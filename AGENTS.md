# Agent Instructions (AGENTS.md)

Welcome to the `opencode-cursor-plugin` project. This guide provides the essential context you need to assist effectively.

<project_overview>
This is an OpenCode Provider plugin that exposes Cursor Headless SDK (`@cursor/sdk`) models as the primary LLM provider. It replaces the legacy `cursor_prompt` custom tool with a standard ProviderHook implementation and injects `provider.cursor` through the plugin config hook so OpenCode registers the provider correctly.
</project_overview>

<tech_stack>
- **Language:** TypeScript (Node.js >= 20.0.0)
- **Package Manager:** `pnpm` (v9.12.0) - **Do not use npm or yarn.**
- **Testing Framework:** `vitest`
- **Validation:** `zod`
</tech_stack>

<commands>
To verify your changes, please use the following commands. Ideally, these should be run inside the provided Devcontainer (`.devcontainer/`).
- Install dependencies: `pnpm install` (**Never** use npm or yarn)
- Type-checking: `pnpm typecheck`
- Unit tests: `pnpm test`
- Manual E2E helper: `pnpm test:e2e`
</commands>

<documentation_map>
To keep this file lightweight (Progressive Disclosure), detailed context is externalized. Please read the following documents when relevant to your task:

- **`SPEC.md`**: Contains the full architectural design, state lifecycle (e.g., AgentPool exclusive checkout), error handling, and data flow. **Read this before making any architectural changes to `src/` modules.**
- **`README.md`**: Contains user-facing setup instructions, environment variable requirements, and plugin installation guides.
</documentation_map>

<guidelines>
- **Safety First:** **Never** stage or commit sensitive files like `.env`, `.git`, or private keys.
- **Verification:** **Always** ensure `pnpm typecheck` and `pnpm test` pass before considering a task complete. **Do not** bypass security checks.
- **Provider verification:** After config changes, confirm `opencode models cursor` lists `cursor/composer-2` (or the whitelisted model set).
- **Scope:** Focus on the requested task. **Do not** perform unrelated "cleanups" or modify core infrastructure (like GitHub Workflows or Devcontainer configs) unless explicitly asked.
- **Logging:** Use the custom `Logger` wrapper. **Never** log sensitive values (e.g., `CURSOR_API_KEY`, full prompts/responses). Use lengths, hashes, or fingerprints for telemetry.
</guidelines>
