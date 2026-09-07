/**
 * v6.256 守衛 —「這隻寶可夢受到的招式的傷害」中央收斂
 *
 * 【卡面】超級赫拉克羅斯ex｜重裝角擊 100+（M2 `14322` / `18578`，I 標，HP280）
 *   逐字：「增加與在上個對手的回合這隻寶可夢受到的招式的傷害相同數值的傷害。」
 *   這是 `CardInstance.damageTakenLastOppTurn` **全 src 唯一的讀取點**
 *   （`src/lib/game/effects/cards/v2690_i_wave19_engine_hooks.ts:23`）。
 *
 * 【v6.256 修的 bug】BASE 20d4d6df 的實測（scripts 內同樣的流程）：
 *   engine 主管線有記；`dealAttackDamageToTarget` 的**一般**分支有記；
 *   其餘 **6 條**全部漏記 ⇒ 玩家被狙擊／多目標／全備戰招式打到後，
 *   下個自己回合的重裝角擊會少算：
 *     1. dealAttackDamageToTarget 的**防 KO** 分支（提早 `return _pk.state`）
 *     2. `snipe-multi`（鐵頭殼ex｜雙刃劍 等）— 一般與防 KO 都沒記
 *     3. `clone-strike-multi-hit`（甲賀忍蛙ex｜分身連打／吼叫尾｜大吼大叫）— 同上
 *     4. `hitBenchAll`（古鼎鹿｜大地斷裂／穿山王｜地震 等）
 *     5. `hitBenchPickPost`（三首惡龍ex｜黑曜石 等）
 *     6. `snipe-60-ex`（謝米｜精刺奇襲）
 *
 * 【修法】收斂成 `effects/_shared.ts` 的 `withAttackDamageTaken(inst, prevDamage, newDamage, kind)`
 *   —— 全站唯一寫入點。記法沿用 v6.255 站長裁定（逐字：「改成實際扣到的」）＋官方
 *   `PTCG RULES/PTCG_RULES.md` L1933-1934：防 KO 成功時記「實際扣到的」（HP−leaveHP 的差額），
 *   非防 KO 記全額。放置傷害指示物（attack-effect）不是「受到傷害」，不計。
 *
 * 【累計語意】卡面「受到的招式的傷害」= 上個對手回合內的**總和**（v6.253 B9／v6.255 C5
 *   已是此語意，本版不改變）；多目標時**各自記各自的**（per-instance）。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
import { stripCommentsBlankChecked, stripCommentsBlank } from './lib/strip-comments.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const E = join(ROOT, '.v6256-e.ts'), O = join(ROOT, '.v6256-o.mjs'), S = join(ROOT, '.v6256-s.mjs');
process.on('exit', () => { for (const p of [E, O, S]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, `export { applyAction } from './src/lib/game/engine';
export { dealAttackDamageToTarget } from './src/lib/game/effects';
export { ATTACK_PRE } from './src/lib/game/effects/_shared';
export { withAttackDamageTaken } from './src/lib/game/effects/_shared';
import './src/lib/game/effects';`);
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const M = await import(pathToFileURL(O).href);
const { applyAction, dealAttackDamageToTarget, ATTACK_PRE, withAttackDamageTaken } = M;

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
const liveCards = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
    if (c?.id == null) continue;
    pool.set(String(c.id), c);
    if (['H', 'I', 'J'].includes(c.regulationMark)) liveCards.push(c);
  }
}

const ID = {
  HERA: '14322',    // 超級赫拉克羅斯ex（重裝角擊＝attacks[0]・HP280・I）
  CROW: '14133',    // 烏鴉頭頭（狙擊羽毛＝attacks[1] → snipe-120 → dealAttackDamageToTarget）
  DEER: '10294',    // 古鼎鹿（大地斷裂＝attacks[0] → hitBenchAll，需場上有競技場）
  HYDRA: '11252',   // 三首惡龍ex（黑曜石＝attacks[1] → hitBenchPickPost 對手備戰2隻各130）
  IRON: '16832',    // 鐵頭殼ex（雙刃劍＝attacks[0] → snipe-multi 2隻各50・flat）
  FROG: '10292',    // 甲賀忍蛙ex（分身連打＝attacks[1] → clone-strike-multi-hit 2隻各120）
  SHAY: '9776',     // 謝米（精刺奇襲＝attacks[0] → snipe-60-ex 對手備戰【ex】60）
  HAWL: '14754',    // 超級摔角鷹人ex（堅忍之軀・擲幣防KO・HP250・卡面無滿血限制）
  CRAB: '13741',    // 岩殿居蟹（結實・HP150・要求滿血）
  PIKA: '14704',    // 皮卡丘ex（勤奮之心・HP200）
  DIALGA: '11072',  // 帝牙盧卡（光炮尾 160＝attacks[1]，engine 主管線用）
  UBO: '17976',     // 帕底亞 烏波（HP60・Basic・無特性）
  STADIUM: '14081', // 活力森林（競技場，大地斷裂的前提）
  eG: '14102', eP: '14103', eF: '14104', eD: '14430', eM: '14434', eW: '18519',
};

let nn = 0;
const inst = (cid, e = [], x = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: e, ...x });
const en = (cid) => ({ iid: 'e' + (++nn), cardId: String(cid), damage: 0, energyAttached: [] });
const mkP = (name, active, bench = []) => ({ name, active, bench, hand: [],
  deck: Array.from({ length: 12 }, () => en(ID.eP)), discard: [],
  prizes: Array.from({ length: 6 }, () => en(ID.eP)) });
const mkS = (p0, p1, stadium = null) => ({ phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, turn: 5,
  isFirstTurn: false, firstPlayerIdx: 0, setupDone: [true, true], pendingMulliganDraw: [0, 0],
  pendingPrizes: [0, 0], log: [], pendingSelection: null,
  activeStadium: stadium ? inst(stadium) : null, players: [p0, p1] });

let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  PASS', n); pass++; } catch (e) {
  if (e instanceof assert.AssertionError) { console.log('  FAIL', n, '::', e.message); fail++; } else { throw e; } } };

/** ATTACK → 反覆用 pick() 回答 pendingSelection（pick 回 null 代表停手）。 */
function drive(s, action, pick = () => null) {
  let st = applyAction(s, action, pool);
  let guard = 0;
  while (st.pendingSelection && guard++ < 8) {
    const iids = pick(st.pendingSelection, st);
    if (iids === null) break;
    st = applyAction(st, { type: 'RESOLVE_SELECTION', selectedIids: iids }, pool);
  }
  return st;
}
const find = (st, cardId) => [st.players[1].active, ...st.players[1].bench].filter(Boolean)
  .find(c => c.cardId === String(cardId));

