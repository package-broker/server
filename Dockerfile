FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/adapter-node/package.json ./packages/adapter-node/
COPY packages/main/package.json ./packages/main/
COPY packages/ui/package.json ./packages/ui/

# Install dependencies (including devDependencies for build)
RUN npm ci

COPY tsconfig.json ./
COPY packages/core ./packages/core
COPY packages/adapter-node ./packages/adapter-node
COPY packages/ui ./packages/ui

# Build packages
RUN npm run build -w packages/core
RUN npm run build -w packages/adapter-node
RUN npm run build -w packages/ui

# Production stage
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/adapter-node/package.json ./packages/adapter-node/

# Install only production dependencies
RUN npm ci --omit=dev

COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/adapter-node/dist ./packages/adapter-node/dist
COPY --from=builder /app/packages/ui/dist ./public

EXPOSE 3000

ENV DB_DRIVER=sqlite
ENV STORAGE_DRIVER=fs
ENV CACHE_DRIVER=memory
ENV QUEUE_DRIVER=memory
ENV PUBLIC_DIR=/app/public

CMD ["node", "packages/adapter-node/dist/index.js"]
