/**
 * v6.259 守衛 — 「被 KO 時修改獎賞卡張數」的中央收斂（願增猿ex｜鬆口氣）
 *
 * 站長回報：超級路卡利歐ex｜波動突刺 KO 願增猿ex 時「鬆口氣」沒有發動。
 * 真因（BASE f116910a）：**不是** PASSIVE_ON_KO 沒被 dispatch，而是**順序相反**——
 *   ・engine.ts 主 ATTACK：addPendingPrize(6094) → PASSIVE_ON_KO(6137)
 *   ・effects.ts dealAttackDamageToTarget：fireDefenderOnKO(8833) → addPendingPrize(8840)
 * 而鬆口氣舊實作是「從攻擊方**手牌**把剛拿的獎賞卡拿回來」的 claw-back，
 * 依賴獎賞已經進手牌 ⇒ 中央 helper 路徑：
 *   手牌空 → 整個效果靜默不發動（＝站長看到的症狀）
 *   手牌非空 → 更糟：把攻擊方一張**真的手牌**塞進獎賞堆
 * 修法：改成「獎賞張數修正子」PASSIVE_KO_PRIZE_ADJUST + koVictimAbilityPrizeAdjust，
 *       由兩條「算獎賞張數」的管線各呼叫一次 ⇒ 結構上不可能雙重觸發、也沒有順序依賴。
 *
 * ⚠ 只捕捉 assert.AssertionError，其餘照丟。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.k9-s.js'), E = join(ROOT, '.k9-e.ts'), O = join(ROOT, '.k9-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E,
  "export { applyAction } from './src/lib/game/engine';\n" +
  "export { dealAttackDamageToTarget, koTargetByAttackEffect, koPrizesAdjusted,\n" +
  "         PASSIVE_ON_KO, PASSIVE_KO_PRIZE_ADJUST, koVictimAbilityPrizeAdjust,\n" +
  "         TOOL_ON_KO, PASSIVE_KO_RETALIATION } from './src/lib/game/effects';\n" +
  "import './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const mod = await import(pathToFileURL(O).href);
const { applyAction, dealAttackDamageToTarget, koTargetByAttackEffect,
        PASSIVE_ON_KO, PASSIVE_KO_PRIZE_ADJUST } = mod;

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
const allCards = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
    if (c?.id != null) { pool.set(String(c.id), c); allCards.push(c); }
  }
}

let pass = 0; const fails = [];
const T = (label, fn) => {
  try { fn(); pass++; console.log('  ✅ ' + label); }
  catch (e) {
    if (!(e instanceof assert.AssertionError)) throw e;   // ⚠ 只吞斷言錯
    fails.push(label + ' — ' + e.message);
    console.log('  ❌ ' + label + '\n      ' + e.message);
  }
};

// ── 卡片 id（逐一查證過的印刷）─────────────────────────────────────────────
const ID = {
  LUCARIO:  '13986',  // 超級路卡利歐ex【M1L・I】attacks[0]=波動突刺130(走 effects.ts 中央 helper)
                      //                          attacks[1]=超級勇氣270(走 engine 主管線)
  MUNNA_EX: '11628',  // 願增猿ex【SV8a・H】｜鬆口氣 HP210（本案主角）
  MOMO_EX:  '11630',  // 桃歹郎ex【SV8a・H】（鬆口氣的條件）
  MOMO_I:   '14775',  // 桃歹郎【M2a・I】｜最後鎖鏈（PASSIVE_ON_KO 的另一個成員，跨管線對照用）
  PIDGEY:   '14797',  // 咕咕（中性填充，無特性）
  E_FIGHT:  '14104',  // 基本【鬥】能量
};
T('0. 下限斷言：本檔依賴的每一張卡都抓得到（抓不到＝安慰劑綠燈）', () => {
  const miss = Object.entries(ID).filter(([, v]) => !pool.get(v)).map(([k]) => k);
  assert.deepStrictEqual(miss, [], '卡池抓不到：' + miss.join(','));
  assert.strictEqual(pool.get(ID.MUNNA_EX).abilities?.[0]?.name, '鬆口氣');
  assert.strictEqual(pool.get(ID.MOMO_I).abilities?.[0]?.name, '最後鎖鏈');
});

// ── fixtures ───────────────────────────────────────────────────────────────
let seq = 0;
const I = (cardId, extra = {}) => ({
  iid: 'i' + (++seq), cardId: String(cardId), damage: 0, energyAttached: [],
  toolAttached: undefined, extraTools: [], status: null, secondaryStatus: null,
  tertiaryStatus: null, ...extra,
});
const EN = id => ({ iid: 'e' + (++seq), cardId: String(id) });
const LOGS = r => r.log.map(l => (typeof l === 'string' ? l : (l.message ?? '')));
const countRelief = r => LOGS(r).filter(x => x.includes('「鬆口氣」啟動')).length;

/** 攻擊方 = 超級路卡利歐ex（2 顆鬥能量）；防守方 active/bench 由參數決定 */
function mk({ handN = 3, defActive, defBench = [], deckN = 3, oppDeckN = 3 }) {
  return {
    id: 't', phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0,
    turn: 5, isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
    activeStadium: null, pendingPrizes: [0, 0],
    players: [
      { name: 'A', active: I(ID.LUCARIO, { energyAttached: [EN(ID.E_FIGHT), EN(ID.E_FIGHT)] }),
        bench: [], hand: Array.from({ length: handN }, () => I(ID.PIDGEY)),
        deck: Array.from({ length: deckN }, () => I(ID.PIDGEY)), discard: [],
        prizes: Array.from({ length: 6 }, () => I(ID.PIDGEY)) },
      { name: 'B', active: defActive, bench: defBench, hand: [],
        deck: Array.from({ length: oppDeckN }, () => I(ID.PIDGEY)), discard: [],
        prizes: Array.from({ length: 6 }, () => I(ID.PIDGEY)) },
    ],
  };
}
/** 打完後把所有 pendingSelection 用「不選」解掉（本檔不關心 picker 內容） */
function drain(r) {
  let g = 0;
  while (r.pendingSelection && g++ < 8) {
    const ps = r.pendingSelection;
    r = applyAction(r, { type: 'RESOLVE_SELECTION', effectKey: ps.effectKey,
      selectedIids: [], actorIdx: ps.actorIdx }, pool);
  }
  return r;
}

