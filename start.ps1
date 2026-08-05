Write-Host "Starting CampusFlow..." -ForegroundColor Cyan

# Start backend
$backend = Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd 'D:\Alpha Coders\CampusFlow\packages\backend'; npx tsx watch src/index.ts" -PassThru -WindowStyle Normal
Write-Host "Backend started (PID: $($backend.Id))" -ForegroundColor Green

# Start frontend
$frontend = Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd 'D:\Alpha Coders\CampusFlow\apps\web'; npm run dev" -PassThru -WindowStyle Normal
Write-Host "Frontend started (PID: $($frontend.Id))" -ForegroundColor Green

Write-Host "`nServers running:" -ForegroundColor Yellow
Write-Host "  Frontend: http://localhost:3000" -ForegroundColor White
Write-Host "  Backend:  http://localhost:4000" -ForegroundColor White
Write-Host "`nPress Enter to stop both..." -ForegroundColor Gray
Read-Host

Stop-Process -Id $backend.Id -Force -ErrorAction SilentlyContinue
Stop-Process -Id $frontend.Id -Force -ErrorAction SilentlyContinue
Write-Host "Stopped." -ForegroundColor Red
