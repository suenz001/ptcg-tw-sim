#!/usr/bin/env node
/**
 * v6.399 守衛：「對手的寶可夢身上放置的傷害指示物的數量×N」收斂到中央
 * `oppCountersMultiplyPre`（Rule 38）。
 *
 * 收斂前這一條卡面（static/cards 逐字查證，H/I/J 共 11 招）站上有**四種寫法**，
 * 而且「指示物數 ＝ Math.floor(damage / 10)」被**就地重寫了三次**
 * （中央明明已經有 counterCount()）：
 *   ・effects.ts 七個 inline regPre｜v2490 的 local factory oppActiveDamageCountPre
 *   ・v2620 的 local factory oppActiveCounterCountPre｜v2740、v2346 的 inline
 *
 * ⚠ 本版是**行為零變化**的收斂，唯一會變的是那 4 張原本就有寫 log 的卡的**對戰紀錄措辭**
 *   （統一成中央格式）。原本不寫 log 的 8 張一律傳 { log: false }，逐字不變。
 *   ⇒ 所以 A 組行為端斷言在 BASE 上也會綠（零回歸斷言），HEAD-FAIL 由 C 組的收斂層負責。
 *   這一點誠實寫在這裡，不假裝 A 組是 HEAD-FAIL。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
import { normEol } from './lib/eol-agnostic.mjs';
import { stripCommentsBlankChecked } from './lib/strip-comments.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));   // Rule 46
const S = join(ROOT, '.x-399g-s.js'), E = join(ROOT, '.x-399g-e.ts'), O = join(ROOT, '.x-399g-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* 忽略 */ } } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { createGame, applyAction } from './src/lib/game/engine';\n"
  + "export { ATTACK_PRE } from './src/lib/game/effects/_shared';\n"
  + "export { getBasicEnergyType } from './src/lib/game/selection-filter';\n"
  + "export { oppCountersMultiplyPre } from './src/lib/game/effects';\n"
  + "import './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const M = await import(pathToFileURL(O).href);
const { createGame, applyAction, ATTACK_PRE, getBasicEnergyType } = M;
/** ⚠ Rule 41：新中央 helper 在 BASE 上不存在 ⇒ 用哨兵包起來，讓每一條各自誠實翻紅。 */
const MISSING = Symbol('missing');
const oppCountersMultiplyPre = (typeof M?.oppCountersMultiplyPre === 'function') ? M.oppCountersMultiplyPre : () => MISSING;

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  PASS ' + n); pass++; } catch (e) { console.log('  FAIL ' + n + ' :: ' + e.message); fail++; } };

const energyByType = new Map();
let anyEnergyId = null;
for (const [id, c] of pool) {
  if (c?.supertype !== 'Energy' || c?.subtype !== 'Basic') continue;
  if (anyEnergyId === null) anyEnergyId = id;
  const t = getBasicEnergyType(c);
  if (t && !energyByType.has(t)) energyByType.set(t, id);
}
/** ⚠ 基本能量卡的 pokemonType 多為 null ⇒ 走中央 getBasicEnergyType，否則招式打不出來。 */
const energyIdFor = (costType) => energyByType.get(costType) ?? anyEnergyId;

let nn = 0;
const inst = (cid, e = [], x = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: e, ...x });

/** 找「卡名＋招式名」都對得上的那張印刷（同名卡可能有多張，招式不同）。 */
function findPrint(name, atkName) {
  for (const [id, c] of pool) {
    if (c?.name !== name) continue;
    if ((c.attacks ?? []).some((a) => a.name === atkName)) return id;
  }
  return null;
}
function pickTarget(atkType, wantWeakTo) {
  for (const [id, c] of pool) {
    if (c?.supertype !== 'Pokemon' || (c.hp ?? 0) < 330) continue;
    if ((c.abilities ?? []).length > 0) continue;   // 特性可能減傷／免疫 ⇒ 靶要乾淨
    const w = c.weakness?.type, r = c.resistance?.type;
    if (wantWeakTo) { if (w === atkType) return id; continue; }
    if (w === atkType || r === atkType) continue;
    return id;
  }
  return null;
}
const tName = (id) => (pool.get(String(id))?.name ?? '?') + '#' + id;

