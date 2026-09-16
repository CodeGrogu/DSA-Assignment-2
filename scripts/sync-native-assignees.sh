#!/usr/bin/env bash
# sync-native-assignees.sh
# POSIX shell wrapper for sync-native-assignees.py

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON_EXEC="python3"

if ! command -v python3 &> /dev/null; then
    if command -v python &> /dev/null; then
        PYTHON_EXEC="python"
    else
        echo "Error: Python runtime not found (neither python3 nor python is available)." >&2
        exit 1
    fi
fi

exec "$PYTHON_EXEC" "$SCRIPT_DIR/sync-native-assignees.py" "$@"
