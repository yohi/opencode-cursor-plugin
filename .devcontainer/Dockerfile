FROM mcr.microsoft.com/devcontainers/javascript-node:20@sha256:9145cd56d93222139e555e537f2662de1d24706155f68f3bfc6bbcb548daeae8

# Enable corepack and pin pnpm version
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate && [ "$(pnpm --version)" = "9.12.0" ]

USER node
