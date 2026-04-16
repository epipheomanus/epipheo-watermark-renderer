FROM node:22-slim

# Install FFmpeg
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# Install exact pnpm version matching the project
RUN corepack enable && corepack prepare pnpm@10.4.1 --activate

WORKDIR /app

# Copy package files and patches (patches are needed during install)
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches/

# Install dependencies
RUN pnpm install --no-frozen-lockfile

# Copy source code
COPY . .

# Build the app
RUN pnpm run build

# Copy server assets (watermark) to dist directory
RUN mkdir -p dist/assets && cp server/assets/* dist/assets/

# Railway sets PORT env var dynamically; expose common default
EXPOSE 3000

# Start the server
CMD ["node", "dist/index.js"]
