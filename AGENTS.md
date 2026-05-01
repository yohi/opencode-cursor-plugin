# opencode-cursor-plugin

This is an OpenCode custom tool plugin that exposes the Cursor SDK (`@cursor/sdk`) as a single `cursor_prompt` tool. It allows OpenCode agents to send prompts to a local Cursor agent and retrieve the text response.

## Tech Stack & Tooling

- **Language:** TypeScript (Node.js >= 20.0.0)
- **Package Manager:** `pnpm` (v9.12.0) - **Do NOT use npm or yarn.**
- **Testing:** `vitest`
- **Validation:** `zod`

## Key Commands

- Install dependencies: `pnpm install`
- Run type-checking: `pnpm typecheck`
- Run unit tests: `pnpm test`
- **Note:** All development, testing, and type-checking should ideally be performed inside the provided Devcontainer.

## Progressive Disclosure & Documentation

For detailed context, please refer to the following documents before making architectural changes:

- **Specifications (`SPEC.md`):** Contains the complete architectural design, the 7-step execute flow, and the exhaustive list of 11 error handling edge cases. Always consult this before modifying `.opencode/plugins/custom-tools.ts`.
- **User Guide (`README.md`):** Contains setup instructions and environment variable requirements (e.g., `CURSOR_API_KEY`).

## Key Architectural Guidelines

- **Error Handling:** The plugin acts as a thin wrapper. It must catch `CursorAgentError` derived exceptions (e.g., `NetworkError`, `RateLimitError`), log them appropriately, and re-throw them to the OpenCode runtime.
- **Resource Management:** Always ensure `agent.close()` is called within a `try/finally` block to prevent resource leaks, regardless of success or failure.
- **Logging & Security:** **NEVER use `console.log`.** Use the custom `Logger` wrapper around `client.app.log`. You MUST ensure that sensitive information (such as `CURSOR_API_KEY`, prompt text, and response text) is NEVER written to the logs. Only log safe metadata (e.g., string lengths, status codes, run IDs).
