#!/usr/bin/env node
/**
 * v6.571 守衛：對戰紀錄的「擊倒／KO」統一成官方卡面用詞「昏厥」，而且「昏厥」那一行要上紅色
 *   （站長 2026-10-15：「照你的想法分批改 1.『擊倒／KO → 昏厥』，並讓『昏厥』那行變紅」）。
 *   依據：static/cards 台灣官方卡面「昏厥」230 次、「擊倒」0 次。
 *
 *   S1 掃描 src/（遊戲程式＋頁面）所有含中文的字串字面：不得再出現「擊倒」或獨立的「KO」（只掃字串，不掃註解與識別字）
 *   S2 掃描器正對照：餵違規樣本一定抓得到；註解、識別字（oppAttackKOdMe…）不誤報
 *   C1 著色：「X 昏厥！」「因中毒傷害昏厥」「也昏厥」是紅色；「避免昏厥」「不會昏厥」「不算昏厥」「沒有寶可夢昏厥」「已昏厥」不是
 *   C2 舊對局（回放／戰報存的是舊字樣）：「被擊倒！」「KO」仍是紅色（零回歸）
 *   E1 引擎實跑：寶可夢檢查中毒昏厥 ⇒ log 是「因中毒傷害昏厥！」（由 test-v6354 K3b 同時守）
 *   【H】BASE（v6.570）：S1、C1 紅；C2 綠（正對照）
 */
