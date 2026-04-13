FROM node:22-slim

# Install FFmpeg
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build the app
RUN pnpm run build

# Copy server assets (watermark) to dist directory
RUN mkdir -p dist/assets && cp server/assets/* dist/assets/

# Expose port (Railway sets PORT env var)
EXPOSE 3000

# Start the server
CMD ["node", "dist/index.js"]
