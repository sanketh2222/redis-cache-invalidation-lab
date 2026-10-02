$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root
$env:DATABASE_URL = "postgresql://app:appsecret@localhost:5433/products_practice"
$env:REDIS_URL = "redis://localhost:6380"
$env:CACHE_WARM_ON_STARTUP = "0"

Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root'; `$env:PORT='3000'; `$env:INSTANCE_ID='api-1'; npm start"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root'; `$env:PORT='3001'; `$env:INSTANCE_ID='api-2'; npm start"
Write-Host "Started api-1 on http://localhost:3000 and api-2 on http://localhost:3001"
Write-Host "Docker alternative: docker compose --profile dual-api up -d  (LB on :8080)"
