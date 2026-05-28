param(
    [Parameter(Mandatory=$true)][string]$KcUser,
    [Parameter(Mandatory=$true)][string]$KcPass,
    [string]$BaseUrl     = 'http://localhost:8085',
    [string]$KeycloakUrl = 'http://localhost:8080',
    [string]$Duration    = '10m'
)

$RpsLevels  = @(20, 40, 60, 80, 100)
$ResultsDir = Join-Path $PSScriptRoot 'results'
$Script     = Join-Path $PSScriptRoot 'calculate-load-test.js'

if (-not (Test-Path $ResultsDir)) {
    New-Item -ItemType Directory -Path $ResultsDir | Out-Null
}

foreach ($rps in $RpsLevels) {
    $poolSize    = [int][math]::Max(20, [math]::Ceiling($rps * 0.4))
    $summaryFile = Join-Path $ResultsDir "summary_${rps}rps.json"

    Write-Host "=== RPS $rps | pool $poolSize | duration $Duration ===" -ForegroundColor Cyan

    k6 run `
        -e KC_USER=$KcUser `
        -e KC_PASS=$KcPass `
        -e BASE_URL=$BaseUrl `
        -e KEYCLOAK_URL=$KeycloakUrl `
        -e TARGET_RPS=$rps `
        -e DURATION=$Duration `
        -e SESSION_POOL_SIZE=$poolSize `
        --summary-export $summaryFile `
        $Script

    if ($LASTEXITCODE -ne 0) {
        Write-Warning "Exit $LASTEXITCODE at $rps RPS - thresholds may have failed, results saved anyway."
    } else {
        Write-Host "Saved: $summaryFile" -ForegroundColor Green
    }

    if ($rps -ne $RpsLevels[-1]) {
        Write-Host 'Cooling down 30s...' -ForegroundColor Yellow
        Start-Sleep -Seconds 30
    }
}

Write-Host 'All done. Copy load-tests\results\*.json to your chart project.' -ForegroundColor Green
