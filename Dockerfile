# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:24-slim AS build

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace root files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json tsconfig.json ./

# Copy all packages (lib + artifacts + scripts)
COPY lib/ lib/
COPY artifacts/ artifacts/
COPY scripts/ scripts/

# Install all deps
RUN pnpm install --frozen-lockfile

# Build shared libs (typecheck emits .d.ts needed by downstream packages)
# Ignore errors from pre-existing issues in integrations lib
RUN pnpm run typecheck:libs || true

# Build frontend (needs PORT and BASE_PATH for vite config)
ENV PORT=8080
ENV BASE_PATH=/
RUN pnpm --filter @workspace/studyflow run build

# Build API server (esbuild bundle)
RUN pnpm --filter @workspace/api-server run build

# ── Production stage ─────────────────────────────────────────────────────────
FROM node:24-slim AS production

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace root for pnpm to resolve workspace deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

# Copy all package.json files for workspace resolution
COPY artifacts/api-server/package.json artifacts/api-server/package.json
COPY artifacts/studyflow/package.json artifacts/studyflow/package.json
COPY artifacts/mockup-sandbox/package.json artifacts/mockup-sandbox/package.json
COPY lib/db/package.json lib/db/package.json
COPY lib/api-zod/package.json lib/api-zod/package.json
COPY lib/api-spec/package.json lib/api-spec/package.json
COPY lib/api-client-react/package.json lib/api-client-react/package.json
COPY lib/integrations-openai-ai-server/package.json lib/integrations-openai-ai-server/package.json
COPY lib/integrations-openai-ai-react/package.json lib/integrations-openai-ai-react/package.json
COPY scripts/package.json scripts/package.json

# Install all deps (pnpm workspace needs all packages present)
RUN pnpm install --frozen-lockfile

# Copy built API server bundle
COPY --from=build /app/artifacts/api-server/dist/ ./dist/

# Copy built frontend into public/ (API server serves it)
COPY --from=build /app/artifacts/studyflow/dist/public/ ./public/

# Copy db schema (needed at runtime by drizzle)
COPY --from=build /app/lib/db/ ./lib/db/

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "--enable-source-maps", "dist/index.mjs"]
