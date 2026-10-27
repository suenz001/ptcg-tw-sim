#!/usr/bin/env node
import { revertAdminV171 as _revertAdminV171 } from './lib/sap-revert-admin-v171.mjs';
import { revertAdminV172 } from './lib/sap-revert-admin-v172.mjs';
import { revertAdminV173 as _revertAdminV173 } from './lib/sap-revert-admin-v173.mjs';
import { revertAdminV174 } from './lib/sap-revert-admin-v174.mjs';   // ⭐v6.601（server v1.74，Rule 40）：我的錦標賽對戰回傳 result（行為由 test-v6601 守）
const revertAdminV173 = (s) => _revertAdminV173(revertAdminV174(s));   // 鏈又長一節（既有呼叫點一個字都不必改）
const revertAdminV171 = s => _revertAdminV171(revertAdminV172(revertAdminV173(s)));
/**
 * server patch v1.69 守衛：管理員「重賽」時，錦標賽聊天室的系統訊息「（從擲幣重新開始）」→「（從擲硬幣重新開始）」
 *   （站長 2026-10-16 裁定「5.好」：玩家看得到的字一律寫「擲硬幣」，與 v6.573 對戰紀錄用詞統一一致）
 *
 *   A1 重賽端點送出的系統訊息寫「從擲硬幣重新開始」（把端點本體抽出來看 postSystemChat 的字串，不是全檔掃）
 *   A2 伺服器補丁裡玩家看得到的字串（引號內）不再有「擲幣」（註解不算）
 *   A3 管理員重賽的其他行為不變：只動了宣告的兩行（revertAdminV169 後逐位元等於 v1.68）
 *   D  錦標賽區塊 28 把鎖重釘：D1 現行＝新值；D2 只還原本版 ⇒ 逐位元回到 v1.67／v1.68 的值；D3 自驗改一個字 ⇒ 指紋對不上；
 *      D4 v1.67 舊值在 scripts/ 下零殘留（還原鏈宣告端除外）；D5 七支消費者都接 v1.69 這一節
 *   H  HEAD-FAIL：A1／A2 餵 BASE（v6.579）必紅
 * Run: node scripts/test-sap169-restart-coin-wording.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import {
  TAIL_ANCHOR, TEV_ANCHOR, revertV169,
  NEW_TAIL_SHA_V169, NEW_TEV_SHA_V169, NEW_TEV_LEN_V169, OLD_TAIL_SHA_V167, OLD_TEV_SHA_V167, OLD_TEV_LEN_V167,
} from './lib/tourn-revert-v169.mjs';
import { revertAdminV169, ADMIN_V169_PAIRS } from './lib/sap-revert-admin-v169.mjs';
import { revertAdminV170 } from './lib/sap-revert-admin-v170.mjs';   // ⭐v1.70（Rule 54：先剝較新的；錦標賽區塊之前的新區塊）

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REL = 'oracle-admin/server_admin_patch.js';
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.579。
const BASE_SHA = '772ecf8c4e413b0046c598348e34e6563305d596';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const SRC = revertAdminV171(readFileSync(join(ROOT, REL), 'utf8').replace(/\r\n/g, '\n'));

// 重賽端點本體：從 app.post('/api/tournament/admin/match/restart' 起，大括號配對到 handler 結束
function restartHandler(src) {
  const a = src.indexOf("app.post('/api/tournament/admin/match/restart'");
  if (a < 0) return null;
  let i = src.indexOf('{', src.indexOf('=>', a)), depth = 0;
  for (let j = i; j < src.length; j++) { const c = src[j]; if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) return src.slice(a, j + 1); } }
  return null;
}
// 只取引號內的字串（去掉註解行）——玩家看得到的字只會在字串裡
const quoted = (src) => src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n').match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g) || [];
function scen(src) {
  const h = restartHandler(src) || '';
  const chats = (h.match(/postSystemChat\(([^;]*)\);/g) || []);
  return {
    A1: h.length > 200 && chats.length === 1 && chats[0].includes('（從擲硬幣重新開始）'),
    A2: quoted(src).length > 1000 && !quoted(src).some((q) => q.includes('擲幣')),
  };
}
console.log('【A】重賽系統訊息');
const R = scen(SRC);
ok('★★★ A1 重賽端點送出的系統訊息寫「（從擲硬幣重新開始）」', R.A1);
ok('★★ A2 伺服器補丁裡的字串（玩家看得到的）不再有「擲幣」', R.A2);
ok('★ A2 自驗：把「擲硬幣」改回「擲幣」⇒ A2 抓得到', scen(SRC.replace('（從擲硬幣重新開始）', '（從擲幣重新開始）')).A2 === false);

console.log('\n【H】HEAD-FAIL（BASE v6.579＝server v1.68）');
let BASE = null;
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('sap169 HEAD-FAIL', '需要歷史 commit');
else {
  const x = readBaseBlob(ROOT, BASE_SHA, REL); BASE = x.ok ? x.out.replace(/\r\n/g, '\n') : '';
  const B = scen(BASE);
  ok('★★★[H] v1.68：A1 紅', B.A1 !== true);
  ok('★★[H] v1.68：A2 紅', B.A2 !== true);
  // A3：只動了宣告的兩行 ⇒ 整份還原後逐位元等於 v1.68
  let rv = null; try { rv = revertAdminV169(revertAdminV170(SRC)); } catch (e) { rv = 'ERR ' + e.message; }
  ok('★★★ A3 revertAdminV169（' + ADMIN_V169_PAIRS.length + ' 對）後逐位元等於 v1.68（其他程式一個字都沒動）', rv === BASE, typeof rv === 'string' ? rv.slice(0, 80) : '');
}

console.log('\n【D】錦標賽區塊 28 把鎖');
const tail = SRC.slice(SRC.indexOf(TAIL_ANCHOR)), tev = SRC.slice(SRC.indexOf(TEV_ANCHOR));
ok('★★★ D1 現行區塊指紋＝v1.69 新值（tail／tev／長度）', sha(tail) === NEW_TAIL_SHA_V169 && sha(tev) === NEW_TEV_SHA_V169 && tev.length === NEW_TEV_LEN_V169, [sha(tail).slice(0, 12), sha(tev).slice(0, 12), tev.length].join(' '));
{
  const t2 = revertV169(tail), e2 = revertV169(tev);
  ok('★★★ D2 只還原 v1.69 ⇒ 逐位元回到 v1.67／v1.68 的指紋', sha(t2) === OLD_TAIL_SHA_V167 && sha(e2) === OLD_TEV_SHA_V167 && e2.length === OLD_TEV_LEN_V167, [sha(t2).slice(0, 12), sha(e2).slice(0, 12), e2.length].join(' '));
}
{
  const mut = SRC.replace('（從擲硬幣重新開始）', '（從擲硬幣重新開始!）');
  ok('★★ D3 自驗：本版改一個字 ⇒ D1 指紋對不上（非恆真）', mut !== SRC && sha(mut.slice(mut.indexOf(TAIL_ANCHOR))) !== NEW_TAIL_SHA_V169);
}
{
  const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
  const DECL = new Set(['scripts/lib/tourn-revert-v167.mjs']);
  const stale = [];
  for (const p of walk(join(ROOT, 'scripts'))) {
    if (!p.endsWith('.mjs')) continue;
    const rel = p.slice(ROOT.length + 1).replace(/\\/g, '/');
    if (DECL.has(rel)) continue;
    const s = readFileSync(p, 'utf8');
    if (s.includes(OLD_TAIL_SHA_V167) || s.includes(OLD_TEV_SHA_V167) || new RegExp('const (TOURN_LEN\\w*|TEV_LEN\\w*) = ' + OLD_TEV_LEN_V167 + '\\b').test(s)) stale.push(rel);
  }
  ok('★★ D4 v1.67 舊指紋在 scripts/ 下零殘留（還原鏈宣告端除外）', stale.length === 0, stale.join(', '));
}
{
  const CONSUMERS = ['test-v6276-deck-tournament-stats', 'test-v6291-tourn-verified-gate', 'test-v6292-tourn-verified-gate2', 'test-v6381-archive-gamedraw-and-swiss-note', 'test-sap152-bracket-light', 'test-sap153-tourn-deck-validate', 'test-sap154-audit-load'];
  const bad = CONSUMERS.filter((f) => { const s = readFileSync(join(ROOT, 'scripts', f + '.mjs'), 'utf8'); return !(s.includes("from './lib/tourn-revert-v176.mjs'") && s.includes('revertV169(')); });
  ok('★★ D5 七支消費者都 import tourn-revert-v169 且呼叫 revertV169(', bad.length === 0, bad.join(', '));
}
console.log(`\n=== server v1.69 重賽系統訊息「擲硬幣」：${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
