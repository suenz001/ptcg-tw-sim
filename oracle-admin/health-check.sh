#!/bin/bash
# PTCG VM 健康檢查（v6.294）—— 由 check-health.bat 上傳到 /tmp 後執行。
#
# ⚠⚠ 全程唯讀：不改任何設定、不重啟任何服務、不寫任何檔案、不寫任何一筆 DB。
#     守衛 scripts/test-v6294-health-check.mjs 會逐字掃這支檔案確認這件事
#     （重導向到檔案／rm・mv・sudo・chmod・sed -i／pm2 restart 等／mongo 寫入 API 一律禁止），
#     並附正對照：把上述任一種寫進來，守衛必須翻紅。
# ⚠  刻意不用 `set -e`：任何一節失敗都要繼續跑完其餘各節，否則站長只會拿到半份報告。
# ⚠  刻意不用 sudo：這裡讀的每個路徑 ubuntu 都讀得到（server.js 就是 pm2 以 ubuntu 跑起來的）。
# ⚠  輸出開頭刻意印 UTF-8 BOM —— 站長是用記事本開 .txt 的，沒有 BOM 中文會變亂碼。

printf '\xef\xbb\xbf'
echo "===== PTCG VM HEALTH CHECK (v6.294) ====="
date -u '+UTC  %Y-%m-%d %H:%M:%S'
TZ=Asia/Taipei date '+台灣 %Y-%m-%d %H:%M:%S'
echo

echo "----- [1] 線上實際在跑的 admin patch 版本 -----"
# ⚠ oracle_admin_update.sh 是把 server_admin_patch.js 的內容**注入 /opt/ptcg/api/server.js**
#   （見該腳本 Step 3 的 python 區塊）。VM 上**沒有** /opt/ptcg/api/server_admin_patch.js
#   這個檔 —— update-tournament.bat 只把它 scp 到 /tmp/ 當素材。
#   ⇒ 要知道「線上真的在跑哪一版 patch」只能讀 server.js 裡的錨點行。
PATCH_VER=$(grep -ao '=== ORACLE ADMIN ENDPOINTS === v[0-9][0-9.]*' /opt/ptcg/api/server.js 2>/dev/null | head -1)
if [ -n "$PATCH_VER" ]; then
  echo "  $PATCH_VER"
else
  echo "  (讀不到 server.js 裡的 patch 錨點 —— patch 沒裝上，或路徑變了)"
fi
echo

echo "----- [2] admin.html 的 SITE_VERSION_HINT（線上那一份）-----"
# ⚠ 只能抓「賦值」那一行：檔案裡另外有兩處是**讀取** SITE_VERSION_HINT，
#   用寬鬆的樣式會抓到那兩行而報出錯的版本（守衛 C3 用 repo 的 admin.html 實跑驗這件事）。
HINT=$(grep -ao "SITE_VERSION_HINT = '[0-9][0-9.]*'" /opt/ptcg/web/admin/index.html 2>/dev/null | head -1)
if [ -n "$HINT" ]; then
  echo "  $HINT"
else
  echo "  (讀不到 /opt/ptcg/web/admin/index.html)"
fi
echo

echo "----- [3] pm2 狀態 -----"
PM2_LIST=$(pm2 list --no-color 2>/dev/null)
if [ -z "$PM2_LIST" ]; then PM2_LIST=$(pm2 list 2>&1); fi
printf '%s\n' "$PM2_LIST" | head -30
echo

# ⭐ pm2 log 只取一次（開三次 pm2 又慢又可能拿到不同區段），底下 [4][5] 共用這一份。
PM2_LOG=$(pm2 logs ptcg-api --nostream --lines 5000 --no-color 2>/dev/null)
if [ -z "$PM2_LOG" ]; then PM2_LOG=$(pm2 logs ptcg-api --nostream --lines 5000 2>&1); fi
PM2_LOG_LINES=$(printf '%s\n' "$PM2_LOG" | wc -l)

echo "----- [4] 冒名閘 verified-gate 攔截紀錄（v6.291／v6.292）-----"
# ⚠⚠ 這一行的字串必須與 server_admin_patch.js 的 console.warn 逐字相同，
#     漂掉一個字這支工具就會靜默失效（永遠回報 0）。守衛 C1 逐字比對兩邊。
echo "  取到 $PM2_LOG_LINES 行 pm2 log（若只有 0~1 行代表 log 根本沒抓到，下面那個 0 不代表沒事）"
echo "  攔截次數：$(printf '%s\n' "$PM2_LOG" | grep -c 'verified-gate blocked')"
echo "  最近 20 筆："
printf '%s\n' "$PM2_LOG" | grep 'verified-gate blocked' | tail -20
echo

echo "----- [5] 最近的錯誤（最後 30 筆）-----"
printf '%s\n' "$PM2_LOG" | grep -iE 'error|unhandled|ReferenceError|TypeError' | tail -30
echo

