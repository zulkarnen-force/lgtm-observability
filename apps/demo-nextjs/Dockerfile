# =============================================================================
# Stage 1: Build the application
# =============================================================================
FROM oven/bun:1 AS builder

WORKDIR /app

# Copy source code and dependencies (already installed on host)
# Copy package-related files first to leverage Docker's caching mechanism
COPY package.json bun.lock* ./

# Copy Prisma schema and config (needed by postinstall hook)
COPY prisma/schema.prisma ./prisma/schema.prisma
COPY prisma.config.ts ./

# Install project dependencies with frozen lockfile for reproducible builds
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --no-save --frozen-lockfile

# Generate Prisma client (needs DATABASE_URL from prisma.config.ts)
ENV DATABASE_URL="postgresql://postgres:postgres@localhost:5432/demo?schema=public"
RUN bunx prisma generate

# Build Next.js application
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN bun run build

# =============================================================================
# Stage 2: Production runner
# =============================================================================
FROM oven/bun:1 AS runner

WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Create non-root user for security
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

# Copy necessary files from builder
# Next.js standalone output includes server.js and node_modules with bundled deps
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Copy Prisma files for runtime (generated to src/generated/prisma/)
COPY --from=builder --chown=nextjs:nodejs /app/src/generated/prisma ./src/generated/prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma

# Switch to non-root user
USER nextjs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD bun -e "fetch('http://localhost:3000/api/users').then(r => { if (!r.ok) throw new Error('Health check failed'); process.exit(0); }).catch(() => process.exit(1))"

# Start the application (standalone mode uses server.js directly)
CMD ["bun", "server.js"]
