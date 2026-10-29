# Run isolated integration tests with dedicated test database
# Usage: powershell -ExecutionPolicy Bypass -File tests/run-isolated.ps1

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "============================================================"
Write-Host "  Zero Trust Security - Isolated Integration Test Suite  "
Write-Host "============================================================"
Write-Host ""

# Create test database
$TestDbPath = Join-Path $PSScriptRoot "..\database\zero-trust-test.db"
$TestDbPath = Resolve-Path $TestDbPath -Relative

Write-Host "[Setup] Creating test database at: database\zero-trust-test.db"
Write-Host "[Setup] This will overwrite any existing test database."

# Clean up any existing test database
if (Test-Path $TestDbPath) {
    Remove-Item $TestDbPath -Force
    $WALPath = $TestDbPath + "-wal"
    $SHMPath = $TestDbPath + "-shm"
    if (Test-Path $WALPath) { Remove-Item $WALPath -Force }
    if (Test-Path $SHMPath) { Remove-Item $SHMPath -Force }
}

# Run database init and seed with test database path
Write-Host "[Setup] Initializing test database schema..."
$env:DB_PATH = $TestDbPath
$env:BCRYPT_ROUNDS = "10"
$env:JWT_SECRET = "test-jwt-secret-for-isolated-tests-12345678901234567890"
$env:JWT_REFRESH_SECRET = "test-refresh-secret-for-isolated-tests-123456789012"
$env:JWT_SERVICE_SECRET = "test-service-secret-for-isolated-tests-123456789"
$env:GATEWAY_SECRET = "test-gateway-secret-for-isolated-tests-123456789012"
$env:NILAI_SERVICE_SECRET = "test-nilai-secret-for-isolated-tests-1234567890"
$env:TRANSKRIP_SERVICE_SECRET = "test-transkrip-secret-for-isolated-tests-12345678"
$env:ALLOW_POLICY_TIME_OVERRIDE = "1"

node shared\db\init.js
node shared\db\seed.js

if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Failed to initialize test database" -ForegroundColor Red
    exit 1
}

Write-Host "[Setup] Test database created successfully" -ForegroundColor Green
Write-Host ""

# Start services in background
Write-Host "[Services] Starting all services with test database..."

# Start Gateway
Write-Host "[Services] Starting Gateway on port 3000..."
Start-Process -FilePath "node" -ArgumentList "gateway/server.js" -NoNewWindow -Wait -RedirectStandardOutput gateway.log -RedirectStandardError gateway.err
$GatewayProc = Start-Process -FilePath "node" -ArgumentList "gateway/server.js" -PassThru
Start-Sleep -Seconds 3

# Start Nilai
Write-Host "[Services] Starting Nilai service on port 3001..."
$NilaiProc = Start-Process -FilePath "node" -ArgumentList "services/nilai/server.js" -PassThru
Start-Sleep -Seconds 2

# Start Transkrip
Write-Host "[Services] Starting Transkrip service on port 3002..."
$TranskripProc = Start-Process -FilePath "node" -ArgumentList "services/transkrip/server.js" -PassThru
Start-Sleep -Seconds 2

Write-Host "[Services] All services started" -ForegroundColor Green
Write-Host ""

# Run tests
Write-Host "[Test] Running service integration tests..."
$env:TEST_DB_PATH = $TestDbPath
$env:ALLOW_POLICY_TIME_OVERRIDE = "1"

node tests/services-isolated.test.js
$TestExitCode = $LASTEXITCODE

Write-Host ""
Write-Host "[Test] Test execution completed"

# Stop services
Write-Host "[Cleanup] Stopping services..."
$GatewayProc | Stop-Process -Force
$NilaiProc | Stop-Process -Force
$TranskripProc | Stop-Process -Force

# Clean up test database
Write-Host "[Cleanup] Removing test database..."
if (Test-Path $TestDbPath) {
    Remove-Item $TestDbPath -Force
}
$WALPath = $TestDbPath + "-wal"
$SHMPath = $TestDbPath + "-shm"
if (Test-Path $WALPath) { Remove-Item $WALPath -Force }
if (Test-Path $SHMPath) { Remove-Item $SHMPath -Force }

Write-Host "[Cleanup] Test database removed"

Write-Host ""
Write-Host "============================================================"
if ($TestExitCode -eq 0) {
    Write-Host "  ✓ ALL TESTS PASSED                                     " -ForegroundColor Green
} else {
    Write-Host "  ✗ SOME TESTS FAILED                                    " -ForegroundColor Red
}
Write-Host "============================================================"
Write-Host ""

exit $TestExitCode