console.log('\n── A. 鬆口氣：每一條「受對手招式傷害而昏厥」的路徑都要**恰好發動 1 次** ──');

T('A1 引擎主管線（超級勇氣）KO 戰鬥位 → 恰 1 次；獎賞 2−1=1（正對照：本來就對）', () => {
  const st = mk({ defActive: I(ID.MUNNA_EX), defBench: [I(ID.MOMO_EX)] });
  const before = st.players[0].hand.map(c => c.iid);
  const r = drain(applyAction(st, { type: 'ATTACK', attackIndex: 1, actorIdx: 0 }, pool));
  assert.strictEqual(r.players[1].active, null, '願增猿ex 應被 KO');
  assert.strictEqual(countRelief(r), 1, '「鬆口氣」log 應恰好 1 次，實得 ' + countRelief(r));
  assert.strictEqual(r.players[0].prizes.length, 5, '獎賞應只被拿 1 張（6→5）');
  const after = new Set(r.players[0].hand.map(c => c.iid));
  assert.ok(before.every(x => after.has(x)), '⚠ 攻擊方原本的手牌一張都不可以被拿走');
});

T('A2 ★中央 dealAttackDamageToTarget（波動突刺）KO 戰鬥位 → 恰 1 次；獎賞 2−1=1', () => {
  const st = mk({ defActive: I(ID.MUNNA_EX, { damage: 100 }), defBench: [I(ID.MOMO_EX)] });
  const before = st.players[0].hand.map(c => c.iid);
  const r = drain(applyAction(st, { type: 'ATTACK', attackIndex: 0, actorIdx: 0 }, pool));
  assert.strictEqual(r.players[1].active, null, '願增猿ex 應被 KO');
  assert.strictEqual(countRelief(r), 1, '「鬆口氣」log 應恰好 1 次，實得 ' + countRelief(r));
  assert.strictEqual(r.players[0].prizes.length, 5, '獎賞應只被拿 1 張（6→5）；BASE 會是 4');
  const after = new Set(r.players[0].hand.map(c => c.iid));
  assert.ok(before.every(x => after.has(x)),
    '⚠ BASE 的 claw-back 會把攻擊方一張真手牌塞進獎賞堆；修好後一張都不能少');
});

