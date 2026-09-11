// v6.338 守衛 —— 借招家族：被借招式的「不計算弱點・抵抗力」必須跟著借過來
//
// 站長裁示（v6.338）：
//   「弱點抵抗力一律用**使用招式的那隻**（借招者）的屬性計算，這是正確的，
//     **除非借到的招式上有寫「不計算弱點・抵抗力」** —— 那個限制屬於招式本身，
//     因此借到那種招式時照抄那個限制，才是正確的。」
//
// v6.337 的實況（本版要修的 bug）：
//   `_shared.dispatchCopiedAttack()` 用**逐欄位列舉**回傳，只列了 skipWeakRes 與 skipDefEffects，
//   而且 skipWeakRes 還被 `inheritSkipWeakRes` 預設 false 擋掉 ⇒
//     ① 8 張借招卡裡只有「火箭隊的謎擬Ｑ｜扮晶晶酒」會繼承 skipWeakRes，其餘 7 張寫死 false
//        ⇒ 借到「不計算弱點・抵抗力」的招式時**仍然會算弱點**，傷害被 ×2 灌水。
//     ② `skipWeakness` / `skipResistance`（v4.495 的半套旗標）與 `breakdown`
//        是**8 張全部**被吃掉 —— 同一個 bug 的另一半，之前沒人測到。
//
// 本版修法：`dispatchCopiedAttack` 改成 `return { ...copiedPre(...) }`（整包原樣轉發），
//   回傳型別綁在 `ReturnType<AttackPreFn>` 上 ⇒ 日後 AttackPreFn 加欄位不會再靜默漏轉發。
//
// 斷言分兩層：
//   【A】單元 —— 8 張借招卡逐一驗「替身回傳的旗標有沒有原樣出現在借招卡的回傳裡」。
//   【B】行為 —— 真的 applyAction，在**有弱點**的盤面上比對最終傷害（50 vs 100）。
//   【C】HEAD-FAIL —— 對 BASE(v6.337) 重跑，A/B 必須紅、哨兵必須綠。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { withBiasedCoin } from './lib/seeded-rng.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = '391b86b806a5e3018b700dfcb94dab2613cefa05';   // v6.337（v6.338 的上一版）