// ══════════════════════════════════════════════════════════════════════
console.log('A. 卡面前提（唯一讀取點／fixture 卡面逐字）');

T('A1 ⭐重裝角擊：live H/I/J 恰好 2 張印刷，卡面逐字未變', () => {
  const hits = liveCards.filter(c => (c.attacks ?? []).some(a => a.name === '重裝角擊'));
  assert.equal(hits.length, 2, `重裝角擊印刷張數應為 2，實得 ${hits.length}`);
  assert.deepEqual(hits.map(c => String(c.id)).sort(), ['14322', '18578']);
  for (const c of hits) {
    assert.equal(c.name, '超級赫拉克羅斯ex');
    assert.equal(c.regulationMark, 'I');
    assert.equal(c.hp, 280);
    const a = c.attacks.find(x => x.name === '重裝角擊');
    assert.equal(a.damage, '100+');
    assert.equal(a.effect, '增加與在上個對手的回合這隻寶可夢受到的招式的傷害相同數值的傷害。');
  }
});

T('A2 ⭐fixture 卡面逐字（六條管線的代表卡；卡面變了就必須重新評估管線歸類）', () => {
  const check = (id, name, atkIdx, atkName, effectHas) => {
    const c = pool.get(String(id));
    assert.ok(c, `${id} 不在 live 卡池`);
    assert.equal(c.name, name, `${id} 卡名變了`);
    const a = c.attacks[atkIdx];
    assert.equal(a.name, atkName, `${id} attacks[${atkIdx}] 變了`);
    assert.ok(a.effect.includes(effectHas), `${name}｜${atkName} 卡面不含「${effectHas}」（實際：${a.effect}）`);
  };
  check(ID.CROW, '烏鴉頭頭', 1, '狙擊羽毛', '對手的1隻寶可夢受到120點傷害');
  check(ID.DEER, '古鼎鹿', 0, '大地斷裂', '對手的所有備戰寶可夢也各受到30點傷害');
  check(ID.HYDRA, '三首惡龍ex', 1, '黑曜石', '對手的2隻備戰寶可夢也各受到130點傷害');
  check(ID.IRON, '鐵頭殼ex', 0, '雙刃劍', '對手的2隻寶可夢各受到50點傷害');
  check(ID.FROG, '甲賀忍蛙ex', 1, '分身連打', '對手的2隻寶可夢各受到120點傷害');
  check(ID.SHAY, '謝米', 0, '精刺奇襲', '受到60點傷害');
  // 防 KO 特性卡面（v6.255 已驗，這裡只確認前提沒被動過）
  const hawl = pool.get(ID.HAWL);
  assert.ok(hawl.abilities.some(a => a.name === '堅忍之軀' && a.effect.includes('以剩餘HP為「10」的狀態留在場上')),
    '堅忍之軀卡面變了');
});

