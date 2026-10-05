#!/usr/bin/env bash
# scripts/init-kafka-topics.sh
# Entrypoint for provisioning Kafka topics locally or inside containers.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "${SCRIPT_DIR}")"

if [ -f "${ROOT_DIR}/docker/kafka/create-topics.sh" ]; then
  exec bash "${ROOT_DIR}/docker/kafka/create-topics.sh" "$@"
fi
