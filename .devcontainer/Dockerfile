FROM mcr.microsoft.com/devcontainers/javascript-node:26@sha256:4feb613079d3d74e5fd59b08c9ff377f3b0b404a1954b7aac65bd6a21fa77d23

# Enable corepack and pin pnpm version
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate && [ "$(pnpm --version)" = "9.12.0" ]

USER node
