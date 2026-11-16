// v6.647＋server v1.86 守衛：錦標賽「個人」分頁的參賽紀錄可以直接點開那場的賽程（玩家需求 2026-11-16）
//
// 【S】伺服器：個人資料聚合 _aggregateArchives 的每筆參賽紀錄帶 eventId（實跑；沒有 eventId 的舊歸檔回 null）
// 【F】前端（剝註解後）：
//   F1 有 eventId 的參賽紀錄是可點的列（role=button、Enter／空白鍵），呼叫既有的 tHofOpen（同歷屆冠軍那一份，不另寫一套）；沒有的維持純文字
//   F2 歷屆賽程／對戰戰報視窗搬到所有分頁的條件式收尾之後（「個人」分頁也看得到），而且只剩一份
//   F3 切分頁時關掉賽程與戰報視窗（以前跟著「賽事」分頁一起隱藏）
//   F4 行為：把真的 tHofOpen 抽出來實跑 ⇒ 參賽紀錄物件會打 /champion-bracket?eventId=<代號>
// 【H】HEAD-FAIL：BASE（e8d902f0＝v6.646／v1.85）上 S1／F1／F2／F3 紅，F4 綠（既有函式本來就吃 eventId，正對照）
import { readFileSync } from 'node:fs';
import { transform } from 'esbuild';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripCommentsBlankChecked } from './lib/strip-comments.mjs';
import { normEol } from './lib/eol-agnostic.mjs';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { revertV6653IfPresent } from './lib/revert-v6653-player-profile.mjs';
import { revertAdminV187IfPresent } from './lib/sap-revert-admin-v187.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = 'e8d902f0';
const PAGE = 'src/routes/game/+page.svelte', SAP = 'oracle-admin/server_admin_patch.js';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + String(x).slice(0, 400) : '')); } };
function fnBody(src, head) {
  const i = src.indexOf(head); if (i < 0) return '';
  let d = 0; for (let k = src.indexOf('{', i); k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (d === 0) return src.slice(i, k + 1); } }
  return '';
}