// ══════════════════════════════════════════════════════════════════════
console.log('B. 行為端：**每一條**傷害管線都要真的記到（HEAD 逐條紅）');

const atkDialga = () => inst(ID.DIALGA, [en(ID.eP), en(ID.eM), en(ID.eP)]);

T('B1 ⭐正對照：engine 主管線一般單體攻擊 ＝ 全額（v6.255 行為逐位元不變）', () => {
  const s = mkS(mkP('P0', atkDialga(), [inst(ID.UBO)]), mkP('P1', inst(ID.PIKA), [inst(ID.UBO)]));
  const r = applyAction(s, { type: 'ATTACK', attackIndex: 1, actorIdx: 0 }, pool);
  assert.equal(r.players[1].active.damage, 160);
  assert.equal(r.players[1].active.damageTakenLastOppTurn, 160, 'engine 一般情況必須仍是全額');
});

T('B2 ⭐正對照：engine 主管線防 KO ＝ 實際扣到的（v6.255 裁定不可被改壞）', () => {
  const s = mkS(mkP('P0', atkDialga(), [inst(ID.UBO)]), mkP('P1', inst(ID.CRAB), [inst(ID.UBO)]));
  const r = applyAction(s, { type: 'ATTACK', attackIndex: 1, actorIdx: 0 }, pool);
  assert.equal(r.players[1].active.damage, 140, '結實留 HP10 ⇒ 指示物 140');
  assert.equal(r.players[1].active.damageTakenLastOppTurn, 140, '必須是 140 不是全額 160');
});

const crowAttack = (defBench, pick) => {
  const s = mkS(mkP('P0', inst(ID.CROW, [en(ID.eD), en(ID.eD), en(ID.eD)]), [inst(ID.UBO)]),
                mkP('P1', inst(ID.UBO), [defBench]));
  const tIid = s.players[1].bench[0].iid;
  return drive(s, { type: 'ATTACK', attackIndex: 1, actorIdx: 0 }, (pd, st) => {
    if (pd.effectKey === 'snipe-120') return [tIid];
    return st.players[0].active.energyAttached.slice(0, 2).map(e => e.iid);  // 丟 2 能量
  });
};

