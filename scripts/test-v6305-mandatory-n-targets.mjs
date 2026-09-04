/**
 * v6.305 行為端枚舉守衛 — 卡面寫死目標隻數（「對手的N隻寶可夢各…」「選擇N隻對手的…」）
 * 且**沒有**「最多／若希望／任意」的招式／特性 ⇒ picker 必須**強制選滿** min(N, 可選目標數)。
 *
 * 站長回報（2026-09-04）：酋雷姆｜三重冰霜 在對手 ≥3 隻時可以只選 1~2 隻。
 * 真因：effects.ts `multiSnipePost` 開 picker 時寫 `minCount: 1, maxCount: realMax`（其他三支同型
 *      helper 都寫 min=max=realCount）。同一 helper 的 鐵頭殼ex｜雙刃劍 同病。
 * 收斂：`_shared.ts` 新增中央述詞 `mandatoryTargetCount(cardCount, availableCount)`，
 *      四支同型 helper ＋ 中央 hitBenchPickPost／placeCountersBenchPickPost ＋ 5 處 inline 全改呼叫它。
 *
 * 守衛設計（行為端為主，靜態為輔）：
 *   A. 中央述詞直呼單元測（繞過呼叫端 gate，型態 3）。
 *   G. 靜態（第二層，放最後讓行為端先紅）：述詞存在；六支 helper 檔剝註解後含呼叫；multiSnipePost 不得殘留 `minCount: 1, maxCount: realMax`。
 *   C. 卡面枚舉（正則掃 live + H/I/J）—— 有下限斷言 ＋ 已知全部真兇必須被掃到（型態 4／10）。
 *   D. 每一張：esbuild harness **實跑完整 ATTACK**（特性走 getAbilityFn），兩種盤面：
 *        盤面 A：對手 1 戰鬥 + 4 備戰 → 期望 min = max = min(N, 可選數)
 *        盤面 B：對手 1 戰鬥 + 1 備戰（「對手不足 N 隻」）→ 期望 min = max = min(N, 可選數)
 *      並把 pending 接到 UI 層：selectionConfirmFloor(min) === min、selectionAllowsSkip === false。
 *   E. 特例（行為端證明）：狡猾天狗｜驅趕龍捲風 卡面「選擇 3 隻備戰**留下**、其餘放回」——
 *      備戰 ≤3 時「未選者」為空集合 ⇒ 無 picker 且盤面不變是等價行為；備戰 4 時 min=max=3。
 *   F. 白名單（卡面「最多」型，三張）**逐條附行為端證明**可少選：玻璃喇叭／火箭隊的尼多娜｜惡之覺醒／阿杏的秘招。
 *   新卡自動納入：正則掃卡面，未來新增同型卡若沒接好 min=max 就會 FAIL。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.v6305-s.js'), E = join(ROOT, '.v6305-e.ts'), O = join(ROOT, '.v6305-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { ATTACK_POST, ATTACK_PRE, TRAINER_EFFECTS, TRAINER_GUARDS, getAbilityFn, mandatoryTargetCount } from './src/lib/game/effects/_shared';\n"
  + "export { selectionConfirmFloor, selectionAllowsSkip } from './src/lib/game/selection-ui';\n"
  + "export { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({
  entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error',
});
const mod = await import(pathToFileURL(O).href);

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('  ✓', msg); };
const eq = (a, b, msg) => { assert.strictEqual(a, b, `${msg}（實際 ${JSON.stringify(a)}，期望 ${JSON.stringify(b)}）`); pass++; console.log('  ✓', msg); };
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const stripZW = (s) => s.replace(/[\u200b-\u200d\ufeff]/g, '');
/** 與 game/+page.svelte 餵 selectionAllowsSkip 的形狀一致：allowSkipZero 由 params 拉到頂層。 */
const skipInput = (p) => ({ type: p.type, actorIdx: p.actorIdx, sourcePlayerIdx: p.sourcePlayerIdx, effectKey: p.effectKey, minCount: p.minCount, allowSkipZero: p.params?.allowSkipZero === true });

