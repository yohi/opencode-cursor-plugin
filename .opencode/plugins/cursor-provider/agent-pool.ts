import { createHash } from "node:crypto";
import type { SDKAgent } from "@cursor/sdk";
import { disposeAgentSafely } from "./agent-cleanup";
import type { Logger } from "./logger";

export interface PooledAgent {
  agent: SDKAgent;
  lastUsedAt: number;
  modelId: string;
  apiKeyFingerprint: string;
}

export interface AgentPool {
  tryGet(hash: string, modelId: string, apiKey: string): PooledAgent | undefined;
  put(hash: string, agent: PooledAgent): Promise<void>;
  closeAll(): Promise<void>;
}

export function fingerprintApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

function poolKey(fingerprint: string, modelId: string, hash: string): string {
  return `${fingerprint}:${modelId}:${hash}`;
}

export function createAgentPool(deps: { log: Logger; capacity: number }): AgentPool {
  const { log, capacity } = deps;
  if (!Number.isInteger(capacity) || capacity < 0) {
    throw new RangeError("capacity must be a non-negative integer");
  }
  const map = new Map<string, PooledAgent>();

  const evictIfNeeded = async () => {
    while (map.size > capacity) {
      const oldest = [...map.entries()].reduce((min, curr) => (curr[1].lastUsedAt < min[1].lastUsedAt ? curr : min));
      if (!oldest) return;

      const [key, entry] = oldest;
      map.delete(key);
      log.info("cursor-provider: pool eviction", {
        modelId: entry.modelId,
        apiKeyFingerprint: entry.apiKeyFingerprint,
      });
      await disposeAgentSafely(entry.agent, log);
    }
  };

  return {
    tryGet(hash, modelId, apiKey) {
      const key = poolKey(fingerprintApiKey(apiKey), modelId, hash);
      const entry = map.get(key);
      if (!entry) return undefined;

      // Exclusive checkout: 取得したらプールから削除する
      map.delete(key);
      entry.lastUsedAt = Date.now();
      return entry;
    },
    async put(hash, entry) {
      entry.lastUsedAt = Date.now();
      const key = poolKey(entry.apiKeyFingerprint, entry.modelId, hash);
      const displaced = map.get(key);

      map.set(key, entry);
      if (displaced && displaced.agent !== entry.agent) {
        log.info("cursor-provider: pool displaced same-key entry", {
          modelId: entry.modelId,
          apiKeyFingerprint: entry.apiKeyFingerprint,
        });
        await disposeAgentSafely(displaced.agent, log);
      }

      await evictIfNeeded();
    },
    async closeAll() {
      const entries = [...map.values()];
      map.clear();
      await Promise.allSettled(entries.map((entry) => disposeAgentSafely(entry.agent, log)));
    },
  };
}
