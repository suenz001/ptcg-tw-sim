@echo off
title PTCG Tournament Record Dump
setlocal enabledelayedexpansion
cd /d D:\ai
set KEY=ssh-key-2026-02-11.key
set HOST=ubuntu@140.245.109.103
set SRC=E:\ptcg-tw-sim\oracle-admin\tournament
set OUTDIR=E:\ptcg-tw-sim\tournament-dumps

REM ===========================================================================
REM  ASCII ONLY - see survey-archetype.bat for the full explanation.
REM  Short version: cmd parses .bat with the system ANSI code page (CP950),
REM  not `chcp 65001`. UTF-8 Chinese bytes reinterpreted as CP950 can contain
REM  '&' and friends, which splits the line and executes the tail as a command.
REM ===========================================================================

echo ========================================
echo   PTCG Tournament Record Dump
echo   Query by: player name / email / matchId / eventId
echo   (If a Chinese player name misbehaves, use their email or matchId.)
echo ========================================
echo.

if not "%~1"=="" goto HAVE_TERM
set /p TERM="Query string: "
goto CHECK_TERM
:HAVE_TERM
set TERM=%~1
:CHECK_TERM
if "!TERM!"=="" goto ERR_NOTERM

echo.
echo [1/3] Uploading dump script...
scp -i %KEY% "%SRC%\dump-match-records.cjs" %HOST%:/tmp/dump-match-records.cjs
if errorlevel 1 goto ERR_SCP

echo [2/3] Querying "!TERM!" on server...
ssh -i %KEY% %HOST% "cd /opt/ptcg/api && node /tmp/dump-match-records.cjs \"!TERM!\""
if errorlevel 1 goto ERR_RUN

echo [3/3] Downloading full record...
if not exist "%OUTDIR%" mkdir "%OUTDIR%"
for /f "tokens=2 delims==" %%a in ('wmic OS Get localdatetime /value 2^>nul') do set DT=%%a
set TS=!DT:~0,8!_!DT:~8,6!
scp -i %KEY% %HOST%:/tmp/ptcg_tourn_dump.json "%OUTDIR%\dump_!TS!.json"
if errorlevel 1 goto ERR_DL

echo.
echo ========================================
echo   Done. Record: %OUTDIR%\dump_!TS!.json
echo   Hand this json to Claude to analyse the bug.
echo ========================================
goto END

:ERR_NOTERM
echo *** No query string given ***
goto END
:ERR_SCP
echo *** SCP upload failed ***
goto END
:ERR_RUN
echo *** Query failed ***
goto END
:ERR_DL
echo *** Download failed ***
goto END

:END
echo.
pause
