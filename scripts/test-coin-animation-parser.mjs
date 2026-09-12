#!/usr/bin/env node
// v6.363 守衛（站長裁定 F-16）：硬幣動畫 parser —— 判準已依 Rule 40 上移到「意圖層」。
//
// ⭐ 意圖（這支守衛真正要釘的東西）：
//   「玩家看到的硬幣動畫序列，必須**逐一對應引擎真的擲出來的那幾次幣** —— 不多也不少。
//     中央擲幣器每寫一行『單次擲幣結果』log 就播一次動畫；任何**總結行**
//     （不論它含不含「硬幣／正面／反面」字樣）都**不得**產生動畫。」
//
// ⚠⚠ Rule 40 上移紀錄（v6.363）：
//   舊版守衛（fdd04ee3）第 2 條斷言釘的是**實作細節**：
//     「舊式包含『擲硬幣/硬幣』的擲幣總結仍應保留一次 fallback 動畫」。
//   而 6fa22f89 已經證明那條 fallback 會讓**總結行多播一次動畫**（玩家看得到的 bug），
//   因此把 fallback 整段移除 —— 但守衛沒有跟著上移，從此紅到現在；
//   又因為它不在 `npm test` 鏈裡（本檔 D1 自檢就是在釘這件事），紅了也沒人看得到。
//   ⇒ 本版把判準上移為「動畫序列 === 中央擲幣器實際記錄的擲幣序列」，
//     並補上反對照（真實總結行一律 0 次動畫）＋ 全站原始碼掃描網。
//     **沒有放寬、沒有刪判準、沒有恆真斷言。**
//
// ⚠ 本檔不驗字串存在：一律呼叫**真的招式效果函式**（ATTACK_PRE 註冊表）產生真實 log，
//   再把 log 餵給 parser —— 每一條斷言都在行為層。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.coinanim-s.js'), E = join(ROOT, '.coinanim-e.ts'), O = join(ROOT, '.coinanim-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* noop */ } } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, [
  "export { parseCoinFlipAnimationEvents } from './src/lib/game/coinAnimation';",
  "export { flipCoinsWithLog } from './src/lib/game/effects';",
  "export { ATTACK_PRE } from './src/lib/game/effects/_shared';",
  "import './src/lib/game/effects';",
].join('\n'));
await build({
  entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error',
});
const { parseCoinFlipAnimationEvents: parse, flipCoinsWithLog, ATTACK_PRE } =
  await import(pathToFileURL(O).href);

