FROM mcr.microsoft.com/devcontainers/javascript-node:20@sha256:e7e86bfe03839d7e646e6721e6fa8cc3818ac91a52b03d90f9888e3f4a20a32a

# Enable corepack and pin pnpm version
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate && [ "$(pnpm --version)" = "9.12.0" ]

USER node
