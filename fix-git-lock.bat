@echo off
chcp 65001 > nul
title 清除 PTCG Git Lock 檔
cd /d %~dp0

echo ====================================================
echo  清除 .git\refs\remotes\origin\main.lock
echo  每次 Claude push 完都會生一個，刪掉本地 git 才能 fetch
echo ====================================================
echo.

if exist ".git\refs\remotes\origin\main.lock" (
    del /f /q ".git\refs\remotes\origin\main.lock"
    if errorlevel 1 (
        echo *** 刪除失敗 — 可能權限不足或檔案被其他程式鎖住 ***
        echo *** 試關掉 VS Code / GitHub Desktop / SourceTree 等 git 工具再執行 ***
    ) else (
        echo OK: lock 檔已刪除
        echo 現在 git fetch / git pull / IDE git 面板都能正常用了
    )
) else (
    echo （沒有 lock 檔 — 本來就乾淨）
)

echo.
pause