let pass = 0, fail = 0, pending = 0;
const chk = (t, c, extra = '') => { if (c) { pass++; console.log('  ✓', t); } else { fail++; console.log('  ❌', t, extra); } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const res = (lines) => lines.flatMap((l) => parse(l)).map((e) => e.result);

/** flipCoinsWithLog / addLog 只讀 turn / log / players[i].active?.iid / activePlayerIndex。 */
const mkState = () => ({
  turn: 1, log: [], activePlayerIndex: 0,
  players: [{ name: 'P1', active: null, bench: [] }, { name: 'P2', active: null, bench: [] }],
});
/** 把 Math.random 換成既定序列（'H' → 正面）；用完一定還原，且多擲會直接爆掉（防空真）。 */
const withFlips = (seq, fn) => {
  const real = Math.random; let i = 0;
  Math.random = () => {
    if (i >= seq.length) throw new Error(`擲幣次數超出預期（只準備了 ${seq.length} 次）`);
    return seq[i++] === 'H' ? 0.1 : 0.9;
  };
  try { return fn(); } finally { Math.random = real; }
};
const newLines = (st0, st1) => st1.log.slice(st0.log.length).map((e) => e.message);
const truthOf = (st) => (st._machineGunLastFlips ?? []).map((z) => (z === '正面' ? 'heads' : 'tails'));

console.log('── A. 真實招式效果函式：動畫序列 === 引擎實際擲幣序列 ──────────────────');
// ⚠ 這四張都是**現行已註冊**的招式；seq 是硬幣結果，不是卡面事實。
const CASES = [
  { key: '超級袋獸ex|機關槍合擊', seq: ['H', 'H', 'T'], why: '擲到反面為止（v6.234 中央 flipCoinsUntilTails）' },
  { key: '貓鼬斬|連斬', seq: ['H', 'T', 'H'], why: '固定 3 次（coinTripleHeadsPre）' },
  { key: '雙倍多多冰|雙重冰凍', seq: ['H', 'T'], why: '總結行含「硬幣」＋「正面」⇒ 6fa22f89 前的 fallback 會多播 1 次' },
  { key: '巴大蝶|鱗粉颶風', seq: ['H', 'H', 'T', 'H'], why: '同上，4 次' },
];
for (const c of CASES) {
  const fn = ATTACK_PRE.get(c.key);
  chk(`A0 ${c.key}：效果函式有註冊（哨兵 — 沒註冊的話後面全是空真）`, typeof fn === 'function');
  if (typeof fn !== 'function') continue;
  const st0 = mkState();
  const out = withFlips(c.seq, () => fn(st0, 0, new Map(), undefined));
  const st1 = out.state;
  const lines = newLines(st0, st1);
  const truth = truthOf(st1);
  const want = c.seq.map((x) => (x === 'H' ? 'heads' : 'tails'));
  const anim = res(lines);
  const flipLines = lines.filter((l) => parse(l).length > 0);
  const summaryLines = lines.filter((l) => parse(l).length === 0);
  chk(`A1 ${c.key} 哨兵：招式真的擲了 ${c.seq.length} 次幣（引擎自記 _machineGunLastFlips）`,
    eq(truth, want), `實際 ${JSON.stringify(truth)}`);
  chk(`A2 ${c.key} 哨兵：擲幣行之外還寫了總結行（log ${lines.length} 行 > 擲幣 ${truth.length} 次）`,
    lines.length > truth.length, JSON.stringify(lines));
  chk(`A3 ⭐⭐⭐ ${c.key}：動畫序列 === 引擎實際擲幣序列（${c.why}）`,
    eq(anim, truth) && anim.length === c.seq.length,
    `動畫 ${JSON.stringify(anim)} ≠ 擲幣 ${JSON.stringify(truth)}｜log=${JSON.stringify(lines)}`);
  chk(`A4 ⭐⭐ ${c.key}：存在「含正面/反面字樣但不是擲幣」的總結行，而它 0 動畫（舊 fallback 就是死在這）`,
    summaryLines.length === lines.length - truth.length
    && summaryLines.length > 0 && summaryLines.some((l) => /正面|反面/.test(l)),
    JSON.stringify(summaryLines));
  chk(`A5 ${c.key} 哨兵：會播動畫的 log 行數 === 擲幣次數（${truth.length}）`,
    flipLines.length === truth.length, `${flipLines.length} vs ${truth.length}`);
}

console.log('── B. 中央擲幣器 flipCoinsWithLog 的每一種輸出格式，parser 都要恰好 1 次 ────');
{
  // B1 count=1（prefix 為空）
  const st0 = mkState();
  const r = withFlips(['H'], () => flipCoinsWithLog(st0, 1, '打滾', 0));
  const lines = newLines(st0, r.state);
  chk('B1 哨兵：count=1 只寫 1 行、且是「擲硬幣 — 正面」格式', lines.length === 1 && /擲硬幣\s*—\s*正面/.test(lines[0]), JSON.stringify(lines));
  chk('B1b ⭐ count=1 的擲幣行 → 恰好 1 次 heads 動畫', eq(res(lines), ['heads']), JSON.stringify(lines));
}
{
  // B2 count≥2（prefix「第 N 次」），且 label 本身含「硬幣」二字（能量硬幣）
  const st0 = mkState();
  const r = withFlips(['H', 'T', 'H'], () => flipCoinsWithLog(st0, 3, '能量硬幣', 0));
  const lines = newLines(st0, r.state);
  chk('B2 哨兵：count=3 寫 3 行、且是「第 N 次擲硬幣 — …」格式',
    lines.length === 3 && lines.every((l, i) => l.includes(`第 ${i + 1} 次擲硬幣 —`)), JSON.stringify(lines));
  chk('B2b ⭐ count=3 的三行擲幣行 → 依序 heads/tails/heads，一行一次', eq(res(lines), ['heads', 'tails', 'heads']), JSON.stringify(lines));
}
{
  // B3 重試徽章注入：行尾多一段〔重試徽章：…〕後綴，不可以讓 parser 漏掉
  const st0 = mkState();
  const r = flipCoinsWithLog(st0, 1, '機關槍合擊', 0, ['正面']);
  const lines = newLines(st0, r.state);
  chk('B3 哨兵：重試徽章注入時擲幣行帶〔重試徽章…〕後綴', lines.length === 1 && lines[0].includes('〔重試徽章'), JSON.stringify(lines));
  chk('B3b ⭐ 帶後綴的擲幣行 → 仍恰好 1 次 heads 動畫', eq(res(lines), ['heads']), JSON.stringify(lines));
}

console.log('── C. 全站掃描網：所有「含硬幣字樣的非擲幣 log 樣板」一律 0 動畫 ────────');
// 意圖層的自動網：未來任何人新增一張卡的總結行，只要含「硬幣」＋「正面/反面」
// 而不是中央擲幣器的「— 正面」格式，就會自動被這條網涵蓋。
const files = [];
const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.ts')) files.push(p); } };
walk(join(ROOT, 'src/lib/game'));
const LIT = /'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;
const probes = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  src.split('\n').forEach((line, i) => {
    if (!line.includes('addLog(')) return;
    for (const m of line.matchAll(LIT)) {
      const lit = m[1] ?? m[2] ?? '';
      if (!lit.includes('硬幣') || !/正面|反面/.test(lit) || lit.includes('—')) continue;
      probes.push({ at: `${f.slice(ROOT.length).replace(/\\/g, '/')}:${i + 1}`, s: lit.replace(/\$\{[^}]*\}/g, '9') });
    }
  });
}
chk(`C1 哨兵：掃到 ≥ 6 條「含硬幣的非擲幣 log 樣板」（實際 ${probes.length} 條；掃不到就是空真）`, probes.length >= 6);
const cBad = probes.filter((p) => parse(p.s).length !== 0);
chk('C2 ⭐⭐⭐ 每一條「含硬幣字樣的總結行」都必須 0 次動畫（6fa22f89 的修正就是釘這裡）',
  cBad.length === 0, cBad.slice(0, 6).map((p) => `${p.at} 「${p.s}」→ ${JSON.stringify(parse(p.s).map((e) => e.result))}`).join(' ｜ '));

