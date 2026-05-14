import { createAgentPlatform, InMemoryRunEventNotifier } from "@cursor/sdk";

/**
 * Creates a minimal, in-memory platform for @cursor/sdk to avoid
 * the native sqlite3 dependency which causes issues in CLI environments.
 */
export async function getInMemoryPlatform() {
  const noopStore: any = {
    getAgent: async () => null,
    createAgent: async (input: any) => ({
      agent: { agentId: input.agentId || "default" },
      run: { runId: "initial-run" },
    }),
    listAgents: async () => ({ items: [] }),
    getRun: async () => null,
    listRuns: async () => ({ items: [] }),
    markRunStarting: async () => {},
    markRunTerminal: async () => {},
    createFollowUpRun: async () => ({ runId: "follow-up" }),
    archiveAgent: async () => {},
    unarchiveAgent: async () => {},
    deleteAgent: async () => {},
    patchCheckpoint: async () => {},
    cancelRun: async () => {},
  };

  const noopCheckpointStore: any = {
    loadLatest: async () => null,
    saveCheckpoint: async () => "cp-ref",
    getBlobStore: async () => ({}),
    getFullConversation: async () => ({ turns: [] }),
    deleteAgent: async () => {},
  };

  const noopEventStore: any = {
    appendRunEvent: async () => ({ runId: "run", offset: 0 }),
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