T('A3 ★中央 helper 直呼、攻擊方手牌 0 張 → 仍要發動（BASE 完全靜默）', () => {
  const st = mk({ handN: 0, defActive: I(ID.MUNNA_EX, { damage: 100 }), defBench: [I(ID.MOMO_EX)] });
  const r = drain(dealAttackDamageToTarget(st, 0, st.players[1].active.iid, 130, pool,
    { kind: 'attack-damage', label: '狙擊' }));
  assert.strictEqual(r.players[1].active, null, '應被 KO');
  assert.strictEqual(countRelief(r), 1, '手牌 0 張也必須發動，實得 ' + countRelief(r) + ' 次');
  assert.strictEqual(r.players[0].prizes.length, 5, '獎賞 6→5');
});

T('A4 ★備戰區的願增猿ex 被狙擊 KO → 也要發動（卡面沒有「在戰鬥場」）', () => {
  const st = mk({ defActive: I(ID.PIDGEY),
                  defBench: [I(ID.MUNNA_EX, { damage: 100 }), I(ID.MOMO_EX)] });
  const benchIid = st.players[1].bench[0].iid;
  const r = drain(dealAttackDamageToTarget(st, 0, benchIid, 130, pool,
    { kind: 'attack-damage', label: '狙擊' }));
  assert.ok(!r.players[1].bench.some(b => b.iid === benchIid), '備戰的願增猿ex 應被 KO');
  assert.strictEqual(countRelief(r), 1,
    '卡面「這隻寶可夢受到…而昏厥時」無位置限定 ⇒ 備戰也要發動，實得 ' + countRelief(r));
  assert.strictEqual(r.players[0].prizes.length, 5, '獎賞 6→5');
});

T('A5 ★同一發 KO 兩隻願增猿ex（戰鬥位＋備戰）→ 各恰 1 次、共 2 次；獎賞 6→4', () => {
  const st = mk({ defActive: I(ID.MUNNA_EX, { damage: 100 }),
                  defBench: [I(ID.MUNNA_EX, { damage: 100 }), I(ID.MOMO_EX)] });
  const iids = [st.players[1].active.iid, st.players[1].bench[0].iid];
  let r = st;
  for (const iid of iids) {
    r = dealAttackDamageToTarget(r, 0, iid, 130, pool, { kind: 'attack-damage', label: '狙擊' });
  }
  r = drain(r);
  assert.strictEqual(countRelief(r), 2, '兩隻各 1 次＝2 次（不是 0、也不是 4），實得 ' + countRelief(r));
  assert.strictEqual(r.players[0].prizes.length, 4, '(2−1)+(2−1)=2 張 ⇒ 6→4');
});

console.log('\n── B. 依卡面**不該**觸發的原因（逐字：「受到對手的寶可夢招式的傷害而【昏厥】時」）──');

T('B1 效果 KO（koTargetByAttackEffect，非傷害）→ 不發動，獎賞照 2 張', () => {
  const st = mk({ defActive: I(ID.MUNNA_EX), defBench: [I(ID.MOMO_EX)] });
  const r = drain(koTargetByAttackEffect(st, 0, st.players[1].active, true, pool, '嗡嗡榍石'));
  assert.strictEqual(r.players[1].active, null, '效果 KO 應成立');
  assert.strictEqual(countRelief(r), 0, '效果 KO 不是「受到傷害而昏厥」⇒ 不可發動');
  assert.strictEqual(r.players[0].prizes.length, 4, '獎賞照 2 張（6→4）');
});

T('B2 放傷害指示物（attack-effect）KO → 不發動', () => {
  const st = mk({ defActive: I(ID.MUNNA_EX, { damage: 200 }), defBench: [I(ID.MOMO_EX)] });
  const r = drain(dealAttackDamageToTarget(st, 0, st.players[1].active.iid, 100, pool,
    { kind: 'attack-effect', label: '放置傷害指示物' }));
  assert.strictEqual(r.players[1].active, null, '應被 KO');
  assert.strictEqual(countRelief(r), 0, '放指示物≠受到傷害 ⇒ 不可發動');
  assert.strictEqual(r.players[0].prizes.length, 4, '獎賞照 2 張');
});

