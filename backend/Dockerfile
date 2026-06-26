# Cloud Run image for the take-note backend (uv + uvicorn).
FROM python:3.12-slim

# uv for fast, locked dependency installs.
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy

WORKDIR /app

# Install locked deps first (no project package — pyproject has no build-system).
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY app ./app

# Use the venv created by uv.
ENV PATH="/app/.venv/bin:$PATH"
ENV PORT=8080

# Cloud Run sets $PORT; bind to it.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
