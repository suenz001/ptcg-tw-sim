@echo off
chcp 65001 >nul
title PTCG 牌組原型資料盤點
setlocal enabledelayedexpansion
cd /d D:\ai
set KEY=ssh-key-2026-02-11.key
set HOST=ubuntu@140.245.109.103
set SRC=E:\ptcg-tw-sim\oracle-admin\tournament
set OUTDIR=E:\ptcg-tw-sim\tournament-dumps

echo ========================================
echo   PTCG 牌組原型資料盤點（批次 0）
echo   回答一件事：這套牌到底有多少「可學習的對局」？
echo   只輸出統計數字，不會拉下任何對局內容。
echo ========================================
echo.
echo   預設盤點：N的索羅亞克ex
echo   （要盤點別套牌，把關鍵卡名當參數傳進來，多張用空白隔開）
echo.

if "%~1"=="" (
  set KEYCARDS="N的索羅亞克ex"
) else (
  set KEYCARDS=
  for %%a in (%*) do set KEYCARDS=!KEYCARDS! "%%~a"
)

echo [1/3] 上傳盤點腳本到伺服器...
scp -i %KEY% "%SRC%\survey-archetype-replays.cjs" %HOST%:/tmp/survey-archetype-replays.cjs
if errorlevel 1 ( echo *** SCP 上傳失敗 *** & pause & exit /b 1 )

echo [2/3] 在伺服器盤點 !KEYCARDS! ...
ssh -i %KEY% %HOST% "cd /opt/ptcg/api && node /tmp/survey-archetype-replays.cjs !KEYCARDS!"
if errorlevel 1 ( echo *** 盤點失敗 *** & pause & exit /b 1 )

echo [3/3] 下載盤點報告...
if not exist "%OUTDIR%" mkdir "%OUTDIR%"
for /f "tokens=2 delims==" %%a in ('wmic OS Get localdatetime /value 2^>nul') do set DT=%%a
set TS=!DT:~0,8!_!DT:~8,6!
scp -i %KEY% %HOST%:/tmp/ptcg_archetype_survey.json "%OUTDIR%\survey_!TS!.json"
if errorlevel 1 ( echo *** 下載失敗 *** & pause & exit /b 1 )

echo.
echo ========================================
echo   完成！報告：%OUTDIR%\survey_!TS!.json
echo   請把上面主控台印出的判定（GO / FALLBACK）貼回對話。
echo ========================================
pause