console.log('── D. 守衛的自我保護：本守衛必須在 npm test 鏈裡 ─────────────────────────');
{
  const chain = String(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts?.test ?? '');
  chk('D0 哨兵：讀得到 package.json 的 scripts.test（不是空字串）', chain.length > 0);
  // ⚠ 這條是**硬紅**（會讓 exit=1）。v6.363 交件時它預期就是紅的 —— 站長收尾 bump
  //   把本檔加進 scripts.test 之後會自動變綠，之後若有人再把它從鏈裡拿掉就會再度翻紅。
  //   （若改成「沒在鏈裡就只印警告」，移出鏈這個方向就抓不到 ⇒ 那才是安慰劑。）
  const inChain = chain.includes('test-coin-animation-parser');
  if (!inChain) pending++;
  chk('D1 ⭐ 自檢：本守衛必須出現在 package.json 的 scripts.test 鏈裡（否則紅了也沒人看得到）',
    inChain, '⚠ v6.363 交件時預期紅：站長收尾 bump 時才會加進鏈（簡報 §2-4），加完自動變 ✓');
}

console.log(`\n═══ coin animation parser：PASS ${pass}／FAIL ${fail}（其中「待站長接鏈」${pending} 條）═══`);
if (pending > 0 && fail === pending) console.log('※ 唯一的紅是 D1「還沒接進 npm test 鏈」—— 簡報 §2-4 已預告，站長收尾時會補。');
process.exit(fail === 0 ? 0 : 1);
