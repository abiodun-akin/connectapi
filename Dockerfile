# ──────────────────────────────────────────────────────────────
# Builder stage – installs everything (including native deps)
# ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

# Install only what's needed for native module compilation
# (Alpine uses apk, not apt-get)
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    # Some packages still need this
    && npm install -g node-gyp

WORKDIR /home/node/app

# Copy package files first (leverages Docker layer caching)
COPY package*.json ./

# Install ALL dependencies (including devDependencies needed for build)
RUN npm ci --include=dev

# Copy source code
COPY . .

# Optional: run build step if you have one (e.g. TypeScript, webpack, etc.)
# RUN npm run build

# ──────────────────────────────────────────────────────────────
# Final production image – tiny & secure
# ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS production

# Create non-root user (already exists in node:alpine, but we make it explicit)
USER node
WORKDIR /home/node/app

# Copy only node_modules and built app from builder
COPY --from=builder --chown=node:node /home/node/app/node_modules ./node_modules
COPY --from=builder --chown=node:node /home/node/app .

# Explicitly expose port (optional, but nice for tooling)
EXPOSE 8888

# Healthcheck (highly recommended in production)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:8888/health || exit 1

# Final command
CMD ["npm", "start"]