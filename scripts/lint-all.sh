#!/usr/bin/env bash
# scripts/lint-all.sh
# Standard monorepo linting and static analysis suite.

set -euo pipefail

echo "================================================================="
echo "       Monorepo Static Analysis & Linting Suite                  "
echo "================================================================="

echo "[1/3] Validating Docker Compose configurations..."
if [ -f "docker-compose.infra.yml" ]; then
    docker compose -f docker-compose.infra.yml config -q
    echo "  [PASS] docker-compose.infra.yml is valid."
fi

if [ -f "docker/docker-compose.services.yml" ]; then
    docker compose -f docker/docker-compose.services.yml config -q
    echo "  [PASS] docker/docker-compose.services.yml is valid."
fi

echo "[2/3] Checking Ballerina code formatting..."
bash scripts/format-all.sh --check

echo "[3/3] Validating Postman collections schema via Bun..."
if [ -d "postman" ] && [ -n "$(find postman -name '*.json' 2>/dev/null)" ]; then
    bun -e '
      import fs from "fs";
      import path from "path";

      const postmanDir = "postman";
      const files = fs.readdirSync(postmanDir).filter(f => f.endsWith(".json"));
      let errorCount = 0;

      for (const file of files) {
        const fullPath = path.join(postmanDir, file);
        try {
          const content = JSON.parse(fs.readFileSync(fullPath, "utf-8"));
          if (!content.info || typeof content.info !== "object") {
            console.error(`[ERROR] ${file}: Missing top-level "info" object.`);
            errorCount++;
            continue;
          }
          if (!content.info.name || typeof content.info.name !== "string") {
            console.error(`[ERROR] ${file}: Missing or non-string "info.name".`);
            errorCount++;
            continue;
          }
          if (!content.info.schema || typeof content.info.schema !== "string") {
            console.error(`[ERROR] ${file}: Missing or non-string "info.schema".`);
            errorCount++;
            continue;
          }
          if (!Array.isArray(content.item)) {
            console.error(`[ERROR] ${file}: Missing or invalid "item" array.`);
            errorCount++;
            continue;
          }
          console.log(`  [PASS] ${file}: Valid Postman collection ("${content.info.name}")`);
        } catch (err) {
          console.error(`[ERROR] ${file}: Failed to parse JSON - ${err.message}`);
          errorCount++;
        }
      }

      if (errorCount > 0) {
        process.exit(1);
      }
    '
    echo "  [PASS] All Postman collections passed schema validation."
else
    echo "  [INFO] No Postman collections found. Skipping."
fi

echo "================================================================="
echo "       All linting and validation gates passed successfully!      "
echo "================================================================="
