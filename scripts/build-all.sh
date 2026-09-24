#!/usr/bin/env bash
# scripts/build-all.sh
# Complete local build and test pipeline for Ballerina workspace.

set -euo pipefail

echo "================================================================="
echo "       Ballerina Monorepo Complete Build Pipeline                "
echo "================================================================="

if command -v bal &> /dev/null && ! command -v bal.bat &> /dev/null; then
    run_bal() { bal "$@"; }
elif command -v cmd.exe &> /dev/null; then
    run_bal() { cmd.exe /c bal "$@"; }
else
    run_bal() { bal "$@"; }
fi

# Phase 1: Test, pack and publish shared modules to local repo
echo "--- Phase 1: Shared Modules Compilation & Testing ---"
if [ -d "modules" ]; then
    for mod in $(find modules -mindepth 1 -maxdepth 2 -name 'Ballerina.toml' -exec dirname {} \; | sort); do
        echo "Testing and packing shared module: $mod"
        (
            cd "$mod"
            run_bal test --test-report --code-coverage
            run_bal pack
            run_bal push --repository local
        )
    done
fi

# Phase 2: Build all microservices
echo "--- Phase 2: Microservices Build & Packaging ---"
if [ -d "services" ]; then
    for svc in $(find services -mindepth 1 -maxdepth 2 -name 'Ballerina.toml' -exec dirname {} \; | sort); do
        echo "Building microservice: $svc"
        (
            cd "$svc"
            run_bal build
        )
    done
fi

# Phase 3: Workspace Level Verification
if [ -f "Ballerina.toml" ]; then
    echo "--- Phase 3: Workspace Integrity Check ---"
    run_bal build
fi

echo "================================================================="
echo "       All modules and microservices compiled successfully!      "
echo "================================================================="
