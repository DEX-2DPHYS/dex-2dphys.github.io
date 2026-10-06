@echo off
title EBL Workbench Pro
rem Starts the EBL Workbench Pro backend (on this computer only, 127.0.0.1) and opens the Workbench
rem in the browser. Keep this window open while you work; closing it stops the backend.
cd /d "%~dp0app"
set "NODE=%~dp0app\node\node.exe"
if not exist "%NODE%" set "NODE=node"
"%NODE%" desktop\server.mjs %*
if errorlevel 1 pause
