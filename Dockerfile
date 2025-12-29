FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/adapter-node/package.json ./packages/adapter-node/
COPY packages/shared/package.json ./packages/shared/
COPY packages/main/package.json ./packages/main/
COPY packages/ui/package.json ./packages/ui/
COPY packages/shared/package.json ./packages/shared/

# Install dependencies (including devDependencies for build)
RUN npm ci

COPY tsconfig.json ./
COPY packages/core ./packages/core
COPY packages/adapter-node ./packages/adapter-node
COPY packages/ui ./packages/ui
COPY packages/shared ./packages/shared
# Copy migrations directory from main package (needed for database initialization)
COPY packages/main/migrations ./packages/main/migrations

# Build packages
RUN npm run build -w packages/shared
RUN npm run build -w packages/core
RUN npm run build -w packages/adapter-node
RUN npm run build -w packages/ui

# Production stage
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/adapter-node/package.json ./packages/adapter-node/

# Install only production dependencies (including workspace deps)
RUN npm ci --omit=dev --workspaces --include-workspace-root

COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/adapter-node/dist ./packages/adapter-node/dist
COPY --from=builder /app/packages/ui/dist ./public
# Copy migration files and migration script for database initialization
COPY --from=builder /app/packages/main/migrations ./packages/main/migrations
COPY --from=builder /app/packages/adapter-node/scripts/migrate.cjs ./packages/adapter-node/scripts/migrate.cjs

EXPOSE 3000

ENV DB_DRIVER=sqlite
ENV STORAGE_DRIVER=fs
ENV CACHE_DRIVER=memory
ENV QUEUE_DRIVER=memory
ENV PUBLIC_DIR=/app/public

CMD ["node", "packages/adapter-node/dist/index.cjs"]
