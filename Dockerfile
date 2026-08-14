FROM node:20-alpine AS base
RUN npm install -g turbo

# Base dev target
FROM base AS builder
WORKDIR /app
COPY package.json turbo.json package-lock.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/mobile/package.json ./apps/mobile/
COPY packages/backend/package.json ./packages/backend/
RUN npm install
COPY . .
RUN turbo build --filter=@campusflow/web --filter=@campusflow/backend

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 campusflow

COPY --from=builder /app/packages/backend/dist ./backend
COPY --from=builder /app/packages/backend/node_modules ./node_modules
COPY --from=builder /app/packages/backend/prisma ./prisma
COPY --from=builder /app/apps/web/dist ./web

USER campusflow
EXPOSE 4000
CMD ["node", "backend/index.js"]