@echo off
title PTCG Deck Archetype Data Survey
setlocal enabledelayedexpansion
cd /d D:\ai
set KEY=ssh-key-2026-02-11.key
set HOST=ubuntu@140.245.109.103
set SRC=E:\ptcg-tw-sim\oracle-admin\tournament
set OUTDIR=E:\ptcg-tw-sim\tournament-dumps

REM ===========================================================================
REM  ASCII ONLY - DO NOT PUT CHINESE (OR ANY NON-ASCII) IN THIS FILE.
REM  cmd.exe parses .bat using the system ANSI code page (CP950 on zh-TW),
REM  NOT the console code page set by `chcp`. UTF-8 Chinese bytes read as
REM  CP950 can land on '&' / '|' / '<' / '>' and split the line - the tail is
REM  then executed as a bogus command. It even happens inside REM lines.
REM  All Chinese explanations live in survey-archetype-replays.cjs (UTF-8,
REM  read by node, never by cmd).
REM ===========================================================================

echo ========================================
echo   PTCG Deck Archetype Data Survey
echo   How many learnable tournament matches does this deck have?
echo   Stats only - no match content is downloaded.
echo ========================================
echo.

REM Never pass Chinese args through cmd: cmd -^> ssh -^> bash mangles them,
REM and a mangled card name silently matches zero decks (looks like "nobody
REM plays this deck", not like an encoding bug). Default lives in the .cjs.
set KEYCARDS=
if not "%~1"=="" set KEYCARDS="%~1"
if not "%~2"=="" set KEYCARDS=!KEYCARDS! "%~2"
if not "%~3"=="" set KEYCARDS=!KEYCARDS! "%~3"

if "!KEYCARDS!"=="" echo   Target: script built-in default
if not "!KEYCARDS!"=="" echo   Target: !KEYCARDS!
echo.

REM No if(...) blocks: cmd reads a parenthesised block as one chunk, so any
REM parse hiccup kills the whole block. goto branches are fully predictable.
if not exist "%SRC%\survey-archetype-replays.cjs" goto ERR_NOSRC
if not exist "%KEY%" goto ERR_NOKEY

echo [1/3] Uploading survey script...
scp -i %KEY% "%SRC%\survey-archetype-replays.cjs" %HOST%:/tmp/survey-archetype-replays.cjs
if errorlevel 1 goto ERR_SCP

echo [2/3] Running survey on server...
ssh -i %KEY% %HOST% "cd /opt/ptcg/api && node /tmp/survey-archetype-replays.cjs !KEYCARDS!"
if errorlevel 1 goto ERR_RUN

echo [3/3] Downloading report...
if not exist "%OUTDIR%" mkdir "%OUTDIR%"
for /f "tokens=2 delims==" %%a in ('wmic OS Get localdatetime /value 2^>nul') do set DT=%%a
set TS=!DT:~0,8!_!DT:~8,6!
scp -i %KEY% %HOST%:/tmp/ptcg_archetype_survey.json "%OUTDIR%\survey_!TS!.json"
if errorlevel 1 goto ERR_DL

echo.
echo ========================================
echo   Done. Report: %OUTDIR%\survey_!TS!.json
echo   Paste the GO / FALLBACK verdict above back into the chat.
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
echo *** Server-side survey failed (see error above) ***
goto END
:ERR_DL
echo *** Report download failed ***
goto END

:END
echo.
pause
