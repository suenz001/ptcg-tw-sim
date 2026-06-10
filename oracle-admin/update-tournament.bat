@echo off
title PTCG Tournament Server-Authoritative Deploy
echo ========================================
echo  錦標賽伺服器權威 部署
echo  /game/tournament + Oracle 引擎端點
echo ========================================
echo.

REM ── 1) 本機重建引擎 bundle + 卡池（用最新引擎，確保版本鎖步） ──
echo [1/5] 本機重建引擎 bundle + 卡池 ...
cd /d E:\ptcg-tw-sim
call node scripts\build-server-engine.mjs
if errorlevel 1 ( echo *** 引擎 build 失敗 *** & pause & exit /b 1 )

cd /d D:\ai
set KEY=ssh-key-2026-02-11.key
set HOST=ubuntu@140.245.109.103
set SRC=E:\ptcg-tw-sim\oracle-admin

REM ── 2) 上傳引擎 bundle + 卡池 ──
echo [2/5] 上傳引擎 bundle + 卡池 ...
scp -i %KEY% "%SRC%\tournament\server-engine.cjs" %HOST%:/tmp/server-engine.cjs
scp -i %KEY% "%SRC%\tournament\tournament-pool.json" %HOST%:/tmp/tournament-pool.json
if errorlevel 1 ( echo *** SCP bundle 失敗 *** & pause & exit /b 1 )

REM ── 3) 安裝到 /opt/ptcg/api/tournament/ ──
echo [3/5] 安裝引擎 bundle 到 /opt/ptcg/api/tournament/ ...
ssh -i %KEY% -t %HOST% "sudo mkdir -p /opt/ptcg/api/tournament && sudo cp /tmp/server-engine.cjs /tmp/tournament-pool.json /opt/ptcg/api/tournament/ && sudo chown -R ubuntu:ubuntu /opt/ptcg/api/tournament && echo bundle+pool installed"

REM ── 4) 上傳 server_admin_patch.js + admin.html + update 腳本 ──
echo [4/5] 上傳 patch + update 腳本 ...
scp -i %KEY% "%SRC%\server_admin_patch.js" "%SRC%\admin.html" "%SRC%\oracle_admin_update.sh" %HOST%:/tmp/

REM ── 5) 重插 patch 進 server.js + pm2 restart ──
echo [5/5] 重插 patch + 重啟 API ...
ssh -i %KEY% -t %HOST% "cd /tmp && chmod +x oracle_admin_update.sh && sudo bash oracle_admin_update.sh"
if errorlevel 1 ( echo *** patch 安裝失敗 *** & pause & exit /b 1 )

echo.
echo ========================================
echo  完成！測試： https://www.ptcg-tw-sim.com/game/tournament
echo  （兩個瀏覽器各自點「進入固定測試房」就會配對）
echo ========================================
pause