T('B3 ⭐正對照：dealAttackDamageToTarget 一般分支（狙擊備戰 120）本來就有記', () => {
  const r = crowAttack(inst(ID.HERA));
  assert.equal(find(r, ID.HERA)?.damageTakenLastOppTurn, 120);
});

T('B4 ⭐⭐⭐dealAttackDamageToTarget **防 KO** 分支（HEAD：完全漏記＝undefined）', () => {
  const ORND = Math.random; Math.random = () => 0.1;  // 堅忍之軀正面
  try {
    const r = crowAttack(inst(ID.HAWL, [], { damage: 200 }));
    const t = find(r, ID.HAWL);
    assert.equal(t?.damage, 240, '堅忍之軀留 HP10 ⇒ 指示物 240');
    assert.equal(t?.damageTakenLastOppTurn, 40, '實際扣到 240−200＝40（HEAD 是 undefined）');
  } finally { Math.random = ORND; }
});

T('B5 ⭐⭐⭐snipe-multi（鐵頭殼ex｜雙刃劍 2×50）（HEAD：undefined）', () => {
  const s = mkS(mkP('P0', inst(ID.IRON, [en(ID.eP), en(ID.eP), en(ID.eP)]), [inst(ID.UBO)]),
                mkP('P1', inst(ID.UBO), [inst(ID.HERA)]));
  const hera = s.players[1].bench[0].iid, act = s.players[1].active.iid;
  const r = drive(s, { type: 'ATTACK', attackIndex: 0, actorIdx: 0 }, () => [hera, act]);
  assert.equal(find(r, ID.HERA)?.damageTakenLastOppTurn, 50);
});

T('B6 ⭐⭐⭐clone-strike-multi-hit（甲賀忍蛙ex｜分身連打 120）（HEAD：undefined）', () => {
  const s = mkS(mkP('P0', inst(ID.FROG, [en(ID.eW), en(ID.eW), en(ID.eW)]), [inst(ID.UBO)]),
                mkP('P1', inst(ID.UBO), [inst(ID.HERA)]));
  const hera = s.players[1].bench[0].iid;
  const r = drive(s, { type: 'ATTACK', attackIndex: 1, actorIdx: 0 }, (pd, st) => {
    if (pd.effectKey === 'clone-strike-multi-hit') return [hera];
    return st.players[0].active.energyAttached.slice(0, 2).map(e => e.iid);
  });
  assert.equal(find(r, ID.HERA)?.damageTakenLastOppTurn, 120);
});

T('B7 ⭐⭐⭐hitBenchAll（古鼎鹿｜大地斷裂 對手全備戰 30）（HEAD：undefined）', () => {
  const s = mkS(mkP('P0', inst(ID.DEER, [en(ID.eF)]), [inst(ID.UBO)]),
                mkP('P1', inst(ID.UBO), [inst(ID.HERA)]), ID.STADIUM);
  const r = drive(s, { type: 'ATTACK', attackIndex: 0, actorIdx: 0 });
  assert.equal(find(r, ID.HERA)?.damageTakenLastOppTurn, 30);
});

T('B8 ⭐⭐⭐hitBenchPickPost（三首惡龍ex｜黑曜石 備戰 130）（HEAD：undefined）', () => {
  const s = mkS(mkP('P0', inst(ID.HYDRA, [en(ID.eP), en(ID.eD), en(ID.eM), en(ID.eP)]), [inst(ID.UBO)]),
                mkP('P1', inst(ID.UBO), [inst(ID.HERA), inst(ID.UBO)]));
  const a = s.players[1].bench[0].iid, b = s.players[1].bench[1].iid;
  const r = drive(s, { type: 'ATTACK', attackIndex: 1, actorIdx: 0 }, () => [a, b]);
  assert.equal(find(r, ID.HERA)?.damageTakenLastOppTurn, 130);
});

