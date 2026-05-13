FROM mcr.microsoft.com/devcontainers/javascript-node:20

# Enable corepack and pin pnpm version
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate && [ "$(pnpm --version)" = "9.12.0" ]

USER node
