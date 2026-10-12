$ErrorActionPreference = "Stop"

$siteDirectory = Join-Path $PSScriptRoot "site"
$configFile = Join-Path $siteDirectory "SERVER-CONFIG-WITH-KEYS.env"

if (-not (Test-Path -LiteralPath $configFile)) {
    throw "Configuration file not found: $configFile"
}

Get-Content -LiteralPath $configFile | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#") -or -not $line.Contains("=")) {
        return
    }

    $name, $value = $line.Split("=", 2)
    [Environment]::SetEnvironmentVariable($name.Trim(), $value.Trim(), "Process")
}

$env:LOCAL_NODE_PREVIEW = "true"
# Local preview only: crm.luzhniki.ru currently presents an expired TLS certificate.
# This variable applies only to the child Node process started by this script.
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
Set-Location -LiteralPath $siteDirectory

if (-not (Test-Path -LiteralPath (Join-Path $siteDirectory "node_modules"))) {
    pnpm install --frozen-lockfile
}

Write-Host "Local version: http://127.0.0.1:4194/parking-subscription"
pnpm exec vinext dev --hostname 127.0.0.1 --port 4194
