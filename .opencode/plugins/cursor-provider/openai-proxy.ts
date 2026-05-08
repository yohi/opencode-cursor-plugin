import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Agent } from "@cursor/sdk";
import type { Logger } from "./logger";
import { STATIC_FALLBACK_MODELS } from "./models";
import { translate, type LanguageModelV2Prompt } from "./translator";
import type { AgentPool } from "./agent-pool";
import { fingerprintApiKey } from "./agent-pool";
import { disposeAgentSafely } from "./agent-cleanup";

type ProxyServer = {
  baseURL: string;
  close: () => Promise<void>;
};

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | Array<{ type: string; text?: string; [k: string]: any }>;
};

type ChatCompletionRequest = {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
};

const MAX_BODY_BYTES = 1 * 1024 * 1024; // 1MB

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function getBearerToken(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return undefined;
  const token = header.slice("Bearer ".length).trim();
  return token && token !== "cursor" ? token : undefined;
}

function readBody(req: IncomingMessage): Promise<ChatCompletionRequest> {
  return new Promise((resolve, reject) => {
    let raw = "";
    let length = 0;
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      length += Buffer.byteLength(chunk);
      if (length > MAX_BODY_BYTES) {
        req.removeAllListeners();
        reject(new Error(`Request body exceeds limit of ${MAX_BODY_BYTES} bytes`));
        return;
      }
      raw += chunk;
    });
    req.on("end", () => {
      try {
        if (!raw) return resolve({ model: "composer-2", messages: [] });
        const body = JSON.parse(raw);
        if (!body || typeof body !== "object") throw new Error("BAD_REQUEST: Invalid JSON body");
        
        // Ensure model is a string and has a default
        if (body.model === undefined || body.model === null) {
          body.model = "composer-2";
        }
        if (typeof body.model !== "string") throw new Error("BAD_REQUEST: model must be a string");
        
        if (!Array.isArray(body.messages)) throw new Error("BAD_REQUEST: messages must be an array");
        
        // Runtime validation of messages
        for (const msg of body.messages) {
          if (!msg || typeof msg !== "object") throw new Error("BAD_REQUEST: Invalid message in messages");
          if (!["system", "user", "assistant", "tool"].includes(msg.role)) {
            throw new Error(`BAD_REQUEST: Invalid role: ${msg.role}`);
          }
        }

        resolve(body as ChatCompletionRequest);
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function writeSse(res: ServerResponse, payload: unknown): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function handleChat(req: IncomingMessage, res: ServerResponse, log: Logger, pool: AgentPool, cwd: string): Promise<void> {
  const apiKey = getBearerToken(req) ?? process.env.CURSOR_API_KEY?.trim();
  if (!apiKey) {
    sendJson(res, 401, { error: { message: "Cursor API key is not set" } });
    return;
  }

  const body = await readBody(req);
  const modelId = body.model.startsWith("cursor/") ? body.model.slice("cursor/".length) : body.model;
  const messages = body.messages as LanguageModelV2Prompt;
  
  if (messages.length === 0) {
    sendJson(res, 400, { error: { message: "messages is empty" } });
    return;
  }

  const translated = translate(messages);
  const fingerprint = fingerprintApiKey(apiKey);
  const hit = pool.tryGet(translated.prefixHash, modelId, apiKey);
  const controller = new AbortController();
  
  const onDisconnect = () => {
    log.debug("cursor-openai-proxy: client disconnected");
    controller.abort();
  };
  req.on("aborted", onDisconnect);
  res.on("close", onDisconnect);

  let agent: any;
  let messageToSend: string;

  if (hit) {
    agent = hit.agent;
    messageToSend = translated.latestUserMessage;
    log.debug("cursor-openai-proxy: pool hit", { prefixHash: translated.prefixHash.slice(0, 8) });
  } else {
    try {
      agent = await Agent.create({ apiKey, model: { id: modelId }, local: { cwd } });
      messageToSend = translated.fullPromptOnMiss;
      log.debug("cursor-openai-proxy: pool miss", { prefixHash: translated.prefixHash.slice(0, 8) });
    } catch (err) {
      if (!res.headersSent) {
        sendJson(res, 500, { error: { message: `Agent creation failed: ${err instanceof Error ? err.message : String(err)}` } });
      }
      return;
    }
  }

  if (!body.stream) {
    let text = "";
    try {
      const run = await agent.send(messageToSend, {
        onDelta(update: any) {
          if (update.type === "text-delta" || update.type === "thinking-delta") text += update.text ?? "";
        },
      });

      const waitPromise = (run as any).wait();
      const result = await Promise.race([
        waitPromise,
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
      ]);

      if (result.status === "finished") {
        await pool.put(translated.nextHash, {
          agent,
          lastUsedAt: Date.now(),
          modelId,
          apiKeyFingerprint: fingerprint,
        });
        sendJson(res, 200, {
          id: `cursor-${Date.now()}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: body.model,
          choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
        });
      } else {
        await disposeAgentSafely(agent, log);
      }
    } catch (err) {
      await disposeAgentSafely(agent, log);
      if (!res.headersSent) {
        sendJson(res, 500, { error: { message: err instanceof Error ? err.message : String(err) } });
      }
    }
    return;
  }

  // SSE Path
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });

  try {
    const id = `cursor-${Date.now()}`;
    const run = await agent.send(messageToSend, {
      onDelta(update: any) {
        if (update.type !== "text-delta" && update.type !== "thinking-delta") return;
        writeSse(res, {
          id,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: body.model,
          choices: [{ index: 0, delta: { content: update.text ?? "" }, finish_reason: null }],
        });
      },
    });

    const waitPromise = (run as any).wait();
    const result = await Promise.race([
      waitPromise,
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener("abort", () => reject(new Error("aborted")));
      }),
    ]);

    if (result.status === "finished") {
      await pool.put(translated.nextHash, {
        agent,
        lastUsedAt: Date.now(),
        modelId,
        apiKeyFingerprint: fingerprint,
      });
      writeSse(res, {
        id,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: body.model,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      });
      res.write("data: [DONE]\n\n");
    } else {
      await disposeAgentSafely(agent, log);
    }
    res.end();
  } catch (err) {
    await disposeAgentSafely(agent, log);
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ error: { message: err instanceof Error ? err.message : String(err) } })}\n\n`);
    } else {
      sendJson(res, 500, { error: { message: err instanceof Error ? err.message : String(err) } });
    }
    res.end();
  }
}

export async function startOpenAiProxy(log: Logger, pool: AgentPool, cwd: string): Promise<ProxyServer> {
  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method === "GET" && (url.pathname === "/v1/models" || url.pathname === "/models")) {
        sendJson(res, 200, {
          object: "list",
          data: STATIC_FALLBACK_MODELS.map((model) => ({ id: model.id, object: "model", owned_by: "cursor" })),
        });
        return;
      }

      if (req.method === "POST" && (url.pathname === "/v1/chat/completions" || url.pathname === "/chat/completions")) {
        await handleChat(req, res, log, pool, cwd);
        return;
      }

      sendJson(res, 404, { error: { message: "Not found" } });
    })().catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      log.warn("cursor-openai-proxy: request failed", { errorType: err instanceof Error ? err.constructor.name : typeof err, message });
      
      if (!res.headersSent) {
        let status = 500;
        if (message.includes("limit")) status = 413;
        else if (message.includes("BAD_REQUEST:")) status = 400;

        sendJson(res, status, { 
          error: { message: message.replace("BAD_REQUEST: ", "") } 
        });
      } else {
        if (res.getHeader("content-type") === "text/event-stream") {
          res.write(`data: ${JSON.stringify({ error: { message: err instanceof Error ? err.message : String(err) } })}\n\n`);
        }
        res.end();
      }
    });
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      const p = typeof address === "object" && address ? address.port : 0;
      if (!p) reject(new Error("cursor-openai-proxy: failed to resolve listen port"));
      else resolve(p);
    });
  });

  return {
    baseURL: `http://127.0.0.1:${port}/v1`,
    close: () => closeServer(server),
  };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof server.closeAllConnections === "function") {
      server.closeAllConnections();
    }
    server.close((err) => (err ? reject(err) : resolve()));
  });
}
