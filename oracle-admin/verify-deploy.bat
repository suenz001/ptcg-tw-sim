@echo off
setlocal
title PTCG Deploy Verify
cd /d "%~dp0.."

REM ==========================================================================
REM  ASCII ONLY - DO NOT PUT CHINESE (OR ANY NON-ASCII) IN THIS FILE.
REM  cmd.exe parses .bat using the system ANSI code page (CP950 on zh-TW),
REM  NOT the console code page. Same rule as check-health.bat.
REM  All Chinese lives in scripts\verify-deploy.mjs (UTF-8) and in the
REM  .txt report it writes.
REM ==========================================================================
REM  READ-ONLY. Fetches 5 public URLs + reads 2 local files.
REM  Nothing is changed. No bat is run. The VM is not touched.
REM
REM  Why this exists (2026-09-15): the deploy notes called
REM  update-admin-full.bat "the frontend", so v6.384/385/386 never reached
REM  the player-facing site - and no bat ever reported an error.
REM  See IRON_RULES.md Rule 43.
REM ==========================================================================

set "OUTDIR=tournament-dumps"
set "OUT=%OUTDIR%\verify_deploy_latest.txt"
if not exist "%OUTDIR%" mkdir "%OUTDIR%"

where node >nul 2>&1
if errorlevel 1 (
  echo [!] node not found on PATH.
  pause
  exit /b 1
)

echo Checking deploy status ^(read-only^) ...
node scripts\verify-deploy.mjs > "%OUT%" 2>&1
set "RC=%ERRORLEVEL%"

echo.
if "%RC%"=="0" (
  echo [OK] All four lines match - the deploy is complete.
) else (
  echo [!!] Something does not match - read the report.
)
echo.
echo Saved to %OUT%
echo Opening the report in Notepad ^(the console cannot show UTF-8 Chinese^).
start "" notepad "%OUT%"
echo.
pause
