FROM node:20-alpine AS base
RUN apk add --no-cache openssl libc6-compat
RUN npm install -g turbo

# Base dev target
FROM base AS builder
WORKDIR /app
COPY package.json turbo.json package-lock.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/mobile/package.json ./apps/mobile/
COPY packages/backend/package.json ./packages/backend/
RUN npm ci
COPY . .
# Prisma client must be generated before build (backend imports @prisma/client)
RUN npx prisma generate --schema=packages/backend/prisma/schema.prisma
RUN turbo build --filter=@campusflow/web --filter=@campusflow/backend

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=10000
RUN apk add --no-cache openssl libc6-compat
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 campusflow

# Monorepo hoisted install: root /app/node_modules (NOT packages/backend/node_modules).
# Includes generated .prisma client from builder.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/packages/backend/dist ./backend
COPY --from=builder /app/packages/backend/prisma ./prisma
COPY --from=builder /app/apps/web/dist ./web

USER campusflow
EXPOSE 10000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://localhost:10000/api/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"
CMD ["node", "backend/index.js"]
