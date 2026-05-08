import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Agent } from "@cursor/sdk";
import type { Logger } from "./logger";
import { STATIC_FALLBACK_MODELS } from "./models";

type ProxyServer = {
  baseURL: string;
  close: () => Promise<void>;
};

type ChatMessage = {
  role?: string;
  content?: unknown;
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

function readBody(req: IncomingMessage): Promise<any> {
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
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const typed = part as { type?: string; text?: string };
      return typed.type === "text" && typeof typed.text === "string" ? typed.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

function messagesToPrompt(messages: ChatMessage[]): string {
  return messages
    .map((message) => {
      const role = message.role ?? "user";
      const text = contentToText(message.content);
      return text ? `<${role}>\n${text}\n</${role}>` : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function normalizeModelId(model: unknown): string {
  const modelId = typeof model === "string" && model.trim() ? model.trim() : "composer-2";
  return modelId.startsWith("cursor/") ? modelId.slice("cursor/".length) : modelId;
}

function writeSse(res: ServerResponse, payload: unknown): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function handleChat(req: IncomingMessage, res: ServerResponse, log: Logger): Promise<void> {
  const apiKey = getBearerToken(req) ?? process.env.CURSOR_API_KEY?.trim();
  if (!apiKey) {
    sendJson(res, 401, { error: { message: "Cursor API key is not set" } });
    return;
  }

  const body = await readBody(req);
  const model = normalizeModelId(body.model);
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const prompt = messagesToPrompt(messages);

  if (!body.stream) {
    let text = "";
    const agent = await Agent.create({ apiKey, model: { id: model }, local: { cwd: process.cwd() } });
    try {
      const run = await agent.send(prompt, {
        onDelta(update: any) {
          if (update.type === "text-delta" || update.type === "thinking-delta") text += update.text ?? "";
        },
      });
      await (run as any).wait();
      sendJson(res, 200, {
        id: `cursor-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
      });
    } finally {
      await (agent as any).close?.().catch?.((err: unknown) => {
        log.warn("cursor-openai-proxy: agent close failed", { errorType: err instanceof Error ? err.constructor.name : typeof err });
      });
    }
    return;
  }

  const agent = await Agent.create({ apiKey, model: { id: model }, local: { cwd: process.cwd() } });
  
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });

  try {
    const id = `cursor-${Date.now()}`;
    const run = await agent.send(prompt, {
      onDelta(update: any) {
        if (update.type !== "text-delta" && update.type !== "thinking-delta") return;
        writeSse(res, {
          id,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [{ index: 0, delta: { content: update.text ?? "" }, finish_reason: null }],
        });
      },
    });
    await (run as any).wait();
    writeSse(res, {
      id,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    });
    res.write("data: [DONE]\n\n");
    res.end();
  } finally {
    await (agent as any).close?.().catch?.((err: unknown) => {
      log.warn("cursor-openai-proxy: agent close failed", { errorType: err instanceof Error ? err.constructor.name : typeof err });
    });
  }
}

export async function startOpenAiProxy(log: Logger): Promise<ProxyServer> {
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
        await handleChat(req, res, log);
        return;
      }

      sendJson(res, 404, { error: { message: "Not found" } });
    })().catch((err) => {
      log.warn("cursor-openai-proxy: request failed", { errorType: err instanceof Error ? err.constructor.name : typeof err });
      if (!res.headersSent) {
        sendJson(res, err.message?.includes("limit") ? 413 : 500, { 
          error: { message: err instanceof Error ? err.message : String(err) } 
        });
      } else {
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
