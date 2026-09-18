#!/usr/bin/env node
/**
 * v6.403 守衛：「寶可夢【ex】」／「寶可夢【ex】・【V】」／「擁有規則的寶可夢」三個判準的收斂。
 *
 * 【本版在修什麼】v3.67 曾把站內所有 ex 判準**一刀切**改成 isRulePokemon，不管卡面寫的是哪一句。
 *   結果同一句卡面在站內有兩種實作（岩殿居蟹｜神秘石居 走 isPokemonExCard、
 *   仙子伊布｜神秘守護 走 isRulePokemon ——**一模一樣的一句卡面**），
 *   而且 isRulePokemon 本身在 effects.ts 與 selection-filter.ts 各有一份逐字相同的定義
 *   ⇒ 針對其中一份的守衛必然是安慰劑（IRON_RULES Rule 38／安慰劑型態 11）。
 *
 * 【收斂後】三個述詞的**定義**全部在 leaf `selection-filter.ts`，各自對應一句卡面：
 *   ・isPokemonExCard ← 「寶可夢【ex】」        （H/I/J 共 35 張卡名）
 *   ・isRuleBoxExOrV  ← 「寶可夢【ex】・【V】」 （H/I/J 共 10 張卡名）
 *   ・isRulePokemon   ← 「擁有規則的寶可夢」    （H/I/J 共 9 張卡名）
 *
 * 【HEAD-FAIL】BASE 上 isRuleBoxExOrV 不存在、神秘守護／極限腰帶／猛攻手鐲 走錯述詞
 *   ⇒ A／B／C／D 各組都會各自翻紅。缺席的東西一律用哨兵包起來（Rule 41），
 *   讓每一條**各自誠實翻紅**，不會第一條就整支 throw。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripCommentsBlankChecked } from './lib/strip-comments.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));   // Rule 46
const S = join(ROOT, '.x-6403-s.js'), E = join(ROOT, '.x-6403-e.ts'), O = join(ROOT, '.x-6403-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* 忽略 */ } } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, `export { createGame, applyAction, prizesForKO } from './src/lib/game/engine';
export * as EFF from './src/lib/game/effects';
export * as SF from './src/lib/game/selection-filter';
import './src/lib/game/effects';
`);
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const M = await import(pathToFileURL(O).href);
const SF = M.SF, EFF = M.EFF;

/** ⭐Rule 41 哨兵：BASE 上不存在的 symbol 直接呼叫會 TypeError ⇒ 整支在第一條就爆，
 *  後面幾十條永遠跑不到。包起來讓每一條各自誠實翻紅。 */
const MISSING = Symbol('MISSING');
const F = (obj, n) => (typeof obj?.[n] === 'function' ? obj[n] : () => MISSING);
const MAP = (obj, n) => (obj?.[n] instanceof Map ? obj[n] : new Map());

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  PASS ' + msg); } else { fail++; console.log('  FAIL ' + msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg}（實得 ${JSON.stringify(a)}，期望 ${JSON.stringify(b)}）`);

// ── 卡池 ─────────────────────────────────────────────────────────────────────
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map(); const all = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
    if (c?.id == null) continue;
    const x = { ...c, __set: f.slice(0, -5) };
    pool.set(String(c.id), x); all.push(x);
  }
}
const HIJ = (c) => ['H', 'I', 'J'].includes(c.regulationMark);
const byName = (n) => all.find((c) => c.name === n && HIJ(c));
const byId = (id) => pool.get(String(id));

const isEx = F(SF, 'isPokemonExCard');
const isRule = F(SF, 'isRulePokemon');
const isExV = F(SF, 'isRuleBoxExOrV');

