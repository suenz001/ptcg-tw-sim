#!/usr/bin/env node
/**
 * v6.573 守衛：對戰紀錄與畫面文字的其餘幾組用詞統一成官方卡面用詞（站長 2026-10-15 分批統一第 3 批：「其餘幾組小量的一批做完」）。
 *   依據 static/cards 官方卡面：
 *     棄牌堆 0 次 ／ 棄牌區 258 次
 *     牌庫頂 0 次 ／ 牌庫上方 220 次；牌庫底 0 次 ／ 牌庫下方 61 次
 *     擲幣 只出現在招式名「連續擲幣」／ 擲硬幣 47 次
 *     回復 只出現在「回復原樣」與卡名「一同回復」／ HP 用「恢復」297 次
 *
 *   S1 src 所有字串字面（對戰紀錄、picker 標題、按鈕、確認視窗）不再出現舊詞；
 *      例外只有：招式名「連續擲幣」（卡面原文，也是 effectKey）、「回復原樣」（卡面原文）、defense.ts 的內部對照表標籤
 *   S2 .svelte 畫面文字（模板、屬性）不再出現舊詞
 *   S3 掃描器正對照：字串（含模板插值、巢狀模板）與畫面裡的違規抓得到；註解、regex 字面、例外詞不算
 *   W1 抽查改寫用對了詞
 *   【H】BASE（v6.572）：S1、S2、W1 紅；S3 綠（正對照）
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname, relative } from 'node:path';
import { normEol } from './lib/eol-agnostic.mjs';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { scanStrings, markupText, walkSrc } from './lib/src-string-scan.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.572。
const BASE_SHA = '7d7b0253';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

// 先拿掉卡面原文的例外詞，再看有沒有舊詞（例外詞以外的地方出現舊詞照樣抓）
const KEEP = /連續擲幣|回復原樣/g;
const OLD = /棄牌堆|牌庫頂|牌庫底|擲幣|回復/;
const bad = (t) => OLD.test(String(t).replace(KEEP, ''));
// defense.ts 的防禦對照表（blocks: ['attack-damage (擲幣)']）是內部中繼資料，不顯示給玩家；只豁免這一個字串
const ALLOW_KEY = (rel, t) => rel === 'src/lib/game/defense.ts' && t === 'attack-damage (擲幣)';
const FILES = walkSrc(join(ROOT, 'src'));

function scenS(read) {
  const str = [], mk = [];
  let n = 0;
  for (const p of FILES) {
    const rel = relative(ROOT, p).replace(/\\/g, '/');
    const src = read(rel);
    if (src == null) continue;
    n++;
    scanStrings(src, rel, (t, line) => { if (bad(t) && !ALLOW_KEY(rel, t)) str.push(rel + ':' + line + ' ' + t.slice(0, 60)); });
    const m = markupText(src, rel).replace(KEEP, '');
    const hit = m.match(/.{0,20}(?:棄牌堆|牌庫頂|牌庫底|擲幣|回復).{0,20}/g);
    if (hit) mk.push(rel + ' ' + hit.slice(0, 3).join(' ／ '));
  }
  return { S1: n > 200 && str.length === 0, S1n: JSON.stringify({ n, hits: str.slice(0, 6), total: str.length }),
    S2: mk.length === 0, S2n: JSON.stringify(mk.slice(0, 6)) };
}
function scenS3() {
  const a = [];
  scanStrings("// 牌庫頂（註解不算）\naddLog(s, '丟棄對手牌庫頂 2 張'); const t = `擲幣 ${n} 次`; const u = `x${y}棄牌堆${`巢狀回復`}`; const r = a / b; const q = /'牌庫底'/.test(z); const k = '索財靈|連續擲幣'; const o = '保留（回復原樣）';",
    'x.ts', (t) => { if (bad(t)) a.push(t); });
  const m = markupText('<script>const x = 1;</script><!-- 擲幣 --><p title="牌庫頂">贏擲幣時</p>', 'x.svelte');
  const okA = JSON.stringify(a) === JSON.stringify(['丟棄對手牌庫頂 2 張', '擲幣 ', '棄牌堆', '巢狀回復']);
  return { S3: okA && /擲幣/.test(m) && /牌庫頂/.test(m) && !/擲幣|牌庫頂/.test(markupText('<!-- 擲幣 --><p>擲硬幣</p>', 'x.svelte').replace(/擲硬幣/g, ''))
      && ALLOW_KEY('src/lib/game/defense.ts', 'attack-damage (擲幣)') && !ALLOW_KEY('src/lib/game/defense.ts', '擲幣免疫') && !ALLOW_KEY('src/lib/game/effects.ts', 'attack-damage (擲幣)'),
    S3n: JSON.stringify({ a, m }) };
}
function scenW(read) {
  const e = read('src/lib/game/effects.ts') ?? '', de = read('src/lib/game/damage-estimate.ts') ?? '', en = read('src/lib/game/engine.ts') ?? '',
    pg = read('src/routes/game/+page.svelte') ?? '', v3 = read('src/lib/game/effects/cards/v3000_g3_wave2.ts') ?? '';
  return {
    W1: e.includes("'海岱：選 2 張手牌放回牌庫下方，再抽 4 張'") && e.includes("'傷藥：選擇恢復 30 HP 的寶可夢'") && e.includes('`山崩：丟棄對手牌庫上方 ${take} 張')
      && e.includes("regPre('索財靈|連續擲幣', coinUntilTailsMultiplyPre(20, 0, '連續擲幣'));")   // 招式名不可動（卡面原文＋effectKey）
      && de.includes("'預估：傷害依擲硬幣次數而定'") && en.includes("'🎲 重試徽章：消除剛才擲硬幣結果，重新擲硬幣！'")
      && pg.includes('<div class="first-pref-label">贏得擲硬幣時</div>') && pg.includes('📥 保留並排序（牌庫上方 → 下方）') && v3.includes('進棄牌區`'),
  };
}
const LABEL = {
  S1: '★★★ S1 src 所有字串不再出現「棄牌堆／牌庫頂／牌庫底／擲幣／回復」（卡面原文「連續擲幣」「回復原樣」與 defense.ts 內部標籤除外）',
  S2: '★★★ S2 頁面畫面文字（模板、屬性）不再出現舊詞',
  S3: '★★ S3 掃描器正對照：字串（含模板插值、巢狀）與畫面裡的違規抓得到；註解、regex 字面、卡面原文例外不算',
  W1: '★★ W1 用詞抽查：棄牌區／牌庫上方／牌庫下方／擲硬幣／恢復，且招式名「連續擲幣」沒被改',
};
const ZERO = new Set(['S3']);
const rd = (rel) => { try { return normEol(readFileSync(join(ROOT, rel), 'utf8')); } catch { return null; } };
const all = (read) => ({ ...scenS(read), ...scenS3(), ...scenW(read) });
const R = all(rd);
for (const k of Object.keys(LABEL)) ok(LABEL[k], R[k] === true, R[k + 'n']);
console.log('【H】HEAD-FAIL（BASE v6.572）');
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('v6573 HEAD-FAIL', '需要歷史 commit');
else {
  const B = all((rel) => { const x = readBaseBlob(ROOT, BASE_SHA, rel); return x.ok ? normEol(x.out) : null; });
  for (const k of Object.keys(LABEL)) {
    if (ZERO.has(k)) ok(`★★[正對照] v6.572：${k} 在 BASE 上也是綠`, B[k] === true, B[k + 'n']);
    else ok(`★★★[H] v6.572：${k} 紅`, B[k] !== true, String(B[k + 'n'] ?? '').slice(0, 160));
  }
}
console.log(`\n=== v6.573 其餘用詞統一（棄牌區／牌庫上方／牌庫下方／擲硬幣／恢復）：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
