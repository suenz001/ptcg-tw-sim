#!/usr/bin/env node
/**
 * v6.381 守衛 —— B 組（乙）B-2 歸檔補 gameDraw ＋（丁）B-5 平手公告加「瑞士制仍可繼續」
 *
 *   (乙) B-2  錦標賽歸檔的 matches 補上 gameDraw（v6.365 當時為了不撞逐字快照而略過）。
 *             ⚠ **寫入端與讀出端都要補** —— v0.96 的教訓逐字：「歸檔本身有存，純粹是這裡的 map 漏掉」。
 *   (丁) B-5  規則平手／時限平手的雙敗公告，在瑞士制下要讓玩家知道「還能繼續打」。
 *             ⚠ 措辭與 v6.156 閒置雙敗那一句**逐字相同**（中央 helper swissContinueNote 共用）。
 *
 * ⭐ 全部行為層：把出貨碼裡那幾段 lambda／表達式**原封不動抽出來實跑**，
 *   不是「grep 到字串就算過」。
 * ⚠ 需要歷史的段落一律 hasBaseCommit 保護、拿不到時 shallowSkip。
 */
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { normEol } from './lib/eol-agnostic.mjs';
import {
  TAIL_ANCHOR, TEV_ANCHOR, revertV6384, revertV6381 as _rv6381, revertToV6292, revertToV6291,
  NEW_TAIL_SHA_V6384, NEW_TEV_SHA_V6384, NEW_TEV_LEN_V6384,
  OLD_TAIL_SHA_V6365, OLD_TEV_SHA_V6365, OLD_TEV_LEN_V6365,
} from './lib/tourn-revert-v6384.mjs';
const revertV6381 = (b) => _rv6381(revertV6384(b));   // ⭐v6.384 鏈又長一節（別名：既有呼叫點一個字都不必改）
import { NEW_TAIL_SHA_V6292, NEW_TEV_SHA_V6292, NEW_TEV_LEN_V6292 } from './lib/tourn-revert-v6292.mjs';
import { NEW_TAIL_SHA_V6291, NEW_TEV_SHA_V6291 } from './lib/tourn-revert-v6291.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = process.env.V6381_BASE || 'f1428cf2';   // v6.380
const SRV_REL = 'oracle-admin/server_admin_patch.js';
const PATCH = normEol(readFileSync(join(ROOT, SRV_REL), 'utf8'));
const PKG = normEol(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

let pass = 0, fail = 0;
const chk = (t, c, extra = '') => {
  if (c) { pass++; console.log('  PASS ' + t); return true; }
  fail++; console.log('  FAIL ' + t + (extra ? '\n        ' + String(extra).slice(0, 600) : ''));
  return false;
};

/** 從原始碼裡抽出一段 `(m) => ({ ... })` 的 map lambda，並實際建成函式。 */
function mapLambda(src, prefix) {
  const i = src.indexOf(prefix);
  if (i < 0) return null;
  // 從 prefix 之後找第一個 `(m) => ({`，然後用括號配對抓到對應的 `})`
  const HEAD = '(m) => ';
  const j = src.indexOf(HEAD + '({', i);
  if (j < 0) return null;
  // ⚠ 配對要從 `({` 的那個 `(` 開始 —— 從參數列表的 `(m)` 起算會在 `m` 之後就收掉。
  const open = j + HEAD.length;
  let depth = 0, k = open;
  for (; k < src.length; k++) {
    const c = src[k];
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) { k++; break; } }
  }
  const body = HEAD + src.slice(open, k);
  try { return { src: body, fn: new Function('return (' + body + ');')() }; }
  catch { return null; }
}

const M_FIXTURE = {
  round: 1, idx: 0, p1uid: 'u1', p1name: '甲', p2uid: 'u2', p2name: '乙',
  winnerUid: null, winnerName: null, status: 'done',
  bye: false, noShow: false, doubleNoShow: false,
  draw: true, gameDraw: true, deadlockDraw: false,
  forfeit: false, idleForfeit: false, timeLimit: false, adminResolved: false,
  doubleDrop: false, dropForfeit: false,
};

// ════════════════════════════════════════════════════════════════════════════
console.log('\n【A】(乙) B-2：歸檔的 matches 真的帶 gameDraw（寫入端＋讀出端，兩端都實跑）');
// ════════════════════════════════════════════════════════════════════════════
const W = mapLambda(PATCH, 'async function recordTournamentArchive(ev) {');
const R = mapLambda(PATCH, 'archives: archives.map((a) => ({');
chk('★★ A0 兩端的 map lambda 都抽得出來、也建得成函式（抽取器壞掉就紅，不准靜默全綠）',
  !!(W && R), 'W=' + !!W + ' R=' + !!R);