import { readFileSync, readdirSync, statSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, dirname, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { normEol } from './lib/eol-agnostic.mjs';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { scanStrings, walkSrc } from './lib/src-string-scan.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.570。
const BASE_SHA = '16e5e75e';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

const BAD = /擊倒|(?<![A-Za-z0-9_])KO(?![A-Za-z0-9_])/;
let LOOKBEHIND = [];   // 掃描時順便收集 regex lookbehind（字面或 new RegExp 字串）
/** ⭐v6.572 起掃描器搬到 scripts/lib/src-string-scan.mjs（與 test-v6572 共用一份，Rule 38）。只看含中文的字串。 */
function scanSource(src, label) {
  const out = [];
  scanStrings(src, label, (t, line) => { if (/[\u4e00-\u9fff]/.test(t) && BAD.test(t)) out.push(label + ':' + line + ' ' + t.slice(0, 80)); },
    (line) => LOOKBEHIND.push(label + ':' + line));
  return out;
}
const FILES = walkSrc(join(ROOT, 'src'));

function scenS(read) {
  const hits = [];
  let n = 0;
  for (const p of FILES) {
    const rel = relative(ROOT, p).replace(/\\/g, '/');
    const src = read(rel);
    if (src == null) continue;
    n++;
    hits.push(...scanSource(src, rel));
  }
  return { S1: n > 200 && hits.length === 0, S1n: JSON.stringify({ files: n, hits: hits.slice(0, 8), total: hits.length }) };
}
function scenS2() {
  const pos = scanSource("const a = `${x} 被擊倒！`; addLog(s, '對手 KO', 0);", 'pos');
  const neg = scanSource("// 被擊倒的舊寫法\nconst k = 'oppAttackKOdMeThisTurn'; /* KO */ const t = `${willKO ? 'x' : ''}昏厥`; const r = /KO/;", 'neg');
  const div = scanSource("const x = a / b; addLog(s, '被擊倒'); const y = (c) / 2; addLog(s, '對手 KO');", 'div');   // 除號不可以吞掉後面的字串
  return { S2: pos.length === 2 && neg.length === 0 && div.length === 2, S2n: JSON.stringify({ pos, neg, div }) };
}

async function loadLib(src) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6571-'));
  try {
    const f = join(tmp, 'lf.ts'); writeFileSync(f, src);
    const o = join(tmp, 'o.mjs');
    await build({ entryPoints: [f], outfile: o, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
    return await import(pathToFileURL(o).href);
  } catch { return null; } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}
function scenC(L) {
  if (!L || typeof L.tokenizeLogMessage !== 'function') return {};
  const red = (m) => L.tokenizeLogMessage(m).filter((t) => t.cls === 'log-ko').map((t) => t.text);
  const yes = ['噴火龍ex 昏厥！小明 取得 2 張獎賞卡。', '伊布 因中毒傷害昏厥！', '同命戰鬥：伊布 也昏厥，對手待取 1 張獎賞卡'];
  const no = ['倖存鍛鍊器：伊布 避免昏厥，剩餘 HP 10！', '伊布 不會昏厥', '水迴旋：自身與附加卡放回牌庫並重洗（不算昏厥，沒有獎賞卡）',
    '報仇：上個對手的回合自己沒有寶可夢昏厥 → 30', '選擇要放回對手手牌的能量（已昏厥戰鬥位）',
    '死亡宣告：反面 → 伊布 不昏厥', '迷唇姐：丟棄（非昏厥，對手不獲得獎賞卡）', '伊布 未昏厥', '沒有可昏厥的目標', '傷害累積到 HP 才判定昏厥', '即將昏厥'];
  // 整行標紅只給「真的昏厥了」：條件、預告、說明句不標整行（字本身可以紅）
  const noLine = ['無畏之心：伊布｜不屈（不施加「昏厥時多 +1 張獎賞卡」）', '不觸發（在備戰區昏厥不算）', '慢嚼碎：對手的戰鬥寶可夢會在下個對手的回合結束時昏厥',
    '幻影奇襲：將 6 個傷害指示物自由分配到對手備戰寶可夢（必須全部放完，昏厥／免疫後溢出的指示物作廢）', '報仇：上個對手的回合自己有寶可夢因招式的傷害昏厥 → +80'];
  const old = ['伊布 被擊倒！小明 取得 1 張獎賞卡。', '豪邁炸彈（holder 被 KO）：…'];
  return {
    C1: yes.every((m) => red(m).length === 1) && no.every((m) => red(m).length === 0),
    C1n: JSON.stringify({ yes: yes.map(red), no: no.map(red) }),
    C2: old.every((m) => red(m).length >= 1),
    C2n: JSON.stringify(old.map(red)),
    // L1：整行標紅（站長：「讓『昏厥』那行變紅」）—— 真的昏厥 ⇒ log-ko-line；否定說法 ⇒ 不標；回合分隔與勝負訊息照舊優先
    L1: typeof L.lineClass === 'function' && yes.every((m) => L.lineClass(m) === 'log-ko-line') && no.every((m) => L.lineClass(m) === '') && noLine.every((m) => L.lineClass(m) === '')
      && L.lineClass('冰冷之帳：小明 有寶可夢昏厥，小華 將取得 1 張獎賞卡。') === 'log-ko-line' && L.lineClass('⚠️ 系統昏厥檢查：伊布 昏厥（戰鬥場，傷害 70 ≥ HP 70）+1 張獎賞卡') === 'log-ko-line'
      && L.lineClass('伊布 被擊倒！小明 取得 1 張獎賞卡。') === 'log-ko-line' && L.lineClass('回合結束，換 小明 行動') === 'log-turn-marker'
      && L.lineClass('小明 取得所有獎賞卡，獲得勝利！') === 'log-victory',
    L1n: typeof L.lineClass === 'function' ? JSON.stringify({ yes: yes.map(L.lineClass), no: no.map(L.lineClass) }) : 'no lineClass',
  };
}

const LABEL = {
  S1: '★★★ S1 遊戲程式與頁面的所有中文字串：不再出現「擊倒」或獨立的「KO」（官方用詞是「昏厥」）',
  S2: '★★ S2 掃描器正對照：違規樣本兩條都抓到；註解、識別字、模板插值不誤報',
  C1: '★★★ C1 「昏厥」那一行上紅色；「避免／不會／不算／沒有寶可夢／已」昏厥不上色',
  C2: '★★ C2 零回歸：舊對局回放裡的「被擊倒！」「KO」仍是紅色',
  L1: '★★★ L1 有寶可夢昏厥的那一行整行標紅（log-ko-line）；否定說法不標；回合分隔與勝負訊息照舊',
  B1: '★★★ B1 src 不得使用 regex lookbehind（Safari 16.3 以下不支援、esbuild 不轉換 ⇒ 對戰頁整頁載入失敗）',
};
const ZERO = new Set(['C2', 'S2', 'B1']);   // B1：BASE（v6.570）本來就沒有 lookbehind ⇒ 正對照
const rd = (rel) => { try { return normEol(readFileSync(join(ROOT, rel), 'utf8')); } catch { return null; } };
function scenB(read) {
  LOOKBEHIND = [];
  for (const p of FILES) {
    const rel = relative(ROOT, p).replace(/\\/g, '/');
    const src = read(rel); if (src == null) continue;
    scanSource(src, rel);
  }
  const hits = LOOKBEHIND.slice();
  // 正對照：判準抓得到 regex 字面與 new RegExp 字串兩種寫法；註解裡的字樣不算
  LOOKBEHIND = [];
  scanSource("const a = /(?<!x)y/g; const b = new RegExp('(?<=p)q'); // (?<!註解不算)", 'ctl');
  const ctl = LOOKBEHIND.length;
  return { B1: hits.length === 0 && ctl === 2, B1n: JSON.stringify({ hits, ctl }) };
}
const all = async (read) => ({ ...scenS(read), ...scenS2(), ...scenB(read), ...scenC(await loadLib(read('src/lib/game/log_format.ts') ?? '')) });
const R = await all(rd);
for (const k of Object.keys(LABEL)) ok(LABEL[k], R[k] === true, R[k + 'n']);

console.log('【H】HEAD-FAIL（BASE v6.570）');
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('v6571 HEAD-FAIL', '需要歷史 commit');
else {
  const B = await all((rel) => { const x = readBaseBlob(ROOT, BASE_SHA, rel); return x.ok ? normEol(x.out) : null; });
  for (const k of Object.keys(LABEL)) {
    if (ZERO.has(k)) ok(`★★[正對照] v6.570：${k} 在 BASE 上也是綠`, B[k] === true, B[k + 'n']);
    else ok(`★★★[H] v6.570：${k} 紅`, B[k] !== true, String(B[k + 'n']).slice(0, 200));
  }
}
console.log(`\n=== v6.571 對戰紀錄「擊倒／KO」→「昏厥」：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
