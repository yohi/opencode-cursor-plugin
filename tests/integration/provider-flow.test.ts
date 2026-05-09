import { describe, expect, it, vi } from "vitest";
import { createAgentPool } from "../../src/agent-pool.js";
import { createLogger } from "../../src/logger.js";
import { createProviderHook } from "../../src/provider.js";

vi.mock("@cursor/sdk", async () => {
  const agents: any[] = [];
  return {
    Cursor: {
      models: {
        list: vi.fn().mockResolvedValue([{ id: "composer-2", name: "C2", contextWindow: 200_000 }]),
      },
    },
    Agent: {
      create: vi.fn(async () => {
        const agent = {
          send: vi.fn(async (_message: string, opts: any) => {
            opts.onDelta({ type: "text-delta", text: "hello" });
            opts.onDelta({ type: "turn-ended" });
            return { wait: async () => ({ status: "finished" }) };
          }),
          [Symbol.asyncDispose]: vi.fn().mockResolvedValue(undefined),
          close: vi.fn(),
          _id: agents.length,
        };
        agents.push(agent);
        return agent;
      }),
    },
    AuthenticationError: class extends Error {},
    ConfigurationError: class extends Error {},
    RateLimitError: class extends Error {},
    NetworkError: class extends Error { isRetryable = true; },
    IntegrationNotConnectedError: class extends Error {},
    UnknownAgentError: class extends Error {},
    CursorSdkError: class extends Error {},
    __agents: agents,
  };
});

const log = createLogger({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });
const system = (text: string) => ({ role: "system" as const, content: text });
const user = (text: string) => ({ role: "user" as const, content: [{ type: "text" as const, text }] });

async function drain(stream: ReadableStream<any>) {
  const reader = stream.getReader();
  const out: any[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    out.push(value);
  }
  return out;
}

describe("integration: provider-flow", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const sdk = await import("@cursor/sdk");
    (sdk as any).__agents.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("プールミス → put、続いてプールヒット → rekey", async () => {
    const pool = createAgentPool({ log, capacity: 8 });
    const hook = createProviderHook({ resolveApiKey: async () => "test-key", log, pool, cwd: "/test/cwd" });
    const models = await hook.models?.("cursor" as any, {} as any);
    const model: any = models?.["composer-2"];
    expect(model).toBeDefined();

    const first = await model.doStream({ prompt: [system("S"), user("U1")] });
    await drain(first.stream);

    const sdk = await import("@cursor/sdk");
    await vi.waitFor(() => {
      expect((sdk as any).__agents.length).toBe(1);
    });

    const second = await model.doStream({
      prompt: [system("S"), user("U1"), { role: "assistant", content: [{ type: "text", text: "R1" }] }, user("U2")],
    });
    await drain(second.stream);

    expect((sdk as any).__agents.length).toBe(1);
  });

  it("LRU 退避: 容量超過で最古 agent が dispose される", async () => {
    const sdk = await import("@cursor/sdk");
    const beforeAgents = (sdk as any).__agents.length;
    const pool = createAgentPool({ log, capacity: 2 });
    const hook = createProviderHook({ resolveApiKey: async () => "test-key", log, pool, cwd: "/test/cwd" });
    const models = await hook.models?.("cursor" as any, {} as any);
    const model: any = models?.["composer-2"];

    for (const prompt of ["U1", "U2", "U3"]) {
      const result = await model.doStream({ prompt: [system("S"), user(prompt)] });
      await drain(result.stream);
    }

    await vi.waitFor(() => {
      const createdInTest = (sdk as any).__agents.slice(beforeAgents);
      expect(createdInTest[0][Symbol.asyncDispose]).toHaveBeenCalled();
    });
  });

  it("キャンセル後の次ターンで前ターンと別 agent が生成される", async () => {
    const sdk = await import("@cursor/sdk");
    const originalCreate = vi.mocked(sdk.Agent.create);
    let created = 0;
    originalCreate.mockImplementation(async () => {
      created += 1;
      if (created === 1) {
        return {
          send: vi.fn(async (_message: string, opts: any) => {
            opts.onDelta({ type: "text-delta", text: "hello" });
            await new Promise((resolve) => setTimeout(resolve, 10));
            return { wait: async () => ({ status: "cancelled" }) };
          }),
          [Symbol.asyncDispose]: vi.fn().mockResolvedValue(undefined),
          close: vi.fn(),
        } as any;
      }

      const agent = {
        send: vi.fn(async (_message: string, opts: any) => {
          opts.onDelta({ type: "text-delta", text: "hello" });
          opts.onDelta({ type: "turn-ended" });
          return { wait: async () => ({ status: "finished" }) };
        }),
        [Symbol.asyncDispose]: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
      } as any;
      (sdk as any).__agents.push(agent);
      return agent;
    });

    try {
      const pool = createAgentPool({ log, capacity: 8 });
      const hook = createProviderHook({ resolveApiKey: async () => "test-key", log, pool, cwd: "/test/cwd" });
      const models = await hook.models?.("cursor" as any, {} as any);
      const model: any = models?.["composer-2"];

      const controller = new AbortController();
      const first = await model.doStream({ prompt: [system("S"), user("U1")], abortSignal: controller.signal });
      controller.abort();
      await drain(first.stream);

      const before = (sdk as any).__agents.length;

      const second = await model.doStream({
        prompt: [system("S"), user("U1"), { role: "assistant", content: [{ type: "text", text: "R1" }] }, user("U2")],
      });
      await drain(second.stream);

      await vi.waitFor(() => {
        expect((sdk as any).__agents.length).toBe(before + 1);
      });
    } finally {
      originalCreate.mockRestore();
    }
  });
});
