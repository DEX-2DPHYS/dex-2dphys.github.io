@echo off
rem Starts the ML-potential sidecar for graphene-md's "ML potential" engine.
rem Default: the surrogate (pipeline test, NOT real physics).
rem For real UMA (after HuggingFace login + accepting facebook/UMA terms):
rem   start-ml-server.bat uma-s-1p1 cpu     (or cuda)
setlocal
set "MODEL=%~1"
if "%MODEL%"=="" set "MODEL=surrogate"
set "DEV=%~2"
if "%DEV%"=="" set "DEV=cpu"
"C:\Users\pbog\b\mlpot-venv\Scripts\python.exe" "%~dp0mlserver.py" --model %MODEL% --device %DEV% --task omat
