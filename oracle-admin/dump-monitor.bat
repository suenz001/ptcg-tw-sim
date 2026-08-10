@echo off
title PTCG Battle Connection Monitor Dump
setlocal enabledelayedexpansion
cd /d D:\ai
set KEY=ssh-key-2026-02-11.key
set HOST=ubuntu@140.245.109.103
set SRC=E:\ptcg-tw-sim\oracle-admin\tournament
set OUTDIR=E:\ptcg-tw-sim\tournament-dumps

REM ===========================================================================
REM  ASCII ONLY - DO NOT PUT CHINESE (OR ANY NON-ASCII) IN THIS FILE.
REM  cmd.exe parses .bat using the system ANSI code page (CP950 on zh-TW),
REM  NOT the console code page set by `chcp`. UTF-8 Chinese bytes read back as
REM  CP950 can land on '&' / '|' / '<' / '>', splitting the line so the tail
REM  runs as a bogus command. It bites even inside REM comments.
REM  ==> All Chinese lives in dump-client-monitor.cjs (UTF-8, read by node),
REM      and in the .txt summary it writes. The station owner reads THOSE,
REM      not this window. Same rule as survey-archetype.bat.
REM ===========================================================================
REM  Also no if(...) blocks: cmd reads a parenthesised block as one chunk, so
REM  any parse hiccup kills the whole block. goto branches are predictable.
REM ===========================================================================

echo ========================================
echo   PTCG Battle Connection Monitor Dump
echo   Packs the whole "monitor" admin tab into files:
echo     - longpoll / redact switches
echo     - fingerprint totals over the FULL window
echo     - EVERY rtt row      [the tab only draws 20]
echo     - EVERY raw diag row [the API is capped at 120]
echo   Range arg: 7d default, or 24h / 72h / a plain hour count.
echo   7 days is the max - the server only keeps 7 days of diagnostics.
echo ========================================
echo.

REM Range must stay ASCII (7d / 24h / 168). Never pass Chinese through
REM cmd -^> ssh -^> bash; it gets mangled and the script silently defaults.
set RANGE=7d
if not "%~1"=="" set RANGE=%~1
echo   Range: !RANGE!
echo.

if not exist "%SRC%\dump-client-monitor.cjs" goto ERR_NOSRC
if not exist "%KEY%" goto ERR_NOKEY

echo [1/3] Uploading dump script...
scp -i %KEY% "%SRC%\dump-client-monitor.cjs" %HOST%:/tmp/dump-client-monitor.cjs
if errorlevel 1 goto ERR_SCP

echo [2/3] Collecting on server...
ssh -i %KEY% %HOST% "cd /opt/ptcg/api && node /tmp/dump-client-monitor.cjs \"!RANGE!\""
if errorlevel 1 goto ERR_RUN

echo [3/3] Downloading dump + summary...
if not exist "%OUTDIR%" mkdir "%OUTDIR%"
REM wmic is gone on newer Windows 11 builds. Without a fallback DT ends up
REM empty and every dump would overwrite the same "monitor__.json".
set DT=
for /f "tokens=2 delims==" %%a in ('wmic OS Get localdatetime /value 2^>nul') do set DT=%%a
if not "!DT!"=="" goto HAVE_DT
for /f %%a in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMddHHmmss"') do set DT=%%a
:HAVE_DT
if "!DT!"=="" goto ERR_NODT
set TS=!DT:~0,8!_!DT:~8,6!
scp -i %KEY% %HOST%:/tmp/ptcg_monitor_dump.json "%OUTDIR%\monitor_!TS!.json"
if errorlevel 1 goto ERR_DL
scp -i %KEY% %HOST%:/tmp/ptcg_monitor_summary.txt "%OUTDIR%\monitor_!TS!.txt"
if errorlevel 1 goto ERR_DL

echo.
echo ========================================
echo   Done. Two files were saved:
echo.
echo   %OUTDIR%\monitor_!TS!.txt
echo       ^<-- READ THIS ONE. Plain-Chinese summary: fingerprint counts,
echo           rtt spread, and the client-version breakdown.
echo.
echo   %OUTDIR%\monitor_!TS!.json
echo       ^<-- HAND THIS ONE TO CLAUDE. Full data, nothing truncated.
echo.
echo   NOTE: both files contain player email addresses.
echo         You are the admin so that is fine, but think before sharing.
echo ========================================
goto END

:ERR_NOSRC
echo *** dump-client-monitor.cjs not found under %SRC% ***
goto END
:ERR_NOKEY
echo *** SSH key %KEY% not found in D:\ai ***
goto END
:ERR_SCP
echo *** SCP upload failed ***
goto END
:ERR_RUN
echo *** Server-side collection failed (see error above) ***
goto END
:ERR_NODT
echo *** Could not read the current date/time (wmic and powershell both failed) ***
goto END
:ERR_DL
echo *** Download failed ***
goto END

:END
echo.
pause