T('B9 ⭐⭐⭐snipe-60-ex（謝米｜精刺奇襲 60）（HEAD：undefined）', () => {
  const s = mkS(mkP('P0', inst(ID.SHAY, [en(ID.eG)]), [inst(ID.UBO)]),
                mkP('P1', inst(ID.UBO), [inst(ID.HERA)]));
  const hera = s.players[1].bench[0].iid;
  const r = drive(s, { type: 'ATTACK', attackIndex: 0, actorIdx: 0 }, () => [hera]);
  assert.equal(find(r, ID.HERA)?.damageTakenLastOppTurn, 60);
});

T('B10 ⭐⭐⭐端到端：備戰赫拉克羅斯被 hitBenchAll 打 30 → 上場用重裝角擊 ＝ 130（HEAD：100）', () => {
  const s = mkS(mkP('P0', inst(ID.DEER, [en(ID.eF)]), [inst(ID.UBO)]),
                mkP('P1', inst(ID.UBO), [inst(ID.HERA)]), ID.STADIUM);
  const r = drive(s, { type: 'ATTACK', attackIndex: 0, actorIdx: 0 });
  const hera = r.players[1].bench.find(c => c.cardId === ID.HERA);
  assert.ok(hera, '赫拉克羅斯應還在備戰');
  const p1 = { ...r.players[1], active: { ...hera, energyAttached: [en(ID.eG), en(ID.eG)] },
               bench: r.players[1].bench.filter(c => c.iid !== hera.iid) };
  const st2 = { ...r, activePlayerIndex: 1, players: [r.players[0], p1] };
  const out = ATTACK_PRE.get('超級赫拉克羅斯ex|重裝角擊')(st2, 1, pool, {});
  assert.equal(out.damage, 130, '100 + 備戰受到的 30');
});

T('B11 ⭐⭐負對照：放置傷害指示物（attack-effect）**不算**「受到的招式的傷害」', () => {
  const s = mkS(mkP('P0', inst(ID.UBO), [inst(ID.UBO)]), mkP('P1', inst(ID.HERA), [inst(ID.UBO)]));
  const r = dealAttackDamageToTarget(s, 0, s.players[1].active.iid, 50, pool,
    { kind: 'attack-effect', label: '放指示物' });
  assert.equal(r.players[1].active.damage, 50, '指示物仍要放上去');
  assert.equal(r.players[1].active.damageTakenLastOppTurn, undefined, 'attack-effect 不得計入');
});

T('B12 ⭐中央 helper 單元語意（治療型 leaveHP 高於受招前 ⇒ 不算受到傷害）', () => {
  const base = { iid: 'x', cardId: ID.HERA, damage: 100, energyAttached: [] };
  assert.equal(withAttackDamageTaken(base, 100, 160, 'attack-damage').damageTakenLastOppTurn, 60);
  assert.equal(withAttackDamageTaken(base, 100, 80, 'attack-damage').damageTakenLastOppTurn, undefined,
    'newDamage < prevDamage ⇒ Math.max(0,…) ⇒ 不寫');
  assert.equal(withAttackDamageTaken(base, 100, 160, 'attack-effect').damageTakenLastOppTurn, undefined);
  assert.equal(withAttackDamageTaken({ ...base, damageTakenLastOppTurn: 30 }, 100, 160, 'attack-damage')
    .damageTakenLastOppTurn, 90, '累計語意：既有 30 ＋ 這一下 60');
  assert.equal(withAttackDamageTaken(base, 100, 160, 'attack-damage').damage, 160, 'damage 一定要寫');
});

// ══════════════════════════════════════════════════════════════════════
console.log('C. lint：唯一寫入點（含下限斷言與正對照）');