console.log('\n=== A 組：三個中央述詞的「定義只有一份」且都在 leaf ===');
{
  const sfSrc = stripCommentsBlankChecked(readFileSync(join(ROOT, 'src/lib/game/selection-filter.ts'), 'utf8'));
  const efSrc = stripCommentsBlankChecked(readFileSync(join(ROOT, 'src/lib/game/effects.ts'), 'utf8'));
  const enSrc = stripCommentsBlankChecked(readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8'));
  for (const n of ['isPokemonExCard', 'isRulePokemon', 'isRuleBoxExOrV', 'isMegaExCard']) {
    const re = new RegExp('(export\\s+)?function\\s+' + n + '\\s*\\(', 'g');
    const inSf = (sfSrc.match(re) ?? []).length;
    re.lastIndex = 0;
    const inEf = (efSrc.match(re) ?? []).length;
    re.lastIndex = 0;
    const inEn = (enSrc.match(re) ?? []).length;
    eq(inSf, 1, `A1 ${n} 的定義在 leaf selection-filter.ts 恰 1 份`);
    eq(inEf + inEn, 0, `A2 ${n} 在 effects.ts／engine.ts 都沒有第二份定義（Rule 38）`);
  }
  // ⭐反安慰劑：掃描器本身要抓得到「有第二份」的樣子（正對照）
  const sample = 'export function isRulePokemon(card) { return false; }';
  ok((sample.match(/(export\s+)?function\s+isRulePokemon\s*\(/g) ?? []).length === 1,
    'A3 ★正對照：掃描器對「就地再定義一份」的樣本確實抓得到（判準不是空真）');
  // selection-filter.ts 必須是 leaf（不可 import effects／engine）
  ok(!/from\s+['"]\.\/effects['"]/.test(sfSrc) && !/from\s+['"]\.\/engine['"]/.test(sfSrc),
    'A4 selection-filter.ts 仍是 leaf（沒有 import effects／engine ⇒ 三個述詞可被任何一層取用）');
  ok(typeof SF.isRuleBoxExOrV === 'function', 'A5 isRuleBoxExOrV 由 leaf export（BASE 沒有這個 symbol ⇒ HEAD-FAIL）');
  ok(typeof EFF.isPokemonExCard === 'function' && typeof EFF.isRulePokemon === 'function'
    && typeof EFF.isRuleBoxExOrV === 'function',
    'A6 effects.ts 仍 re-export 三個述詞（既有呼叫端不必改 import 來源）');
}

console.log('\n=== B 組：三個述詞的語義（釘死具體卡，不比字面）===');
{
  const gengarJ = byId(19988);          // 耿鬼ex（J，Stage2）
  const megaLuc = byId(14752);          // 超級路卡利歐ex（I，Mega ex）
  const salandit = byName('顫弦蠑螈');   // I 標，非 ex
  const arceus = byId(20071);           // 阿爾宙斯VSTAR（F 標，subtype='VSTAR'）
  const zacian = byId(20068);           // 蒼響V（D 標，subtype='Basic'、tags 空、rulesText 空）
  ok(!!gengarJ && !!megaLuc && !!salandit && !!arceus && !!zacian, 'B0 fixture 都在（卡池沒有被改掉）');
  eq(isEx(gengarJ), true,  'B1 耿鬼ex 是「寶可夢【ex】」');
  eq(isEx(megaLuc), true,  'B2 超級路卡利歐ex 是「寶可夢【ex】」');
  eq(isEx(salandit), false, 'B3 顫弦蠑螈（非 ex）不是「寶可夢【ex】」');
  eq(isEx(arceus), false,  'B4 ⭐阿爾宙斯VSTAR **不是**「寶可夢【ex】」（BASE 誤用 isRulePokemon 會答 true）');
  eq(isRule(arceus), true, 'B5 阿爾宙斯VSTAR 是「擁有規則的寶可夢」');
  eq(isExV(arceus), true,  'B6 阿爾宙斯VSTAR 是「寶可夢【ex】・【V】」');
  eq(isRule(zacian), false, 'B7 ⭐蒼響V 的資料缺漏（subtype=Basic／tags 空／rulesText 空）⇒ isRulePokemon 判不到');
  eq(isExV(zacian), true,  'B8 ⭐但它是「寶可夢【ex】・【V】」⇒ isRuleBoxExOrV 必須補回來（兩者不可互換的證據）');
  eq(isEx(zacian), false,  'B9 蒼響V 不是「寶可夢【ex】」');
  eq(isEx(undefined), false, 'B10 undefined 不會炸也不會誤判');
  // ⭐⭐ 三個述詞真的不同：至少存在一張卡讓任兩個給出不同答案
  ok(isRule(arceus) !== isEx(arceus), 'B11 ★isRulePokemon ≠ isPokemonExCard（阿爾宙斯VSTAR 為證）');
  ok(isRule(zacian) !== isExV(zacian), 'B12 ★isRulePokemon ≠ isRuleBoxExOrV（蒼響V 為證）');
}

console.log('\n=== C 組：行為端（卡面 → 實際判定）===');
{
  const IMM = MAP(EFF, 'PASSIVE_IMMUNITY');
  const TA = MAP(EFF, 'TOOL_ATTACK_BONUS');
  const arceus = byId(20071), gengarJ = byId(19988), salandit = byName('顫弦蠑螈');
  const zacian = byId(20068);
  // C1 神秘守護（仙子伊布）卡面「寶可夢【ex】」／神秘石居（岩殿居蟹）**同一句**
  const guard = IMM.get('神秘守護'), stone = IMM.get('神秘石居');
  ok(!!guard && !!stone, 'C0 神秘守護／神秘石居都有註冊');
  eq(!!guard?.(gengarJ, 100, undefined, 0, undefined), true, 'C1a 神秘守護擋「寶可夢【ex】」的招式');
  eq(!!guard?.(arceus, 100, undefined, 0, undefined), false, 'C1b ⭐神秘守護**不擋** VSTAR（卡面只寫「寶可夢【ex】」；BASE 會擋 ⇒ HEAD-FAIL）');
  eq(!!guard?.(salandit, 100, undefined, 0, undefined), false, 'C1c 神秘守護不擋非 ex');
  ok(['ex', 'ex'].every(() => true) &&
     [gengarJ, arceus, salandit].every((c) => !!guard?.(c, 100, undefined, 0, undefined) === !!stone?.(c, 100, undefined, 0, undefined)),
    'C2 ★★神秘守護與神秘石居是**一模一樣的一句卡面** ⇒ 三張測試卡上必須逐格同答（BASE 兩者分岔）');
  // C3 神秘之盾（堅盾劍怪）卡面「寶可夢【ex】・【V】」⇒ 必須擋蒼響V
  const shield = IMM.get('神秘之盾');
  eq(!!shield?.(zacian, 100, undefined, 0, undefined), true, 'C3 ⭐神秘之盾擋蒼響V（卡面「ex・V」；BASE 走 isRulePokemon 判不到 ⇒ HEAD-FAIL）');
  eq(!!shield?.(salandit, 100, undefined, 0, undefined), false, 'C3b 神秘之盾不擋非 ex／非 V');
  // C4 極限腰帶／電氣球：卡面「寶可夢【ex】」
  const belt = TA.get('極限腰帶'), ball = TA.get('電氣球'), brace = TA.get('猛攻手鐲');
  const dummyInst = { energyAttached: [] };
  eq(belt?.({ name: 'X' }, dummyInst, gengarJ), 50, 'C4a 極限腰帶對「寶可夢【ex】」+50');
  eq(belt?.({ name: 'X' }, dummyInst, arceus), 0, 'C4b ⭐極限腰帶對 VSTAR **不加**（卡面只寫「寶可夢【ex】」；BASE 給 50）');
  eq(ball?.({ name: '皮卡丘ex' }, dummyInst, arceus), 0, 'C4c ⭐電氣球對 VSTAR 不加（同上）');
  eq(ball?.({ name: '雷丘' }, dummyInst, gengarJ), 0, 'C4d 電氣球 holder 不是皮卡丘ex ⇒ 不加（零回歸）');
  // C5 猛攻手鐲：一句卡面裡兩半用不同述詞
  eq(brace?.(salandit, dummyInst, gengarJ), 30, 'C5a 猛攻手鐲：holder 非規則 + 目標是 ex ⇒ +30');
  eq(brace?.(gengarJ, dummyInst, gengarJ), 0, 'C5b 猛攻手鐲：holder 是「擁有規則的寶可夢」⇒ 卡面除外條款 ⇒ 0');
  eq(brace?.(salandit, dummyInst, arceus), 0, 'C5c ⭐猛攻手鐲：目標是 VSTAR（不是「寶可夢【ex】」）⇒ 0（BASE 給 30）');
  eq(brace?.(arceus, dummyInst, gengarJ), 0, 'C5d 猛攻手鐲：holder 是 VSTAR（擁有規則）⇒ 0（這一半**維持** isRulePokemon）');
  // ⭐v6.404：原本寫成 `a !== b === false`（＝ a === b），與訊息說的「兩半不同」相反，
  //   而且 C5c／C5d 已各自釘死 a、b ⇒ 那一條是 100% 冗餘。改成真的在測「兩半判準不同」：
  //   同一個 holder（非規則）下，目標換成 VSTAR 與換成耿鬼ex **必須給出不同答案**
  //   —— 目標那一半若被改成「擁有規則」，兩者就會一樣。
  ok(brace?.(salandit, dummyInst, arceus) !== brace?.(salandit, dummyInst, gengarJ),
    'C5e ★目標那一半確實是「寶可夢【ex】」：VSTAR 與耿鬼ex 給出不同答案');
  // C6 尾甲（奇麒麟ex）：卡面「【基礎】寶可夢的『寶可夢【ex】』」
  const tail = IMM.get('尾甲');
  const rayquazaEX = byId(20061);   // 烈空坐EX：stage=Basic、name 結尾 EX、subtype=Basic
  eq(!!tail?.(gengarJ, 100, undefined, 0, undefined), false, 'C6a 尾甲不擋 2 階 ex（卡面限【基礎】）');
  ok(!!rayquazaEX, 'C6b fixture 烈空坐EX 在');
  eq(!!tail?.(rayquazaEX, 100, undefined, 0, undefined), true,
    'C6c ⭐尾甲擋烈空坐EX（【基礎】且卡名結尾 EX；BASE 只認 subtype===\'ex\' ⇒ 漏判）');
}

console.log('\n=== D 組：判準不得再散寫（靜態 lint，配正對照）===');
{
  const files = [];
  (function walk(d) {
    for (const f of readdirSync(d, { withFileTypes: true })) {
      if (f.isDirectory()) { if (f.name === 'node_modules' || f.name === '.git') continue; walk(join(d, f.name)); }
      else if (/\.(ts|svelte)$/.test(f.name)) files.push(join(d, f.name));
    }
  })(join(ROOT, 'src'));
  ok(files.length > 150, `D0 掃描器下限：掃到 ${files.length} 個檔（< 150 就是掃描器壞了）`);
  // 白名單：三個述詞自己的定義，與「不是 ex 判準」的用途
  // ⚠ 白名單＝「這一處不是 ex 判準，或它就是中央述詞自己的定義」。每加一條都要寫理由。
  const WL = new Map([
    // 三個述詞的**唯一**定義都在這裡：isPokemonExCard 的 subtype==='ex' 1 處、
    // isMegaExCard 的 1 處、isRulePokemon 內的 RULE_BOX_SUBTYPES.has 2 處。
    ['src/lib/game/selection-filter.ts', 4],
    ['src/lib/game/effects/cards/m2_dragon_charizard_batch.ts', 1],  // isEvolutionPokemon：進化階級判準，不是 ex 判準
    ['src/lib/game/effects.ts', 1],            // 桃歹郎ex 的**卡名**比對（卡面「「桃歹郎ex」除外」）
    ['src/lib/game/effects/cards/v3001_g3_wave3.ts', 2],  // 特性 gate：判 holder 自己是不是規則盒，非卡面 ex 判準
  ]);
  // ⭐⭐v6.404：原本只掃 `subtype === 'ex'` —— 獨立審查指出否定式 `subtype !== 'ex'` 完全不在
  //   掃描範圍，所以 ai.ts／+page.svelte 裡兩份「水蓮的照顧」的舊抄本帶著舊語義留下來，
  //   守衛照樣全綠（安慰劑型態 10：掃字面沒掃語義）。本版把否定式、`subtype?.includes('ex')`
  //   與 `RULE_BOX_SUBTYPES.has(`（「擁有規則的寶可夢」的手刻版，比中央述詞窄）一起納入。
  const PATS = [
    [/subtype\s*===\s*'ex'/g, "subtype === 'ex'"],
    [/subtype\s*!==\s*'ex'/g, "subtype !== 'ex'"],
    [/subtype\??\.includes\(\s*'ex'\s*\)/g, "subtype?.includes('ex')"],
    [/RULE_BOX_SUBTYPES\.has\(/g, 'RULE_BOX_SUBTYPES.has('],
  ];
  let offenders = [];
  let total = 0;
  for (const p of files) {
    const rel = p.slice(ROOT.length).replace(/\\/g, '/').replace(/^\//, '');
    const src = stripCommentsBlankChecked(readFileSync(p, 'utf8')).replace(/[​-‍﻿]/g, '');
    let n = 0;
    const detail = [];
    for (const [re, lab] of PATS) {
      re.lastIndex = 0;
      const k = (src.match(re) ?? []).length;
      n += k;
      if (k) detail.push(`${lab}×${k}`);
    }
    total += n;
    const allow = WL.get(rel) ?? 0;
    if (n > allow) offenders.push(`${rel}（${n} 處：${detail.join('、')}，白名單 ${allow}）`);
  }
  ok(total >= 6, `D1a 下限：全站四種手刻樣式合計還有 ${total} 處（都在白名單內；0 表示掃描器壞了）`);
  eq(offenders.join(' / '), '',
    'D1b 白名單以外不得再出現 ex／規則盒判準的手刻散寫（subtype ===／!==／?.includes／RULE_BOX_SUBTYPES.has）——請改走中央述詞');
  // ⭐正對照：判準抓得到一個真的違規樣本
  for (const [sample, re, lab] of [
    ["if (card.subtype === 'ex') return true;", /subtype\s*===\s*'ex'/g, "subtype === 'ex'"],
    ["if (card.subtype !== 'ex') return true;", /subtype\s*!==\s*'ex'/g, "subtype !== 'ex'"],
    ["if (c.subtype?.includes('ex')) return true;", /subtype\??\.includes\(\s*'ex'\s*\)/g, "subtype?.includes('ex')"],
    ['if (RULE_BOX_SUBTYPES.has(c.subtype)) return true;', /RULE_BOX_SUBTYPES\.has\(/g, 'RULE_BOX_SUBTYPES.has('],
  ]) {
    re.lastIndex = 0;
    ok((stripCommentsBlankChecked(sample).match(re) ?? []).length === 1,
      `D2 ★正對照：lint 抓得到「${lab}」這種違規樣式（不是空真）`);
  }
  // ⭐註解裡的同樣字面不可以讓 lint 誤判（型態 6）
  const commented = "// if (card.subtype === 'ex') return true;\nconst x = 1;";
  ok((stripCommentsBlankChecked(commented).match(/subtype\s*===\s*'ex'/g) ?? []).length === 0,
    'D3 ★反安慰劑：註解裡的同一段字面被剝掉了（不會假紅也不會假綠）');
  // v3.67 的一刀切註解不得復活
  let v367 = 0;
  for (const p of files) {
    const raw = readFileSync(p, 'utf8');
    if (/v3\.67：改用 isRulePokemon helper/.test(raw)) v367++;
  }
  eq(v367, 0, 'D4 ⭐「v3.67：改用 isRulePokemon helper」這串一刀切註解已全部清掉（BASE 有 5 處、分佈 4 個檔 ⇒ HEAD-FAIL）');
  // ⭐正對照：掃描器抓得到那串註解（不是因為 regex 打錯才 0）
  ok(/v3\.67：改用 isRulePokemon helper/.test('// v3.67：改用 isRulePokemon helper'),
    'D5 ★正對照：D4 的 regex 對一段真的含該註解的樣本抓得到（不是空真）');
}

console.log('\n=== E 組：卡池事實（下限斷言＋逐張明列差異）===');
{
  const pk = all.filter((c) => HIJ(c) && c.supertype === 'Pokemon');
  ok(pk.length > 3000, `E0 下限：H/I/J live Pokemon ${pk.length} 張（< 3000 就是枚舉壞了）`);
  const a = pk.filter((c) => isEx(c) === true).length;
  const b = pk.filter((c) => isRule(c) === true).length;
  const d = pk.filter((c) => isExV(c) === true).length;
  ok(a > 600, `E1 下限：H/I/J 的「寶可夢【ex】」有 ${a} 張`);
  eq(b, a, 'E2 ⭐H/I/J 內 isRulePokemon 與 isPokemonExCard 完全等價（本版對標準賽零行為變更的根據）');
  eq(d, a, 'E3 ⭐H/I/J 內 isRuleBoxExOrV 也與它們等價（【V】在 H/I/J 是 0 張）');
  // 全池差異：只有 4 張舊 V 卡讓 isRulePokemon 與 isRuleBoxExOrV 分岔
  const pkAll = all.filter((c) => c.supertype === 'Pokemon');
  const split = pkAll.filter((c) => isRule(c) !== isExV(c)).map((c) => `${c.name}[${c.__set}#${c.id}]`).sort();
  eq(split.join(','), '夢幻VMAX[M6a#20070],蒼響V[M6a#20068],霓虹魚V[svhk#10055],霓虹魚V[svhm#10076]',
    'E4 ⭐⭐全池只有這 4 張讓兩個述詞分岔（全部不在 H/I/J ⇒ 標準賽不可達）');
  ok(split.every((s) => {
    const id = s.match(/#(\d+)\]/)?.[1];
    return !HIJ(byId(id) ?? {});
  }), 'E5 ★那 4 張一張都不在 H/I/J（否則本版就不是零行為變更了）');
  // 卡面枚舉：三句卡面各有多少張卡（下限，且三組互斥）
  const s1 = new Set(), s2 = new Set(), s3 = new Set();
  for (const c of all) {
    if (!HIJ(c)) continue;
    const txts = [c.rulesText, ...(c.abilities ?? []).map((x) => x.effect), ...(c.attacks ?? []).map((x) => x.effect)]
      .filter(Boolean).map(String);
    for (const t of txts) {
      if (/「寶可夢【ex】・【V】」/.test(t)) s2.add(c.name);
      else if (/「寶可夢【ex】」/.test(t)) s1.add(c.name);
      if (/擁有規則的寶可夢/.test(t)) s3.add(c.name);
    }
  }
  ok(s1.size >= 30, `E6 下限：卡面寫「寶可夢【ex】」的 H/I/J 卡名有 ${s1.size} 個`);
  ok(s2.size >= 8, `E7 下限：卡面寫「寶可夢【ex】・【V】」的 H/I/J 卡名有 ${s2.size} 個`);
  ok(s3.size >= 7, `E8 下限：卡面寫「擁有規則的寶可夢」的 H/I/J 卡名有 ${s3.size} 個`);
  for (const n of ['仙子伊布', '岩殿居蟹', '極限腰帶', '猛攻手鐲', '阿塞蘿拉的惡作劇', '脫殼忍者'])
    ok(s1.has(n), `E9 「寶可夢【ex】」清單含 ${n}（本版把它改成 isPokemonExCard 的依據）`);
  for (const n of ['烏栗', '請假王ex', '索羅亞克', '中立中心'])
    ok(s2.has(n), `E10 「寶可夢【ex】・【V】」清單含 ${n}（本版把它改成 isRuleBoxExOrV 的依據）`);
  for (const n of ['水蓮的照顧', '猛攻手鐲', '格拉吉歐的決戰', '謝米'])
    ok(s3.has(n), `E11 「擁有規則的寶可夢」清單含 ${n}（本版**維持** isRulePokemon 的依據）`);
}

console.log('\n=== F 組：selection filter 與水蓮的照顧（判準只有一份）===');
{
  const ev = F(SF, 'evaluateSelectionFilter');
  const arceus = byId(20071), gengarJ = byId(19988), salandit = byName('顫弦蠑螈');
  const inst = { iid: 'i1' };
  eq(ev('deck-search', 'ex', inst, gengarJ, {}), true, 'F1 filter \'ex\' 認得「寶可夢【ex】」');
  eq(ev('deck-search', 'ex', inst, salandit, {}), false, 'F2 filter \'ex\' 不認非 ex');
  eq(ev('discard-search', 'PokemonNonExOrBasicEnergy', inst, gengarJ, {}), false,
    'F3 水蓮的照顧的 picker 不給選 ex');
  eq(ev('discard-search', 'PokemonNonExOrBasicEnergy', inst, arceus, {}), false,
    'F4 ⭐水蓮的照顧的 picker 不給選 VSTAR（卡面「擁有規則的寶可夢」除外；BASE 用 subtype!==\'ex\' 會放行）');
  eq(ev('discard-search', 'PokemonNonExOrBasicEnergy', inst, salandit, {}), true,
    'F5 非規則寶可夢照樣選得到（零回歸）');
  // ⚠ gate 與 picker 必須同一份判準，否則會長出 pendingStuckEmpty（安慰劑線索①）
  const guards = MAP(EFF, 'TRAINER_GUARDS');
  const g = guards.get('水蓮的照顧');
  ok(typeof g === 'function', 'F6 水蓮的照顧的 gate 有註冊');
  const mk = (cards) => ({
    players: [{ discard: cards.map((c, i) => ({ iid: 'd' + i, cardId: String(c.id) })) }, { discard: [] }],
  });
  eq(!!g?.(mk([arceus]), 0, pool), false,
    'F7 ⭐⭐盤面只有 VSTAR 在棄牌區 ⇒ gate 必須擋（否則卡打得出去但 picker 沒候選 ＝ pendingStuckEmpty）');
  eq(!!g?.(mk([salandit]), 0, pool), true, 'F8 盤面有非規則寶可夢 ⇒ gate 放行（零回歸）');
  eq(!!g?.(mk([]), 0, pool), false, 'F9 棄牌區空 ⇒ gate 擋');
}


// ══════════════════════════════════════════════════════════════════════════════
console.log('\n=== G 組：每個消費端走的是「哪一句卡面」的述詞（簽章法，v6.404 新增）===');
// ⭐⭐⭐ 為什麼這一組是本守衛的主力：
//   v6.403 的守衛只釘了 10 個消費端，而本版動到約 47 處 ⇒ 獨立審查設計的 8 個突變
//   （把 isExCard 整支 revert、把 defIsExPre 的 alsoV 預設翻面、把 snipeAllOppExPost 的
//   兩個分支對調…）**全部存活**。那是典型的「覆蓋率不足＝安慰劑」。
//
// 做法：挑 4 張 fixture，讓三個述詞的回答形成**兩兩不同的簽章**：
//                       耿鬼ex  阿爾宙斯VSTAR  蒼響V  顫弦蠑螈
//   isPokemonExCard       1          0           0       0     ← 'ex'
//   isRuleBoxExOrV        1          1           1       0     ← 'exv'
//   isRulePokemon         1          1           0       0     ← 'rule'
//   ⇒ 任何一個消費端只要被換成另一個述詞，它的簽章就會變 ⇒ 一定被抓到。
// ⚠ 三張分歧卡都不在 H/I/J（標準賽不可達）—— 這是**刻意**的：本版主張「H/I/J 零行為變更」，
//   所以能區分三個述詞的探針一定落在 H/I/J 之外。這一組守的是「判準有沒有對到卡面」。
{
  const FX = [byId(19988), byId(20071), byId(20068), byName('顫弦蠑螈')];
  const FXN = ['耿鬼ex', '阿爾宙斯VSTAR', '蒼響V', '顫弦蠑螈'];
  ok(FX.every(Boolean), 'G0 四張 fixture 都在');
  const SIG = { ex: '1,0,0,0', exv: '1,1,1,0', rule: '1,1,0,0' };
  // 先證明三個簽章真的兩兩不同（否則整組是空真）
  eq(FX.map((c) => (isEx(c) ? 1 : 0)).join(','), SIG.ex, 'G1a isPokemonExCard 的簽章');
  eq(FX.map((c) => (isExV(c) ? 1 : 0)).join(','), SIG.exv, 'G1b isRuleBoxExOrV 的簽章');
  eq(FX.map((c) => (isRule(c) ? 1 : 0)).join(','), SIG.rule, 'G1c isRulePokemon 的簽章');
  ok(new Set(Object.values(SIG)).size === 3, 'G1d ★三個簽章兩兩不同（否則這一整組是空真）');

  const sig = (fn) => FX.map((c) => (fn(c) ? 1 : 0)).join(',');
  /** 斷言某個消費端的簽章 === 卡面對應述詞的簽章 */
  const probe = (label, want, fn) => {
    let got;
    try { got = sig(fn); } catch (e) { got = 'ERR:' + e.message.slice(0, 60); }
    ok(got === SIG[want],
      `G ${label} 走「${want}」的判準（簽章 ${got}${got === SIG[want] ? '' : ' ≠ ' + SIG[want]}；欄位＝${FXN.join('/')}）`);
  };

  // ── ① PASSIVE_IMMUNITY（攻擊方是這張卡時擋不擋）──────────────────────────
  const IMM = MAP(EFF, 'PASSIVE_IMMUNITY');
  probe('仙子伊布｜神秘守護〔卡面「寶可夢【ex】」〕', 'ex', (c) => !!IMM.get('神秘守護')?.(c, 100, undefined, 0, undefined));
  probe('岩殿居蟹｜神秘石居〔卡面「寶可夢【ex】」〕', 'ex', (c) => !!IMM.get('神秘石居')?.(c, 100, undefined, 0, undefined));
  probe('堅盾劍怪｜神秘之盾〔卡面「寶可夢【ex】・【V】」〕', 'exv', (c) => !!IMM.get('神秘之盾')?.(c, 100, undefined, 0, undefined));

  // ── ② PASSIVE_PREVENT_PRIZE（脫殼忍者｜脆弱蛻殼）────────────────────────
  const PP = MAP(EFF, 'PASSIVE_PREVENT_PRIZE');
  ok(PP.size > 0, 'G2 PASSIVE_PREVENT_PRIZE 抓得到（v6.403 的行為矩陣曾寫錯 export 名 ⇒ 這一族全盲）');
  probe('脫殼忍者｜脆弱蛻殼〔卡面「寶可夢【ex】」〕', 'ex', (c) => !!PP.get('脆弱蛻殼')?.(c));

  // ── ③ TOOL_ATTACK_BONUS ───────────────────────────────────────────────────
  const TA = MAP(EFF, 'TOOL_ATTACK_BONUS');
  const di = { energyAttached: [] };
  probe('極限腰帶〔目標＝卡面「寶可夢【ex】」〕', 'ex', (c) => (TA.get('極限腰帶')?.({ name: 'X' }, di, c) ?? 0) > 0);
  probe('電氣球〔目標＝卡面「寶可夢【ex】」〕', 'ex', (c) => (TA.get('電氣球')?.({ name: '皮卡丘ex' }, di, c) ?? 0) > 0);
  probe('猛攻手鐲｜目標半〔卡面「寶可夢【ex】」〕', 'ex',
    (c) => (TA.get('猛攻手鐲')?.(byName('顫弦蠑螈'), di, c) ?? 0) > 0);
  probe('猛攻手鐲｜holder 除外半〔卡面「擁有規則的寶可夢」〕', 'rule',
    (c) => (TA.get('猛攻手鐲')?.(c, di, byId(19988)) ?? 0) === 0);

  // ── ④ ATTACK_PRE：把 fixture 放進對手戰鬥場，看傷害有沒有加成 ─────────────
  const PRE = MAP(EFF, 'ATTACK_PRE');
  let sn = 0;
  const si = (cid, x = {}) => ({ iid: 'g' + (++sn), cardId: String(cid), damage: 0, energyAttached: [], ...x });
  const st = (oppCard, myCardId, extra = {}) => {
    const s0 = M.createGame({ name: 'A', entries: [{ cardId: '19988', count: 1 }] },
                            { name: 'B', entries: [{ cardId: '19988', count: 1 }] }, pool);
    return { ...s0, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, isFirstTurn: false,
      setupDone: [true, true], pendingSelection: null, activeStadium: null, pendingPrizes: [0, 0],
      players: [
        { ...s0.players[0], active: si(myCardId), bench: [], hand: [], deck: [si('19988')], discard: [],
          prizes: Array.from({ length: 6 }, () => si('19988')) },
        { ...s0.players[1], active: si(oppCard.id), bench: [], hand: [], deck: [si('19988')], discard: [],
          prizes: Array.from({ length: 6 }, () => si('19988')) }],
      ...extra };
  };
  const preDmg = (key, myCardId, c, extra) => {
    const fn = PRE.get(key);
    if (!fn) return null;
    return fn(st(c, myCardId, extra), 0, pool)?.damage ?? null;
  };
  const preBonus = (key, myCardId, base) => (c) => (preDmg(key, myCardId, c) ?? base) > base;
  // defIsExPre 家族（12 個呼叫端，卡面分兩句）
  probe('火焰鳥｜鬥志之翼〔卡面「寶可夢【ex】」〕', 'ex', preBonus('火焰鳥|鬥志之翼', byName('火焰鳥')?.id, 20));
  probe('眷戀雲｜上升之心〔卡面「寶可夢【ex】」〕', 'ex', preBonus('眷戀雲|上升之心', byName('眷戀雲')?.id, 100));
  probe('無極汰那｜汰那爆破〔卡面「寶可夢【ex】」〕', 'ex', preBonus('無極汰那|汰那爆破', byName('無極汰那')?.id, 10));
  probe('泥偶巨人｜鬥志之拳〔卡面「寶可夢【ex】・【V】」〕', 'exv', preBonus('泥偶巨人|鬥志之拳', byName('泥偶巨人')?.id, 120));
  probe('舞天鵝｜鬥志之翼〔卡面「寶可夢【ex】・【V】」〕', 'exv', preBonus('舞天鵝|鬥志之翼', byName('舞天鵝')?.id, 20));
  probe('電蜘蛛ex｜衝天之線〔卡面「寶可夢【ex】・【V】」〕', 'exv', preBonus('電蜘蛛ex|衝天之線', byName('電蜘蛛ex')?.id, 110));
  // oppExBonusPre 家族（3 個呼叫端，卡面分兩句）
  probe('鐵臂膀｜超合金之手〔卡面「寶可夢【ex】・【V】」〕', 'exv', preBonus('鐵臂膀|超合金之手', byName('鐵臂膀')?.id, 80));
  probe('摔角鷹人｜上升衝撞〔卡面「寶可夢【ex】」〕', 'ex', preBonus('摔角鷹人|上升衝撞', byName('摔角鷹人')?.id, 10));
  probe('哲爾尼亞斯ex｜上升角擊〔卡面「寶可夢【ex】」〕', 'ex', preBonus('哲爾尼亞斯ex|上升角擊', byName('哲爾尼亞斯ex')?.id, 120));
  // v6.403 誤接、v6.404 修回的那幾支（原本共用 isExCard）
  probe('古劍豹｜上升利刃〔卡面「寶可夢【ex】」〕', 'ex', preBonus('古劍豹|上升利刃', byName('古劍豹')?.id, 80));
  probe('密勒頓ex｜強子電光〔卡面「寶可夢【ex】」〕', 'ex', preBonus('密勒頓ex|強子電光', byName('密勒頓ex')?.id, 120));
  probe('魔幻假面喵｜上升綻放〔卡面「寶可夢【ex】」〕', 'ex', preBonus('魔幻假面喵|上升綻放', byName('魔幻假面喵')?.id, 90));
  probe('打擊鬼｜上升劈打〔卡面「寶可夢【ex】」〕', 'ex',
    (c) => (preDmg('打擊鬼|上升劈打', byName('打擊鬼')?.id, c) ?? 0) > 0);
  // 計數型（對手場上有幾隻）
  probe('索羅亞克｜幻影劫持〔卡面「寶可夢【ex】・【V】」〕', 'exv',
    (c) => (preDmg('索羅亞克|幻影劫持', byName('索羅亞克')?.id, c) ?? 0) > 0);
  probe('土龍節節ex｜逆境之尾〔卡面「寶可夢【ex】」〕', 'ex',
    (c) => (preDmg('土龍節節ex|逆境之尾', byName('土龍節節ex')?.id, c) ?? 0) > 0);

  // ── ⑤ 謝米（v6.404 修回的兩句卡面）───────────────────────────────────────
  const benchGuard = F(EFF, 'resolveBenchGuard');
  probe('謝米｜花之帷幔〔卡面「擁有規則的寶可夢」除外〕', 'rule', (c) => {
    // 「被擋住」＝ 非規則寶可夢 ⇒ 取反才是「是規則寶可夢」的簽章。
    // ⚠ 花之帷幔走 isEffectiveAsOfDeclaration（v6.373 站長裁定 A-3「宣告當時」）
    //   ⇒ 這裡把 attack-time 快照直接設成 true，讓探針只測「目標是不是規則寶可夢」這一件事。
    const shaymin = byName('謝米');
    const s = st(byId(19988), byId(19988).id);
    const s2 = { ...s, _attackTimeOppFlowerVeil: true,
      players: [s.players[0], { ...s.players[1], active: si(shaymin.id), bench: [si(c.id)] }] };
    // 簽名：resolveBenchGuard(state, pool, actorIdx, targetCard, kind, { targetInst })
    const r = benchGuard(s2, pool, 0, c, 'attack-damage', { targetInst: s2.players[1].bench[0] });
    return !(r && r.blocked === true);
  });
  const POST = MAP(EFF, 'ATTACK_POST');
  probe('謝米｜精刺奇襲〔卡面「寶可夢【ex】・【V】」〕', 'exv', (c) => {
    const shaymin = byName('謝米');
    const s = st(byId(19988), shaymin.id);
    const s2 = { ...s, players: [s.players[0], { ...s.players[1], bench: [si(c.id)] }] };
    const out = POST.get('謝米|精刺奇襲')?.(s2, 0, pool);
    const logs = (out?.log ?? []).map((l) => String(l?.message ?? l)).join('\n');
    return !/沒有|無 ex/.test(logs.split('\n').slice(-1)[0] ?? '');
  });

  // ── ⑥ snipeAllOppExPost 的兩個分支（審查的 N2 突變：兩分支對調）───────────
  const snipeHit = (key, attackerName) => (c) => {
    const s = st(byId(19988), byName(attackerName)?.id);
    const s2 = { ...s, players: [s.players[0], { ...s.players[1], bench: [si(c.id)] }] };
    const out = POST.get(key)?.(s2, 0, pool);
    const b = out?.players?.[1]?.bench?.[0];
    return (b?.damage ?? 0) > 0;
  };
  probe('水伊布ex｜重磅驟雨〔卡面「寶可夢【ex】」〕', 'ex', snipeHit('水伊布ex|重磅驟雨', '水伊布ex'));
  probe('沙漠蜻蜓ex｜橄欖石音波〔卡面「寶可夢【ex】・【V】」〕', 'exv', snipeHit('沙漠蜻蜓ex|橄欖石音波', '沙漠蜻蜓ex'));
  probe('超夢ex｜光子彈〔卡面「寶可夢【ex】」〕', 'ex', snipeHit('超夢ex|光子彈', '超夢ex'));
  probe('捷拉奧拉｜閃電急襲〔卡面「寶可夢【ex】」〕', 'ex', (c) => {
    const s = st(byId(19988), byName('捷拉奧拉')?.id);
    const s2 = { ...s, players: [s.players[0], { ...s.players[1], bench: [si(c.id)] }] };
    const out = POST.get('捷拉奧拉|閃電急襲')?.(s2, 0, pool);
    return !!out?.pendingSelection;
  });

  // ── ⑦ 請假王ex｜懶怠個性 與 中立中心（兩支 export 的述詞）─────────────────
  const lazy = F(EFF, 'isLazyTraitBlockingAttack');
  probe('請假王ex｜懶怠個性〔卡面「寶可夢【ex】・【V】」〕', 'exv', (c) => {
    const kanpan = byName('請假王ex');
    const s = st(c, kanpan.id);
    return lazy(s.players[0].active, s, pool) === false;   // 對手場上有 ex/V ⇒ 不封鎖
  });
  const ncb = F(EFF, 'wouldNeutralCenterBlock');
  const NC = byName('中立中心');
  const ncState = () => ({ ...st(byId(19988), byId(19988).id), activeStadium: si(NC.id) });
  ok(!!NC, 'G5 fixture 中立中心在');
  probe('中立中心｜attacker 半〔卡面「寶可夢【ex】・【V】」〕', 'exv',
    (c) => ncb(ncState(), pool, c, byName('顫弦蠑螈')) === true);
  probe('中立中心｜defender 半〔卡面「擁有規則的寶可夢」除外〕', 'rule',
    (c) => ncb(ncState(), pool, byId(19988), c) === false);

  // ── ⑧ 獎賞張數三份（必須逐張同答；審查指出 BASE 就已經不一致）──────────────
  {
    const pk = all.filter((x) => x.supertype === 'Pokemon');
    const bad = pk.filter((x) => {
      const a = M.prizesForKO(x), b = EFF.koPrizeCount(x), d = EFF.prizesForKOLocal?.(x);
      return !(a === b && b === d);
    });
    eq(bad.map((x) => `${x.name}[${x.__set}#${x.id}]`).join(','), '',
      'G3 ⭐⭐獎賞張數的三份實作（engine.prizesForKO／effects.koPrizeCount／prizesForKOLocal）全池逐張同答');
    ok(pk.length > 4000, `G3b 下限：逐張比對了 ${pk.length} 張 Pokemon`);
  }

  // ── ⑨ isExCard 不得復活（v6.403 的教訓：共用 helper 的粒度天生解不了多句卡面）──
  {
    const efSrc = stripCommentsBlankChecked(readFileSync(join(ROOT, 'src/lib/game/effects.ts'), 'utf8'));
    eq((efSrc.match(/function\s+isExCard\s*\(/g) ?? []).length, 0,
      'G4 ⭐effects.ts 不得再有共用的 isExCard（v6.404 已拆；它被 6 個呼叫點共用而卡面分三句）');
    ok(efSrc.includes('isRuleBoxExOrV(card)') || efSrc.includes('isRuleBoxExOrV(c)'),
      'G4b 精刺奇襲那一類已改走 isRuleBoxExOrV');
  }
}

console.log(`\n=== v6.403 ex 判準收斂守衛：PASS ${pass} / FAIL ${fail} ===`);
if (fail > 0) process.exit(1);
