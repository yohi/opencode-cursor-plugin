import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../src/logger.js";
import { createStream } from "../src/stream-proxy.js";

// Ensure mock classes have the correct 'name' property even if minified/transpiled
vi.mock("@cursor/sdk", () => {
	const createMockError = (
		name: string,
		extraProps: Record<string, unknown> = {},
	) => {
		return class extends Error {
			constructor(m: string) {
				super(m);
				this.name = name;
				Object.assign(this, extraProps);
			}
		};
	};

	return {
		AuthenticationError: createMockError("AuthenticationError"),
		ConfigurationError: createMockError("ConfigurationError"),
		RateLimitError: createMockError("RateLimitError"),
		NetworkError: createMockError("NetworkError", { isRetryable: true }),
		IntegrationNotConnectedError: createMockError(
			"IntegrationNotConnectedError",
		),
		UnknownAgentError: createMockError("UnknownAgentError"),
		CursorSdkError: createMockError("CursorSdkError"),
	};
});

const log = createLogger({
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	debug: vi.fn(),
});

type StreamAgent = Parameters<typeof createStream>[0]["agent"];

const fakeAgent = (
	impl: (cb: (update: unknown) => void) => Promise<{ status: string }>,
) =>
	({
		send: vi.fn(
			async (
				_message: string,
				opts: { onDelta: (update: unknown) => void },
			) => {
				const statusResult = await impl(opts.onDelta);
				return { wait: async () => statusResult };
			},
		),
		close: vi.fn(),
	}) as unknown as StreamAgent;

async function collect(stream: ReadableStream<unknown>): Promise<unknown[]> {
	const reader = stream.getReader();
	const out: unknown[] = [];
	while (true) {
		const { value, done } = await reader.read();
		if (done) break;
		out.push(value);
	}
	return out;
}

