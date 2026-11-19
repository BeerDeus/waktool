@echo off
rem Waktool - arrete le pont lance en arriere-plan (waktool-pont-fond.vbs).
rem Ne touche qu'au processus du pont (numero note par le pont au demarrage).
setlocal
title Waktool - arret du pont
set "PIDF=%LOCALAPPDATA%\Waktool\pont.pid"
if not exist "%PIDF%" (
  echo Le pont Waktool ne tourne pas.
  goto fin
)
set /p WPID=<"%PIDF%"
tasklist /FI "PID eq %WPID%" /FI "IMAGENAME eq powershell.exe" /NH | find " %WPID% " >nul
if errorlevel 1 (
  echo Le pont Waktool ne tourne plus.
) else (
  taskkill /PID %WPID% /F >nul 2>&1
  echo Pont Waktool arrete.
)
del "%PIDF%" >nul 2>&1
:fin
timeout /t 4 >nul