if (W && R) {
  const w = W.fn(M_FIXTURE);
  const r = R.fn(M_FIXTURE);
  chk('★★★ A1 歸檔**寫入**端：gameDraw 真的被寫進去，而且是 true', w.gameDraw === true, JSON.stringify(w));
  chk('★★★ A2 歸檔**讀出**端（admin stats）：gameDraw 也回傳出來（v0.96 的教訓：寫了不回等於沒補）',
    r.gameDraw === true, JSON.stringify(r));
  const w0 = W.fn({ ...M_FIXTURE, gameDraw: undefined });
  const r0 = R.fn({ ...M_FIXTURE, gameDraw: undefined });
  chk('★★ A3 舊資料（沒有 gameDraw 欄位的歷史歸檔）讀出來是 false，不是 undefined ⇒ 形狀穩定',
    w0.gameDraw === false && r0.gameDraw === false, JSON.stringify([w0.gameDraw, r0.gameDraw]));
  chk('★★★ A4 兩端的欄位集合完全一致（寫入端補了、讀出端漏掉就是 v0.96 的原型病灶）',
    JSON.stringify(Object.keys(r)) === JSON.stringify(Object.keys(w).filter((k) => k in r))
    && Object.keys(w).filter((k) => !(k in r)).every((k) => ['doubleDrop', 'dropForfeit'].includes(k)),
    'w=' + Object.keys(w).join(',') + '\n        r=' + Object.keys(r).join(','));
  chk('★★ A5 舊欄位一個都沒被動到（純 additive：draw／deadlockDraw／timeLimit… 值照舊）',
    w.draw === true && w.deadlockDraw === false && w.timeLimit === false
    && w.status === 'done' && w.winnerUid === null,
    JSON.stringify(w));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n【B】(丁) B-5：雙敗公告在瑞士制下要說「仍可繼續」（三句共用同一份措辭）');
// ════════════════════════════════════════════════════════════════════════════
const NOTE = '（瑞士制：雙方仍可繼續比賽）';
let noteFn = null;
{
  const m = /function swissContinueNote\(ev\) \{ return ([\s\S]*?); \}/.exec(PATCH);
  chk('★★ B0 中央 helper swissContinueNote 存在且抽得出來', !!m, String(m));
  if (m) {
    const swissPhase = (ev) => !!(ev && ev.format === 'swiss-then-cut' && ev.phase === 'swiss');
    noteFn = new Function('swissPhase', 'ev', 'return ' + m[1] + ';').bind(null, swissPhase);
    chk('★★★ B1 helper 行為：瑞士制階段回傳那句、其他一律空字串（非瑞士制逐字不變）',
      noteFn({ format: 'swiss-then-cut', phase: 'swiss' }) === NOTE
      && noteFn({ format: 'swiss-then-cut', phase: 'cut' }) === ''
      && noteFn({ format: 'single-elim' }) === '' && noteFn(null) === '',
      JSON.stringify([noteFn({ format: 'swiss-then-cut', phase: 'swiss' }), noteFn({ format: 'single-elim' })]));
    chk('★★ B1b 措辭與 v6.156 閒置雙敗那一句**逐字相同**（站上不會出現兩種說法）',
      PATCH.split(NOTE).length - 1 >= 2, '出現 ' + (PATCH.split(NOTE).length - 1) + ' 次');
  }
}
// ── B2：規則平手（gameDraw）的公告 ──────────────────────────────────────────
{
  const m = /await postSystemChat\((.*swissContinueNote\(_evNote\))\);/.exec(PATCH);
  chk('★★ B2a 規則平手公告的表達式抽得出來，而且真的接了 swissContinueNote', !!m, String(m));
  if (m && noteFn) {
    const f = new Function('m', 'swissContinueNote', '_evNote', 'return ' + m[1] + ';');
    const mm = { round: 2, p1name: '甲', p2name: '乙' };
    const sw = f(mm, noteFn, { format: 'swiss-then-cut', phase: 'swiss' });
    const se = f(mm, noteFn, { format: 'single-elim' });
    chk('★★★ B2 規則平手公告：瑞士制多那一句、單淘汰逐字不變',
      sw.endsWith(NOTE) && se === sw.slice(0, sw.length - NOTE.length) && se.includes('雙敗'),
      JSON.stringify([sw, se]));
    chk('★★ B2b 加完仍遠低於 postSystemChat 的 200 字上限（超過會被 slice 掉尾巴）',
      sw.length < 200, '長度=' + sw.length);
  }
  chk('★★ B2c _evNote 真的是從 TEVENTS 查來的（不是憑空變出來的物件）',
    /const _evNote = await TEVENTS\.findOne\(\{ _id: m\.eventId \}\);/.test(PATCH));
}
// ── B3：時限平手的公告 ──────────────────────────────────────────────────────
{
  const m = /await postSystemChat\((.*swissPhase\(ev\) \? swissContinueNote\(ev\).*)\);/.exec(PATCH);
  chk('★★ B3a 時限平手公告的表達式抽得出來', !!m, String(m));
  if (m && noteFn) {
    const swissPhase = (ev) => !!(ev && ev.format === 'swiss-then-cut' && ev.phase === 'swiss');
    const f = new Function('ev', 'swissPhase', 'swissContinueNote', 'return ' + m[1] + ';');
    const sw = f({ format: 'swiss-then-cut', phase: 'swiss' }, swissPhase, noteFn);
    const se = f({ format: 'single-elim' }, swissPhase, noteFn);
    chk('★★★ B3 時限平手公告：瑞士制不再說「雙方淘汰」，改說仍可繼續；單淘汰逐字不變',
      sw.includes(NOTE) && !sw.includes('雙方淘汰')
      && se === '⏰ 對局時限到，最後回合結束後仍平手 → 自動判雙敗，雙方淘汰（下一輪對手輪空）。',
      JSON.stringify([sw, se]));
    chk('★★ B3b 加完仍遠低於 200 字上限', sw.length < 200, '長度=' + sw.length);
  }
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n【C】revert-chain：v6.381 → v6.365 → v6.292 → v6.291（逐位元）');
// ════════════════════════════════════════════════════════════════════════════
{
  const tail = PATCH.slice(PATCH.indexOf(TAIL_ANCHOR));
  const tev = PATCH.slice(PATCH.indexOf(TEV_ANCHOR));
  chk('★★★ C1 現行區塊指紋 = v6.381 的新值（tail／tev／長度）',
    sha256(tail) === NEW_TAIL_SHA_V6384 && sha256(tev) === NEW_TEV_SHA_V6384
    && tev.length === NEW_TEV_LEN_V6384,
    'tail=' + sha256(tail) + ' tev=' + sha256(tev) + ' len=' + tev.length);
  chk('★★★ C2 還原 v6.381 後**逐位元**回到 v6.365（4 處行內改動＋1 個哨兵都宣告在還原器裡）',
    sha256(revertV6381(tail)) === OLD_TAIL_SHA_V6365
    && sha256(revertV6381(tev)) === OLD_TEV_SHA_V6365
    && revertV6381(tev).length === OLD_TEV_LEN_V6365,
    'tail=' + sha256(revertV6381(tail)) + ' tev=' + sha256(revertV6381(tev)) + ' len=' + revertV6381(tev).length);
  chk('★★ C3 鏈再往後：還原到 v6.292 與 v6.291 也都逐位元吻合',
    sha256(revertToV6292(tail)) === NEW_TAIL_SHA_V6292
    && sha256(revertToV6292(tev)) === NEW_TEV_SHA_V6292
    && revertToV6292(tev).length === NEW_TEV_LEN_V6292
    && sha256(revertToV6291(tail)) === NEW_TAIL_SHA_V6291
    && sha256(revertToV6291(tev)) === NEW_TEV_SHA_V6291);
  // 突變：把本版的一處改動抹掉 ⇒ 還原器必須爆（不是靜默吃掉）
  const mutated = tev.replace('gameDraw: !!m.gameDraw, deadlockDraw:', 'deadlockDraw:');
  chk('★★★ C4 [自驗] 把本版一處改動抹掉後，指紋必須對不上（C1 不是恆真式）',
    mutated !== tev && sha256(mutated) !== NEW_TEV_SHA_V6384);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n【D】28 把區塊鎖全部重釘、v6.365 的舊指紋零殘留');
// ════════════════════════════════════════════════════════════════════════════
{
  // 遞迴掃 scripts/（含 lib/）—— v6.365 的根因就是「readdirSync 不是遞迴」
  const { readdirSync } = await import('node:fs');
  const walk = (d, acc = []) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p, acc);
      else if (e.name.endsWith('.mjs')) acc.push(p);
    }
    return acc;
  };
  const files = walk(join(ROOT, 'scripts'));
  const rel = (p) => p.slice(ROOT.length).replace(/\\/g, '/').replace(/^\//, '');
  // 只有還原鏈的宣告端可以寫出 v6.365 的舊指紋
  const DECL = new Set(['scripts/lib/tourn-revert-v6365.mjs']);
  let nNew = 0, stale = [];
  for (const p of files) {
    const s = normEol(readFileSync(p, 'utf8'));
    nNew += (s.split(NEW_TAIL_SHA_V6384).length - 1) + (s.split(NEW_TEV_SHA_V6384).length - 1);
    if (DECL.has(rel(p))) continue;
    if (s.includes(OLD_TAIL_SHA_V6365)) stale.push(rel(p) + ' :: v6.365 tail');
    if (s.includes(OLD_TEV_SHA_V6365)) stale.push(rel(p) + ' :: v6.365 tev');
    if (s.includes(String(OLD_TEV_LEN_V6365))) stale.push(rel(p) + ' :: v6.365 len');
  }
  chk('★★★ D1 v6.365 的舊指紋零殘留（還原鏈的宣告端除外）—— 漏重釘一把這裡就紅',
    stale.length === 0, stale.join(' | '));
  chk('★★★ D2 新指紋真的被釘到很多地方（>= 25 處；掃描器壞掉會掉到 0）',
    nNew >= 25, '新指紋出現 ' + nNew + ' 處，掃了 ' + files.length + ' 個檔');
  chk('★★ D3 [自驗] 舊指紋與新指紋確實不同（否則 D1 是恆真式）',
    OLD_TAIL_SHA_V6365 !== NEW_TAIL_SHA_V6384 && OLD_TEV_SHA_V6365 !== NEW_TEV_SHA_V6384
    && OLD_TEV_LEN_V6365 !== NEW_TEV_LEN_V6384);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n【E】HEAD-FAIL：BASE(' + BASE_SHA + ') 上本版的判準必須全部不成立');
// ════════════════════════════════════════════════════════════════════════════
if (!hasBaseCommit(ROOT, BASE_SHA)) {
  shallowSkip('【E】對 BASE(' + BASE_SHA + ') 的 HEAD-FAIL', '【A】【B】【C】【D】不需要歷史，仍在守');
} else {
  const r = readBaseBlob(ROOT, BASE_SHA, SRV_REL);
  const baseRaw = typeof r === 'string' ? r : r.out;
  const base = normEol(baseRaw);
  const bw = mapLambda(base, 'async function recordTournamentArchive(ev) {');
  const br = mapLambda(base, 'archives: archives.map((a) => ({');
  chk('★★★ E1 BASE 的歸檔**寫入**端沒有 gameDraw（⇒ A1 在 BASE 上必紅）',
    !!bw && bw.fn(M_FIXTURE).gameDraw === undefined, bw ? JSON.stringify(bw.fn(M_FIXTURE)) : 'lambda 抽不出來');
  chk('★★★ E2 BASE 的歸檔**讀出**端也沒有 gameDraw（⇒ A2 在 BASE 上必紅）',
    !!br && br.fn(M_FIXTURE).gameDraw === undefined, br ? JSON.stringify(br.fn(M_FIXTURE)) : 'lambda 抽不出來');
  chk('★★★ E3 BASE 沒有 swissContinueNote 這個 helper（⇒ B0／B1 在 BASE 上必紅）',
    !base.includes('swissContinueNote'));
  chk('★★★ E4 BASE 的時限平手公告就是那句寫死「雙方淘汰」的（⇒ B3 在 BASE 上必紅）',
    base.includes("await postSystemChat('⏰ 對局時限到，最後回合結束後仍平手 → 自動判雙敗，雙方淘汰（下一輪對手輪空）。');"));
  chk('★★ E5 BASE 的區塊指紋是 v6.365 的舊值（⇒ C1 在 BASE 上必紅）',
    sha256(base.slice(base.indexOf(TAIL_ANCHOR))) === OLD_TAIL_SHA_V6365
    && sha256(base.slice(base.indexOf(TEV_ANCHOR))) === OLD_TEV_SHA_V6365);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n【F】npm test chain');
// ════════════════════════════════════════════════════════════════════════════
chk('★★ F1 本守衛已掛進 npm test chain',
  PKG.includes('scripts/test-v6381-archive-gamedraw-and-swiss-note.mjs'));
chk('★★ F2 revert-chain 的三個消費者都還在 chain 裡（鏈斷了就沒人在驗了）',
  PKG.includes('scripts/test-v6276-deck-tournament-stats.mjs')
  && PKG.includes('scripts/test-v6291-tourn-verified-gate.mjs')
  && PKG.includes('scripts/test-v6292-tourn-verified-gate2.mjs'));

console.log('\n=== v6.381 守衛：PASS ' + pass + ' / FAIL ' + fail + ' ===');
assert.strictEqual(fail, 0, '有 ' + fail + ' 條失敗');
