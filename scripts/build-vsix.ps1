param(
    [switch]$Production = $false
)

$ScriptDir = Split-Path -Parent $PSCommandPath
$ProjectRoot = Split-Path -Parent $ScriptDir
Set-Location $ProjectRoot

# Check for Node.js
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host "Error: Node.js is required. Install from https://nodejs.org/" -ForegroundColor Red
    exit 1
}

# Install dependencies if needed
if (-not (Test-Path "node_modules")) {
    Write-Host "Installing dependencies..." -ForegroundColor Yellow
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "npm install failed" -ForegroundColor Red
        exit 1
    }
}

# Build with esbuild
Write-Host "Building extension..." -ForegroundColor Yellow
if ($Production) {
    node esbuild.config.mjs --production
} else {
    node esbuild.config.mjs
}
if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed" -ForegroundColor Red
    exit 1
}

# Package VSIX
Write-Host "Packaging VSIX..." -ForegroundColor Yellow
npx vsce package
if ($LASTEXITCODE -ne 0) {
    Write-Host "Packaging failed" -ForegroundColor Red
    exit 1
}

$vsix = Get-ChildItem -Path $ProjectRoot -Filter "*.vsix" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($vsix) {
    Write-Host "VSIX created: $($vsix.FullName)" -ForegroundColor Green
}
