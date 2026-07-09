@echo off
title PTCG Tournament Deploy
echo ========================================
echo   Tournament (server-authoritative) Deploy
echo   /game/tournament + Oracle engine endpoints
echo ========================================
echo.

echo [sync] Syncing working tree to latest commit (avoid missing-file build errors)...
cd /d E:\ptcg-tw-sim
echo [pull] Fetching latest cards + code from GitHub (origin/main)...
if exist ".git\index.lock" del /f /q ".git\index.lock" >nul 2>&1
git fetch origin
if errorlevel 1 (
  echo *** git fetch FAILED - check network / git on PATH ***
  pause
  exit /b 1
)
git reset --hard origin/main
if errorlevel 1 (
  echo *** git reset --hard FAILED - close any open git tool ^(VS Code/GitHub Desktop/SourceTree^) and retry ***
  pause
  exit /b 1
)
echo     synced working tree to origin/main.
git archive HEAD -o "%TEMP%\ptcg_sync.tar" -- src scripts static
if errorlevel 1 (
  echo *** git archive FAILED - confirm E:\ptcg-tw-sim is a git repo and git is on PATH ***
  pause
  exit /b 1
)
tar -xf "%TEMP%\ptcg_sync.tar"
if errorlevel 1 (
  echo *** working-tree sync via tar FAILED - confirm tar is available, built-in on Win10+ ***
  pause
  exit /b 1
)
del "%TEMP%\ptcg_sync.tar" >nul 2>&1
echo     working tree synced to HEAD.
echo.

echo [1/5] Building engine bundle + card pool locally...
cd /d E:\ptcg-tw-sim
call node scripts\build-server-engine.mjs
if errorlevel 1 (
  echo *** engine build FAILED ***
  pause
  exit /b 1
)

cd /d D:\ai
set KEY=ssh-key-2026-02-11.key
set HOST=ubuntu@140.245.109.103
set SRC=E:\ptcg-tw-sim\oracle-admin

echo [2/5] Uploading engine bundle + pool...
scp -i %KEY% "%SRC%\tournament\server-engine.cjs" %HOST%:/tmp/server-engine.cjs
scp -i %KEY% "%SRC%\tournament\tournament-pool.json" %HOST%:/tmp/tournament-pool.json
if errorlevel 1 (
  echo *** SCP bundle FAILED ***
  pause
  exit /b 1
)

echo [3/5] Installing bundle to /opt/ptcg/api/tournament/ ...
ssh -i %KEY% -t %HOST% "sudo mkdir -p /opt/ptcg/api/tournament && sudo cp /tmp/server-engine.cjs /tmp/tournament-pool.json /opt/ptcg/api/tournament/ && sudo chown -R ubuntu:ubuntu /opt/ptcg/api/tournament && echo bundle and pool installed"

echo [4/5] Uploading patch + admin.html + update script...
scp -i %KEY% "%SRC%\server_admin_patch.js" "%SRC%\admin.html" "%SRC%\oracle_admin_update.sh" %HOST%:/tmp/
if errorlevel 1 (
  echo *** SCP patch FAILED ***
  pause
  exit /b 1
)

echo [5/5] Re-inserting patch into server.js + restart API...
ssh -i %KEY% -t %HOST% "cd /tmp && chmod +x oracle_admin_update.sh && sudo bash oracle_admin_update.sh"
if errorlevel 1 (
  echo *** patch install FAILED ***
  pause
  exit /b 1
)

echo.
echo ========================================
echo   Done! Test: https://www.ptcg-tw-sim.com/game/tournament
echo   Open in TWO browsers, click the join button.
echo ========================================
pause