/**
 * 讓 cid 用 atkName 打一個中立高血靶；對手 active 身上先放 activeDmg 點傷害、
 * 備戰放 benchDmg（測 scope:'all'）。回傳 { dealt, logs }。
 */
function hit(cid, atkName, activeDmg, benchDmg, opts = {}) {
  const card = pool.get(String(cid));
  const ai = (card.attacks ?? []).findIndex((a) => a.name === atkName);
  assert.ok(ai >= 0, card.name + ' 找不到招式 ' + atkName);
  const cost = card.attacks[ai].cost ?? [];
  const tgt = opts.targetId ?? pickTarget(card.pokemonType, false);
  assert.ok(tgt, '挑不到對 ' + card.pokemonType + ' 中立的高血靶');
  const s0 = createGame({ name: 'P1', entries: [{ cardId: tgt, count: 1 }] },
                        { name: 'P2', entries: [{ cardId: tgt, count: 1 }] }, pool);
  const me = inst(cid, cost.map((t) => inst(energyIdFor(t))));
  const defActive = inst(tgt, [], { damage: activeDmg });
  const defBench = benchDmg > 0 ? [inst(tgt, [], { damage: benchDmg })] : [];
  const st = { ...s0, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0,
    isFirstTurn: false, setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
    pendingSelection: null,
    players: [
      { ...s0.players[0], hand: [], deck: [inst(tgt)], discard: [], prizes: Array.from({ length: 6 }, () => inst(tgt)),
        active: me, bench: [], energyAttachedThisTurn: true },
      { ...s0.players[1], hand: [], deck: [inst(tgt)], discard: [], prizes: Array.from({ length: 6 }, () => inst(tgt)),
        active: defActive, bench: defBench }] };
  const before = st.players[1].active.damage;
  const after = applyAction(st, { type: 'ATTACK', attackIndex: ai }, pool);
  assert.ok(after && after !== st, atkName + ' 沒有被引擎接受（cost／前提不成立）');
  assert.ok(after.players[1].active, atkName + ' 打完之後對手戰鬥位不見了（靶被秒殺，換血更厚的）');
  return {
    dealt: (after.players[1].active?.damage ?? -1) - before,
    logs: (after.log ?? []).map((l) => String(l?.message ?? l?.text ?? l)),
  };
}

// ── 卡面逐字查證表（static/cards）。base/per 取自卡面的 damage 欄與 effect。 ──────
const CASES = [
  { name: '脫殼忍者', atk: '傷害律動', base: 0, per: 20, scope: 'active', log: true, split: false },
  { name: '冰鬼護', atk: '傷害律動', base: 0, per: 20, scope: 'active', log: false, split: false },
  { name: '蘋裹龍', atk: '酸味噴吐', base: 0, per: 20, scope: 'active', log: false, split: false },
  { name: '麒麟奇', atk: '精神傷害', base: 20, per: 10, scope: 'active', log: false, split: false },
  { name: '太陽伊布', atk: '精神傷害', base: 30, per: 10, scope: 'active', log: false, split: true },  // ⚠ G 標印刷
  { name: '月月熊 赫月', atk: '瘋狂啃咬', base: 100, per: 30, scope: 'active', log: false, split: true },
  { name: '猛惡菇', atk: '爆毆', base: 50, per: 50, scope: 'active', log: false, split: true },
  { name: '伽勒爾 堵攔熊', atk: '傷疤嚎叫', base: 0, per: 70, scope: 'active', log: true, split: false },
  { name: '鬃岩狼人', atk: '抓擊獠牙', base: 40, per: 40, scope: 'active', log: true, split: false },
  { name: '閃電鳥', atk: '追擊伏特', base: 20, per: 10, scope: 'active', log: true, split: false },
  { name: '亞克諾姆', atk: '意志強念', base: 10, per: 10, scope: 'all', log: false, split: false },
  { name: '朽木妖', atk: '超頻傷痛', base: 60, per: 10, scope: 'all', log: false, split: false },
];

