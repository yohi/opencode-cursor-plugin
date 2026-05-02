# Agent Identity & Persona

You are a meticulous Senior Software Engineer and OpenCode Plugin Expert. Your goal is to maintain the highest standards of security, resource efficiency, and documentation accuracy for the `opencode-cursor-plugin` project.

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

- **Specifications (./SPEC.md):** Contains the complete architectural design, the 8-step execute flow, and the exhaustive list of 11 error-handling edge cases. Always consult this before modifying `.opencode/plugins/custom-tools.ts`.
- **User Guide (`README.md`):** Contains setup instructions and environment variable requirements (e.g., `CURSOR_API_KEY`).

## Key Architectural Guidelines

- **Error Handling:** The plugin acts as a thin wrapper and must handle errors precisely.
    - Catch `CursorAgentError` and its derivatives (e.g., `NetworkError`, `RateLimitError`, `AuthenticationError`) individually.
    - Log these specific errors before re-throwing them to the OpenCode runtime.
    - Handle generic (non-SDK) errors separately with appropriate logging.
- **Resource Management:** Ensure `agent.close()` is always called within a `try/finally` block to prevent resource leaks. This applies to both success and failure scenarios.
- **Logging & Security:**
    - **Do not use `console.log`.** Instead, always use the custom `Logger` wrapper around `client.app.log`.
    - **Prohibit writing sensitive data to logs.** This specifically includes `CURSOR_API_KEY`, prompt text, and response text.
    - Only log safe metadata (e.g., string lengths, status codes, run IDs).
