#!/usr/bin/env bash
# compile-diagrams.sh
# Compiles all D2 architecture diagrams in docs/diagrams/ to SVGs using the D2 CLI.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DIAGRAMS_DIR="$REPO_ROOT/docs/diagrams"

if [ ! -d "$DIAGRAMS_DIR" ]; then
    echo "Error: Diagrams directory not found at $DIAGRAMS_DIR" >&2
    exit 1
fi

if ! command -v d2 &> /dev/null; then
    if [ -f "$HOME/.local/bin/d2" ]; then
        D2_EXEC="$HOME/.local/bin/d2"
    else
        echo "Error: D2 CLI not found. Please install D2 via: curl -fsSL https://d2lang.com/install.sh | sh" >&2
        exit 1
    fi
else
    D2_EXEC="d2"
fi

echo ">>> Using D2 compiler: $D2_EXEC ($("$D2_EXEC" --version))"
echo ">>> Scanning $DIAGRAMS_DIR for *.d2 diagrams..."

count=0
for d2_file in "$DIAGRAMS_DIR"/*.d2; do
    [ -e "$d2_file" ] || continue
    base_name="$(basename "$d2_file" .d2)"
    svg_file="$DIAGRAMS_DIR/$base_name.svg"
    
    printf "  Compiling: %s -> %s.svg... " "$base_name.d2" "$base_name"
    "$D2_EXEC" --theme 303 --dark-theme 200 "$d2_file" "$svg_file"
    echo "[OK]"
    count=$((count + 1))
done

echo ">>> Successfully compiled $count architecture diagrams."
