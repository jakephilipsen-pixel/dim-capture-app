FROM node:22-alpine AS deps
WORKDIR /app
# Prisma engines on Alpine need OpenSSL present, else they default to the
# wrong libssl and fail to load (schema/query engine cannot start).
RUN apk add --no-cache openssl
COPY package*.json ./
RUN npm ci --omit=dev
COPY prisma ./prisma
RUN npx prisma generate

FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache openssl
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Runtime needs openssl too — the CMD runs `prisma migrate deploy`.
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
EXPOSE 3005
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
