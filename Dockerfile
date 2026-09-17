# Mehrstufiger Build: zuerst das Frontend bauen, dann ein schlankes Laufzeit-Image.

# --- Stufe 1: Frontend bauen ---
FROM node:24-slim AS frontend
WORKDIR /build/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# --- Stufe 2: Laufzeit ---
FROM node:24-slim
WORKDIR /app/backend

COPY backend/package*.json ./
RUN npm ci --omit=dev

COPY backend/src ./src
COPY --from=frontend /build/frontend/dist /app/frontend/dist

ENV NODE_ENV=production
ENV PORT=3001
# Datenbank auf ein persistentes Volume legen (siehe docker-compose.yml).
ENV DB_PFAD=/data/pendenzen.sqlite

EXPOSE 3001
CMD ["node", "src/server.js"]
