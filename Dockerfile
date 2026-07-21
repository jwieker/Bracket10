# Multi-stage build for production optimization
FROM node:24.16.0-alpine AS builder

WORKDIR /usr/src/app

# Copy package files first for better caching
COPY package*.json ./

# Install dependencies (ignoring scripts like husky pre-commit hooks)
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Production stage using distroless image (much smaller than Alpine).
# Pinned by digest so the runtime layer can't drift; Dependabot's docker
# ecosystem will bump the digest. Tag at time of pinning: latest (nodejs24).
FROM gcr.io/distroless/nodejs24-debian12:latest@sha256:61f4f4341db81820c24ce771b83d202eb6452076f58628cd536cc7d94a10978b AS production

WORKDIR /usr/src/app

# Copy only production dependencies from builder
COPY --from=builder /usr/src/app/node_modules ./node_modules

# Copy application code (excluding unnecessary files)
COPY server.js ./
COPY src/ ./src/
COPY views/ ./views/
COPY public/ ./public/

# Copy only necessary config files
COPY package.json ./

# Expose port
EXPOSE 8080

# Start the application
CMD ["server.js"]