#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export DATASTORE_EMULATOR_HOST="${DATASTORE_EMULATOR_HOST:-127.0.0.1:8791}"
uv sync --frozen
exec uv run uvicorn atlas.api:create_app --factory --reload --host 127.0.0.1 --port 8000
