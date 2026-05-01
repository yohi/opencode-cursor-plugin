FROM mcr.microsoft.com/devcontainers/typescript-node:20-bookworm

# Enable corepack and pin pnpm version
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate && [ "$(pnpm --version)" = "9.12.0" ]

USER node
