@echo off
rem Stops the hidden DSW host process started by "Launch DSW.cmd".
setlocal
taskkill /im dsw.exe /f >nul 2>&1
if errorlevel 1 (
    echo DSW was not running.
) else (
    echo DSW stopped.
)
timeout /t 2 >nul
exit /b 0