echo "----- [6] 好友功能開關 ＋ [7] tournamentClientDiag 資料齡 -----"
# ⚠ 刻意**不用 mongosh**：這台 VM 不保證裝了 mongosh，而且沒裝時只會安靜地印一行
#   「not installed」＝看起來很正常的空結果（守衛安慰劑）。
#   改成 node ＋ /opt/ptcg/api/node_modules/mongodb，URI 探測順序與
#   oracle-admin/tournament/dump-client-monitor.cjs 完全相同（那一套在這台 VM 上已驗證可用）。
# ⚠ 只用 estimatedDocumentCount（讀 metadata，O(1)）＋ ts 索引取最舊 1 筆，
#   絕不對正式資料做全表掃描（Rule 30：不拿玩家的體驗當實驗）。
MONGO_JS=$(cat <<'JSEOF'
var fs = require('fs');
function envFile(p) {
  try {
    var ls = fs.readFileSync(p, 'utf8').split(/\r?\n/);
    for (var i = 0; i < ls.length; i++) {
      var m = ls[i].match(/=\s*["']?(mongodb(?:\+srv)?:\/\/[^"'\s]+)/i);
      if (m) return m[1];
    }
  } catch (e) { /* 檔案不存在就換下一個 */ }
  return null;
}
function fromProc() {
  try {
    var ps = fs.readdirSync('/proc');
    for (var i = 0; i < ps.length; i++) {
      if (!/^\d+$/.test(ps[i])) continue;
      var c = '';
      try { c = fs.readFileSync('/proc/' + ps[i] + '/cmdline', 'utf8'); } catch (e) { continue; }
      if (!/server\.js|ptcg/.test(c)) continue;
      var en = '';
      try { en = fs.readFileSync('/proc/' + ps[i] + '/environ', 'utf8'); } catch (e) { continue; }
      var vs = en.split('\0');
      for (var j = 0; j < vs.length; j++) {
        var m = vs[j].match(/^[^=]*=(mongodb(?:\+srv)?:\/\/[^\s]+)/);
        if (m) return m[1];
      }
    }
  } catch (e) { /* /proc 讀不到就往下走 */ }
  return null;
}
function findUri() {
  if (process.env.MONGO_URL) return process.env.MONGO_URL;
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI;
  var fp = fromProc();
  if (fp) return fp;
  var cands = ['/opt/ptcg/api/.env', '/opt/ptcg/.env', '/opt/ptcg/api/.env.production', '/opt/ptcg/api/.env.local'];
  for (var i = 0; i < cands.length; i++) { var u = envFile(cands[i]); if (u) return u; }
  return 'mongodb://127.0.0.1:27017';
}
(async function () {
  var M = null;
  try { M = require('/opt/ptcg/api/node_modules/mongodb'); }
  catch (e) { try { M = require('mongodb'); } catch (e2) { console.log('  (找不到 mongodb 模組 ⇒ [6][7] 這兩節沒有跑，不代表設定沒問題)'); return; } }
  var cli = new M.MongoClient(findUri(), { serverSelectionTimeoutMS: 8000 });
  await cli.connect();
  var db = null;
  try {
    var L = await cli.db().admin().listDatabases();
    for (var i = 0; i < L.databases.length; i++) {
      var cand = cli.db(L.databases[i].name);
      var cols = await cand.listCollections({ name: 'tournamentConfig' }).toArray();
      if (cols.length) { db = cand; break; }
    }
  } catch (e) { /* 沒有 listDatabases 權限就退回 URI 內的 db 名 */ }
  if (!db) {
    var um = String(findUri()).match(/mongodb(?:\+srv)?:\/\/[^/]+\/([^?]+)/);
    db = um ? cli.db(decodeURIComponent(um[1])) : cli.db();
  }
  var d = await db.collection('tournamentConfig').findOne({ _id: 'friendsConfig' });
  console.log('  [6] friendsConfig  enabled=' + !!(d && d.enabled === true)
    + '  dm=' + !!(d && d.dm === true) + (d ? '' : '   (doc 不存在 ⇒ 兩個開關都還是預設的關閉)'));
  var col = db.collection('tournamentClientDiag');
  var n = await col.estimatedDocumentCount();
  var oldest = await col.find({}, { projection: { ts: 1 } }).sort({ ts: 1 }).limit(1).toArray();
  if (!n || !oldest.length) {
    console.log('  [7] tournamentClientDiag  目前 0 筆');
  } else {
    var age = Math.round((Date.now() - Number(oldest[0].ts)) / 86400000);
    console.log('  [7] tournamentClientDiag  約 ' + n + ' 筆，最舊 '
      + new Date(Number(oldest[0].ts)).toISOString() + '（' + age + ' 天前）'
      + (age >= 8 ? '   <== 超過 7 天：已知問題（ts 存成數字，TTL 索引從未生效），另案追蹤'
                  : '   (在 7 天內，正常)'));
  }
  await cli.close();
})().catch(function (e) { console.log('  (讀取失敗：' + (e && e.message) + ')'); });
JSEOF
)
( cd /opt/ptcg/api && node -e "$MONGO_JS" ) 2>&1 | head -20
echo

echo "===== END ====="
