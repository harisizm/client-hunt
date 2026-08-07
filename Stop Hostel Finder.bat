@echo off
title Stop Hostel Hunter
set PORT=7777
for /f "tokens=2 delims==" %%a in ('findstr /b "PORT=" "%~dp0hostel-hunter\.env" 2^>nul') do set PORT=%%a
echo Stopping Hostel Hunter (port %PORT%)...
powershell -NoProfile -Command "$c = Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue; if ($c) { $c | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }; Write-Host 'Stopped. Nothing was lost - all data is saved.' } else { Write-Host 'The app was not running.' }"
timeout /t 3 >nul
