#!/usr/bin/env pwsh
# compile-diagrams.ps1
# Compiles all D2 architecture diagrams in docs/diagrams/ to SVGs using the D2 CLI.

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$repoRoot = Split-Path -Parent $scriptDir
$diagramsDir = Join-Path $repoRoot "docs\diagrams"

if (-not (Test-Path $diagramsDir)) {
    Write-Error "Diagrams directory not found: $diagramsDir"
    exit 1
}

$d2Cmd = Get-Command d2 -ErrorAction SilentlyContinue
if (-not $d2Cmd) {
    $fallbackD2 = Join-Path $HOME ".local\bin\d2.exe"
    if (Test-Path $fallbackD2) {
        $d2Exec = $fallbackD2
    } else {
        Write-Error "D2 CLI not found in PATH or ~/.local/bin. Please install D2 (e.g., winget install Terrastruct.D2)."
        exit 1
    }
} else {
    $d2Exec = "d2"
}

Write-Host ">>> Using D2 compiler: $d2Exec ($(& $d2Exec --version))" -ForegroundColor Cyan
Write-Host ">>> Scanning $diagramsDir for *.d2 diagrams..." -ForegroundColor Cyan

$d2Files = Get-ChildItem -Path $diagramsDir -Filter "*.d2"
if ($d2Files.Count -eq 0) {
    Write-Warning "No .d2 files found in $diagramsDir"
    exit 0
}

$compiledCount = 0
foreach ($file in $d2Files) {
    $outputSvg = [System.IO.Path]::ChangeExtension($file.FullName, ".svg")
    Write-Host "  Compiling: $($file.Name) -> $([System.IO.Path]::GetFileName($outputSvg))..." -NoNewline
    
    & $d2Exec --theme 303 --dark-theme 200 $file.FullName $outputSvg
    if ($LASTEXITCODE -eq 0) {
        $fileSize = (Get-Item $outputSvg).Length
        Write-Host " [OK] ($fileSize bytes)" -ForegroundColor Green
        $compiledCount++
    } else {
        Write-Host " [FAILED]" -ForegroundColor Red
        exit 1
    }
}

Write-Host ">>> Successfully compiled $compiledCount/$($d2Files.Count) architecture diagrams." -ForegroundColor Green