// ⭐v6.325 批2：區塊註解剝除改走中央 helper（scripts/lib/strip-comments.mjs 的行級狀態機）。
//   ⚠ 原本的 `/\/\*[\s\S]*?\*\//g` 會被**行註解裡的** `cards/*.ts` 這種字樣騙開假區塊：
//     effects.ts 有兩處（:27 的 `effects/cards/*.ts` 吃到 :147、:7905 的 `cards/*.ts` 吃到 :8203），
//     合計把 273 行真程式碼變成空白 ⇒ 掃在那段裡的違規一律靜默漏掉。
//   ⚠ 一律用**等長留白**版（不是刪行版）：本檔靠行號／位移回報，刪行會讓行號整體位移。
//   ⚠ 行尾 `//` 的處理**保留在這裡** —— 中央 helper 只剝行首 `//`，正向斷言目標若落在
//     行尾註解裡會假綠。行尾正則是單行、不跨行 ⇒ 不會像區塊正則那樣開洞。
const strip = (s, label = '') => stripCommentsBlankChecked(s, { label }).replace(/\/\/.*$/gm, '');
const SRC = {
  engine: strip(readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8'), 'engine.ts'),
  effects: strip(readFileSync(join(ROOT, 'src/lib/game/effects.ts'), 'utf8'), 'effects.ts'),
  shared: strip(readFileSync(join(ROOT, 'src/lib/game/effects/_shared.ts'), 'utf8'), 'effects/_shared.ts'),
  types: strip(readFileSync(join(ROOT, 'src/lib/game/types.ts'), 'utf8'), 'types.ts'),
  hook: strip(readFileSync(join(ROOT, 'src/lib/game/effects/cards/v2690_i_wave19_engine_hooks.ts'), 'utf8'), 'v2690 hook'),
};
// 「寫入」樣式 = 出現 `damageTakenLastOppTurn:` 當物件鍵（型別宣告用 `?:`，另外排除）
const WRITE_RE = /(?<!\?)\bdamageTakenLastOppTurn:\s/g;

T('C1 ⭐⭐⭐除了 _shared.ts 的中央 helper，全 src 不得有第二個寫入點（＋正對照＋下限）', () => {
  // 下限斷言：掃描器至少要看得到唯一讀取點與型別宣告，否則就是讀錯檔／regex 壞了
  const totalMentions = Object.values(SRC).join('\n').split('damageTakenLastOppTurn').length - 1;
  // ⭐v6.325：下限自 5 收緊到 6（實測 6）。
  assert.ok(totalMentions >= 6, `掃描器下限：全檔提及次數應 ≥6，實得 ${totalMentions}（掃描器壞了？）`);
  assert.ok(/damageTakenLastOppTurn\?: number;/.test(SRC.types), 'types.ts 欄位宣告不見了');
  assert.ok(/const dmgTaken = a\?\.damageTakenLastOppTurn \?\? 0;/.test(SRC.hook), '唯一讀取點（重裝角擊）不見了');
  // 正對照：樣式真的抓得到違規樣本（否則就是恆真的安慰劑）
  assert.equal(('x = { ...c, damageTakenLastOppTurn: 1 };'.match(WRITE_RE) ?? []).length, 1,
    'C1 樣式抓不到已知違規樣本＝安慰劑');
  assert.equal(('  damageTakenLastOppTurn?: number;'.match(WRITE_RE) ?? []).length, 0,
    'C1 樣式誤把型別宣告當寫入');
  // 本體
  for (const [name, src] of [['engine.ts', SRC.engine], ['effects.ts', SRC.effects], ['v2690 hook', SRC.hook]]) {
    const hits = src.match(WRITE_RE) ?? [];
    assert.equal(hits.length, 0,
      `${name} 直接寫 damageTakenLastOppTurn ${hits.length} 次 ⇒ 繞過中央 withAttackDamageTaken（v6.256 收斂被破壞）`);
  }
  const sharedHits = SRC.shared.match(WRITE_RE) ?? [];
  assert.equal(sharedHits.length, 1, `_shared.ts 的中央寫入點應恰好 1 處，實得 ${sharedHits.length}`);
});

T('C2 ⭐⭐中央 helper 的算式與所有消費端（＋下限斷言＋正對照）', () => {
  assert.ok(/const actual = Math\.max\(0, newDamage - prevDamage\);/.test(SRC.shared),
    '「實際扣到的」算式（newDamage − prevDamage）不見了');
  assert.ok(/if \(kind !== 'attack-damage' \|\| actual <= 0\) return \{ \.\.\.inst, damage: newDamage \};/.test(SRC.shared),
    'kind gate／actual>0 gate 不見了 ⇒ 放指示物會被誤計為「受到的傷害」');
  const calls = (SRC.engine + '\n' + SRC.effects).match(/withAttackDamageTaken\(/g) ?? [];
  // ⭐v6.325：下限自 10 收緊到 11（實測 12）。
  assert.ok(calls.length >= 11,
    `withAttackDamageTaken 呼叫點只剩 ${calls.length} 個（應 ≥11）⇒ 有管線被拔掉`);
  assert.ok(/withAttackDamageTaken\(defenderState\.active!, _damageBeforeThisAttack, _survivedDamage, 'attack-damage'\)/.test(SRC.engine),
    'engine 主管線沒有走中央寫入點');
  // 正對照
  assert.equal(('a = withAttackDamageTaken(c, c.damage, n, k);'.match(/withAttackDamageTaken\(/g) ?? []).length, 1,
    'C2 呼叫點樣式恆假＝安慰劑');
});

T('C3 ⭐⭐防 KO 中央 helper 的三個呼叫端都必須宣告 kind（＋正對照）', () => {
  // 抽取所有 applyPreventKOToVictim(...) 的實參（單行寫法，anchor 為右括號）
  const re = /applyPreventKOToVictim\(([^;]*?)\)\s*;/g;
  // ⭐v6.260：備戰 KO 路徑補防 KO（hitBenchAll／bench-hit-N／snipe-60-ex）＋ mega_decks 的
  //   olive-oil-distribute ⇒ effects.ts 6 個、mega_decks.ts 1 個。每個都必須宣告 kind（下方檢查）。
  // ⭐v6.325：這一份原本**沒有剝註解**（與同函式其他來源不一致）⇒ 一併收進中央 helper。
  const megaSrc = strip(readFileSync(join(ROOT, 'src/lib/game/effects/cards/mega_decks.ts'), 'utf8'), 'mega_decks.ts');
  const sites = [...SRC.effects.matchAll(re)].map(m => m[1]);
  const megaSites = [...megaSrc.matchAll(re)].map(m => m[1]);
  assert.equal(sites.length, 6,
    `applyPreventKOToVictim effects.ts 呼叫端應恰好 6 個（dealAttackDamageToTarget／snipe-multi／clone-strike-multi-hit／` +
    `hitBenchAll／bench-hit-N／snipe-60-ex），實得 ${sites.length} ⇒ 新增了管線就必須回來讀卡面決定 kind`);
  assert.equal(megaSites.length, 1,
    `applyPreventKOToVictim mega_decks.ts 呼叫端應恰好 1 個（olive-oil-distribute），實得 ${megaSites.length}`);
  sites.push(...megaSites);
  for (const args of sites) {
    const n = args.split(',').length;
    assert.equal(n, 7, `applyPreventKOToVictim 呼叫端只有 ${n} 個參數（缺 kind）：${args.trim()}`);
  }
  // 正對照：6 參數的舊樣本必須被抓出來
  const badSrc = 'const _pk = applyPreventKOToVictim(st, targetNow, targetCard, dIdx, effDmg, pool);';
  const bad = [...badSrc.matchAll(re)].map(m => m[1]);
  assert.equal(bad.length, 1, 'C3 抽取器抓不到已知樣本＝安慰劑');
  assert.equal(bad[0].split(',').length, 6, 'C3 參數計數壞了');
  // 且宣告端必須是必填（沒有 `?:` 也沒有預設值）
  assert.ok(/kind: DamageKind,\n\): \{ prevented: boolean; state: GameState \} \{/.test(SRC.effects),
    'applyPreventKOToVictim 的 kind 參數不再是必填 ⇒ 新呼叫端可以靜默漏掉');
});

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILED'}  pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
