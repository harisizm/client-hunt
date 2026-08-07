@echo off
title Hostel Hunter - one time setup
cd /d "%~dp0"
echo Installing packages (one-time)...
call npm install --no-audit --no-fund
echo Installing browser engine (one-time, ~190 MB)...
call npx playwright install chromium
echo.
echo Setup complete. Use "Start Hostel Finder.bat" in the marketing folder from now on.
pause
