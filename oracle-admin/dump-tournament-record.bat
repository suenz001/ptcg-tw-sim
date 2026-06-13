@echo off
chcp 65001 >nul
title PTCG Tournament Record Dump
setlocal enabledelayedexpansion
cd /d D:\ai
set KEY=ssh-key-2026-02-11.key
set HOST=ubuntu@140.245.109.103
set SRC=E:\ptcg-tw-sim\oracle-admin\tournament
set OUTDIR=E:\ptcg-tw-sim\tournament-dumps

echo ========================================
echo   PTCG 錦標賽完整紀錄 Dump
echo   可用：玩家名字 / email / matchId / eventId
echo   (中文名若有亂碼問題，改用該玩家 email 或 matchId)
echo ========================================
echo.

if "%~1"=="" (
  set /p TERM="輸入查詢字串: "
) else (
  set TERM=%~1
)
if "!TERM!"=="" ( echo 未輸入查詢字串 & pause & exit /b 1 )

echo.
echo [1/3] 上傳 dump 腳本到伺服器...
scp -i %KEY% "%SRC%\dump-match-records.cjs" %HOST%:/tmp/dump-match-records.cjs
if errorlevel 1 ( echo *** SCP 上傳失敗 *** & pause & exit /b 1 )

echo [2/3] 在伺服器查詢「!TERM!」...
ssh -i %KEY% %HOST% "cd /opt/ptcg/api && node /tmp/dump-match-records.cjs \"!TERM!\""
if errorlevel 1 ( echo *** 查詢失敗 *** & pause & exit /b 1 )

echo [3/3] 下載完整紀錄檔...
if not exist "%OUTDIR%" mkdir "%OUTDIR%"
for /f "tokens=2 delims==" %%a in ('wmic OS Get localdatetime /value 2^>nul') do set DT=%%a
set TS=!DT:~0,8!_!DT:~8,6!
scp -i %KEY% %HOST%:/tmp/ptcg_tourn_dump.json "%OUTDIR%\dump_!TS!.json"
if errorlevel 1 ( echo *** 下載失敗 *** & pause & exit /b 1 )

echo.
echo ========================================
echo  完成！紀錄檔: %OUTDIR%\dump_!TS!.json
echo  把這個 json 檔丟給 Claude 就能分析該場 bug。
echo ========================================
pause
