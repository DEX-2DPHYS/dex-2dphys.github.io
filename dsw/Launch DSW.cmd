@echo off
rem ---------------------------------------------------------------------------
rem  Launch DSW - starts the Digital Science Workstation host and opens the
rem  launcher in the default browser. Portable: %~dp0 is this script's folder,
rem  which is also the folder dsw.exe must run FROM (it finds web\ and plugins\
rem  relative to the working directory).
rem ---------------------------------------------------------------------------
setlocal
set "DSWDIR=%~dp0"
set "PORT=8090"
set "URL=http://127.0.0.1:%PORT%/"

rem --- already serving? then just open a browser tab -------------------------
netstat -an | findstr /c:"127.0.0.1:%PORT%" | findstr /c:"LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo DSW is already running - opening %URL%
    start "" "%URL%"
    exit /b 0
)

rem --- the host binary ------------------------------------------------------
if not exist "%DSWDIR%dsw.exe" (
    echo.
    echo   dsw.exe not found in:
    echo   %DSWDIR%
    echo.
    echo   Build it first ^(build dir outside Dropbox^):
    echo     cmake -B "%USERPROFILE%\b\dsw-build" -S "%DSWDIR%."
    echo     cmake --build "%USERPROFILE%\b\dsw-build" --config Release
    echo.
    pause
    exit /b 1
)

echo Starting DSW ...
cd /d "%DSWDIR%"
powershell -NoProfile -Command "Start-Process -FilePath '%DSWDIR%dsw.exe' -WorkingDirectory '%DSWDIR%' -WindowStyle Hidden" >nul 2>&1

rem --- wait for the port (up to ~12 s), then open the launcher --------------
set /a TRIES=0
:wait
set /a TRIES+=1
netstat -an | findstr /c:"127.0.0.1:%PORT%" | findstr /c:"LISTENING" >nul 2>&1
if not errorlevel 1 goto ready
if %TRIES% GEQ 24 goto failed
ping -n 1 -w 500 127.0.0.1 >nul 2>&1
goto wait

:ready
start "" "%URL%"
exit /b 0

:failed
echo.
echo   DSW did not start listening on port %PORT%.
echo   If the window flashed and vanished, Smart App Control may have blocked
echo   this build - rebuild dsw.exe to give it a fresh hash. See DSW\HANDOVER.md
echo.
pause
exit /b 1
