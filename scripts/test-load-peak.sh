#!/usr/bin/env bash
# Runs the peak meal load test (50 concurrent requests). Prereqs: platform running, Node.js installed.
set -uo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "Not inside a git repo"; exit 2; }
command -v node >/dev/null 2>&1 || { echo "Install Node.js to run the tests."; exit 2; }

exec node tests/load/peak-meal-load.mjs