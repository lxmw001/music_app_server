FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

RUN apk add --no-cache curl python3 py3-pip && \
    python3 -m venv /opt/yt-dlp-env && \
    /opt/yt-dlp-env/bin/pip install --no-cache-dir yt-dlp && \
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod +x /usr/local/bin/yt-dlp

# Make the venv's python3 the default for scripts
ENV YTDLP_PYTHON=/opt/yt-dlp-env/bin/python3

COPY --from=builder /app/dist ./dist
COPY scripts ./scripts

EXPOSE 3000

CMD ["node", "dist/main"]
