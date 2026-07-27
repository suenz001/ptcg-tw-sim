@echo off
title PTCG Deck Playstyle Extract
setlocal enabledelayedexpansion
cd /d D:\ai
set KEY=ssh-key-2026-02-11.key
set HOST=ubuntu@140.245.109.103
set SRC=E:\ptcg-tw-sim\oracle-admin\tournament
set OUTDIR=E:\ptcg-tw-sim\tournament-dumps

REM ===========================================================================
REM  ASCII ONLY - cmd.exe parses .bat with the system ANSI code page (CP950 on
REM  zh-TW), NOT the console page set by `chcp`. UTF-8 Chinese bytes read back
REM  as CP950 can land on '&' / '|' / '<' / '>', splitting the line so the tail
REM  runs as a bogus command. This bites even inside REM comments.
REM  Chinese explanations live in survey-archetype-replays.cjs (read by node).
REM ===========================================================================

echo ========================================
echo   PTCG Deck Playstyle Extract (batch 1)
echo   Rebuilds how the top players actually pilot the deck:
echo   action sequences + board snapshots + battle log events.
echo   Output contains NO hand or deck contents (counts only).
echo ========================================
echo.

set KEYCARDS=
if not "%~1"=="" set KEYCARDS="%~1"
if not "%~2"=="" set KEYCARDS=!KEYCARDS! "%~2"
if not "%~3"=="" set KEYCARDS=!KEYCARDS! "%~3"

if "!KEYCARDS!"=="" echo   Target: script built-in default
if not "!KEYCARDS!"=="" echo   Target: !KEYCARDS!
echo.

if not exist "%SRC%\survey-archetype-replays.cjs" goto ERR_NOSRC
if not exist "%KEY%" goto ERR_NOKEY

echo [1/3] Uploading script...
scp -i %KEY% "%SRC%\survey-archetype-replays.cjs" %HOST%:/tmp/survey-archetype-replays.cjs
if errorlevel 1 goto ERR_SCP

echo [2/3] Extracting playstyle on server...
ssh -i %KEY% %HOST% "cd /opt/ptcg/api && node /tmp/survey-archetype-replays.cjs --extract !KEYCARDS!"
if errorlevel 1 goto ERR_RUN

echo [3/3] Downloading playstyle report...
if not exist "%OUTDIR%" mkdir "%OUTDIR%"
for /f "tokens=2 delims==" %%a in ('wmic OS Get localdatetime /value 2^>nul') do set DT=%%a
set TS=!DT:~0,8!_!DT:~8,6!
scp -i %KEY% %HOST%:/tmp/ptcg_archetype_playstyle.json "%OUTDIR%\playstyle_!TS!.json"
if errorlevel 1 goto ERR_DL

echo.
echo ========================================
echo   Done. Report: %OUTDIR%\playstyle_!TS!.json
echo   Hand this json back to Claude to write the playbook.
echo ========================================
goto END

:ERR_NOSRC
echo *** survey-archetype-replays.cjs not found under %SRC% ***
goto END
:ERR_NOKEY
echo *** SSH key %KEY% not found in D:\ai ***
goto END
:ERR_SCP
echo *** SCP upload failed ***
goto END
:ERR_RUN
echo *** Server-side extract failed (see error above) ***
goto END
:ERR_DL
echo *** Report download failed ***
goto END

:END
echo.
pause
