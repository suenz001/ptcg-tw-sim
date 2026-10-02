#!/usr/bin/env node
/**
 * 卡表守衛：寶可夢的進化來源（evolvesFrom）必須正確 —— 特別是「ex 不是從同名的非 ex 卡進化」
 *
 * 由來：站長多次提醒的老錯（長期記憶 reference-mp-promo-new-cards-v5990「Wilson 每次警告『你會弄錯』」）：
 *   補新卡時把「XXex」的 evolvesFrom 填成「XX」（同名的非 ex 卡）。實際上 ex 是**平行**的一張卡，
 *   和同名非 ex 卡**同一階**、從**前一階**進化：
 *     魔幻假面喵ex（2 階）← 蒂蕾喵（1 階），不是 ← 魔幻假面喵（2 階）
 *     索羅亞克ex（1 階）← 索羅亞（基礎），不是 ← 索羅亞克
 *     伊布ex（基礎）沒有 evolvesFrom
 *   填錯的後果：牌組裡放了 XX 卻沒有前一階時能「進化」上去、或正確的前一階反而不能進化（進化判定讀 evolvesFrom）。
 *   ⚠ 官網 detail 頁的文字**沒有**「從XX進化」（印在卡圖上）；要讀 detail 頁「進化」面板的整條進化鏈。
 *
 * 判準（只看 H/I/J、只看 live 卡表 ＝ 檔名不含底線；化石的來源是訓練家卡，另外核對）：
 *   A1 1 階／2 階一定有 evolvesFrom；基礎一定沒有
 *   A2 evolvesFrom 指向的卡存在，且階段剛好低一階（1 階 ← 基礎、2 階 ← 1 階）；化石 1 階 ← 同名訓練家卡
 *   A3 ⭐ ex 的 evolvesFrom 不可以是「去掉 ex（與『超級』）後的同名卡」
 *   A4 下限：檢查到的 ex 進化卡數量要夠多（掃描器沒壞）
 * 突變（記憶體內實跑）：M1 把 魔幻假面喵ex 的來源改成 魔幻假面喵 ⇒ A2／A3 紅；M2 拿掉一張 1 階的 evolvesFrom ⇒ A1 紅；
 *   M3 基礎 ex 加上 evolvesFrom ⇒ A1 紅。
 *
 * Run: node scripts/test-evolves-from-integrity.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'static/cards');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

const all = [];
for (const f of readdirSync(DIR)) {
  if (!f.endsWith('.json') || f === 'index.json' || f.includes('_')) continue;   // 底線檔是暫存／舊卡面，不上線
  let d; try { d = JSON.parse(readFileSync(join(DIR, f), 'utf8')); } catch { continue; }
  if (Array.isArray(d)) for (const c of d) if (c && c.name) all.push({ ...c, _file: f });
}
const PREV = { Stage1: 'Basic', Stage2: 'Stage1' };

function check(cards) {
  const byName = new Map();
  for (const c of cards) { if (!byName.has(c.name)) byName.set(c.name, []); byName.get(c.name).push(c); }
  const r = { a1: [], a2: [], a3: [], exEvolved: 0 };
  for (const c of cards) {
    if (c.supertype !== 'Pokemon' || !['H', 'I', 'J'].includes(c.regulationMark)) continue;
    const tag = `${c._file}#${c.id} ${c.name}(${c.stage})`;
    const ev = c.evolvesFrom;
    if ((c.stage === 'Stage1' || c.stage === 'Stage2') && !ev) r.a1.push(tag + ' 缺 evolvesFrom');
    if (c.stage === 'Basic' && ev) r.a1.push(tag + ' 基礎卻有 evolvesFrom=' + ev);
    if (ev && PREV[c.stage]) {
      const srcs = byName.get(ev) || [];
      const pokes = srcs.filter((x) => x.supertype === 'Pokemon');
      const fossil = c.stage === 'Stage1' && srcs.some((x) => x.supertype === 'Trainer');
      if (!fossil && !pokes.some((x) => x.stage === PREV[c.stage])) r.a2.push(`${tag} ← ${ev}（` + (pokes.length ? '階段 ' + [...new Set(pokes.map((x) => x.stage))].join('/') : '站上找不到') + `，應為 ${PREV[c.stage]}）`);
    }
    if (/ex$/.test(c.name) && ev) {
      r.exEvolved++;
      const core = c.name.slice(0, -2);
      if (ev === core || ev === core.replace(/^超級/, '')) r.a3.push(`${tag} ← ${ev}（同名非 ex 卡！應從前一階進化）`);
    }
  }
  return r;
}

console.log('【A】現行卡表');
const r = check(all);
ok('★★[A1] 1 階／2 階都有 evolvesFrom、基礎都沒有', r.a1.length === 0, r.a1.slice(0, 8).join('；'));
ok('★★★[A2] evolvesFrom 指向的卡存在且剛好低一階（化石 ← 訓練家卡）', r.a2.length === 0, r.a2.slice(0, 8).join('；'));
ok('★★★[A3] ex 沒有從「同名的非 ex 卡」進化', r.a3.length === 0, r.a3.slice(0, 8).join('；'));
ok('[A4] 掃描器自驗：檢查到的 ex 進化卡 ≥ 300 張', r.exEvolved >= 300, r.exEvolved);

console.log('\n【突變】（記憶體內）');
const mut = (fn) => check(all.map((c) => fn({ ...c })));
const hasMagic = all.some((c) => c.name === '魔幻假面喵ex' && c.evolvesFrom === '蒂蕾喵');
ok('[M1 前提] 卡表裡有「魔幻假面喵ex ← 蒂蕾喵」', hasMagic);
const m1 = mut((c) => { if (c.name === '魔幻假面喵ex') c.evolvesFrom = '魔幻假面喵'; return c; });
ok('★★[M1] 魔幻假面喵ex 改成 ← 魔幻假面喵（同名 2 階）⇒ A2 與 A3 都紅', m1.a2.length > 0 && m1.a3.length > 0);
let done2 = false;
const m2 = mut((c) => { if (!done2 && c.stage === 'Stage1' && c.regulationMark === 'J' && c.supertype === 'Pokemon') { delete c.evolvesFrom; done2 = true; } return c; });
ok('★[M2] 拿掉一張 1 階的 evolvesFrom ⇒ A1 紅', m2.a1.length > 0);
const m3 = mut((c) => { if (c.name === '伊布ex' && c.stage === 'Basic') c.evolvesFrom = '伊布'; return c; });
ok('★[M3] 基礎的伊布ex 加上 evolvesFrom ⇒ A1 紅', m3.a1.length > 0);

console.log(`\n=== 進化來源完整性: ${pass} PASS / ${fail} FAIL ===`);
console.log('=== SCRIPT-END evolves-from-integrity ===');
process.exit(fail ? 1 : 0);
