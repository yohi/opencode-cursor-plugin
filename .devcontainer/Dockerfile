FROM mcr.microsoft.com/devcontainers/typescript-node@sha256:e37faeaf8e940ea41e840a988d2a0f7ff272b3d29b0b7db1d8861f9d5d1328ec

# Enable corepack and pin pnpm version
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate && [ "$(pnpm --version)" = "9.12.0" ]

USER node
