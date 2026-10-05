param(
  [switch]$SkipWait
)

$root = git rev-parse --show-toplevel 2>$null
if (-not $root) { Write-Host 'Not inside a git repo' -ForegroundColor Red; exit 2 }
Set-Location $root
$envFile = 'postman/environments/local.postman_environment.json'
if (-not (Test-Path $envFile)) { Write-Host "Missing $envFile. Run: node scripts/build-postman-collections.mjs" -ForegroundColor Red; exit 2 }

if (Get-Command newman -ErrorAction SilentlyContinue) { $cmd = 'newman'; $pre = @() }
elseif (Get-Command bunx -ErrorAction SilentlyContinue) { $cmd = 'bunx'; $pre = @('newman') }
elseif (Get-Command npx -ErrorAction SilentlyContinue) { $cmd = 'npx'; $pre = @('--yes', 'newman') }
else { Write-Host 'Install newman (npm i -g newman), Bun (bunx) or Node.js (npx).' -ForegroundColor Red; exit 2 }

if (-not $SkipWait -and $env:SKIP_WAIT -ne '1') {
  $up = 'docker compose -f docker-compose.infra.yml up -d --wait; docker compose -f docker/docker-compose.services.yml up -d'
  Write-Host 'Waiting for services (up to 90s)...'
  foreach ($port in 9091,9093,9094,9095,9096,9097,9098) {
    $ok = $false
    for ($i = 0; $i -lt 45; $i++) {
      & curl.exe -fsS "http://localhost:$port/health" 2>$null | Out-Null
      if ($LASTEXITCODE -eq 0) { $ok = $true; break }
      Start-Sleep -Seconds 2
    }
    if (-not $ok) { Write-Host "Service on port $port is not healthy. Run: $up" -ForegroundColor Red; exit 2 }
  }
}

$files = Get-ChildItem postman -Filter *.postman_collection.json |
  Sort-Object @{ Expression = { if ($_.Name -like 'restaurants.*') { 0 } else { 1 } } }, Name

$fail = $false
foreach ($file in $files) {
  Write-Host "`n=== $($file.Name -replace '\.postman_collection\.json$','')"
  & $cmd @pre run $file.FullName -e $envFile --reporters cli
  if ($LASTEXITCODE -ne 0) { $fail = $true }
}
if ($fail) { Write-Host 'SOME POSTMAN COLLECTIONS FAILED' -ForegroundColor Red; exit 1 }
Write-Host 'ALL POSTMAN COLLECTIONS PASSED' -ForegroundColor Green
exit 0


