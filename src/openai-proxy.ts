import {
	type IncomingMessage,
	type Server,
	type ServerResponse,
	createServer,
} from "node:http";
import type { SDKAgent } from "@cursor/sdk";
import { disposeAgentSafely } from "./agent-cleanup.js";
import type { AgentPool } from "./agent-pool.js";
import { fingerprintApiKey } from "./agent-pool.js";
import { classifyError, logError } from "./errors.js";
import type { Logger } from "./logger.js";
import { STATIC_FALLBACK_MODELS } from "./models.js";
import { type ModelV2Prompt, translate } from "./translator.js";

function extractErrorInfo(err: unknown): {
	name: string;
	code?: string | number;
	message: string;
	details?: unknown;
} {
	const isObj = typeof err === "object" && err !== null;
	const errObj = isObj ? (err as Record<string, unknown>) : {};

	return {
		name: typeof errObj.name === "string" ? errObj.name : "UnknownError",
		code:
			typeof errObj.code === "string" || typeof errObj.code === "number"
				? errObj.code
				: undefined,
		message: err instanceof Error ? err.message : String(err),
		details: errObj.details,
	};
}

type ProxyServer = {
	baseURL: string;
	close: () => Promise<void>;
};

type ChatMessage = {
	role: "system" | "user" | "assistant" | "tool";
	content:
		| string
		| Array<{ type: string; text?: string; [k: string]: unknown }>;
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
				reject(
					new Error(`Request body exceeds limit of ${MAX_BODY_BYTES} bytes`),
				);
				return;
			}
			raw += chunk;
		});
		req.on("end", () => {
			try {
				if (!raw) return resolve({ model: "composer-2", messages: [] });
				const body = JSON.parse(raw);
				if (!body || typeof body !== "object")
					throw new Error("BAD_REQUEST: Invalid JSON body");

				// Ensure model is a string and has a default
				if (body.model === undefined || body.model === null) {
					body.model = "composer-2";
				}
				if (typeof body.model !== "string")
					throw new Error("BAD_REQUEST: model must be a string");

				if (!Array.isArray(body.messages))
					throw new Error("BAD_REQUEST: messages must be an array");

				// Runtime validation of messages
				for (const msg of body.messages) {
					if (!msg || typeof msg !== "object")
						throw new Error("BAD_REQUEST: Invalid message in messages");
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

async function handleChat(
	req: IncomingMessage,
	res: ServerResponse,
	log: Logger,
	pool: AgentPool,
): Promise<void> {
	const rawToken = getBearerToken(req) ?? process.env.CURSOR_API_KEY?.trim();
	const apiKey =
		rawToken && rawToken !== "undefined" && rawToken !== "null"
			? rawToken
			: undefined;

	log.debug("cursor-openai-proxy: received request", {
		hasApiKey: !!apiKey,
		apiKeyFingerprint: apiKey ? fingerprintApiKey(apiKey) : null,
		model: req.method === "POST" ? "checking-body" : "n/a",
	});

	if (!apiKey) {
		sendJson(res, 401, {
			error: { message: "Cursor API key is not set or invalid" },
		});
		return;
	}

	const body = await readBody(req);
	let modelId = body.model.startsWith("cursor/")
		? body.model.slice("cursor/".length)
		: body.model;

	// Map simulated/unknown models to a known valid Cursor model to avoid invalid_argument errors from the real backend
	const validCursorModels = STATIC_FALLBACK_MODELS.map((m) => m.id);
	if (!validCursorModels.includes(modelId)) {
		log.warn("cursor-openai-proxy: mapping unknown model to composer-2", {
			originalModel: modelId,
		});
		modelId = "composer-2";
	}

	const messages = body.messages as ModelV2Prompt;

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
	let agent: SDKAgent | undefined;
	let messageToSend: string | undefined;

	if (hit) {
		agent = hit.agent;
		messageToSend = translated.latestUserMessage;
		log.debug("cursor-openai-proxy: pool hit", {
			prefixHash: translated.prefixHash.slice(0, 8),
		});
	} else {
		const maxRetries = 3;
		let attempt = 0;
		const { Agent } = (await import("@cursor/sdk")) as {
			Agent: typeof import("@cursor/sdk").Agent;
		};

		while (attempt < maxRetries) {
			attempt++;
			try {
				log.debug("cursor-openai-proxy: calling Agent.create (local mode)", {
					modelId,
				});

				agent = await Agent.create({
					apiKey,
					model: { id: modelId },
					local: { cwd: process.cwd() },
				});
				messageToSend = translated.fullPromptOnMiss;
				log.debug("cursor-openai-proxy: pool miss", {
					prefixHash: translated.prefixHash.slice(0, 8),
				});
				break;
			} catch (err: unknown) {
				const decision = classifyError(err, { phase: "create" });
				const canRetry = attempt < maxRetries && decision.retry;
				const info = extractErrorInfo(err);

				logError(log, err, {
					phase: "create",
					model: modelId,
					attempt,
					maxRetries,
					canRetry,
					errName: info.name,
					errCode: info.code,
					errMessage: info.message,
					details: info.details,
				});

				if (!canRetry) {
					if (!res.headersSent) {
						sendJson(res, 500, {
							error: {
								message: `Cursor Agent creation failed: [${info.name}${info.code ? `:${info.code}` : ""}] ${info.message} | Details: ${JSON.stringify(info.details || {})}`,
								type: "server_error",
							},
						});
					}
					return;
				}

				const delay = decision.delayMs * 2 ** (attempt - 1);
				await new Promise((resolve) => setTimeout(resolve, delay));
			}
		}
	}

	if (!agent || !messageToSend) {
		if (!res.headersSent) {
			sendJson(res, 500, {
				error: {
					message: "Internal server error: agent or message missing",
					type: "server_error",
				},
			});
		}
		return;
	}

	if (!body.stream) {
		let text = "";
		try {
			const run = await agent.send(messageToSend, {
				onDelta: (args) => {
					const update = args.update;
					if (
						update.type === "text-delta" ||
						update.type === "thinking-delta"
					) {
						text += update.text ?? "";
					}
				},
			});

			const result = await run.wait();

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
					choices: [
						{
							index: 0,
							message: { role: "assistant", content: text },
							finish_reason: "stop",
						},
					],
				});
			} else {
				log.warn("cursor-openai-proxy: run non-finished", {
					status: result.status,
				});
				await disposeAgentSafely(agent, log);
				sendJson(res, 500, {
					error: { message: `Cursor run failed with status: ${result.status}` },
				});
			}
		} catch (err: unknown) {
			const info = extractErrorInfo(err);

			log.error("cursor-openai-proxy: handleChat non-streaming error", {
				errorName: info.name,
				errorCode: info.code,
				message: info.message,
			});
			await disposeAgentSafely(agent, log);
			if (!res.headersSent) {
				sendJson(res, 500, {
					error: {
						message: `Cursor execution error: [${info.name}${info.code ? `:${info.code}` : ""}] ${info.message}`,
					},
				});
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
			onDelta(args) {
				const update = args.update;
				if (update.type !== "text-delta" && update.type !== "thinking-delta")
					return;
				writeSse(res, {
					id,
					object: "chat.completion.chunk",
					created: Math.floor(Date.now() / 1000),
					model: body.model,
					choices: [
						{
							index: 0,
							delta: { content: update.text ?? "" },
							finish_reason: null,
						},
					],
				});
			},
		});

		const result = await run.wait();

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
			log.warn("cursor-openai-proxy: run non-finished (streaming)", {
				status: result.status,
			});
			await disposeAgentSafely(agent, log);
			writeSse(res, {
				error: { message: `Cursor run failed with status: ${result.status}` },
			});
		}
		res.end();
	} catch (err: unknown) {
		const info = extractErrorInfo(err);

		log.error("cursor-openai-proxy: handleChat caught an error", {
			errorName: info.name,
			errorCode: info.code,
			message: info.message,
		});
		await disposeAgentSafely(agent, log);
		if (res.headersSent) {
			res.write(
				`data: ${JSON.stringify({ error: { message: `Cursor execution error: [${info.name}${info.code ? `:${info.code}` : ""}] ${info.message}` } })}\n\n`,
			);
		} else {
			sendJson(res, 500, {
				error: {
					message: `Cursor execution error: [${info.name}${info.code ? `:${info.code}` : ""}] ${info.message}`,
				},
			});
		}
		res.end();
	}
}

