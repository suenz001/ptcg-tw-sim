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

REM ⚠不要用 if(...) 括號區塊 —— cmd 對括號區塊是整塊讀入再解析，
REM   一旦裡面混了中文或引號就容易整塊爛掉、視窗直接關閉連錯誤都看不到。
REM   一律用 goto 分支，行為完全可預期。
REM ⚠也刻意**不從 cmd 傳中文參數**：中文經 cmd → ssh → bash 三層轉碼很容易變亂碼，
REM   預設的關鍵卡名寫在 .cjs 腳本裡（那裡是 UTF-8，不經過任何轉碼）。
set KEYCARDS=
if not "%~1"=="" set KEYCARDS="%~1"
if not "%~2"=="" set KEYCARDS=!KEYCARDS! "%~2"
if not "%~3"=="" set KEYCARDS=!KEYCARDS! "%~3"

if "!KEYCARDS!"=="" echo   盤點對象：N的索羅亞克ex（腳本內建預設）
if not "!KEYCARDS!"=="" echo   盤點對象：!KEYCARDS!
echo.

if not exist "%SRC%\survey-archetype-replays.cjs" goto ERR_NOSRC
if not exist "%KEY%" goto ERR_NOKEY

echo [1/3] 上傳盤點腳本到伺服器...
scp -i %KEY% "%SRC%\survey-archetype-replays.cjs" %HOST%:/tmp/survey-archetype-replays.cjs
if errorlevel 1 goto ERR_SCP

echo [2/3] 在伺服器盤點...
ssh -i %KEY% %HOST% "cd /opt/ptcg/api && node /tmp/survey-archetype-replays.cjs !KEYCARDS!"
if errorlevel 1 goto ERR_RUN

echo [3/3] 下載盤點報告...
if not exist "%OUTDIR%" mkdir "%OUTDIR%"
for /f "tokens=2 delims==" %%a in ('wmic OS Get localdatetime /value 2^>nul') do set DT=%%a
set TS=!DT:~0,8!_!DT:~8,6!
scp -i %KEY% %HOST%:/tmp/ptcg_archetype_survey.json "%OUTDIR%\survey_!TS!.json"
if errorlevel 1 goto ERR_DL

echo.
echo ========================================
echo   完成！報告：%OUTDIR%\survey_!TS!.json
echo   請把上面印出的判定（GO / FALLBACK）貼回對話。
echo ========================================
goto END

:ERR_NOSRC
echo *** 找不到 %SRC%\survey-archetype-replays.cjs ***
goto END
:ERR_NOKEY
echo *** 在 D:\ai 找不到金鑰 %KEY%（請確認目前目錄與金鑰檔名）***
goto END
:ERR_SCP
echo *** SCP 上傳失敗 ***
goto END
:ERR_RUN
echo *** 伺服器端盤點失敗（上面應有錯誤訊息）***
goto END
:ERR_DL
echo *** 報告下載失敗 ***
goto END

:END
echo.
pause