T('B3 中毒檢查階段 KO → 不發動（非「對手招式的傷害」）', () => {
  const st = mk({ defActive: I(ID.PIDGEY), defBench: [] });
  // 換成：自己(idx0)的願增猿ex 中毒致死，對手(idx1)取獎
  st.players[0].active = I(ID.MUNNA_EX, { damage: 200, status: 'poisoned' });
  st.players[0].bench = [I(ID.MOMO_EX)];
  const r = applyAction(st, { type: 'END_TURN' }, pool);
  assert.strictEqual(r.players[0].active, null, '中毒檢查應致死');
  assert.strictEqual(countRelief(r), 0, '中毒檢查 KO 不可發動鬆口氣');
  assert.strictEqual(r.players[1].prizes.length, 4, '對手照拿 2 張（6→4）');
});

T('B4 場上沒有桃歹郎ex → 不發動（卡面條件不成立）', () => {
  const st = mk({ defActive: I(ID.MUNNA_EX, { damage: 100 }), defBench: [I(ID.PIDGEY)] });
  const r = drain(dealAttackDamageToTarget(st, 0, st.players[1].active.iid, 130, pool,
    { kind: 'attack-damage', label: '狙擊' }));
  assert.strictEqual(countRelief(r), 0, '沒有桃歹郎ex 不可發動');
  assert.strictEqual(r.players[0].prizes.length, 4, '獎賞照 2 張');
});

T('B5 願增猿ex 的特性被消除（招式版暗夜羽擊旗標）→ 不發動', () => {
  const st = mk({ defActive: I(ID.MUNNA_EX, { damage: 100, abilityNullifiedThisTurn: true }),
                  defBench: [I(ID.MOMO_EX)] });
  const r = drain(dealAttackDamageToTarget(st, 0, st.players[1].active.iid, 130, pool,
    { kind: 'attack-damage', label: '狙擊' }));
  assert.strictEqual(countRelief(r), 0, '特性被消除時不可發動');
  assert.strictEqual(r.players[0].prizes.length, 4, '獎賞照 2 張');
});

T('B7 中央述詞單元測：koByAttackDamage=false ⇒ adjust 必為 0（含正對照 true ⇒ -1）', () => {
  assert.ok(typeof mod.koVictimAbilityPrizeAdjust === 'function',
    'effects.ts 沒有 export koVictimAbilityPrizeAdjust（v6.259 中央述詞不存在）');
  const st = mk({ defActive: I(ID.MUNNA_EX), defBench: [I(ID.MOMO_EX)] });
  const inst = st.players[1].active, card = pool.get(ID.MUNNA_EX);
  const yes = mod.koVictimAbilityPrizeAdjust(st, inst, card, 1, pool, true);
  assert.strictEqual(yes.adjust, -1, '正對照：受招式傷害昏厥 ⇒ -1');
  assert.strictEqual(yes.logs.length, 1, '正對照：要寫 1 行 log');
  const no = mod.koVictimAbilityPrizeAdjust(st, inst, card, 1, pool, false);
  assert.strictEqual(no.adjust, 0, '效果/指示物/檢查階段 KO ⇒ 0（呼叫端就算忘了 gate 也不能觸發）');
  assert.strictEqual(no.logs.length, 0, '不觸發時不可寫 log');
});

