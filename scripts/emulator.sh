#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Homebrew's JDK is not registered with macOS java_home by default.
if [[ -z "${JAVA_HOME:-}" && -d /opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home ]]; then
  export JAVA_HOME=/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home
fi
mkdir -p .local
flags=()
if [[ -d .local/datastore-export ]]; then flags+=(--import-data=.local/datastore-export); fi
exec gcloud emulators firestore start --database-mode=datastore-mode --host-port=127.0.0.1:8791 \
  --project=atlas-local --export-on-exit=.local/datastore-export "${flags[@]}"
