# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

# Copy source code
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Next.js "collect page data" exige DATABASE_URL en producción; valor dummy solo para build
ARG DATABASE_URL=postgresql://build:build@localhost:5432/build
ENV DATABASE_URL=${DATABASE_URL}

# Build application
RUN npm run build

# Production stage
FROM node:20-alpine AS runner

# Healthcheck usa wget; Alpine no lo trae por defecto
RUN apk add --no-cache wget

WORKDIR /app

ENV NODE_ENV=production

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy necessary files
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma

# Create uploads directory and cache directory with proper permissions
RUN mkdir -p ./public/uploads ./.next/cache && chown -R nextjs:nodejs ./public/uploads ./.next

# Script: aplica schema (db push) y arranca el servidor
RUN echo '#!/bin/sh' > /app/docker-entrypoint.sh && \
    echo 'npx prisma db push 2>/dev/null || true' >> /app/docker-entrypoint.sh && \
    echo 'exec node server.js' >> /app/docker-entrypoint.sh && \
    chmod +x /app/docker-entrypoint.sh && chown nextjs:nodejs /app/docker-entrypoint.sh

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["/app/docker-entrypoint.sh"]
