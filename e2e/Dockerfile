ARG NODE_IMAGE=node:22.22.2-bookworm-slim
FROM ${NODE_IMAGE}

ENV CI=1 \
    NO_UPDATE_NOTIFIER=1 \
    npm_config_audit=false \
    npm_config_fund=false \
    npm_config_update_notifier=false

WORKDIR /repo

RUN npm install -g pnpm@10.1.0

COPY package.json pnpm-lock.yaml tsconfig.json tsconfig.build.json vitest.config.ts oxlint.config.ts oxfmt.config.ts ./
COPY README.md LICENSE ./
COPY prompts ./prompts
COPY skills ./skills
COPY src ./src
COPY e2e ./e2e

RUN pnpm install --frozen-lockfile

CMD ["bash", "e2e/run.sh", "--inside"]
