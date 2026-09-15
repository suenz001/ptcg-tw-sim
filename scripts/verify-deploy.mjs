// ═══════════════════════════════════════════════════════════════════════════
// v6.387 部署驗收工具（IRON_RULES Rule 43：**bat 沒報錯 ≠ 部署成功**）
//
// 由 oracle-admin/verify-deploy.bat 呼叫，報告寫成 .txt 再用記事本開
// （console 顯示不了 UTF-8 中文，同 check-health.bat 的作法）。
//
// ⚠ 這支只**讀**：五個公開網址 ＋ 本機兩個檔。不改任何東西、不碰 VM、不跑 bat。
//
// 為什麼需要它（2026-09-15 的事故）：
//   部署說明把 update-admin-full.bat 誤當成「前端」，v6.384／v6.385／v6.386
//   三版的玩家端前端一版都沒上線，正式站的 changelog 第一則卡在 v6.382 三天，
//   而 bat 從頭到尾沒有報過錯。⇒ 唯一可靠的驗收是**實測正式站**。
//
// ⚠ 判準**不在這個檔裡** —— 在 scripts/lib/verify-deploy-core.mjs（單一來源，
//   守衛 test-v6387 直接測那一份）。這裡只負責 I/O 與排版。
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  verFromVersionTs, firstChangelogVer, adminHint, evaluate, batsToRun,
} from './lib/verify-deploy-core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PROD = 'https://www.ptcg-tw-sim.com';
const TEST = 'https://suenz001.github.io/ptcg-tw-sim';
const RAW = 'https://raw.githubusercontent.com/suenz001/ptcg-tw-sim/main';

const P = (s = '') => console.log(s);

// ── 抓網頁：一律加時間戳 query ＋ no-cache，避開 CDN 與 Service Worker 快取
async function get(url) {
  const u = url + (url.includes('?') ? '&' : '?') + '_vd=' + Date.now();
  try {
    const r = await fetch(u, {
      headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
      signal: AbortSignal.timeout(25000),
    });
    if (!r.ok) return { ok: false, err: `HTTP ${r.status}` };
    return { ok: true, text: await r.text() };
  } catch (e) {
    return { ok: false, err: String(e?.message || e) };
  }
}

P('═══════════════════════════════════════════════════════════════');
P(' PTCG 部署驗收（唯讀）  ' + new Date().toLocaleString('zh-TW', { hour12: false }));
P('═══════════════════════════════════════════════════════════════');
P('');

// ── 本機 ────────────────────────────────────────────────────────────────
let localVer = null, localFirst = null;
try {
  localVer = verFromVersionTs(readFileSync(path.join(ROOT, 'src/lib/version.ts'), 'utf8'));
} catch (e) { P('⚠ 讀不到本機 src/lib/version.ts：' + e.message); }
try {
  localFirst = firstChangelogVer(readFileSync(path.join(ROOT, 'static/changelog.html'), 'utf8'));
} catch (e) { P('⚠ 讀不到本機 static/changelog.html：' + e.message); }

P(`本機 repo    版本號 = ${localVer ?? '(讀不到)'}   首頁 changelog 第一則 = ${localFirst ?? '(讀不到)'}`);
P('');
P('抓取中（五個公開網址，唯讀）…');

const [ghR, testR, prodR, adminR, verJsonR] = await Promise.all([
  get(`${RAW}/src/lib/version.ts`),
  get(`${TEST}/changelog.html`),
  get(`${PROD}/changelog.html`),
  get(`${PROD}/admin/`),
  get(`${PROD}/_app/version.json`),
]);

const rows = evaluate({
  localVer,
  localFirst,
  ghVer: ghR.ok ? verFromVersionTs(ghR.text) : null,
  testFirst: testR.ok ? firstChangelogVer(testR.text) : null,
  prodFirst: prodR.ok ? firstChangelogVer(prodR.text) : null,
  prodHint: adminR.ok ? adminHint(adminR.text) : null,
  errs: { gh: ghR.err, test: testR.err, prod: prodR.err, admin: adminR.err },
});

// ── 報告 ────────────────────────────────────────────────────────────────
P('');
P('───────────────────────────────────────────────────────────────');
for (const r of rows) {
  P(`${r.ok ? '✅' : '❌'} ${r.no} ${r.name}`);
  P(`      應該是：${r.want}`);
  P(`      實際是：${r.got}`);
  if (r.note) P(`      ⚠ ${r.note}`);
  if (!r.ok) P(`      ⇒ 要跑：${r.bat ?? r.batHint}`);
  P('');
}
P('───────────────────────────────────────────────────────────────');

if (verJsonR.ok) {
  const ts = (verJsonR.text.match(/"version"\s*:\s*"(\d+)"/) || [])[1];
  if (ts) {
    P(`正式站前端最後一次 build：${new Date(Number(ts)).toLocaleString('zh-TW', { hour12: false })}`);
    P('（這是 _app/version.json 的時間戳，redeploy-oracle.bat 每跑一次就會更新）');
    P('');
  }
}

const bad = rows.filter((r) => !r.ok);
if (bad.length === 0) {
  P('🟢 四條線全部對得上，部署完成。');
} else {
  P(`🔴 有 ${bad.length} 條對不上：`);
  for (const r of bad) P(`   ${r.no} ${r.name}`);
  const bats = batsToRun(rows);
  if (bats.length) {
    P('');
    P('   要跑的 bat（先伺服器後前端）：');
    for (const b of bats) P(`     - ${b}`);
  }
  P('');
  P('   ⚠ 若①或②沒過，先把 push／CI 弄好再跑 bat —— bat 是以 GitHub 為唯一真相的。');
}
P('');
P('═══════════════════════════════════════════════════════════════');

process.exitCode = bad.length === 0 ? 0 : 1;