// ── A. 中央述詞直呼 ────────────────────────────────────────────────────────
console.log('A. 中央述詞 mandatoryTargetCount 直呼');
ok(typeof mod.mandatoryTargetCount === 'function', '_shared.ts export mandatoryTargetCount');
assert.deepStrictEqual(mod.mandatoryTargetCount(3, 5), { minCount: 3, maxCount: 3 }, '述詞 (3,5) 必須回 {3,3}'); pass++; console.log('  ✓ (3,5) → {3,3}');
assert.deepStrictEqual(mod.mandatoryTargetCount(3, 2), { minCount: 2, maxCount: 2 }, '述詞 (3,2) 必須回 {2,2}'); pass++; console.log('  ✓ (3,2) → {2,2}（不足 N 全選）');
assert.deepStrictEqual(mod.mandatoryTargetCount(2, 0), { minCount: 0, maxCount: 0 }, '述詞 (2,0) 必須回 {0,0}'); pass++; console.log('  ✓ (2,0) → {0,0}');
{
  const r = mod.mandatoryTargetCount(3, 5);
  eq(r.minCount, r.maxCount, '述詞回傳 minCount 恆等於 maxCount（不得再有 minCount:1 的漏洞）');
}

// ── 卡池 ───────────────────────────────────────────────────────────────────
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
const HIJ = (c) => ['H', 'I', 'J'].includes(c.regulationMark);
function byName(name, pred = () => true) {
  for (const [id, c] of pool) if (c.name === name && HIJ(c) && pred(c)) return id;
  throw new Error('找不到 H/I/J 卡：' + name);
}
let U = 0;
const inst = (cardId, extra = {}) => ({ iid: 'i' + (++U), cardId: String(cardId), damage: 0, energyAttached: [], ...extra });
const instN = (name, extra = {}, pred) => inst(byName(name, pred), extra);
const ecard = (name) => ({ iid: 'e' + (++U), cardId: byName(name) });
const ALL_BASIC_ENERGY = ['草', '火', '水', '雷', '超', '鬥', '惡', '鋼'].map(t => `基本【${t}】能量`);
const richEnergy = () => ALL_BASIC_ENERGY.flatMap(n => [ecard(n), ecard(n)]);
const mk = (p0, p1) => ({
  phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0,
  turn: 5, isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
  players: [
    { name: 'A', active: null, bench: [], hand: [], deck: [], discard: [], prizes: [], ...p0 },
    { name: 'B', active: null, bench: [], hand: [], deck: [], discard: [], prizes: [], ...p1 },
  ],
});
const filler = () => instN('皮卡丘', {}, c => !c.abilities?.length && c.stage === 'Basic');
const oppField = (benchN) => ({ active: filler(), bench: Array.from({ length: benchN }, filler) });

