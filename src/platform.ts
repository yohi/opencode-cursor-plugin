import { createAgentPlatform, InMemoryRunEventNotifier } from "@cursor/sdk";
import type { AgentRunStore, AgentCheckpointStore, RunEventStore, CreateAgentInput } from "@cursor/sdk";
import crypto from "node:crypto";

/**
 * Creates a minimal, in-memory platform for @cursor/sdk to avoid
 * the native sqlite3 dependency which causes issues in CLI environments.
 */
export async function getInMemoryPlatform() {
  const noopStore: AgentRunStore = {
    getAgent: async () => null,
    createAgent: async (input: CreateAgentInput) => ({
      agent: { agentId: input.agentId || `agent-${crypto.randomUUID()}` },
      run: { runId: `run-${crypto.randomUUID()}` },
    }),
    listAgents: async () => ({ items: [] }),
    getRun: async () => null,
    listRuns: async () => ({ items: [] }),
    markRunStarting: async () => {},
    markRunTerminal: async () => {},
    createFollowUpRun: async () => ({ runId: `run-${crypto.randomUUID()}` }),
    archiveAgent: async () => {},
    unarchiveAgent: async () => {},
    deleteAgent: async () => {},
    patchCheckpoint: async () => {},
    cancelRun: async () => {},
  };

  const noopCheckpointStore: AgentCheckpointStore = {
    loadLatest: async () => null,
    saveCheckpoint: async () => "cp-ref",
    getBlobStore: async () => ({
      get: async () => null,
      put: async () => {},
      delete: async () => {},
    }),
    getFullConversation: async () => ({ turns: [] }),
    deleteAgent: async () => {},
  };

  const noopEventStore: RunEventStore = {
    appendRunEvent: async () => ({ runId: `run-${crypto.randomUUID()}`, offset: 0 }),
    listRunEvents: async () => ({ items: [] }),
    deleteRunEvents: async () => {},
  };

  return await createAgentPlatform({
    store: noopStore,
    checkpointStore: noopCheckpointStore,
    eventStore: noopEventStore,
    eventNotifier: new InMemoryRunEventNotifier(),
  });
}