describe("stream-proxy", () => {
	it("TextDeltaUpdate → text-delta", async () => {
		const agent = fakeAgent(async (onDelta) => {
			onDelta({ update: { type: "text-delta", text: "hello" } });
			onDelta({ update: { type: "turn-ended" } });
			return { status: "finished" };
		});

		const { stream } = createStream({ agent, message: "m", log });
		const parts = await collect(stream);

		expect(
			parts.some((part) => part.type === "text-delta" && part.text === "hello"),
		).toBe(true);
		expect(parts.at(-1)?.type).toBe("finish");
	});

	it("ThinkingDeltaUpdate → reasoning-delta", async () => {
		const agent = fakeAgent(async (onDelta) => {
			onDelta({ update: { type: "thinking-delta", text: "reasoning..." } });
			onDelta({ update: { type: "turn-ended" } });
			return { status: "finished" };
		});

		const { stream } = createStream({ agent, message: "m", log });
		const parts = await collect(stream);

		expect(parts.some((part) => part.type === "reasoning-delta")).toBe(true);
	});

	it("ToolCallStartedUpdate → 警告 text-delta は同 toolCallId で 1 回のみ", async () => {
		const agent = fakeAgent(async (onDelta) => {
			onDelta({
				update: {
					type: "tool-call-started",
					toolCallId: "t1",
					toolName: "shell",
				},
			});
			onDelta({
				update: {
					type: "tool-call-started",
					toolCallId: "t1",
					toolName: "shell",
				},
			});
			onDelta({ update: { type: "turn-ended" } });
			return { status: "finished" };
		});

		const { stream } = createStream({ agent, message: "m", log });
		const parts = await collect(stream);
		const warnings = parts.filter(
			(part) =>
				part.type === "text-delta" && /Cursor agent attempted/.test(part.text),
		);

		expect(warnings).toHaveLength(1);
	});

	it("PartialToolCallUpdate / ToolCallCompletedUpdate はドロップ", async () => {
		const agent = fakeAgent(async (onDelta) => {
			onDelta({ update: { type: "tool-call-partial", arguments: '{"foo":' } });
			onDelta({ update: { type: "tool-call-completed", toolCallId: "t1" } });
			onDelta({ update: { type: "turn-ended" } });
			return { status: "finished" };
		});

		const { stream } = createStream({ agent, message: "m", log });
		const parts = await collect(stream);

		expect(
			parts.some((part) => part.type === "text-delta" && /foo/.test(part.text)),
		).toBe(false);
	});

	it("status=error で error パート enqueue + close (controller.error は呼ばない)", async () => {
		const agent = fakeAgent(async () => ({ status: "error" }));
		const { stream } = createStream({ agent, message: "m", log });
		const parts = await collect(stream);

		expect(parts.some((part) => part.type === "error")).toBe(true);
	});

	it("AbortSignal でストリームがクローズされる", async () => {
		const controller = new AbortController();
		const agent = fakeAgent(async (onDelta) => {
			onDelta({ update: { type: "text-delta", text: "x" } });
			controller.abort();
			await new Promise((resolve) => setTimeout(resolve, 10));
			return { status: "cancelled" };
		});

		const { stream } = createStream({
			agent,
			message: "m",
			log,
			abortSignal: controller.signal,
		});
		const parts = await collect(stream);

		expect(
			parts.some(
				(part) => part.type === "finish" && part.finishReason === "abort",
			),
		).toBe(true);
	});

	it("createStream 開始時に既に abort 済みなら外部 abortSignal の listener を解除する", async () => {
		const controller = new AbortController();
		controller.abort();
		const removeSpy = vi.spyOn(controller.signal, "removeEventListener");
		const agent = fakeAgent(async () => ({ status: "finished" }));

		const { stream, done } = createStream({
			agent,
			message: "m",
			log,
			abortSignal: controller.signal,
		});
		await collect(stream);

		await expect(done).resolves.toMatchObject({ finishReason: "abort" });
		expect(removeSpy).toHaveBeenCalledWith("abort", expect.any(Function));
		expect(agent.send).not.toHaveBeenCalled();
	});

	it("TurnEnded 後の status=finished で重複 close されない (hasClosedStream ガード)", async () => {
		const agent = fakeAgent(async (onDelta) => {
			onDelta({ update: { type: "turn-ended" } });
			return { status: "finished" };
		});

		const { stream, done } = createStream({ agent, message: "m", log });
		await collect(stream);

		await expect(done).resolves.toEqual({ finishReason: "stop" });
	});

	it("done は status=error 経路で finishReason='error' を解決する", async () => {
		const agent = fakeAgent(async () => ({ status: "error" }));

		const { stream, done } = createStream({ agent, message: "m", log });
		await collect(stream);

		await expect(done).resolves.toEqual({ finishReason: "error" });
	});

	it("ReadableStream の cancel() は内部 abort 経路に集約され done は finishReason='abort' を解決する", async () => {
		let releaseAgent!: () => void;
		const agentReleased = new Promise<void>((resolve) => {
			releaseAgent = resolve;
		});
		const agent = fakeAgent(async () => {
			await agentReleased;
			return { status: "cancelled" };
		});

		const { stream, done } = createStream({ agent, message: "m", log });
		const reader = stream.getReader();
		await reader.cancel();
		releaseAgent();

		await expect(done).resolves.toEqual({ finishReason: "abort" });
	});

	it("hasEmittedDelta=true 時の NetworkError はリトライ発火せず error パートを流す", async () => {
		const { NetworkError } = await import("@cursor/sdk");
		const err = new NetworkError("flap");
		const agent = fakeAgent(async (onDelta) => {
			onDelta({ update: { type: "text-delta", text: "first chunk" } });
			throw err;
		});

		const { stream } = createStream({ agent, message: "m", log });
		const parts = await collect(stream);

		expect(parts.filter((part) => part.type === "text-delta")).toHaveLength(1);
		expect(parts.some((part) => part.type === "error")).toBe(true);
	});

	it("未知イベント型は debug ログのみで enqueue しない", async () => {
		const localLog = createLogger({
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			debug: vi.fn(),
		});
		const agent = fakeAgent(async (onDelta) => {
			onDelta({ update: { type: "unknown-future-event" } });
			onDelta({ update: { type: "turn-ended" } });
			return { status: "finished" };
		});

		const { stream } = createStream({ agent, message: "m", log: localLog });
		const parts = await collect(stream);

		expect(parts.some((part) => part.type === "text-delta")).toBe(false);
	});

	it("pre-stream NetworkError リトライ後の status=error で error パートが enqueue される", async () => {
		const { NetworkError } = await import("@cursor/sdk");
		const err = new NetworkError("flap");
		let calls = 0;
		const agent = {
			send: vi.fn(async () => {
				calls += 1;
				if (calls === 1) throw err;
				return { wait: async () => ({ status: "error" }) };
			}),
			close: vi.fn(),
		} as unknown as StreamAgent;

		const { stream, done } = createStream({ agent, message: "m", log });
		const parts = await collect(stream);

		expect(calls).toBe(2);
		expect(parts.some((part) => part.type === "error")).toBe(true);
		await expect(done).resolves.toMatchObject({ finishReason: "error" });
	});

	it("UnknownAgentError + recreateAgent あり: 1 回再試行して成功する", async () => {
		const { UnknownAgentError } = await import("@cursor/sdk");
		const err = new UnknownAgentError("agent gone");
		const oldAgent = {
			send: vi.fn(async () => {
				throw err;
			}),
			close: vi.fn(),
		} as unknown as StreamAgent;
		const newAgent = fakeAgent(async (onDelta) => {
			onDelta({ update: { type: "text-delta", text: "from-new" } });
			onDelta({ update: { type: "turn-ended" } });
			return { status: "finished" };
		});
		const recreateAgent = vi.fn(async () => ({
			agent: newAgent,
			message: "full-prompt",
		}));

		const { stream, done } = createStream({
			agent: oldAgent,
			message: "m",
			log,
			recreateAgent,
		});
		const parts = await collect(stream);

		expect(recreateAgent).toHaveBeenCalledTimes(1);
		expect(newAgent.send).toHaveBeenCalledWith(
			"full-prompt",
			expect.any(Object),
		);
		expect(
			parts.some(
				(part) => part.type === "text-delta" && part.text === "from-new",
			),
		).toBe(true);
		await expect(done).resolves.toEqual({ finishReason: "stop" });
	});

	it("UnknownAgentError + recreateAgent あり: 再試行も失敗すると errorType 付きで終端する", async () => {
		const { UnknownAgentError } = await import("@cursor/sdk");
		const err = new UnknownAgentError("agent gone");
		const oldAgent = {
			send: vi.fn(async () => {
				throw err;
			}),
			close: vi.fn(),
		} as unknown as StreamAgent;
		const recreateAgent = vi.fn(async () => {
			throw new Error("create failed");
		});

		const { stream, done } = createStream({
			agent: oldAgent,
			message: "m",
			log,
			recreateAgent,
		});
		const parts = await collect(stream);

		expect(parts.some((part) => part.type === "error")).toBe(true);
		await expect(done).resolves.toEqual({
			finishReason: "error",
			errorType: "Error",
		});
	});

	it("UnknownAgentError + recreateAgent 後に新 agent.send が失敗したら retryErr の型と pre-stream phase を記録する", async () => {
		const { UnknownAgentError, AuthenticationError } = await import(
			"@cursor/sdk"
		);
		const rawLog = {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			debug: vi.fn(),
		};
		const localLog = createLogger(rawLog);
		const err = new UnknownAgentError("agent gone");
		const retryErr = new AuthenticationError("expired");
		const oldAgent = {
			send: vi.fn(async () => {
				throw err;
			}),
			close: vi.fn(),
		} as unknown as StreamAgent;
		const newAgent = {
			send: vi.fn(async () => {
				throw retryErr;
			}),
			close: vi.fn(),
		} as unknown as StreamAgent;
		const recreateAgent = vi.fn(async () => ({
			agent: newAgent,
			message: "full-prompt",
		}));

		const { stream, done } = createStream({
			agent: oldAgent,
			message: "m",
			log: localLog,
			recreateAgent,
		});
		const parts = await collect(stream);

		expect(parts.some((part) => part.type === "error")).toBe(true);
		await expect(done).resolves.toEqual({
			finishReason: "error",
			errorType: "AuthenticationError",
		});
		expect(newAgent.send).toHaveBeenCalledWith(
			"full-prompt",
			expect.any(Object),
		);
		expect(rawLog.error.mock.calls).toContainEqual([
			"cursor-provider: error captured",
			expect.objectContaining({
				phase: "pre-stream",
				errorType: "AuthenticationError",
			}),
		]);
	});

	it("UnknownAgentError + recreateAgent 実行中に abort されたら新 agent.send は呼ばれず finishReason='abort' で終端する", async () => {
		const { UnknownAgentError } = await import("@cursor/sdk");
		const err = new UnknownAgentError("agent gone");
		const oldAgent = {
			send: vi.fn(async () => {
				throw err;
			}),
			close: vi.fn(),
		} as unknown as StreamAgent;
		const controller = new AbortController();
		const newAgent = fakeAgent(async (onDelta) => {
			onDelta({ update: { type: "text-delta", text: "should-not-appear" } });
			onDelta({ update: { type: "turn-ended" } });
			return { status: "finished" };
		});
		const recreateAgent = vi.fn(async () => {
			controller.abort();
			return { agent: newAgent, message: "full-prompt" };
		});

		const { stream, done } = createStream({
			agent: oldAgent,
			message: "m",
			log,
			abortSignal: controller.signal,
			recreateAgent,
		});
		const parts = await collect(stream);

		expect(recreateAgent).toHaveBeenCalledTimes(1);
		expect(newAgent.send).not.toHaveBeenCalled();
		expect(parts.some((part) => part.type === "text-delta")).toBe(false);
		expect(
			parts.some(
				(part) => part.type === "finish" && part.finishReason === "abort",
			),
		).toBe(true);
		await expect(done).resolves.toMatchObject({ finishReason: "abort" });
	});

	it("UnknownAgentError + recreateAgent なし: リトライせず error パートを流す", async () => {
		const { UnknownAgentError } = await import("@cursor/sdk");
		const err = new UnknownAgentError("agent gone");
		const oldAgent = {
			send: vi.fn(async () => {
				throw err;
			}),
			close: vi.fn(),
		} as unknown as StreamAgent;

		const { stream, done } = createStream({
			agent: oldAgent,
			message: "m",
			log,
		});
		const parts = await collect(stream);

		expect(parts.some((part) => part.type === "error")).toBe(true);
		await expect(done).resolves.toMatchObject({ finishReason: "error" });
	});
});