// 從 head 開始，配對 Svelte 條件區塊的開頭與收尾，回傳整段（含巢狀）
function ifBlock(src, head) {
  const i = src.indexOf(head); if (i < 0) return '';
  const re = /\{#if\b|\{\/if\}/g; re.lastIndex = i; let d = 0, m;
  while ((m = re.exec(src))) { if (m[0] === '{/if}') { d--; if (d === 0) return src.slice(i, m.index + 5); } else d++; }
  return '';
}
// 審查 P3-1：搬移後三個視窗的內容必須與 BASE（在「賽事」分頁裡的那一份）逐字相同（剝註解、空白正規化）
export function modalTrio(pageRaw) {
  const page = stripCommentsBlankChecked(normEol(pageRaw), 'svelte');
  const parts = ['{#if tHofLoading}', '{#if tHofView}', '{#if tMatchLog || tMatchLogLoading}'].map((h) => ifBlock(page, h));
  return parts.every((x) => x.length > 0) ? parts.map((x) => x.replace(/\s+/g, ' ').trim()).join('\n') : '';
}

function checkS(sap, tag) {
  const fn = fnBody(sap, 'function _aggregateArchives(archives) {');
  ok(`前提${tag} 抽得到 _aggregateArchives`, fn.length > 1500, fn.length);
  let out = null, err = null;
  try {
    const agg = new Function('_detectCutPlacements', fn + '\nreturn _aggregateArchives;')(() => ({ finals: new Set(), top4: new Set(), top8: new Set() }));
    out = agg([
      { eventId: 'evt_abc', eventName: '測試賽', finishedAt: 2, startedAt: 1, players: [{ uid: 'u1', email: 'a@x', name: 'A' }, { uid: 'u2', email: 'b@x', name: 'B' }], matches: [{ round: 1, idx: 0, p1uid: 'u1', p2uid: 'u2', winnerUid: 'u1', status: 'done' }] },
      { eventName: '舊歸檔', finishedAt: 4, startedAt: 3, players: [{ uid: 'u1', email: 'a@x', name: 'A' }], matches: [] },
    ]);
  } catch (e) { err = e.message; }
  const ev = out?.get('a@x')?.events ?? [];
  ok(`★★★ S1${tag} 參賽紀錄帶 eventId（有歸檔代號的那筆＝代號；舊歸檔沒有 ⇒ null，不會壞）`, !err && ev.length === 2 && ev[0].eventId === 'evt_abc' && ev[1].eventId === null && ev[0].wins === 1, JSON.stringify({ err, ev }));
  // 審查 P3-1：/profile 對 events 是整筆物件原樣輸出（只排序），不是白名單 ⇒ eventId 不會在端點被丟掉
  const prof = fnBody(sap, "app.get('/api/tournament/profile', async (req, res) => {");
  ok(`★★ S2${tag} /profile 原樣輸出 events（slice＋sort，沒有挑欄位的 map）`, /events: s\.events\.slice\(\)\.sort\(\(a, b\) => \(b\.date \|\| 0\) - \(a\.date \|\| 0\)\)/.test(prof) && !/s\.events\.(map|slice\(\)\.map)/.test(prof), prof.length);
}

function checkF(pageRaw, tag) {
  const page = stripCommentsBlankChecked(normEol(pageRaw), 'svelte');
  const i = page.indexOf('<div class="tourn-lb-title">📋 參賽紀錄</div>');
  const blk = i >= 0 ? page.slice(i, i + 2500) : '';
  ok(`前提${tag} 抓得到參賽紀錄區塊`, blk.length > 500);
  ok(`★★★ F1${tag} 有 eventId 的紀錄是可點的列（role=button、可用鍵盤）並呼叫既有的 tHofOpen；沒有的維持純文字`,
    /\{#if ev\.eventId\}\s*<div class="tourn-pf-evrow tourn-pf-evrow-go" role="button" tabindex="0"[^>]*onclick=\{\(\) => tHofOpen\(ev\)\}[^>]*onkeydown=\{\(e\) => \{ if \(e\.key === 'Enter' \|\| e\.key === ' '\) \{ e\.preventDefault\(\); tHofOpen\(ev\); \} \}\}>/.test(blk)
      && /\{:else\}\s*<div class="tourn-pf-evrow">/.test(blk) && /賽程 ▸/.test(blk));
  const iHof = page.indexOf('{#if tHofView}'), iLog = page.indexOf('{#if tMatchLog || tMatchLogLoading}'), iFriends = page.indexOf("{:else if tTab === 'friends'}"), iErr = page.indexOf('{#if tError}<p class="warn">');
  const iEnd = iFriends > 0 ? page.indexOf('{/if}', page.indexOf('</div>', page.indexOf('<FriendsPanel embedded', iFriends))) : -1;
  ok(`★★★ F2${tag} 歷屆賽程／對戰戰報視窗在所有分頁的條件式收尾之後（個人分頁也看得到），而且各只有一份`,
    iEnd > 0 && iHof > iEnd && iLog > iEnd && iHof < iErr && iLog < iErr && page.split('{#if tHofView}').length === 2 && page.split('{#if tHofLoading}').length === 2 && page.split('{#if tMatchLog || tMatchLogLoading}').length === 2,
    JSON.stringify({ iHof, iLog, iEnd, iErr }));
  // F3：分頁真的換了（不是第一次執行、不是同一個分頁）才關；寫在 $effect 裡，tSwitchTab 逐字不動
  const ef = (() => { const i = page.indexOf('let _v6647TabSeen'); return i < 0 ? '' : page.slice(i, i + 600); })();
  ok(`★★ F3${tag} 切分頁時關掉賽程與戰報視窗（$effect 讀 tTabRaw；第一次只記錄、同一分頁不關）`,
    /\$effect\(\(\) => \{\s*const t = tTabRaw;\s*if \(_v6647TabSeen === null\) \{ _v6647TabSeen = t; return; \}\s*if \(t === _v6647TabSeen\) return;\s*_v6647TabSeen = t;\s*untrack\(\(\) => \{ tHofClose\(\); tMatchLogClose\(\); \}\);\s*\}\);/.test(ef), ef.slice(0, 300));
}

async function checkF4(pageRaw, tag) {
  const page = normEol(pageRaw);
  const fn = (await transform(fnBody(page, 'async function tHofOpen(c: any) {'), { loader: 'ts' })).code;   // 去掉型別標註
  const calls = [];
  let err = null;
  try {
    const run = new Function('tApi', 'tMatchTimesLoad', `let tHofSeq = 0, tHofLoading = false, tHofView = null, tHofPage = 1, tError = '', tHofEventId = '';\n${fn}\nreturn async (c) => { await tHofOpen(c); return { tHofView, tHofEventId, tError }; };`)(
      async (u) => { calls.push(u); return { matches: [], rounds: 1, eventName: 'X' }; }, () => {});
    const r = await run({ eventId: 'evt_abc', eventName: '測試賽', wins: 1 });
    ok(`★★ F4${tag} 參賽紀錄物件交給 tHofOpen ⇒ 打 /champion-bracket?eventId=evt_abc 並打開賽程`, calls[0] === '/champion-bracket?eventId=evt_abc' && r.tHofView?.eventName === 'X' && r.tHofEventId === 'evt_abc', JSON.stringify({ calls, r }));
  } catch (e) { err = e.message; ok(`★★ F4${tag} tHofOpen 實跑`, false, err); }
}

const sap = revertAdminV187IfPresent(readFileSync(join(ROOT, SAP), 'utf8').replace(/\r\n/g, '\n'));
const page = revertV6653IfPresent(PAGE, readFileSync(join(ROOT, PAGE), 'utf8'));
console.log('【S】伺服器'); checkS(sap, '');
console.log('【F】前端'); checkF(page, ''); await checkF4(page, '');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const bp0 = readBaseBlob(ROOT, BASE_SHA, PAGE);
  const cur = modalTrio(page), old = bp0.ok ? modalTrio(bp0.out) : '';
  ok('★★★ F2b 搬出來的賽程／戰報視窗內容與 BASE 逐字相同（剝註解、空白正規化）', cur.length > 3000 && cur === old, JSON.stringify({ cur: cur.length, old: old.length }));
  // 正對照：把裡面一個 onclick 改成空函式 ⇒ 必須對不上
  const mut = modalTrio(page.replace('if (_hasLog) tMatchLogOpen(', 'if (false) tMatchLogOpen('));
  ok('★★ F2c 正對照：視窗內容被改一個字 ⇒ F2b 會抓到', mut.length > 3000 && mut !== old);
  const swNow = fnBody(stripCommentsBlankChecked(normEol(page), 'svelte'), 'function tSwitchTab('), swOld = fnBody(stripCommentsBlankChecked(normEol(bp0.ok ? bp0.out : ''), 'svelte'), 'function tSwitchTab(');
  ok('★★ F3b tSwitchTab 與 BASE 逐字相同（v6.297／v6.299／v6.603 守衛抽它實跑）', swNow.length > 100 && swNow === swOld, JSON.stringify({ now: swNow.length, old: swOld.length }));
} else shallowSkip('F2b（缺 BASE ' + BASE_SHA + '）');
console.log('【H】HEAD-FAIL');
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('H（缺 BASE ' + BASE_SHA + '）');
else {
  const bs = readBaseBlob(ROOT, BASE_SHA, SAP), bp = readBaseBlob(ROOT, BASE_SHA, PAGE);
  const before = pass, fb = fail; const log = console.log; const lines = []; console.log = (s) => lines.push(String(s));
  checkS(bs.ok ? bs.out.replace(/\r\n/g, '\n') : '', '@BASE'); checkF(bp.ok ? bp.out : '', '@BASE'); await checkF4(bp.ok ? bp.out : '', '@BASE');
  console.log = log;
  const reds = lines.filter((l) => /FAIL/.test(l)).map((l) => l.trim().slice(5, 30));
  pass = before; fail = fb;
  console.log('    BASE 紅：' + reds.join('｜'));
  ok('★★★ H1 BASE 上 S1／F1／F2／F3 紅', ['S1@', 'F1@', 'F2@', 'F3@'].every((k) => reds.some((r) => r.includes(k))), reds.join(','));
  ok('★★ H2 BASE 上「前提」與 F4 綠（tHofOpen 本來就吃 eventId；正對照）', !reds.some((r) => /前提|F4@/.test(r)), reds.join(','));
}
console.log(`=== v6.647 參賽紀錄點開賽程：${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