export async function startOpenAiProxy(
	log: Logger,
	pool: AgentPool,
): Promise<ProxyServer> {
	const server = createServer((req, res) => {
		void (async () => {
			const url = new URL(req.url ?? "/", "http://127.0.0.1");
			if (
				req.method === "GET" &&
				(url.pathname === "/v1/models" || url.pathname === "/models")
			) {
				sendJson(res, 200, {
					object: "list",
					data: STATIC_FALLBACK_MODELS.map((model) => ({
						id: model.id,
						object: "model",
						owned_by: "cursor",
					})),
				});
				return;
			}

			if (
				req.method === "POST" &&
				(url.pathname === "/v1/chat/completions" ||
					url.pathname === "/chat/completions")
			) {
				await handleChat(req, res, log, pool);
				return;
			}

			sendJson(res, 404, { error: { message: "Not found" } });
		})().catch((err: unknown) => {
			const message = err instanceof Error ? err.message : String(err);
			log.warn("cursor-openai-proxy: request failed", {
				errorType: err instanceof Error ? err.constructor.name : typeof err,
				message,
			});

			if (!res.headersSent) {
				let status = 500;
				if (message.includes("limit")) status = 413;
				else if (message.includes("BAD_REQUEST:")) status = 400;

				sendJson(res, status, {
					error: { message: message.replace("BAD_REQUEST: ", "") },
				});
			} else {
				if (res.getHeader("content-type") === "text/event-stream") {
					res.write(
						`data: ${JSON.stringify({ error: { message: err instanceof Error ? err.message : String(err) } })}\n\n`,
					);
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
			if (!p)
				reject(new Error("cursor-openai-proxy: failed to resolve listen port"));
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
