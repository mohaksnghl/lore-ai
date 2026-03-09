# ── Stage 1: Build React client ───────────────────────────────────────────────
FROM node:20-slim AS client-builder
WORKDIR /client

COPY client/package*.json ./
RUN npm ci

COPY client/ ./
# No VITE_SERVER_URL needed — client auto-detects same-host WS URL in prod
RUN npm run build

# ── Stage 2: Python server + embedded frontend ────────────────────────────────
FROM python:3.11-slim
WORKDIR /app

COPY server/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server/ .

# Embed the built React app — FastAPI serves it as static files
COPY --from=client-builder /client/dist ./static

ENV PORT=8080
EXPOSE 8080

CMD ["python", "main.py"]
