# opencode-cursor-plugin Agent Instructions

**WHAT:** OpenCode Provider plugin exposing Cursor Headless SDK (`@cursor/sdk`) models.
**WHY:** Replaces the legacy `cursor_prompt` tool with a standard ProviderHook, injecting `provider.cursor` for OpenCode integration.

## 🗺️ Progressive Disclosure
To keep context lean, detailed information is separated. Read these when relevant:
- `SPEC.md`: Architecture design, state lifecycle (AgentPool), data flow.
- `README.md`: User setup, installation, environment variables.

## 🛠️ Tech Stack & How to Run
**MUST RUN INSIDE DEVCONTAINER:** Open the project in the Devcontainer and run commands from the repository root, not from the .devcontainer/ directory. This ensures native module (`sqlite3`) compatibility.

- **Stack:** TypeScript (Node.js >= 20), pnpm, Vitest, Biome, Zod.
- **Install:** `pnpm install --frozen-lockfile` (Never use npm/yarn)
- **Lint/Format:** `pnpm lint` (Rely on Biome for styling; do not guess formatting rules)
- **Typecheck:** `pnpm typecheck`
- **Test:** `pnpm test`
- **E2E:** `pnpm test:e2e`

## 📋 Guidelines
1. **Keep it focused:** Do not perform unrelated refactoring or modify core infrastructure (like Devcontainer config) unless explicitly asked.
2. **Safety:** Never stage or commit secrets (e.g., `.env`, private keys).
3. **Logging:** Use the custom `Logger` wrapper. Never log sensitive values like `CURSOR_API_KEY` or full prompts/responses. Use lengths/hashes.
4. **Verification:** Always verify changes by running `pnpm lint`, `pnpm typecheck`, and `pnpm test` before completion.
5. **Let Tools Work:** Delegate code style to the linter (`pnpm lint`).
6. **Provider verification:** After config changes, confirm `opencode models cursor` lists `cursor/composer-2` (or the whitelisted model set).
