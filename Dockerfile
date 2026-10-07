FROM node:22-bookworm-slim AS frontend
WORKDIR /src/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim-bookworm
COPY --from=ghcr.io/astral-sh/uv:0.11.0 /uv /usr/local/bin/uv
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libgomp1 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY pyproject.toml uv.lock ./
COPY backend/ ./backend/
RUN uv sync --frozen --no-dev --no-editable
COPY --from=frontend /src/frontend/dist ./frontend/dist
RUN useradd --create-home --uid 10001 atlas && mkdir -p /app/.local && chown -R atlas:atlas /app/.local
USER atlas
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1 NUMBA_CACHE_DIR=/tmp/numba ATLAS_FRONTEND_DIR=/app/frontend/dist
EXPOSE 8080
CMD ["sh", "-c", "exec uvicorn atlas.api:create_app --factory --host 0.0.0.0 --port ${PORT:-8080}"]
