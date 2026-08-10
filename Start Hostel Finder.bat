@echo off
title Web 7 Labs - Hostel Hunter
cd /d "%~dp0hostel-hunter"
echo.
echo   Web 7 Labs - Hostel Hunter is starting...
echo   Your browser will open automatically. Keep this black window open while working.
echo   When you are done, just close this window - everything is saved automatically.
echo.
node server.js
pause