T('B6 正對照：一般寶可夢（無鬆口氣）被 KO ⇒ 兩條管線獎賞與 log 完全不受本次改動影響', () => {
  // ⚠ 防守方一定要留備戰，否則中央 helper 走「沒有可上場的寶可夢」game-over 提前 return
  const st1 = mk({ defActive: I(ID.PIDGEY), defBench: [I(ID.PIDGEY)] });
  const r1 = drain(applyAction(st1, { type: 'ATTACK', attackIndex: 1, actorIdx: 0 }, pool));
  assert.strictEqual(r1.players[0].prizes.length, 5, '咕咕＝1 獎賞（主管線 6→5）');
  assert.strictEqual(countRelief(r1), 0);
  const st2 = mk({ defActive: I(ID.PIDGEY), defBench: [I(ID.PIDGEY)] });
  const r2 = drain(dealAttackDamageToTarget(st2, 0, st2.players[1].active.iid, 300, pool,
    { kind: 'attack-damage', label: '狙擊' }));
  assert.strictEqual(r2.players[0].prizes.length, 5, '咕咕＝1 獎賞（中央 helper 6→5）');
  assert.strictEqual(countRelief(r2), 0);
});

console.log('\n── C. 結構／跨管線等價（真正防「下一張卡再踩一次」）──');
// ⚠ BASE 上沒有這張表 ⇒ 用斷言擋在前面，讓 C 項各自紅成 AssertionError（不是 TypeError 一次炸掉）
const needPKA = () => assert.ok(PASSIVE_KO_PRIZE_ADJUST instanceof Map,
  'effects.ts 沒有 export PASSIVE_KO_PRIZE_ADJUST（v6.259 的中央獎賞修正表不存在）');

T('C1 PASSIVE_ON_KO 與 PASSIVE_KO_PRIZE_ADJUST 名稱不可相交（相交＝同一效果掛兩個 hook＝雙觸發）', () => {
  needPKA();
  const inter = [...PASSIVE_KO_PRIZE_ADJUST.keys()].filter(n => PASSIVE_ON_KO.has(n));
  assert.deepStrictEqual(inter, [], '同時註冊在兩張表：' + inter.join('、'));
});

T('C2 下限斷言：PASSIVE_KO_PRIZE_ADJUST 必須含「鬆口氣」（表被清空＝守衛變安慰劑）', () => {
  needPKA();
  assert.ok(PASSIVE_KO_PRIZE_ADJUST.has('鬆口氣'),
    'PASSIVE_KO_PRIZE_ADJUST 必須註冊鬆口氣，實得 keys=' + [...PASSIVE_KO_PRIZE_ADJUST.keys()]);
  assert.ok(PASSIVE_KO_PRIZE_ADJUST.size >= 1);
});

T('C3 PASSIVE_KO_PRIZE_ADJUST 每個 key 都要有 static/cards 的卡面佐證（禁死條目／禁憑印象）', () => {
  needPKA();
  const bad = [];
  for (const name of PASSIVE_KO_PRIZE_ADJUST.keys()) {
    const hit = allCards.find(c => (c.abilities ?? []).some(a => a.name === name));
    if (!hit) { bad.push(`${name}：static/cards 找不到同名特性`); continue; }
    const eff = hit.abilities.find(a => a.name === name).effect ?? '';
    if (!eff.includes('獎賞卡')) bad.push(`${name}：卡面沒有「獎賞卡」字樣 ⇒ 不該放在獎賞修正表`);
    if (!eff.includes('昏厥')) bad.push(`${name}：卡面沒有「昏厥」字樣 ⇒ 不是 on-KO 型`);
    // 卡面寫「受到…傷害而【昏厥】」⇒ 必須只在 koByAttackDamage 生效（本檔 B1/B2/B3 已行為端驗）
    if (!eff.includes('傷害')) bad.push(`${name}：卡面沒有「傷害」字樣 ⇒ 觸發原因要重新判定`);
  }
  assert.deepStrictEqual(bad, [], bad.join(' / '));
});

