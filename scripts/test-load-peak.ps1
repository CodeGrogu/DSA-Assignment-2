# Runs the peak meal load test (50 concurrent requests). Prereqs: platform running, Node.js installed.
$root = git rev-parse --show-toplevel 2>$null
if (-not $root) { Write-Host 'Not inside a git repo' -ForegroundColor Red; exit 2 }
Set-Location $root

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Host 'Install Node.js to run the tests.' -ForegroundColor Red; exit 2 }

node tests/load/peak-meal-load.mjs
exit $LASTEXITCODE