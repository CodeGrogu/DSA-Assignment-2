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
    HAS_FORMAT_ERRORS=0

    if [ -d "modules" ]; then
        for mod in $(find modules -mindepth 1 -maxdepth 2 -name 'Ballerina.toml' -exec dirname {} \; | sort); do
            echo "Checking shared module: $mod"
            OUTPUT=$(cd "$mod" && run_bal format)
            if echo "$OUTPUT" | grep -q "modified files:"; then
                echo "  [FAIL] Formatting issues detected in $mod"
                HAS_FORMAT_ERRORS=1
            else
                echo "  [PASS] $mod is clean."
            fi
        done
    fi

    if [ -d "services" ]; then
        for svc in $(find services -mindepth 1 -maxdepth 2 -name 'Ballerina.toml' -exec dirname {} \; | sort); do
            echo "Checking microservice: $svc"
            OUTPUT=$(cd "$svc" && run_bal format)
            if echo "$OUTPUT" | grep -q "modified files:"; then
                echo "  [FAIL] Formatting issues detected in $svc"
                HAS_FORMAT_ERRORS=1
            else
                echo "  [PASS] $svc is clean."
            fi
        done
    fi

    if [ "$HAS_FORMAT_ERRORS" -ne 0 ]; then
        echo "[ERROR] Formatting discrepancies found. Run 'bash scripts/format-all.sh' to fix."
        exit 1
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
