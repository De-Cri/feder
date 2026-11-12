# Feder - starts the wizard on Windows.
# If Node.js is missing (the wizard needs it) it asks for permission and installs it with winget.
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Set-Location (Split-Path -Parent $PSScriptRoot)

function Update-PathFromRegistry {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}

function Get-NodeMajor {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { return 0 }
  $v = & node -v 2>$null
  if ($v -match '^v(\d+)') { return [int]$Matches[1] }
  return 0
}

if ((Get-NodeMajor) -lt 20) {
  Write-Host ''
  Write-Host '  Node.js 20+ non trovato: serve per far partire il wizard (~30 MB).' -ForegroundColor Yellow
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Write-Host '  Installa Node.js LTS da https://nodejs.org e rilancia Setup.cmd'
    exit 1
  }
  $answer = Read-Host '  Lo installo io? [S/n]'
  if ($answer -and ($answer -notmatch '^[sSyY]')) { exit 1 }
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  Update-PathFromRegistry
  if ((Get-NodeMajor) -lt 20) {
    Write-Host '  Node.js installato: chiudi questa finestra e rilancia Setup.cmd.' -ForegroundColor Yellow
    exit 1
  }
}

& node scripts/wizard.mjs @args
exit $LASTEXITCODE
