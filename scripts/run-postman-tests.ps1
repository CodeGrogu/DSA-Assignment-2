$root = git rev-parse --show-toplevel 2>$null
if (-not $root) { Write-Host 'Not inside a git repo' -ForegroundColor Red; exit 2 }
Set-Location $root
$envFile = 'postman/environments/local.postman_environment.json'
if (-not (Test-Path $envFile)) { Write-Host "Missing $envFile. Run: node scripts/build-postman-collections.mjs" -ForegroundColor Red; exit 2 }
if (Get-Command bunx -ErrorAction SilentlyContinue) { $runner = @('bunx','newman') }
elseif (Get-Command npx -ErrorAction SilentlyContinue) { $runner = @('npx','--yes','newman') }
else { Write-Host 'Install Node.js (npx) or Bun (bunx) to run Newman.' -ForegroundColor Red; exit 2 }

Write-Host 'Waiting for services (up to 90s)...'
foreach ($port in 9091,9093,9094,9095,9096,9097,9098) {
  $ok = $false
  for ($i = 0; $i -lt 45; $i++) {
    & curl.exe -fsS "http://localhost:$port/health" 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $ok = $true; break }
    Start-Sleep -Seconds 2
  }
  if (-not $ok) { Write-Host "Service on port $port is not healthy. Run: docker compose up -d" -ForegroundColor Red; exit 2 }
}

$fail = $false
foreach ($file in Get-ChildItem postman -Filter *.postman_collection.json) {
  Write-Host "`n=== $($file.BaseName -replace '\.postman_collection$','')"
  & $runner[0] $runner[1..($runner.Count - 1)] run $file.FullName -e $envFile --reporters cli
  if ($LASTEXITCODE -ne 0) { $fail = $true }
}
if ($fail) { Write-Host 'SOME POSTMAN COLLECTIONS FAILED' -ForegroundColor Red; exit 1 }
Write-Host 'ALL POSTMAN COLLECTIONS PASSED' -ForegroundColor Green
exit 0