console.log('【0】前提哨兵');
T('F0 ★ 12 個註冊點都在 ATTACK_PRE 裡（改名／漏註冊要立刻發現）', () => {
  for (const c of CASES) assert.ok(ATTACK_PRE.has(c.name + '|' + c.atk), '缺 key：' + c.name + '|' + c.atk);
});
T('F0b ★ 卡面逐字查證（本守衛所有數字的依據；措辭變了就要重新判讀）', () => {
  let n = 0;
  for (const c of CASES) {
    const id = findPrint(c.name, c.atk);
    assert.ok(id, '卡池找不到 ' + c.name + '｜' + c.atk);
    const a = pool.get(id).attacks.find((x) => x.name === c.atk);
    const who = c.scope === 'all' ? '所有' : '戰鬥';
    const re = new RegExp('對手的' + who + '寶可夢身上放置的傷害指示物的數量×' + c.per + '點傷害');
    assert.ok(re.test(String(a.effect)), c.name + '｜' + c.atk + ' 卡面對不上：' + a.effect);
    // 卡面 damage 欄與 base 對齊（「20+」＝ base 20、「20×」＝ base 0）
    const d = String(a.damage ?? '');
    const expect = c.base === 0 ? String(c.per * 1) + '×' : String(c.base) + '+';
    if (c.base === 0) assert.ok(/×$/.test(d), c.name + ' 卡面 damage 應為「N×」，實得 ' + d);
    else assert.strictEqual(d, expect, c.name + ' 卡面 damage 對不上');
    n++;
  }
  assert.strictEqual(n, 12, '應查證 12 招，實得 ' + n);
});

console.log('\n【A】⭐⭐⭐ 行為端：傷害 = base + 指示物數 × per（零回歸斷言）');
for (const c of CASES) {
  const cid = findPrint(c.name, c.atk);
  T('A ' + c.name + '｜' + c.atk + '：對手 3 個指示物 ⇒ ' + (c.base + 3 * c.per), () => {
    const r = hit(cid, c.atk, 30, 0);
    assert.strictEqual(r.dealt, c.base + 3 * c.per, '實得 ' + r.dealt);
  });
  T('A0 ' + c.name + '｜' + c.atk + '：0 個指示物 ⇒ ' + c.base + '（邊界）', () => {
    const r = hit(cid, c.atk, 0, 0);
    assert.strictEqual(r.dealt, c.base, '實得 ' + r.dealt);
  });
}
T('A-all ⭐ scope:"all" 的兩張要把**備戰**的指示物也算進去（scope:"active" 的不可以）', () => {
  // 對手 active 3 個 + 備戰 2 個 = 5 個
  const akn = findPrint('亞克諾姆', '意志強念');
  const rot = findPrint('朽木妖', '超頻傷痛');
  const kir = findPrint('麒麟奇', '精神傷害');
  assert.strictEqual(hit(akn, '意志強念', 30, 20).dealt, 10 + 5 * 10, '亞克諾姆應算 5 個');
  assert.strictEqual(hit(rot, '超頻傷痛', 30, 20).dealt, 60 + 5 * 10, '朽木妖應算 5 個');
  // ★ 反向：scope:'active' 的那張**不可以**被備戰影響（證明 scope 參數真的有在分流）
  assert.strictEqual(hit(kir, '精神傷害', 30, 20).dealt, 20 + 3 * 10,
    '麒麟奇是「對手的戰鬥寶可夢」⇒ 備戰的指示物不算');
});
T('B1 ★★ 反安慰劑：同一招打**弱點靶**必須兩倍（證明 A 組的靶真的有避開弱點）', () => {
  // ⚠ 這裡**不能**用猛惡菇（200×2=400 會把 330 血的靶直接秒殺 ⇒ 守衛會紅在「戰鬥位不見了」，
  //   那是假紅、證明不了弱點倍率）。挑傷害小的麒麟奇（50×2=100）才測得到弱點倍率本身。
  const cid = findPrint('麒麟奇', '精神傷害');
  const atkType = pool.get(String(cid))?.pokemonType;
  const weak = pickTarget(atkType, true);
  assert.ok(weak, '卡池裡挑不到弱 ' + atkType + ' 的高血靶');
  const r = hit(cid, '精神傷害', 30, 0, { targetId: weak });
  assert.strictEqual(r.dealt, (20 + 3 * 10) * 2, '弱點靶應吃兩倍，實得 ' + r.dealt + '（靶＝' + tName(weak) + '）');
});
T('B2 ⭐ 對戰紀錄：原本不寫 log 的 8 張仍然不寫；原本有 log 的 4 張走中央格式', () => {
  for (const c of CASES) {
    const cid = findPrint(c.name, c.atk);
    const r = hit(cid, c.atk, 30, 0);
    const line = r.logs.find((l) => l.startsWith(c.atk + '：'));
    if (c.log) {
      const where = c.scope === 'all' ? '對手全場' : '對手戰鬥場';
      assert.strictEqual(line, c.atk + '：' + where + '傷害指示物 3 個 × ' + c.per + ' → ' + (c.base + 3 * c.per),
        c.name + ' 的 log 不是中央格式，實得：' + line);
    } else {
      assert.ok(!line, c.name + ' 原本沒有 log，收斂後不可以多出一條（應傳 { log: false }）：' + line);
    }
  }
});
T('B3 ⭐ 直呼中央 helper：splitBreakdown 的形狀（n>0 才給，兩段加總 = 傷害）', () => {
  const fn = oppCountersMultiplyPre(100, 30, '瘋狂啃咬', { log: false, splitBreakdown: true });
  assert.notStrictEqual(fn, MISSING, 'oppCountersMultiplyPre 缺席（BASE 沙盒）');
  const mk = (d) => ({ players: [{ active: null, bench: [] }, { active: { damage: d, energyAttached: [] }, bench: [] }], log: [] });
  const r3 = fn(mk(30), 0, pool);
  assert.strictEqual(r3.damage, 190);
  assert.deepStrictEqual(r3.breakdown, [{ value: 90, label: '指示物 3×30' }, { value: 100, label: '基礎' }]);
  assert.strictEqual(r3.breakdown.reduce((a, b) => a + b.value, 0), r3.damage, 'breakdown 加總應等於傷害');
  const r0 = fn(mk(0), 0, pool);
  assert.strictEqual(r0.damage, 100);
  assert.ok(!r0.breakdown, 'n=0 時不該給 breakdown（沿用既有形狀）');
  // ★ 反向：沒開 splitBreakdown 就不可以有 breakdown
  const plain = oppCountersMultiplyPre(20, 10, '精神傷害', { log: false });
  assert.ok(!plain(mk(30), 0, pool).breakdown, '沒開 splitBreakdown 卻回了 breakdown');
});

