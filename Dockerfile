FROM node:20-alpine

RUN apk add --no-cache ffmpeg python3 py3-pip \
    && python3 -m pip install --no-cache-dir --break-system-packages yt-dlp

WORKDIR /app

COPY package.json ./
COPY server.js config.js ./
COPY lib ./lib

RUN mkdir -p /app/downloads

# Port exposed on the host (see docker-compose: 3021 -> container PORT)
EXPOSE 3021

ENV NODE_ENV=production \
    YTDLP_EXE=yt-dlp \
    FFMPEG_LOCATION=/usr/bin \
    DOWNLOAD_DIR=/app/downloads

CMD ["node", "server.js"]