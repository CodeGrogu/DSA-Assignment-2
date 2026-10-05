#!/usr/bin/env bun
// Validates Postman collections (postman/*.json) and environments (postman/environments/*.json).
// Fails if no collections are found, so the gate can never pass by skipping.
// Usage: bun scripts/validate-postman.mjs   (node also works)
import fs from "node:fs";
import path from "node:path";

const dir = "postman";
const envDir = path.join(dir, "environments");
let errors = 0;
const fail = (file, msg) => { console.error(`[ERROR] ${file}: ${msg}`); errors++; };
const readJson = (file) => {
  try { return JSON.parse(fs.readFileSync(file, "utf-8")); }
  catch (err) { fail(file, `Failed to parse JSON - ${err.message}`); return null; }
};
const listJson = (d) =>
  fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith(".json")).map((f) => path.join(d, f)) : [];

const collections = listJson(dir);
const environments = listJson(envDir);

if (collections.length === 0) {
  console.error(`[ERROR] No Postman collections found in '${dir}/'. Refusing to pass.`);
  process.exit(1);
}
if (environments.length === 0) {
  console.error(`[ERROR] No Postman environments found in '${envDir}/'. Refusing to pass.`);
  process.exit(1);
}

for (const file of collections) {
  const c = readJson(file);
  if (!c) continue;
  const before = errors;
  if (!c.info || typeof c.info !== "object") { fail(file, 'Missing top-level "info" object.'); continue; }
  if (!c.info.name || typeof c.info.name !== "string") fail(file, 'Missing or non-string "info.name".');
  if (!c.info.schema || typeof c.info.schema !== "string") fail(file, 'Missing or non-string "info.schema".');
  if (!Array.isArray(c.item) || c.item.length === 0) { fail(file, 'Missing or empty "item" array.'); continue; }
  for (const item of c.item) {
    const req = item.request;
    if (!item.name) fail(file, "An item has no name.");
    if (!req || !req.method) { fail(file, `Item "${item.name}" has no request method.`); continue; }
    const url = typeof req.url === "string" ? req.url : req.url?.raw;
    if (!url) fail(file, `Item "${item.name}" has no URL.`);
    else if (/http:\/\/.*http:\/\//.test(url)) fail(file, `Item "${item.name}" has a doubled scheme in its URL.`);
    const hasTest = (item.event ?? []).some((e) => e.listen === "test" && e.script?.exec?.length);
    if (!hasTest) fail(file, `Item "${item.name}" has no test script.`);
  }
  if (errors === before) console.log(`[PASS] ${file}: "${c.info.name}" (${c.item.length} request(s))`);
}

for (const file of environments) {
  const e = readJson(file);
  if (!e) continue;
  const before = errors;
  if (!e.name || typeof e.name !== "string") fail(file, 'Missing or non-string "name".');
  if (!Array.isArray(e.values) || e.values.length === 0) { fail(file, 'Missing or empty "values" array.'); continue; }
  for (const v of e.values) {
    if (!v.key || typeof v.value !== "string") fail(file, `Invalid variable entry: ${JSON.stringify(v)}`);
  }
  if (errors === before) console.log(`[PASS] ${file}: environment "${e.name}" (${e.values.length} variable(s))`);
}

if (errors > 0) {
  console.error(`\nValidation failed: ${errors} error(s).`);
  process.exit(1);
}
console.log("\nAll Postman collections and environments passed validation.");

