@echo off
setlocal
title PTCG VM Health Check
cd /d "%~dp0"

REM ==========================================================================
REM  ASCII ONLY - DO NOT PUT CHINESE (OR ANY NON-ASCII) IN THIS FILE.
REM  cmd.exe parses .bat using the system ANSI code page (CP950 on zh-TW),
REM  NOT the console code page. Same rule as dump-monitor.bat.
REM  All Chinese lives in health-check.sh (UTF-8, read by bash on the VM)
REM  and in the .txt report it writes.
REM ==========================================================================
REM  Read-only: uploads health-check.sh, runs it, saves the report.
REM  Nothing on the VM is changed and no service is restarted.
REM ==========================================================================

set "KEY=D:\ai\ssh-key-2026-02-11.key"
if not exist "%KEY%" set "KEY=ssh-key-2026-02-11.key"
if not exist "%KEY%" (
  echo [!] Key not found: D:\ai\ssh-key-2026-02-11.key
  pause
  exit /b 1
)
set "HOST=ubuntu@140.245.109.103"
set "OUTDIR=..\tournament-dumps"
set "OUT=%OUTDIR%\health_latest.txt"
if not exist "%OUTDIR%" mkdir "%OUTDIR%"
echo Using key: %KEY%

echo [1/2] Uploading health-check.sh ...
scp -i "%KEY%" health-check.sh %HOST%:/tmp/ptcg-health-check.sh
if errorlevel 1 (
  echo SCP FAILED
  pause
  exit /b 1
)

echo [2/2] Running on VM (read-only) ...
REM  sed strips CR first: git on Windows may check the .sh out as CRLF and
REM  bash then dies with a confusing "$'\r': command not found".
ssh -i "%KEY%" %HOST% "sed -i 's/\r$//' /tmp/ptcg-health-check.sh; bash /tmp/ptcg-health-check.sh" > "%OUT%" 2>&1

echo.
echo Saved to %OUT%
echo Opening the report in Notepad (the console cannot show UTF-8 Chinese).
start "" notepad "%OUT%"
echo.
pause
