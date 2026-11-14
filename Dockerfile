# Etapa 1: instala las dependencias de Node (better-sqlite3 se compila aquí, con compilador).
FROM node:24-trixie-slim AS deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Etapa 2: la imagen que corre, sin compilador.
FROM node:24-trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr python3 python3-venv ca-certificates && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/escaner && /opt/escaner/bin/pip install --no-cache-dir opencv-python-headless==5.0.0.93 numpy==2.5.4
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY tessdata ./tessdata
COPY *.js escanear.py ./
RUN mkdir -p /app/data && chown node:node /app/data
ENV PYTHON=/opt/escaner/bin/python TESSDATA_DIR=/app/tessdata DATA_DIR=/app/data NODE_ENV=production TZ=Europe/Madrid
USER node
CMD ["node", "bot.js"]
