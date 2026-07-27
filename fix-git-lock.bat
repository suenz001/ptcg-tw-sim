@echo off
title Clear PTCG Git Lock File
cd /d %~dp0

REM ===========================================================================
REM  ASCII ONLY - cmd.exe parses .bat with the system ANSI code page (CP950 on
REM  zh-TW), NOT the console page set by `chcp`. UTF-8 Chinese bytes read back
REM  as CP950 can land on '&' / '|' / '<' / '>', splitting the line so the tail
REM  runs as a bogus command. This bites even inside REM comments.
REM ===========================================================================

echo ====================================================
echo  Clear .git\refs\remotes\origin\main.lock
echo  Claude's push leaves one behind; delete it so local
echo  git fetch / pull / IDE git panel work again.
echo ====================================================
echo.

if not exist ".git\refs\remotes\origin\main.lock" goto NOLOCK
del /f /q ".git\refs\remotes\origin\main.lock"
if errorlevel 1 goto DELFAIL
echo OK: lock file removed.
goto END

:NOLOCK
echo No lock file - already clean.
goto END

:DELFAIL
echo *** Delete failed - no permission, or the file is held by another app. ***
echo *** Close VS Code / GitHub Desktop / SourceTree and try again. ***
goto END

:END
echo.
pause