console.log('\n【C】⭐⭐ 收斂層：判準只剩一份');
T('C1 ⭐⭐⭐ 12 個註冊點都是一行式的 oppCountersMultiplyPre（沒有人再自己算一次）', () => {
  const files = [
    ['src/lib/game/effects.ts', ['冰鬼護|傷害律動', '蘋裹龍|酸味噴吐', '麒麟奇|精神傷害', '太陽伊布|精神傷害',
      '月月熊 赫月|瘋狂啃咬', '猛惡菇|爆毆', '亞克諾姆|意志強念']],
    ['src/lib/game/effects/cards/v2490_i_wave3a_conditional.ts', ['脫殼忍者|傷害律動']],
    ['src/lib/game/effects/cards/v2620_i_wave12_misc5.ts', ['伽勒爾 堵攔熊|傷疤嚎叫', '鬃岩狼人|抓擊獠牙']],
    ['src/lib/game/effects/cards/v2740_h_wave1_simple.ts', ['閃電鳥|追擊伏特']],
    ['src/lib/game/effects/cards/v2346_j_mark_batch.ts', ['朽木妖|超頻傷痛']],
  ];
  let n = 0;
  for (const [rel, keys] of files) {
    const src = normEol(readFileSync(join(ROOT, rel), 'utf8'));
    for (const k of keys) {
      const re = new RegExp("regPre\\('" + k.replace('|', '\\|') + "', oppCountersMultiplyPre\\(");
      assert.ok(re.test(src), rel + ' 的 ' + k + ' 不是一行式的 oppCountersMultiplyPre 註冊');
      n++;
    }
  }
  assert.strictEqual(n, 12, '應檢查 12 個註冊點');
  // ★ 正對照：偵測器對人造的手刻寫法必須**不**命中（不是恆真）
  assert.ok(!/regPre\('X\|Y', oppCountersMultiplyPre\(/.test("regPre('X|Y', (state, aIdx) => {"), '偵測器恆真');
});
T('C2 ⭐⭐ 兩個 local factory 真的不見了（不是留在原地沒人用）', () => {
  const gone = [
    ['src/lib/game/effects/cards/v2490_i_wave3a_conditional.ts', 'function oppActiveDamageCountPre'],
    ['src/lib/game/effects/cards/v2620_i_wave12_misc5.ts', 'function oppActiveCounterCountPre'],
  ];
  for (const [rel, needle] of gone) {
    const src = normEol(readFileSync(join(ROOT, rel), 'utf8'));
    assert.ok(!src.includes(needle), rel + ' 還留著 ' + needle + '（Rule 38：判準留兩份＝守衛必然是安慰劑）');
  }
});
T('C3 ⭐⭐⭐ 全站不得再有第二份「指示物數 = Math.floor(damage / 10)」（唯一一份是 damageCounterCount）', () => {
  const files = [];
  const walk = (d) => { for (const f of readdirSync(join(ROOT, d))) {
    if (f.endsWith('.ts') || f.endsWith('.svelte')) files.push(d + '/' + f); } };
  walk('src/lib/game'); walk('src/lib/game/effects'); walk('src/lib/game/effects/cards'); walk('src/routes/game');
  // 語義而不是字面：任何「把 damage 除以 10 再取整」的寫法（空白與 ?? 0 都允許變體）
  const RE = /Math\.floor\s*\(\s*\(?[A-Za-z0-9_$.?\[\]' ]*damage[^)]{0,20}\)?\s*\/\s*10\s*\)/;
  const ALLOW = [
    // ⭐ 這一條就是**那一份**中央判準本體（_shared.ts 的 damageCounterCount）——
    //   它當然要自己除一次 10，其餘全站都必須呼叫它。
    { file: 'src/lib/game/effects/_shared.ts', needle: 'export function damageCounterCount' },
  ];
  const hits = [];
  let scanned = 0;
  for (const rel of files) {
    const raw = normEol(readFileSync(join(ROOT, rel), 'utf8'));
    let src; try { src = stripCommentsBlankChecked(raw, rel); } catch { src = raw; }
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!/damage/.test(lines[i])) continue;
      scanned++;
      if (!RE.test(lines[i])) continue;
      const ctx = lines.slice(Math.max(0, i - 3), i + 2).join('\n');
      if (ALLOW.some((a) => a.file === rel && ctx.includes(a.needle))) continue;
      hits.push(rel + ':' + (i + 1) + '  ' + lines[i].trim());
    }
  }
  assert.ok(scanned > 300, '只掃到 ' + scanned + ' 行含 damage ⇒ 掃描器壞了（下限斷言）');
  assert.strictEqual(hits.length, 0, '還有 ' + hits.length + ' 處自己算指示物數：\n  ' + hits.join('\n  '));
  // 白名單不得有死條目（對應的程式碼被改名／刪掉還留著 ⇒ 下次同名的就被白白放行）
  for (const a of ALLOW) {
    const raw = normEol(readFileSync(join(ROOT, a.file), 'utf8'));
    assert.ok(raw.includes(a.needle), '白名單死條目：' + a.file + ' / ' + a.needle);
  }
  console.log('        （掃了 ' + scanned + ' 行含 damage 的程式碼，白名單 ' + ALLOW.length + ' 條）');
  // ★ 正對照：人造違規樣本必須被同一支偵測器抓到
  assert.ok(RE.test('const counters = Math.floor((def.damage ?? 0) / 10);'), '偵測器對違規樣本沒反應');
  assert.ok(RE.test('const n = Math.floor(inst.damage / 10);'), '偵測器對變體寫法沒反應');
  assert.ok(!RE.test('const n = counterCount(inst.damage);'), '走中央的寫法被誤判為違規');
});

console.log('\n【D】chain');
T('D1 本守衛已掛進 npm test chain', () => {
  assert.ok(readFileSync(join(ROOT, 'package.json'), 'utf8').includes('test-v6399-opp-counters-converge.mjs'));
});

console.log('\n=== v6.399 守衛：PASS ' + pass + ' / FAIL ' + fail + ' ===');
process.exit(fail ? 1 : 0);