// ── C. 卡面枚舉 ────────────────────────────────────────────────────────────
console.log('C. 卡面枚舉：H/I/J live「N隻…各／選擇N隻對手的」且無「最多／若希望／任意」');
const OPTIONAL_RE = /最多|若希望|任意/;
// 兩種措辭：「對手的N隻(備戰)寶可夢(身上)(也)各」／「選擇N隻對手的(備戰)寶可夢」
const RE_A = /對手的([2-9])隻(備戰)?寶可夢(?:身上)?也?各/;
const RE_B = /選擇([2-9])隻對手的(備戰)?寶可夢/;
function parseN(effect) {
  const t = stripZW(effect || '');
  if (OPTIONAL_RE.test(t)) return null;
  const m = RE_A.exec(t) || RE_B.exec(t);
  if (!m) return null;
  return { n: Number(m[1]), benchOnly: !!m[2] };
}
const entries = []; // { key, kind, cardId, idx, n, benchOnly, name, label }
const seenKey = new Set();
for (const [id, c] of pool) {
  if (!HIJ(c) || c.supertype !== 'Pokemon') continue;
  (c.attacks ?? []).forEach((a, idx) => {
    const r = parseN(a.effect); if (!r) return;
    const key = `${c.name}|${a.name}`; if (seenKey.has(key)) return; seenKey.add(key);
    entries.push({ key, kind: 'attack', cardId: id, idx, ...r, name: c.name, label: a.name });
  });
  (c.abilities ?? []).forEach((a, idx) => {
    const r = parseN(a.effect); if (!r) return;
    const key = `${c.name}|${a.name}`; if (seenKey.has(key)) return; seenKey.add(key);
    entries.push({ key, kind: 'ability', cardId: id, idx, ...r, name: c.name, label: a.name });
  });
}
entries.sort((a, b) => a.key.localeCompare(b.key));
console.log('  掃到', entries.length, '筆：', entries.map(e => `${e.key}[${e.n}${e.benchOnly ? '備' : ''}]`).join('、'));
ok(entries.length >= 14, `掃描器下限：至少 14 筆（實得 ${entries.length}），否則掃描器壞了`);
// 已知真兇／全部已知同型卡當正對照（型態 10）：掃描器必須全部抓到
const KNOWN = ['酋雷姆|三重冰霜', '鐵頭殼ex|雙刃劍', '雙尾怪手|雙尾', '超級麻麻鰻魚王ex|爆裂彈', '電擊魔獸ex|二重伏特',
  '大吾的盔甲鳥|雙音波', '竹蘭的美納斯|水分岔', '三首惡龍ex|黑曜石', '古簡蝸|貪婪危害', '甲賀忍蛙ex|分身連打',
  '謎擬Ｑex|惡作劇之手', '花岩怪|魂之末', '仙子伊布ex|天仙石', '狡猾天狗|驅趕龍捲風', '火箭隊的叉字蝠ex|亂咬'];
for (const k of KNOWN) ok(seenKey.has(k), `正對照：掃描器抓到 ${k}`);
// 「最多」型三張不得被掃進強制集合
for (const k of ['火箭隊的尼多娜|惡之覺醒']) ok(!seenKey.has(k), `可選型 ${k} 不在強制集合`);

// ── D. 行為端逐張 ──────────────────────────────────────────────────────────
console.log('D. 行為端：完整 ATTACK／特性 → pending minCount === maxCount === min(N, 可選數)');
/** 特殊 fixture（卡面有額外前提才會開 picker 的卡）。沒列在這裡的一律用預設盤面。 */
const FIXTURE = {
  // 魂之末：「若自己的棄牌區有13張以上擁有特性「化隱」的寶可夢卡」
  '花岩怪|魂之末': (st) => {
    const hy = [...pool.entries()].filter(([, c]) => HIJ(c) && c.abilities?.some(a => a.name === '化隱')).map(([id]) => id);
    assert.ok(hy.length >= 1, '需要至少一張化隱寶可夢當 fixture');
    st.players[0].discard = Array.from({ length: 13 }, (_, i) => inst(hy[i % hy.length]));
    return st;
  },
};
/** E. 語義不同於 min(N, avail) 的特例 —— 每條都在下方以行為端證明 */
const SPECIAL = new Set(['狡猾天狗|驅趕龍捲風']);

