// 量測腳本（鐵律 Rule 32）：批 2 八支守衛目標檔的「洞的地圖」
// 洞 = 用守衛自寫的剝除器剝完後「整行沒有非空白字元」，但中央 helper（相對正確答案）
//      剝完後該行仍有非空白字元 ⇒ 那一行的真碼被守衛多吃掉了。
// 用法：node scripts/measure-v6325-holes.mjs <repoRoot>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scanCommentLines, nonWs } from './lib/strip-comments.mjs';

const ROOT = process.argv[2] || '.';

// 守衛目前自寫的剝除器（區塊正則等長留白 ＋ 行尾 //）—— 逐字照抄自 v6202/v6253/v6255/v6256
const guardStrip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/\/\/.*$/gm, '');

// v6257/v6258 的變體：只剝區塊（保行號），零寬先剝，行尾 // 用各自的正則
const guardStripB = (s) => s
  .replace(/[​-‍﻿]/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, (m) => '\n'.repeat((m.match(/\n/g) || []).length));

// 中央 helper 的等長留白（相對正確答案）
const centralBlank = (s) => {
  const scan = scanCommentLines(s);
  const { lines, keepFrom } = scan;
  return lines.map((line, i) => {
    const kf = keepFrom[i];
    if (kf === 0) return line;
    const cut = kf < 0 ? line.length : kf;
    return line.slice(0, cut).replace(/[^\r]/g, ' ') + line.slice(cut);
  }).join('\n');
};

const FILES = [
  'src/lib/game/effects.ts',
  'src/lib/game/engine.ts',
  'src/lib/game/effects/_shared.ts',
  'src/lib/game/defense.ts',
  'src/lib/game/effects/cards/v3001_g3_wave3.ts',
  'src/lib/game/effects/cards/mega_decks.ts',
  'src/lib/game/effects/cards/v2690_i_wave19_engine_hooks.ts',
  'src/lib/game/effects/cards/v3080_deferred_wave_c.ts',
  'src/lib/game/types.ts',
];

function holes(src, strip) {
  const a = strip(src).split('\n');
  const b = centralBlank(src).split('\n');
  const n = Math.min(a.length, b.length);
  const lost = [];
  for (let i = 0; i < n; i++) {
    if (nonWs(b[i]) > 0 && nonWs(a[i] || '') === 0) lost.push(i + 1);
  }
  // 連續段落
  const segs = [];
  for (const ln of lost) {
    const last = segs[segs.length - 1];
    if (last && ln === last.to + 1) last.to = ln;
    else segs.push({ from: ln, to: ln });
  }
  return { lost, segs, lineDelta: a.length - b.length };
}

for (const f of FILES) {
  let src;
  try { src = readFileSync(join(ROOT, f), 'utf8'); } catch { console.log(`?? ${f} 讀不到`); continue; }
  for (const [name, strip] of [['A(區塊留白+行尾//)', guardStrip], ['B(v6257/58 保行號)', guardStripB]]) {
    const { lost, segs, lineDelta } = holes(src, strip);
    const longest = segs.reduce((m, s) => Math.max(m, s.to - s.from + 1), 0);
    const at = segs.find((s) => s.to - s.from + 1 === longest);
    console.log(
      `${lost.length === 0 ? '🟢' : '🔴'} ${f.padEnd(48)} ${name.padEnd(22)} ` +
      `多吃真碼 ${String(lost.length).padStart(4)} 行 / ${segs.length} 段` +
      (longest ? ` / 最長 ${longest} 行 @${at.from}` : '') +
      (lineDelta ? ` (行數差 ${lineDelta})` : '')
    );
  }
}
