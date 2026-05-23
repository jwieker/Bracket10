# Multi-stage build for production optimization
FROM node:26.2.0-alpine AS builder

WORKDIR /usr/src/app

# Copy package files first for better caching
COPY package*.json ./

# Install dependencies (including dev dependencies for potential build steps)
RUN npm ci --omit=dev && npm cache clean --force

# Production stage using distroless image (much smaller than Alpine)
FROM gcr.io/distroless/nodejs24-debian12:latest AS production

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