function runEntry(e, benchN) {
  const cardObj = pool.get(e.cardId);
  const attacker = inst(e.cardId, { energyAttached: richEnergy() });
  let st = mk({ active: attacker }, oppField(benchN));
  if (FIXTURE[e.key]) st = FIXTURE[e.key](st);
  if (e.kind === 'attack') {
    st = mod.applyAction(st, { type: 'ATTACK', attackIndex: e.idx, actorIdx: 0 }, pool);
  } else {
    const fn = mod.getAbilityFn(cardObj.name, cardObj.abilities[e.idx].name, e.idx);
    assert.ok(typeof fn === 'function', `${e.key} 特性未實作（getAbilityFn 回 undefined）`);
    st = fn(st, 0, pool, attacker);
  }
  return st;
}
for (const e of entries) {
  if (SPECIAL.has(e.key)) continue;
  for (const benchN of [4, 1]) {
    const avail = e.benchOnly ? benchN : benchN + 1;
    const expected = Math.min(e.n, avail);
    const st = runEntry(e, benchN);
    const p = st.pendingSelection;
    assert.ok(p, `${e.key}（對手 ${benchN + 1} 隻）：ATTACK 後應開 picker，實際沒有 pending。log 尾：${JSON.stringify(st.log.slice(-3).map(l => l.message ?? l))}`);
    assert.ok(p.type === 'opp-poke-choose' || p.type === 'opp-bench-choose', `${e.key}：pending 型別應為對手場上目標，實際 ${p.type}／${p.effectKey}`);
    eq(p.minCount, expected, `${e.key}（對手 ${benchN + 1} 隻, N=${e.n}）minCount = ${expected}`);
    eq(p.maxCount, expected, `${e.key}（對手 ${benchN + 1} 隻）maxCount = ${expected}`);
    // 接到 UI 層：確定鈕門檻＝minCount；不給【不選】鈕
    eq(mod.selectionConfirmFloor(p.minCount), expected, `${e.key}：UI 確定鈕門檻 = ${expected}`);
    eq(mod.selectionAllowsSkip(skipInput(p)), false, `${e.key}：UI 不給【不選】鈕`);
  }
}

// ── E. 特例行為證明：驅趕龍捲風 ─────────────────────────────────────────────
console.log('E. 特例：狡猾天狗｜驅趕龍捲風（卡面「選擇3隻備戰留下，其餘放回牌庫」）');
{
  const e = entries.find(x => x.key === '狡猾天狗|驅趕龍捲風');
  assert.ok(e, '枚舉必須含 驅趕龍捲風');
  const st4 = runEntry(e, 4);
  eq(st4.pendingSelection?.minCount, 3, '備戰 4 隻：minCount = 3');
  eq(st4.pendingSelection?.maxCount, 3, '備戰 4 隻：maxCount = 3');
  const st2 = runEntry(e, 2);
  ok(!st2.pendingSelection, '備戰 2 隻（≤3）：不開 picker（「未選者」為空集合，放回 0 隻＝等價）');
  eq(st2.players[1].bench.length, 2, '備戰 2 隻：對手備戰盤面不變（沒有任何一隻被放回）');
  eq(st2.players[1].deck.length, 0, '備戰 2 隻：對手牌庫沒有多出卡（沒有被放回）');
}

