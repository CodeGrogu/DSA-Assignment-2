#!/usr/bin/env bash
# scripts/format-all.sh
# Formats all Ballerina packages across modules and services.

set -euo pipefail

echo "================================================================="
echo "       Ballerina Workspace Code Formatting Check                "
echo "================================================================="

if command -v bal &> /dev/null && ! command -v bal.bat &> /dev/null; then
    run_bal() { bal "$@"; }
elif command -v cmd.exe &> /dev/null; then
    run_bal() { cmd.exe /c bal "$@"; }
else
    run_bal() { bal "$@"; }
fi

CHECK_MODE="${1:-}"

if [ "$CHECK_MODE" = "--check" ]; then
    echo "Verifying formatting clean state..."
    if command -v cmd.exe &> /dev/null && command -v bal.bat &> /dev/null; then
        # Match Windows Python to Windows bal.bat, even when bash runs under WSL.
        cmd.exe /c python scripts/check-format.py
    elif command -v python3 &> /dev/null; then
        python3 scripts/check-format.py
    else
        python scripts/check-format.py
    fi
    echo "[PASS] All Ballerina packages are cleanly formatted."
else
    # In apply mode: format all packages
    if [ -d "modules" ]; then
        for mod in $(find modules -mindepth 1 -maxdepth 2 -name 'Ballerina.toml' -exec dirname {} \; | sort); do
            echo "Formatting shared module: $mod"
            (cd "$mod" && run_bal format)
        done
    fi

    if [ -d "services" ]; then
        for svc in $(find services -mindepth 1 -maxdepth 2 -name 'Ballerina.toml' -exec dirname {} \; | sort); do
            echo "Formatting microservice: $svc"
            (cd "$svc" && run_bal format)
        done
    fi
    echo "Formatting complete across all packages."
fi
