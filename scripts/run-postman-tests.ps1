$root = git rev-parse --show-toplevel 2>$null
if (-not $root) { Write-Host 'Not inside a git repo' -ForegroundColor Red; exit 2 }
Set-Location $root
$envFile = 'postman/environments/local.environment.yaml'
if (-not (Get-Command postman -ErrorAction SilentlyContinue)) { Write-Host 'Postman CLI not found. Install it, then run: postman login' -ForegroundColor Red; exit 2 }
if (-not (Test-Path $envFile)) { Write-Host "Missing $envFile" -ForegroundColor Red; exit 2 }
if ($env:POSTMAN_API_KEY) { postman login --with-api-key $env:POSTMAN_API_KEY | Out-Null }

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

postman environment lint $envFile
if ($LASTEXITCODE -ne 0) { exit 1 }
$fail = $false
foreach ($dir in Get-ChildItem postman/collections -Directory) {
  Write-Host "`n=== $($dir.Name)"
  postman collection lint $dir.FullName
  if ($LASTEXITCODE -ne 0) { $fail = $true }
  postman collection run $dir.FullName -e $envFile
  if ($LASTEXITCODE -ne 0) { $fail = $true }
}
if ($fail) { Write-Host 'SOME POSTMAN COLLECTIONS FAILED' -ForegroundColor Red; exit 1 }
Write-Host 'ALL POSTMAN COLLECTIONS PASSED' -ForegroundColor Green
exit 0

