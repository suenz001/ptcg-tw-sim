#!/usr/bin/env node
/**
 * v6.577 守衛：古玉魚｜嫉妒業火 只算「因招式的傷害」昏厥（站長 2026-10-16 裁定「要修」）。
 *   卡面（static/cards SV8a 12337）：「在上個對手的回合，若自己的寶可夢因招式的傷害而【昏厥】了，則增加90點傷害。」
 *   ＝ 復仇刀鋒／捲土重來／報仇同一句 ⇒ 走同一個中央 revengeDamageKOPre（讀 oppDamageKOdMeInLastOppTurn）。
 *   舊寫法讀 oppAttackKOdMeInLastOppTurn（含招式「效果」昏厥：放指示物、直接昏厥）⇒ 效果昏厥也 +90（bug）。
 *
 *   J1 只有招式效果昏厥（attack 那格 1、傷害那格 0）⇒ 50
 *   J2 招式傷害昏厥（兩格都 1）⇒ 140，紀錄寫「因招式的傷害昏厥」
 *   J3 都沒有 ⇒ 50；另一方（對手座位）的計數不影響
 *   J4 中央收斂：effects.ts 註冊的是 revengeDamageKOPre(50, 90, '嫉妒業火')（判準只有一份，Rule 38）
 *   【H】HEAD-FAIL：BASE（v6.576）J1、J4 紅；J2、J3 綠（正對照）
 */
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { hasBaseCommit, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.576。
const BASE_SHA = 'f6f7c8a41da7f0a61122bbe4a344a00785d313ce';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };
const tmps = [];
process.on('exit', () => { for (const t of tmps) { try { rmSync(t, { recursive: true, force: true }); } catch { /* */ } } });

async function bundle(srcRoot) {
  const t = mkdtempSync(join(tmpdir(), 'v6577-')); tmps.push(t);
  const S = join(t, 's.js'), E = join(t, 'e.ts'), O = join(t, 'o.mjs');
  writeFileSync(S, 'export const base="";export const browser=false;');
  const p = (x) => join(srcRoot, x).replace(/\\/g, '/');
  writeFileSync(E, `export { ATTACK_PRE } from '${p('src/lib/game/effects/_shared')}';\nimport '${p('src/lib/game/effects')}';`);
  await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
    alias: { '$lib': join(srcRoot, 'src/lib'), '$app/paths': S, '$app/environment': S }, logLevel: 'silent', nodePaths: [join(ROOT, 'node_modules')] });
  return await import(pathToFileURL(O).href);
}
function scen(M, effSrc) {
  const r = {};
  const fn = M.ATTACK_PRE.get('古玉魚|嫉妒業火');
  if (typeof fn !== 'function') return r;
  const st = (dmg, atk) => ({ turn: 5, activePlayerIndex: 0, log: [], players: [{ name: 'A' }, { name: 'B' }], oppDamageKOdMeInLastOppTurn: dmg, oppAttackKOdMeInLastOppTurn: atk });
  const a = fn(st([0, 0], [1, 0]), 0, new Map());
  r.J1 = a.damage === 50; r.J1n = String(a.damage);
  const b = fn(st([1, 0], [1, 0]), 0, new Map());
  r.J2 = b.damage === 140;
  r.J2b = b.state.log.some((l) => /嫉妒業火：上個對手的回合自己有寶可夢因招式的傷害昏厥 → \+90 傷害/.test(l.message ?? l));
  r.J2bn = JSON.stringify(b.state.log.map((l) => l.message ?? l));
  r.J2n = JSON.stringify({ d: b.damage, log: b.state.log.map((l) => l.message ?? l) });
  const c = fn(st([0, 1], [0, 1]), 0, new Map());
  r.J3 = c.damage === 50; r.J3n = String(c.damage);
  // 審查 P3-1：先去掉註解行（中央寫法留在註解裡、實際手刻一份時不可以綠）
  const code = effSrc.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  r.J4 = /^regPre\('古玉魚\|嫉妒業火', revengeDamageKOPre\(50, 90, '嫉妒業火'\)\);$/m.test(code) && (code.match(/regPre\('古玉魚\|嫉妒業火'/g) || []).length === 1;
  return r;
}
const LABEL = {
  J1: '★★★ J1 只有招式「效果」昏厥（放指示物／直接昏厥）⇒ 不加傷害（50）',
  J2: '★★ J2 招式「傷害」昏厥 ⇒ 50+90＝140',
  J2b: '★ J2b 紀錄寫「因招式的傷害昏厥」（與卡面同一句）',
  J3: '★ J3 沒有昏厥（只有對手那一側的計數）⇒ 50',
  J4: '★★ J4 判準只有一份：嫉妒業火走中央 revengeDamageKOPre',
};
const ZERO = new Set(['J2', 'J3']);
const R = scen(await bundle(ROOT), readFileSync(join(ROOT, 'src/lib/game/effects.ts'), 'utf8'));
for (const k of Object.keys(LABEL)) ok(LABEL[k], R[k] === true, R[k + 'n']);
console.log('【H】HEAD-FAIL（BASE v6.576）');
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('v6577 HEAD-FAIL', '需要歷史 commit');
else {
  const bd = mkdtempSync(join(tmpdir(), 'v6577-base-')); tmps.push(bd);
  execFileSync('tar', ['-x', '-C', bd], { input: execFileSync('git', ['-C', ROOT, 'archive', '--format=tar', BASE_SHA, 'src'], { maxBuffer: 1 << 28 }) });
  const B = scen(await bundle(bd), readFileSync(join(bd, 'src/lib/game/effects.ts'), 'utf8'));
  for (const k of Object.keys(LABEL)) {
    if (ZERO.has(k)) ok(`★★[正對照] v6.576：${k} 在 BASE 上也是綠`, B[k] === true, B[k + 'n']);
    else ok(`★★★[H] v6.576：${k} 紅`, B[k] !== true, B[k + 'n']);
  }
}
console.log(`\n=== v6.577 嫉妒業火只算招式傷害昏厥：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
