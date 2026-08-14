@echo off
title Client Hunt - Automated Lead Finder
cd /d "%~dp0client-hunt"
echo.
echo   Client Hunt is starting...
echo   Your browser will open automatically. Keep this black window open while working.
echo   When you are done, just close this window - everything is saved automatically.
echo.
node server.js
pause

