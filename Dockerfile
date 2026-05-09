FROM node:20-alpine

RUN apk add --no-cache \
    chromium \
    xvfb \
    x11vnc \
    python3 \
    py3-pip \
    && pip3 install --break-system-packages websockify \
    && mkdir -p /usr/share/novnc \
    && wget -qO- https://github.com/novnc/noVNC/archive/refs/tags/v1.4.0.tar.gz | tar xz --strip-components=1 -C /usr/share/novnc

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

RUN npm prune --omit=dev

EXPOSE 6080

VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD pgrep -f "node dist/main.js" > /dev/null || exit 1

ENTRYPOINT ["node", "dist/main.js"]
