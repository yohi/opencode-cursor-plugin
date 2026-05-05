import { createHash } from "node:crypto";

export interface PooledAgent {
  agent: any;
  lastUsedAt: number;
  modelId: string;
  apiKeyFingerprint: string;
}

export interface AgentPool {
  tryGet(prefixHash: string, modelId: string, apiKey: string): PooledAgent | undefined;
  put(nextHash: string, pooled: PooledAgent): Promise<void>;
  closeAll(): Promise<void>;
}

export function fingerprintApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

export function createAgentPool(deps: { log: any; capacity?: number }): AgentPool {
  const { log, capacity = 8 } = deps;
  const pool = new Map<string, PooledAgent>();

  return {
    tryGet(prefixHash, modelId, apiKey) {
      const entry = pool.get(prefixHash);
      if (!entry) return undefined;

      const fingerprint = fingerprintApiKey(apiKey);
      if (entry.modelId !== modelId || entry.apiKeyFingerprint !== fingerprint) {
        return undefined;
      }

      pool.delete(prefixHash);
      return entry;
    },

    async put(nextHash, pooled) {
      if (pool.size >= capacity) {
        const oldestKey = Array.from(pool.keys())[0];
        if (oldestKey !== undefined) {
          const oldest = pool.get(oldestKey);
          pool.delete(oldestKey);
          if (oldest) {
            const { disposeAgentSafely } = await import("./agent-cleanup.js");
            await disposeAgentSafely(oldest.agent, log);
          }
        }
      }
      pool.set(nextHash, pooled);
    },

    async closeAll() {
      const { disposeAgentSafely } = await import("./agent-cleanup.js");
      const agents = Array.from(pool.values());
      pool.clear();
      await Promise.all(agents.map((p) => disposeAgentSafely(p.agent, log)));
    },
  };
}