// ── F. 白名單（「最多」型）逐條行為端證明可少選 ───────────────────────────────
console.log('F. 白名單「最多N隻」型：行為端證明 UI 允許少於 N');
{ // 火箭隊的尼多娜｜惡之覺醒：「選擇最多2隻自己的【惡】寶可夢…」→ 逐隻兩段式，phase A 可跳過
  const me = instN('火箭隊的尼多娜', { energyAttached: richEnergy() }, c => c.attacks?.some(a => a.name === '惡之覺醒'));
  const dark2 = instN('火箭隊的尼多娜', {}, c => c.attacks?.some(a => a.name === '惡之覺醒'));
  const card = pool.get(me.cardId); const ai = card.attacks.findIndex(a => a.name === '惡之覺醒');
  let st = mk({ active: me, bench: [dark2], deck: [inst(me.cardId)] }, oppField(1));
  st = mod.applyAction(st, { type: 'ATTACK', attackIndex: ai, actorIdx: 0 }, pool);
  const p = st.pendingSelection;
  assert.ok(p, '惡之覺醒應開 picker');
  eq(p.maxCount, 1, '惡之覺醒：逐隻選（maxCount 1）');
  eq(p.minCount, 0, '惡之覺醒：minCount 0（可跳過）');
  eq(mod.selectionAllowsSkip(skipInput(p)), true, '惡之覺醒：UI 給【不選】鈕 ⇒ 可少於 2 隻');
}
{ // 阿杏的秘招：「選擇最多2隻自己的【惡】寶可夢」→ 1~2 隻（已知區必選 ≥1，可只選 1）
  const d1 = instN('火箭隊的尼多娜', {}, c => c.pokemonType === 'Darkness');
  const d2 = instN('火箭隊的尼多娜', {}, c => c.pokemonType === 'Darkness');
  const d3 = instN('火箭隊的尼多娜', {}, c => c.pokemonType === 'Darkness');
  let st = mk({ active: d1, bench: [d2, d3], deck: [ecard('基本【惡】能量'), ecard('基本【惡】能量')] }, oppField(1));
  ok(mod.TRAINER_GUARDS.get('阿杏的秘招')(st, 0, pool) === true, '阿杏的秘招 gate 放行');
  st = mod.TRAINER_EFFECTS.get('阿杏的秘招')(st, 0, pool);
  const p = st.pendingSelection;
  assert.ok(p, '阿杏的秘招應開 picker');
  eq(p.maxCount, 2, '阿杏的秘招：maxCount 2');
  ok(p.minCount < p.maxCount, `阿杏的秘招：minCount(${p.minCount}) < maxCount(2) ⇒ 可只選 1 隻`);
  eq(mod.selectionConfirmFloor(p.minCount), 1, '阿杏的秘招：UI 選 1 隻即可按確定');
}
{ // 玻璃喇叭：「選擇最多2隻自己的備戰區的【無】寶可夢」→ 先選 0~2 張能量
  const tera = instN('厄鬼椪 碧草面具ex');
  const c1 = instN('喵喵', {}, c => c.pokemonType === 'Colorless' && c.stage === 'Basic');
  const c2 = instN('喵喵', {}, c => c.pokemonType === 'Colorless' && c.stage === 'Basic');
  let st = mk({ active: tera, bench: [c1, c2], discard: [ecard('基本【草】能量'), ecard('基本【火】能量')] }, oppField(1));
  ok(mod.TRAINER_GUARDS.get('玻璃喇叭')(st, 0, pool) === true, '玻璃喇叭 gate 放行');
  st = mod.TRAINER_EFFECTS.get('玻璃喇叭')(st, 0, pool);
  const p = st.pendingSelection;
  assert.ok(p, '玻璃喇叭應開 picker');
  eq(p.maxCount, 2, '玻璃喇叭：maxCount 2');
  ok(p.minCount < p.maxCount, `玻璃喇叭：minCount(${p.minCount}) < maxCount(2) ⇒ 可少於 2`);
}

// ── G. 靜態（第二層）：helper 全部接上中央述詞 ──────────────────────────────────────
console.log('G. 靜態（第二層）：同型 helper 都呼叫中央述詞');
const HELPER_FILES = [
  ['src/lib/game/effects.ts', ['function multiSnipePost', 'export function hitBenchPickPost', 'export function placeCountersBenchPickPost']],
  ['src/lib/game/effects/cards/v2620_i_wave12_misc5.ts', ['function snipeNoppPokemonPost']],
  ['src/lib/game/effects/cards/v2630_i_wave13_misc6.ts', ['function snipeNOppBenchAutoPost']],
  ['src/lib/game/effects/cards/v2660_i_wave16_misc9.ts', ['function snipeNOppPokemonAutoPost']],
];
for (const [rel, fns] of HELPER_FILES) {
  const src = stripComments(readFileSync(join(ROOT, rel), 'utf8'));
  for (const fn of fns) {
    const at = src.indexOf(fn);
    ok(at >= 0, `${rel}：找得到 ${fn}`);
    const blk = src.slice(at, src.indexOf('\nregR(', at) > 0 ? Math.min(src.indexOf('\nregR(', at), at + 4000) : at + 4000);
    ok(blk.includes('mandatoryTargetCount('), `${fn} 呼叫中央 mandatoryTargetCount`);
    ok(!/minCount:\s*1,\s*maxCount:\s*real/.test(blk), `${fn} 不得殘留「minCount: 1, maxCount: realMax」`);
  }
}

console.log(`\nv6.305 mandatory-N-targets：PASS ${pass} / FAIL 0`);