T('C4 ★跨管線等價：PASSIVE_ON_KO 的每個成員，兩條管線 KO 後攻擊方獎賞/手牌張數必須一致', () => {
  needPKA();
  // 這條是「防再犯」的核心：任何 on-KO 效果只要對兩條管線表現不同，這裡就會紅。
  const bad = [];
  const names = [...PASSIVE_ON_KO.keys(), ...PASSIVE_KO_PRIZE_ADJUST.keys()];
  let checked = 0;
  for (const name of names) {
    const card = allCards.find(c => (c.abilities ?? []).some(a => a.name === name)
      && ['H', 'I', 'J'].includes(c.regulationMark) && c.hp);
    if (!card) continue;                       // 只維護 H/I/J
    checked++;
    const hp = Number(card.hp);
    const mkOne = () => mk({
      defActive: I(card.id, { damage: hp - 10 }),
      defBench: [I(ID.MOMO_EX)],               // 讓鬆口氣的條件成立
    });
    // P1：引擎主管線（超級勇氣 270）
    const p1 = drain(applyAction(mkOne(), { type: 'ATTACK', attackIndex: 1, actorIdx: 0 }, pool));
    // P2：中央 dealAttackDamageToTarget（同樣 270）
    const s2 = mkOne();
    const p2 = drain(dealAttackDamageToTarget(s2, 0, s2.players[1].active.iid, 270, pool,
      { kind: 'attack-damage', label: '狙擊' }));
    if (p1.players[1].active !== null || p2.players[1].active !== null) {
      bad.push(`${name}(${card.name})：fixture 沒把它打死，測試無效`); continue;
    }
    if (p1.players[0].prizes.length !== p2.players[0].prizes.length) {
      bad.push(`${name}(${card.name})：攻擊方剩餘獎賞 主管線=${p1.players[0].prizes.length} vs 中央helper=${p2.players[0].prizes.length}`);
    }
    if (p1.players[0].hand.length !== p2.players[0].hand.length) {
      bad.push(`${name}(${card.name})：攻擊方手牌 主管線=${p1.players[0].hand.length} vs 中央helper=${p2.players[0].hand.length}`);
    }
  }
  assert.ok(checked >= 3, `跨管線等價至少要驗到 3 個 on-KO 特性，實得 ${checked}（＝守衛沒測到東西）`);
  assert.deepStrictEqual(bad, [], bad.join(' / '));
});

T('C5 源碼掃描：PASSIVE_ON_KO 的登錄區塊內不得直接改寫獎賞（prizes:）', () => {
  const src = readFileSync(join(ROOT, 'src/lib/game/effects.ts'), 'utf8');
  const start = src.indexOf('export const PASSIVE_ON_KO = new Map');
  assert.ok(start > 0, '找不到 PASSIVE_ON_KO 宣告（掃描器自身失效）');
  const end = src.indexOf('\n]);', start);
  assert.ok(end > start, '找不到 PASSIVE_ON_KO 結尾');
  const block = src.slice(start, end);
  assert.ok(!/\bprizes\s*:/.test(block),
    '⚠ PASSIVE_ON_KO 內出現 prizes: 寫入 —— 獎賞修正一律改用 PASSIVE_KO_PRIZE_ADJUST（否則兩條管線順序不同會分岔）');
  // 正對照（防「找不到區塊就綠燈」）：獎賞修正表裡**確實**看得到 adjust
  const s2 = src.indexOf('export const PASSIVE_KO_PRIZE_ADJUST = new Map');
  assert.ok(s2 > 0, '找不到 PASSIVE_KO_PRIZE_ADJUST 宣告');
  assert.ok(/adjust:\s*-1/.test(src.slice(s2, src.indexOf('\n]);', s2))),
    '正對照失敗：獎賞修正表裡應該看得到 adjust: -1');
});

T('C6 兩條「算獎賞」管線都要呼叫同一支中央述詞（少接一邊＝這次的 bug 復發）', () => {
  const eff = readFileSync(join(ROOT, 'src/lib/game/effects.ts'), 'utf8');
  const eng = readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8');
  const nEff = (eff.match(/koVictimAbilityPrizeAdjust\(/g) || []).length;
  const nEng = (eng.match(/koVictimAbilityPrizeAdjust\(/g) || []).length;
  assert.ok(nEff >= 2, `effects.ts 應有「宣告 1 + koPrizesAdjusted 呼叫 1」共 ≥2 處，實得 ${nEff}`);
  assert.strictEqual(nEng, 1, `engine.ts 主管線應恰好呼叫 1 次（多於 1 次＝可能雙套），實得 ${nEng}`);
});

console.log(`\n=== v6.259 KO 獎賞修正中央收斂：PASS ${pass} / FAIL ${fails.length} ===`);
if (fails.length) { for (const f of fails) console.log('  - ' + f); process.exit(1); }