let pass = 0, fail = 0;
const chk = (name, ok, extra = '') => {
  if (ok) { console.log('  PASS ' + name); pass++; } else { console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')); fail++; }
  return !!ok;
};

// ── 卡池 ──────────────────────────────────────────────────────────────────────
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
const byName = (n, pred = () => true) => [...pool.values()].find(c => c.name === n && pred(c));

const SLOWKING = byName('呆呆王', c => (c.attacks ?? []).some(a => a.name === '耀閃挑戰'));
const MIMIKYU = byName('火箭隊的謎擬Ｑ', c => (c.attacks ?? []).some(a => a.name === '扮晶晶酒'));
const DRAGA = byName('多龍巴魯托ex', c => (c.tags ?? []).includes('太晶') && (c.attacks ?? []).length >= 2);
const CLEFABLE = byName('皮可西', c => (c.attacks ?? []).some(a => a.name === '揮指'));
const MEOWTH = byName('火箭隊的貓老大ex', c => (c.attacks ?? []).some(a => a.name === '高傲指令'));
const ZOROARK = byName('索羅亞克', c => (c.attacks ?? []).some(a => a.name === '欺詐'));
const SUDOWOODO = byName('阿響的樹才怪', c => (c.attacks ?? []).some(a => a.name === '試著模仿'));
const NZORO = byName('N的索羅亞克ex', c => (c.attacks ?? []).some(a => a.name === '暗黑底牌'));
const FOX = byName('狐大盜', c => (c.attacks ?? []).some(a => a.name === '技能大盜'));
const NBENCH = [...pool.values()].find(c => c.name?.startsWith('N的') && c.name !== 'N的索羅亞克ex' && (c.attacks ?? []).length >= 2);

// ⚠ 附滿 8 種基本能量各 2 張 —— 借招卡橫跨【超】【惡】【無】，附不夠的話 applyAction 會
//   直接拒絕出招、一行 log 都不會有（那種「全綠」是空真，不是通過）。
const ALL_BASIC = ['基本【草】能量', '基本【火】能量', '基本【水】能量', '基本【雷】能量',
  '基本【超】能量', '基本【鬥】能量', '基本【惡】能量', '基本【鋼】能量'].map(n => byName(n)).filter(Boolean);

// 行為測試要一隻「對呆呆王的屬性有弱點」的對手，而且 HP 要夠高不會被一擊打倒
// ⚠ 卡片資料的 supertype 是 'Pokemon'（沒有 é）—— 寫成 'Pokémon' 會一張都抓不到，
//   整個【B】行為端區段就會靜默不跑（空真）。fixture 斷言就是為了擋這種情況。
const OPPW = [...pool.values()].find(c =>
  c.supertype === 'Pokemon' && c.weakness?.type && SLOWKING && c.weakness.type === SLOWKING.pokemonType
  && Number(c.hp) >= 200);

// Rule 25：fixture 自己先驗，抽不到卡要大聲紅，不可以靜默全綠
chk('fixture：8 張借招卡與對照卡都抓得到',
  !!(SLOWKING && MIMIKYU && DRAGA && CLEFABLE && MEOWTH && ZOROARK && SUDOWOODO && NZORO && FOX && NBENCH),
  JSON.stringify({ SLOWKING: !!SLOWKING, MIMIKYU: !!MIMIKYU, DRAGA: !!DRAGA, CLEFABLE: !!CLEFABLE, MEOWTH: !!MEOWTH, ZOROARK: !!ZOROARK, SUDOWOODO: !!SUDOWOODO, NZORO: !!NZORO, FOX: !!FOX, NBENCH: !!NBENCH }));
chk('fixture：8 種基本能量都抓得到', ALL_BASIC.length === 8, String(ALL_BASIC.length));
chk('fixture：抓得到一隻「弱點＝呆呆王屬性」且 HP≥200 的對手（行為測試的前提）',
  !!OPPW, `SLOWKING.pokemonType=${SLOWKING?.pokemonType} OPPW=${OPPW?.name}/${OPPW?.hp}`);

// ── harness ──────────────────────────────────────────────────────────────────
const TMP = mkdtempSync(join(tmpdir(), 'v6338-'));
process.on('exit', () => { try { rmSync(TMP, { recursive: true, force: true }); } catch { /* noop */ } });
const STRAY = [];
process.on('exit', () => { for (const p of STRAY) { try { unlinkSync(p); } catch { /* noop */ } } });

/** ⚠ entry 要寫在 srcDir 的父目錄、用相對路徑 import（Windows 的 `E:/…` 會被 esbuild 當成套件名）。 */
async function bundleFrom(srcDir, tag) {
  const parent = dirname(srcDir);
  const name = srcDir.slice(parent.length + 1).replace(/\\/g, '/');
  const p = `./${name}`;
  const S = join(parent, `.v6338-s-${tag}.js`), E = join(parent, `.v6338-e-${tag}.ts`), O = join(parent, `.v6338-o-${tag}.mjs`);
  STRAY.push(S, E, O);
  writeFileSync(S, 'export const base="";');
  writeFileSync(E,
    `export { ATTACK_PRE, ATTACK_POST } from '${p}/lib/game/effects/_shared';\n`
    + `export { applyAction } from '${p}/lib/game/engine';\n`
    + `import '${p}/lib/game/effects';\n`);
  await build({
    entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
    alias: { $lib: join(srcDir, 'lib'), '$app/paths': S }, logLevel: 'silent',
  });
  return import(pathToFileURL(O).href);
}

const HEAD = await bundleFrom(join(ROOT, 'src'), 'head');

// ── 盤面 ─────────────────────────────────────────────────────────────────────
let seq = 0;
const inst = (id, extra = {}) => ({ cardId: String(id), iid: 'i' + (++seq), damage: 0, energyAttached: [], toolAttached: null, ...extra });
const ENERGIES = () => [...ALL_BASIC.map(c => inst(c.id)), ...ALL_BASIC.map(c => inst(c.id))];

function board({ myActive, myBench = [], myDeck = [], myHand = [], oppActive, oppBench = [], oppDeck = [] }) {
  return {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
    isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
    pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
    players: [
      { name: 'P1', active: myActive, bench: myBench, hand: myHand, deck: myDeck, discard: [], prizes: Array.from({ length: 6 }, () => inst(MIMIKYU.id)) },
      { name: 'P2', active: oppActive, bench: oppBench, hand: [], deck: oppDeck, discard: [], prizes: Array.from({ length: 6 }, () => inst(DRAGA.id)) },
    ],
  };
}

/**
 * 借招家族的「旗標轉發」單元探針。
 * 作法：把**被借招式**的 ATTACK_PRE 換成一個把所有旗標都打開的替身，
 *   再直呼**借招卡**的 ATTACK_PRE，看外層回傳了什麼。
 * ⚠ 每一筆都附一個 `damage === 10` 的哨兵 —— 替身沒被呼叫到（＝根本沒借成功）時要紅，
 *   否則「旗標是 undefined」會被誤判成「沒轉發」，其實是盤面搭錯（空真）。
 */
const STUB = (s) => ({
  state: s, damage: 10,
  skipWeakRes: true, skipWeakness: true, skipResistance: true, skipDefEffects: true,
  breakdown: [{ value: 10, label: '替身' }],
});
function probe(MOD, borrowKey, stubKey, make, wrap = (f) => f()) {
  const orig = MOD.ATTACK_PRE.get(stubKey);
  MOD.ATTACK_PRE.set(stubKey, STUB);
  try {
    const { state, action } = make();
    const pre = MOD.ATTACK_PRE.get(borrowKey);
    if (!pre) return { missing: true };
    return wrap(() => pre(state, 0, pool, action)) ?? {};
  } catch (e) {
    return { threw: String(e && e.message ? e.message : e) };
  } finally {
    if (orig) MOD.ATTACK_PRE.set(stubKey, orig); else MOD.ATTACK_PRE.delete(stubKey);
  }
}

/** 8 張借招卡各自的盤面與「被借招式」的 key */
function cases() {
  const A = (c) => inst(c.id, { energyAttached: ENERGIES() });
  const dr0 = `${DRAGA.name}|${DRAGA.attacks[0].name}`;
  const oppDr = () => { const d = inst(DRAGA.id); return { d, st: (me, extra = {}) => board({ myActive: me, oppActive: d, oppDeck: [inst(DRAGA.id)], ...extra }) }; };
  const list = [];

  // ① 呆呆王｜耀閃挑戰 —— 從**自己牌庫頂**那張借
  {
    const top = inst(MIMIKYU.id);
    list.push({
      name: '呆呆王｜耀閃挑戰', borrowKey: '呆呆王|耀閃挑戰', stubKey: `${MIMIKYU.name}|扮晶晶酒`,
      make: () => ({
        state: board({ myActive: A(SLOWKING), myDeck: [top], oppActive: inst(DRAGA.id), oppDeck: [inst(DRAGA.id)] }),
        action: { type: 'ATTACK', attackIndex: 0, copyAttackChoice: { pokeIid: top.iid, attackIndex: 0 } },
      }),
    });
  }
  // ② 火箭隊的謎擬Ｑ｜扮晶晶酒 —— 對手戰鬥場的太晶寶可夢（v6.337 唯一已經會繼承的一張 ⇒ 哨兵）
  {
    const o = oppDr();
    list.push({
      name: '火箭隊的謎擬Ｑ｜扮晶晶酒', borrowKey: '火箭隊的謎擬Ｑ|扮晶晶酒', stubKey: dr0, sentinel: true,
      make: () => ({ state: o.st(A(MIMIKYU)), action: { type: 'ATTACK', attackIndex: 0, copyAttackChoice: { pokeIid: o.d.iid, attackIndex: 0 } } }),
    });
  }
  // ③ 索羅亞克｜欺詐
  {
    const o = oppDr();
    list.push({
      name: '索羅亞克｜欺詐', borrowKey: '索羅亞克|欺詐', stubKey: dr0,
      make: () => ({ state: o.st(A(ZOROARK)), action: { type: 'ATTACK', attackIndex: 0, copyAttackChoice: { pokeIid: o.d.iid, attackIndex: 0 } } }),
    });
  }
  // ④ 阿響的樹才怪｜試著模仿 —— 要先擲出正面；用必定正面的偏置擲幣讓它可重現
  {
    const o = oppDr();
    list.push({
      name: '阿響的樹才怪｜試著模仿', borrowKey: '阿響的樹才怪|試著模仿', stubKey: dr0,
      wrap: (f) => withBiasedCoin(0x6338, 1, f),
      make: () => ({ state: o.st(A(SUDOWOODO)), action: { type: 'ATTACK', attackIndex: 0, copyAttackChoice: { pokeIid: o.d.iid, attackIndex: 0 } } }),
    });
  }
  // ⑤ 火箭隊的貓老大ex｜高傲指令 —— 從**對手牌庫頂 10 張**裡挑
  {
    const deck = Array.from({ length: 12 }, () => inst(DRAGA.id));
    const idx = MEOWTH.attacks.findIndex(a => a.name === '高傲指令');
    list.push({
      name: '火箭隊的貓老大ex｜高傲指令', borrowKey: '火箭隊的貓老大ex|高傲指令', stubKey: dr0,
      make: () => ({
        state: board({ myActive: A(MEOWTH), oppActive: inst(DRAGA.id), oppDeck: deck }),
        action: { type: 'ATTACK', attackIndex: idx, copyAttackChoice: { pokeIid: deck[0].iid, attackIndex: 0 } },
      }),
    });
  }
  // ⑥ 皮可西｜揮指 —— 對手場上
  {
    const o = oppDr();
    const idx = CLEFABLE.attacks.findIndex(a => a.name === '揮指');
    list.push({
      name: '皮可西｜揮指', borrowKey: '皮可西|揮指', stubKey: dr0,
      make: () => ({ state: o.st(A(CLEFABLE)), action: { type: 'ATTACK', attackIndex: idx, copyAttackChoice: { pokeIid: o.d.iid, attackIndex: 0 } } }),
    });
  }
  // ⑦ N的索羅亞克ex｜暗黑底牌 —— 自己備戰的「N的」寶可夢
  {
    const nb = inst(NBENCH.id);
    const idx = NZORO.attacks.findIndex(a => a.name === '暗黑底牌');
    list.push({
      name: 'N的索羅亞克ex｜暗黑底牌', borrowKey: 'N的索羅亞克ex|暗黑底牌', stubKey: `${NBENCH.name}|${NBENCH.attacks[0].name}`,
      make: () => ({
        state: board({ myActive: A(NZORO), myBench: [nb], oppActive: inst(DRAGA.id), oppDeck: [inst(DRAGA.id)] }),
        action: { type: 'ATTACK', attackIndex: idx, copyAttackChoice: { pokeIid: nb.iid, attackIndex: 0 } },
      }),
    });
  }
  // ⑧ 狐大盜｜技能大盜 —— 手牌必須是 0 張
  {
    const o = oppDr();
    const idx = FOX.attacks.findIndex(a => a.name === '技能大盜');
    list.push({
      name: '狐大盜｜技能大盜', borrowKey: '狐大盜|技能大盜', stubKey: dr0,
      make: () => ({ state: o.st(A(FOX), { myHand: [] }), action: { type: 'ATTACK', attackIndex: idx, copyAttackChoice: { pokeIid: o.d.iid, attackIndex: 0 } } }),
    });
  }
  return list;
}

/** 回傳每張卡的旗標轉發結果（給 HEAD 與 BASE 各跑一次） */
function flagMatrix(MOD) {
  const out = [];
  for (const c of cases()) {
    const r = probe(MOD, c.borrowKey, c.stubKey, c.make, c.wrap);
    out.push({
      name: c.name, sentinel: !!c.sentinel,
      reached: r.damage === 10,
      weakRes: r.skipWeakRes, weakness: r.skipWeakness, resistance: r.skipResistance,
      defEffects: r.skipDefEffects, breakdown: Array.isArray(r.breakdown) && r.breakdown.length === 1,
      note: r.missing ? 'no-regPre' : (r.threw ?? ''),
    });
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【A】8 張借招卡：被借招式的旗標必須原樣轉發（站長裁示 v6.338）');
const M = flagMatrix(HEAD);
for (const r of M) {
  chk(`A1 ${r.name}：替身真的被呼叫到（damage=10 哨兵，避免空真）`, r.reached, r.note || JSON.stringify(r));
}
for (const r of M) {
  chk(`A2 ${r.name}：skipWeakRes 原樣轉發（「不計算弱點・抵抗力」屬於招式本身）`,
    r.reached && r.weakRes === true, String(r.weakRes));
}
for (const r of M) {
  chk(`A3 ${r.name}：skipWeakness／skipResistance（v4.495 半套旗標）也要轉發`,
    r.reached && r.weakness === true && r.resistance === true, `${r.weakness}/${r.resistance}`);
}
for (const r of M) {
  chk(`A4 ${r.name}：skipDefEffects 與 breakdown 一併轉發（傷害拆解不該消失）`,
    r.reached && r.defEffects === true && r.breakdown, `${r.defEffects}/${r.breakdown}`);
}
chk('A5 ⭐反安慰劑：替身不設任何旗標時，借招卡也不可以憑空生出 true',
  (() => {
    const K = `${DRAGA.name}|${DRAGA.attacks[0].name}`;
    const orig = HEAD.ATTACK_PRE.get(K);
    HEAD.ATTACK_PRE.set(K, (s) => ({ state: s, damage: 10 }));
    try {
      const d = inst(DRAGA.id);
      const st = board({ myActive: inst(MIMIKYU.id, { energyAttached: ENERGIES() }), oppActive: d, oppDeck: [inst(DRAGA.id)] });
      const r = HEAD.ATTACK_PRE.get('火箭隊的謎擬Ｑ|扮晶晶酒')(st, 0, pool, { type: 'ATTACK', attackIndex: 0, copyAttackChoice: { pokeIid: d.iid, attackIndex: 0 } });
      return r.damage === 10 && r.skipWeakRes === undefined && r.skipWeakness === undefined;
    } finally { if (orig) HEAD.ATTACK_PRE.set(K, orig); else HEAD.ATTACK_PRE.delete(K); }
  })());

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【B】行為端：有弱點的盤面上，借到「不計算弱點・抵抗力」的招式不可以再 ×2');

/** 呆呆王｜耀閃挑戰 借牌庫頂謎擬Ｑ 的招式，打一隻對呆呆王屬性有弱點的對手 */
function weaknessRun(MOD, flags) {
  const KEY = `${MIMIKYU.name}|扮晶晶酒`;
  const orig = MOD.ATTACK_PRE.get(KEY);
  MOD.ATTACK_PRE.set(KEY, (s) => ({ state: s, damage: 50, ...flags }));
  try {
    const top = inst(MIMIKYU.id);
    const target = inst(OPPW.id);
    const st = board({ myActive: inst(SLOWKING.id, { energyAttached: ENERGIES() }), myDeck: [top], oppActive: target, oppDeck: [inst(DRAGA.id)] });
    const out = MOD.applyAction(st, {
      type: 'ATTACK', attackIndex: (SLOWKING.attacks ?? []).findIndex(a => a.name === '耀閃挑戰'),
      copyAttackChoice: { pokeIid: top.iid, attackIndex: 0 },
    }, pool);
    return out.players[1].active?.damage ?? -1;
  } finally {
    if (orig) MOD.ATTACK_PRE.set(KEY, orig); else MOD.ATTACK_PRE.delete(KEY);
  }
}

let bPlain = -1, bSkip = -1, bHalf = -1;
if (OPPW) {
  bPlain = weaknessRun(HEAD, {});
  bSkip = weaknessRun(HEAD, { skipWeakRes: true });
  bHalf = weaknessRun(HEAD, { skipWeakness: true });
  chk('B0 ⭐哨兵：沒有旗標時弱點確實生效（50 ×2 = 100）—— 這條在 BASE 也該綠',
    bPlain === 100, String(bPlain));
  chk('B1 ⭐⭐⭐ 被借招式標了 skipWeakRes ⇒ 弱點不再計算（50，不是 100）',
    bSkip === 50, String(bSkip));
  chk('B2 ⭐⭐ 被借招式只標 skipWeakness（v4.495 半套）也要生效（50，不是 100）',
    bHalf === 50, String(bHalf));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【C】HEAD-FAIL：對 BASE(' + BASE_SHA.slice(0, 8) + ' ＝ v6.337) 重跑');

const CHANGED = [
  'src/lib/game/effects/_shared.ts',
  'src/lib/game/effects.ts',
  'src/lib/game/effects/cards/slowking_lucario_deck.ts',
  'src/lib/game/effects/cards/m5_preview.ts',
  'src/lib/game/effects/cards/six_decks.ts',
];

if (!hasBaseCommit(ROOT, BASE_SHA)) {
  shallowSkip('【C】HEAD-FAIL 對 BASE 的重建比對', '需要歷史 commit；【A】【B】不需要歷史，仍在守');
} else {
  const baseSrc = join(TMP, 'base-src');
  cpSync(join(ROOT, 'src'), baseSrc, { recursive: true });
  let rebuilt = true;
  for (const rel of CHANGED) {
    const b = readBaseBlob(ROOT, BASE_SHA, rel);
    if (!b.ok) { rebuilt = false; break; }
    writeFileSync(join(baseSrc, rel.replace(/^src\//, '')), b.out, 'utf8');
  }
  chk('C0 BASE 樹重建成功（5 個改過的檔都換回 BASE blob）', rebuilt);

  if (rebuilt) {
    const BASE = await bundleFrom(baseSrc, 'base');
    const bm = flagMatrix(BASE);

    // Rule 41 哨兵：BASE 上「扮晶晶酒繼承 skipWeakRes」必須是綠的，
    //   證明 BASE bundle 是活的、不是整支爆掉導致「全紅」。
    const sent = bm.find(r => r.sentinel);
    chk('C1 ⭐Rule 41 哨兵：BASE 上扮晶晶酒的 skipWeakRes 已經是 true（v3.873 起的既有行為）',
      !!sent && sent.reached && sent.weakRes === true, JSON.stringify(sent));
    chk('C2 ⭐哨兵：BASE 上 8 張借招卡都確實借到了替身（盤面沒搭錯）',
      bm.every(r => r.reached), bm.filter(r => !r.reached).map(r => r.name + ':' + r.note).join(' / '));

    const redWeakRes = bm.filter(r => !r.sentinel && r.weakRes !== true).map(r => r.name);
    chk('C3 ⭐⭐⭐ BASE 上「扮晶晶酒以外的 7 張」skipWeakRes 都**沒有**繼承（本版真的修了東西）',
      redWeakRes.length === 7, `實際沒繼承的有 ${redWeakRes.length} 張：${redWeakRes.join('、')}`);

    const redHalf = bm.filter(r => r.weakness === true || r.resistance === true).map(r => r.name);
    chk('C4 ⭐⭐⭐ BASE 上 skipWeakness／skipResistance 是**8 張全部**被吃掉',
      redHalf.length === 0, `BASE 上竟然有轉發的：${redHalf.join('、')}`);

    const redBd = bm.filter(r => r.breakdown).map(r => r.name);
    chk('C5 BASE 上 breakdown 也是 8 張全部被吃掉', redBd.length === 0, redBd.join('、'));

    if (OPPW) {
      const p = weaknessRun(BASE, {});
      const s = weaknessRun(BASE, { skipWeakRes: true });
      const h = weaknessRun(BASE, { skipWeakness: true });
      chk('C6 ⭐哨兵：BASE 上「沒旗標 ⇒ 100」也是綠的', p === 100, String(p));
      chk('C7 ⭐⭐⭐ BASE 上 skipWeakRes 被吃掉 ⇒ 傷害仍是 100（本版修成 50）', s === 100, String(s));
      chk('C8 ⭐⭐⭐ BASE 上 skipWeakness 被吃掉 ⇒ 傷害仍是 100（本版修成 50）', h === 100, String(h));
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【D】靜態：中央出口不可以再退回「逐欄位列舉」');
{
  const sh = readFileSync(join(ROOT, 'src/lib/game/effects/_shared.ts'), 'utf8');
  chk('D1 dispatchCopiedAttack 的回傳型別綁在 ReturnType<AttackPreFn>（加欄位不必再同步一次）',
    /export type CopiedAttackResult = ReturnType<AttackPreFn>;/.test(sh)
    && /\): CopiedAttackResult \{/.test(sh));
  chk('D2 不可以再有 inheritSkipWeakRes 這種「要不要繼承」的開關（判準只有一個）',
    !/inheritSkipWeakRes/.test(sh));
  const body = sh.slice(sh.indexOf('export function dispatchCopiedAttack'));
  const fn = body.slice(0, body.indexOf('\nexport '));
  chk('D3 轉接時整包展開回傳（不是逐欄位列舉）', /return \{ \.\.\.copiedPre\(/.test(fn), fn.length + ' chars');
  // ⚠ 判準要釘在**結構**上，不是釘「skipWeakRes: false 這串字」——
  //   那幾個檔裡別張卡自己的招式合法地回傳 skipWeakRes: false，釘字串會誤紅。
  //   真正的病灶是「把中央出口的回傳拆開再組回去」：一拆開就會漏掉沒列舉到的欄位。
  const BORROW_FILES = [
    'src/lib/game/effects.ts',
    'src/lib/game/effects/cards/slowking_lucario_deck.ts',
    'src/lib/game/effects/cards/m5_preview.ts',
    'src/lib/game/effects/cards/six_decks.ts',
    'src/lib/game/effects/cards/v2680_i_wave18_copy_attacks.ts',
    'src/lib/game/effects/cards/v2760_h_wave3_complex.ts',
  ];
  const rebuilders = BORROW_FILES.filter(rel =>
    /(?:const|let|var)\s+\w+\s*=\s*dispatchCopiedAttack\(/.test(readFileSync(join(ROOT, rel), 'utf8')));
  chk('D4 借招卡一律 return dispatchCopiedAttack(...)，不可以接成變數再逐欄位組回去',
    rebuilders.length === 0, rebuilders.join('、'));
  chk('D5 8 張借招卡的轉接點都還在（D4 不是因為呼叫全消失才綠的）',
    BORROW_FILES.reduce((n, rel) =>
      n + (readFileSync(join(ROOT, rel), 'utf8').split('dispatchCopiedAttack(').length - 1), 0) === 8,
    String(BORROW_FILES.reduce((n, rel) =>
      n + (readFileSync(join(ROOT, rel), 'utf8').split('dispatchCopiedAttack(').length - 1), 0)));
}

{
  const v = readFileSync(join(ROOT, 'src/lib/version.ts'), 'utf8');
  chk('D6 版本已 bump 到 6.338 以上', /VERSION = '6\.(33[89]|3[4-9]\d|[4-9]\d\d)'/.test(v), v.match(/VERSION = '[^']+'/)?.[0] ?? '');
}

console.log(`\nv6.338 借招旗標轉發守衛：PASS ${pass} / FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
