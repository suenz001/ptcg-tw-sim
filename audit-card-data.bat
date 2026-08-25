@echo off
rem ============================================================
rem  Card data audit vs official site (compare only -- this tool
rem  NEVER writes to static\cards\ and never touches index.json).
rem  Report output:
rem    tournament-dumps\card-audit\card-audit-report.md
rem  Default sets: M-P-H / M-P-I / M-P-J, --resume is always on
rem  (re-running continues after a network interruption).
rem  To audit other sets: audit-card-data.bat SV11B SV11W
rem ============================================================
cd /d "%~dp0"
node scripts\audit-card-data-vs-official.mjs --resume %*
echo.
echo Done. Report: tournament-dumps\card-audit\card-audit-report.md
pause
