// ⭐⭐v6.493 守衛：全站稽核（中央昏厥管線）找到的缺口
//
// B1（v6.490 回歸）：同一招打昏多隻時，「持有者型」獎賞修正以**宣告當時**判定（比照花之帷幔，as-of-declaration.ts）。
//   官方 PTCG_RULES.md L1665：多龍巴魯托ex｜幻影奇襲 打昏戰鬥位的願增猿ex（鬆口氣）＋ 放 6 個指示物打昏備戰剩 60 的桃歹郎ex
//   ⇒ 自己獲得的獎賞卡「為3張」。v6.490 起戰鬥位受害者延後到效果結束才結算，桃歹郎ex 已先離場 ⇒ 曾算成 4 張。
//   影藏同型（稽核 A9）：戰鬥位【惡】桃歹郎＋備戰超級耿鬼ex 被同一招打昏 ⇒ 桃歹郎那一份仍要 -1。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.v6493-s.mjs'), E = join(ROOT, '.v6493-e.ts'), O = join(ROOT, '.v6493-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { createGame, applyAction } from './src/lib/game/engine';\n");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };
const need = (id, name) => { assert.equal(pool.get(id)?.name, name, `fixture：${id} 應為 ${name}`); return id; };
const DRAGA = need('17019', '多龍巴魯托ex'), ZARU = need('11628', '願增猿ex'), MOMOEX = need('11630', '桃歹郎ex');
const MOMO = need('11255', '桃歹郎'), GENGAR = need('15978', '超級耿鬼ex'), KOKO = need('12116', '卡璞・鳴鳴ex');
const DEF = '13163';
const MANKEY = need('11242', '棄世猴'), HAXO = need('17014', '雙斧戰龍'), GLACE = need('16633', '冰伊布ex');
const MOON = need('11626', '轟鳴月ex'), REVERSE = need('11171', '反轉能量'), CARVANHA = need('14422', '利牙魚');
const SHED = need('14063', '脫殼忍者'), OKIDOGI_LIKE = need('14774', '吉雉雞ex');
const AZELF = need('11228', '由克希'), KISS = need('11227', '波克基斯'), CACNEA = need('13698', '沙鈴仙人掌');
const basicE = (t) => String([...pool.values()].find(c => c.supertype === 'Energy' && c.subtype === 'Basic' && c.name === `基本【${t}】能量`)?.id);
const FIRE = basicE('火'), PSY = basicE('超');
const hpOf = (id) => Number(pool.get(id).hp);
const GRASS = basicE('草'), WATERE = basicE('水'), DARK = basicE('惡'), FIGHTE = basicE('鬥');
// 依序回傳的亂數（< 0.5 ＝ 正面）；用完之後一律正面
const withRandoms = (seq, fn) => { const o = Math.random; let k = 0; Math.random = () => (k < seq.length ? seq[k++] : 0.1); try { return fn(); } finally { Math.random = o; } };
const takenBy = (s, i) => 6 - s.players[i].prizes.length;
const kissed = (s) => s.log.some(l => /奇跡之吻/.test(l.message));
const atkIdx = (id, name) => pool.get(id).attacks.findIndex(a => a.name === name);
const withHeads = (fn) => { const o = Math.random; Math.random = () => 0.1; try { return fn(); } finally { Math.random = o; } };
const PHANTOM = pool.get(DRAGA).attacks.findIndex(a => a.name === '幻影奇襲');
assert.ok(PHANTOM >= 0, 'fixture：幻影奇襲');
let nn = 0; const inst = (cid, x = {}) => ({ iid: 'v93_' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], ...x });
function board(p0, p1) {
  const s = createGame({ name: 'P1', entries: [{ cardId: DEF, count: 1 }] }, { name: 'P2', entries: [{ cardId: DEF, count: 1 }] }, pool);
  return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, isFirstTurn: false, turn: 5, log: [],
    setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], pendingSelection: null,
    players: [
      { ...s.players[0], hand: [], deck: [inst(DEF), inst(DEF)], discard: [], prizes: Array.from({ length: 6 }, () => inst(DEF)), bench: [], ...p0 },
      { ...s.players[1], hand: [], deck: [inst(DEF)], discard: [], prizes: Array.from({ length: 6 }, () => inst(DEF)), bench: [], ...p1 }] };
}
const taken = (s) => 6 - s.players[0].prizes.length;
// 幻影奇襲：戰鬥位 200 ＋ 6 個指示物全放在 benchTarget
function phantom(defActive, benchTarget, extraBench = [inst(KOKO)]) {
  let s = board({ active: inst(DRAGA, { energyAttached: [inst(FIRE), inst(PSY)] }) },
                { active: defActive, bench: [benchTarget, ...extraBench] });
  s = applyAction(s, { type: 'ATTACK', attackIndex: PHANTOM }, pool);
  assert.ok(s.pendingSelection, '前置：幻影奇襲應開指示物分配視窗');
  assert.equal(taken(s), 0, '前置：分配指示物之前不可以先取獎賞');
  s = applyAction(s, { type: 'RESOLVE_SELECTION', senderIdx: 0, actorIdx: 0, effectKey: s.pendingSelection.effectKey,
    selectedIids: Array.from({ length: 6 }, () => benchTarget.iid) }, pool);
  assert.equal(s.pendingSelection ?? null, null, '結算後不應還有待選視窗');
  assert.equal(s._pendingAttackKo, undefined, '_pendingAttackKo 不可殘留');
  return s;
}

console.log('── B1 鬆口氣（官方 L1665）──');
T('B1a 願增猿ex（戰鬥位）＋ 桃歹郎ex（備戰剩 60）同一招昏厥 ⇒ 3 張', () => {
  const s = phantom(inst(ZARU, { damage: 20 }), inst(MOMOEX, { damage: 130 }));
  assert.ok(s.players[1].discard.some(c => c.cardId === MOMOEX), '前置：桃歹郎ex 應已昏厥');
  assert.ok(s.players[1].discard.some(c => c.cardId === ZARU), '前置：願增猿ex 應已昏厥');
  assert.equal(taken(s), 3);
  assert.ok(s.log.some(l => /鬆口氣/.test(l.message)), '應有鬆口氣的 log');
});
T('B1b 正對照：桃歹郎ex 沒昏厥（仍在場）⇒ 願增猿ex 1 張', () => {
  const s = phantom(inst(ZARU, { damage: 20 }), inst(MOMOEX));
  assert.equal(taken(s), 1);
});
T('B1c 反對照：備戰是非 ex 的「桃歹郎」⇒ 鬆口氣不生效 ⇒ 2＋1＝3 張且沒有鬆口氣 log', () => {
  const s = phantom(inst(ZARU, { damage: 20 }), inst(MOMO, { damage: 20 }));
  assert.equal(taken(s), 3);
  assert.ok(!s.log.some(l => /鬆口氣/.test(l.message)), '不可出現鬆口氣');
});

console.log('── B1 影藏（稽核 A9）──');
T('B1d 戰鬥位【惡】桃歹郎＋備戰超級耿鬼ex（剩 60）同一招昏厥 ⇒ 桃歹郎 1-1＝0、超級耿鬼ex 3（效果昏厥不 -1）＝ 3 張', () => {
  const s = phantom(inst(MOMO), inst(GENGAR, { damage: 290 }));
  assert.ok(s.players[1].discard.some(c => c.cardId === GENGAR), '前置：超級耿鬼ex 應已昏厥');
  assert.equal(taken(s), 3);
  assert.ok(s.log.some(l => /影藏/.test(l.message)), '應有影藏的 log');
});
T('B1e 正對照：超級耿鬼ex 沒昏厥 ⇒ 桃歹郎 0 張', () => {
  const s = phantom(inst(MOMO), inst(GENGAR));
  assert.equal(taken(s), 0);
});
T('B1f 反對照：備戰不是影藏持有者 ⇒ 桃歹郎 1＋卡璞・鳴鳴ex 2＝3 張', () => {
  const s = phantom(inst(MOMO), inst(KOKO, { damage: 160 }), []);
  assert.equal(taken(s), 3);
});

console.log('── B2 全體放指示物（痛楚記憶）打昏戰鬥位 ⇒ 奇跡之吻 ──');
const painMemory = (p0bench, p1bench) => {
  const ATK = pool.get(AZELF).attacks.findIndex(a => a.name === '痛楚記憶');
  let s = board({ active: inst(AZELF, { energyAttached: [inst(PSY)] }), bench: p0bench },
                { active: inst(CACNEA, { damage: hpOf(CACNEA) - 20 }), bench: p1bench });
  return withHeads(() => applyAction(s, { type: 'ATTACK', attackIndex: ATK }, pool));
};
T('B2a 自己場上有波克基斯 ⇒ 擲奇跡之吻（正面）⇒ 1＋1＝2 張', () => {
  const s = painMemory([inst(KISS)], [inst(KOKO)]);
  assert.ok(s.players[1].discard.some(c => c.cardId === CACNEA), '前置：沙鈴仙人掌應已昏厥');
  assert.ok(s.log.some(l => /奇跡之吻/.test(l.message)), '應擲奇跡之吻');
  assert.equal(taken(s), 2);
});
T('B2b 正對照：沒有波克基斯 ⇒ 1 張、沒有奇跡之吻', () => {
  const s = painMemory([], [inst(KOKO)]);
  assert.equal(taken(s), 1);
  assert.ok(!s.log.some(l => /奇跡之吻/.test(l.message)));
});
T('B2c 正對照：只打昏備戰（戰鬥位存活）⇒ 不擲', () => {
  const ATK = pool.get(AZELF).attacks.findIndex(a => a.name === '痛楚記憶');
  let s = board({ active: inst(AZELF, { energyAttached: [inst(PSY)] }), bench: [inst(KISS)] },
                { active: inst(KOKO), bench: [inst(CACNEA, { damage: hpOf(CACNEA) - 20 })] });
  s = withHeads(() => applyAction(s, { type: 'ATTACK', attackIndex: ATK }, pool));
  assert.equal(taken(s), 1);
  assert.ok(!s.log.some(l => /奇跡之吻/.test(l.message)));
});
T('B2d 對手沒有可上場的寶可夢 ⇒ 直接獲勝、不擲', () => {
  const s = painMemory([inst(KISS)], []);
  assert.equal(s.phase, 'game-over');
  assert.equal(s.winner, 0);
  assert.ok(!s.log.some(l => /奇跡之吻/.test(l.message)));
});

console.log('── B3 效果昏厥收斂到中央（斧擊在地／藍柱石／同命戰鬥／瘋癲攻擊）──');
T('B3a 斧擊在地 打昏戰鬥位 ⇒ 奇跡之吻（原本手刻漏掉）⇒ 2 張', () => {
  let s = board({ active: inst(HAXO, { energyAttached: [inst(FIGHTE)] }), bench: [inst(KISS)] },
                { active: inst(CACNEA, { energyAttached: [inst(REVERSE)] }), bench: [inst(KOKO)] });
  s = withHeads(() => applyAction(s, { type: 'ATTACK', attackIndex: atkIdx(HAXO, '斧擊在地') }, pool));
  assert.ok(s.players[1].discard.some(c => c.cardId === CACNEA), '前置：應已昏厥');
  assert.ok(kissed(s)); assert.equal(taken(s), 2);
});
T('B3b 藍柱石 打昏戰鬥位（唯一候選）⇒ 奇跡之吻 ⇒ 2 張', () => {
  let s = board({ active: inst(GLACE, { energyAttached: [inst(GRASS), inst(WATERE), inst(DARK)] }), bench: [inst(KISS)] },
                { active: inst(CACNEA, { damage: 60 }), bench: [inst(KOKO)] });
  s = withHeads(() => applyAction(s, { type: 'ATTACK', attackIndex: atkIdx(GLACE, '藍柱石') }, pool));
  if (s.pendingSelection) s = withHeads(() => applyAction(s, { type: 'RESOLVE_SELECTION', senderIdx: 0, actorIdx: 0, effectKey: s.pendingSelection.effectKey, selectedIids: [s.players[1].active.iid] }, pool));
  assert.ok(s.players[1].discard.some(c => c.cardId === CACNEA), '前置：應已昏厥');
  assert.ok(kissed(s)); assert.equal(taken(s), 2);
});
const mutual = (p0bench, p1bench) => {
  const s = board({ active: inst(MANKEY, { energyAttached: [inst(FIGHTE), inst(FIGHTE)] }), bench: p0bench },
                  { active: inst(CACNEA), bench: p1bench });
  return withHeads(() => applyAction(s, { type: 'ATTACK', attackIndex: atkIdx(MANKEY, '同命戰鬥') }, pool));
};
T('B3c 同命戰鬥：雙方各有波克基斯 ⇒ 兩邊都擲（裁定 2：對手自己把自己弄昏厥也擲）', () => {
  const s = mutual([inst(KISS)], [inst(KISS)]);
  assert.equal(s.phase, 'playing');
  assert.equal(takenBy(s, 0), 2, '攻擊方：沙鈴仙人掌 1＋奇跡之吻 1');
  assert.equal(takenBy(s, 1), 2, '對手：棄世猴 1＋奇跡之吻 1');
});
T('B3d 同命戰鬥：雙方都沒有備戰 ⇒ 平手（官方 L622；原本判對手獲勝）', () => {
  const s = mutual([], []);
  assert.equal(s.phase, 'game-over'); assert.equal(s.isDraw, true); assert.equal(s.winner, undefined);
});
T('B3e 同命戰鬥：只有攻擊方沒有備戰 ⇒ 對手獲勝', () => {
  const s = mutual([], [inst(KOKO)]);
  assert.equal(s.phase, 'game-over'); assert.equal(s.winner, 1);
});
T('B3f 同命戰鬥：只有對手沒有備戰 ⇒ 攻擊方獲勝', () => {
  const s = mutual([inst(KOKO)], []);
  assert.equal(s.phase, 'game-over'); assert.equal(s.winner, 0);
});
const roaring = (p0bench, p1bench) => {
  const s = board({ active: inst(MOON, { damage: 30, energyAttached: [inst(DARK), inst(DARK), inst(DARK)] }), bench: p0bench },
                  { active: inst(CACNEA), bench: p1bench });
  return withHeads(() => applyAction(s, { type: 'ATTACK', attackIndex: atkIdx(MOON, '瘋癲攻擊') }, pool));
};
T('B3g 瘋癲攻擊：對手昏厥＋自己反噬昏厥 ⇒ 攻擊方奇跡之吻 1＋1、對手 轟鳴月ex 2＋奇跡之吻 1', () => {
  const s = roaring([inst(KISS)], [inst(KISS)]);
  assert.equal(takenBy(s, 0), 2); assert.equal(takenBy(s, 1), 3);
});
T('B3h 瘋癲攻擊：雙方都沒有備戰 ⇒ 平手（原本先判攻擊方獲勝，跳過反噬）', () => {
  const s = roaring([], []);
  assert.equal(s.phase, 'game-over'); assert.equal(s.isDraw, true);
});
T('B3i 瘋癲攻擊：反噬沒有昏厥 ⇒ 只受 200', () => {
  const s = board({ active: inst(MOON, { energyAttached: [inst(DARK), inst(DARK), inst(DARK)] }), bench: [] },
                  { active: inst(CACNEA), bench: [inst(KOKO)] });
  const r = applyAction(s, { type: 'ATTACK', attackIndex: atkIdx(MOON, '瘋癲攻擊') }, pool);
  assert.equal(r.players[0].active?.damage, 200); assert.equal(takenBy(r, 0), 1);
});

T('B3j 瘋癲攻擊：攻擊方取完最後 1 張獎賞、但自己反噬昏厥且沒有備戰 ⇒ 平手（v6.420 裁定，交給中央重判）', () => {
  let s = board({ active: inst(MOON, { damage: 30, energyAttached: [inst(DARK), inst(DARK), inst(DARK)] }), bench: [] },
                { active: inst(CACNEA), bench: [inst(KOKO)] });
  s = { ...s, players: [{ ...s.players[0], prizes: [inst(DEF)] }, s.players[1]] };
  s = withHeads(() => applyAction(s, { type: 'ATTACK', attackIndex: atkIdx(MOON, '瘋癲攻擊') }, pool));
  assert.equal(s.phase, 'game-over'); assert.equal(s.isDraw, true, `winner=${s.winner}`);
});

console.log('── B6 脆弱蛻殼（對手無法獲得獎賞卡）＋奇跡之吻 ──');
T('B6a 吉雉雞ex｜殘酷箭 選戰鬥位的脫殼忍者 ⇒ 0 張（奇跡之吻正面也不加）', () => {
  const COL = basicE('雷');
  let s = board({ active: inst(OKIDOGI_LIKE, { energyAttached: [inst(COL), inst(COL), inst(COL)] }), bench: [inst(KISS)] },
                { active: inst(SHED), bench: [inst(KOKO)] });
  s = withHeads(() => applyAction(s, { type: 'ATTACK', attackIndex: atkIdx(OKIDOGI_LIKE, '殘酷箭') }, pool));
  assert.ok(s.pendingSelection, '前置：應開目標選擇');
  const shedIid = s.players[1].active.iid;
  s = withHeads(() => applyAction(s, { type: 'RESOLVE_SELECTION', senderIdx: 0, actorIdx: 0, effectKey: s.pendingSelection.effectKey, selectedIids: [shedIid] }, pool));
  assert.ok(s.players[1].discard.some(c => c.cardId === SHED), '前置：脫殼忍者應已昏厥');
  assert.equal(taken(s), 0);
  assert.ok(s.log.some(l => /奇跡之吻.*無法獲得獎賞卡/.test(l.message)), '應寫明正面但不加');
});

console.log('── K 奇跡之吻（站長裁定 2026-10-06）──');
T('K1 裁定 1：寶可夢檢查（中毒）讓對手戰鬥寶可夢昏厥 ⇒ 擲奇跡之吻 ⇒ 2 張', () => {
  let s = board({ active: inst(KOKO), bench: [inst(KISS)] },
                { active: inst(CACNEA, { status: 'poisoned', damage: hpOf(CACNEA) - 10 }), bench: [inst(KOKO)] });
  s = withHeads(() => applyAction(s, { type: 'END_TURN' }, pool));
  assert.ok(s.players[1].discard.some(c => c.cardId === CACNEA), '前置：應被毒死');
  assert.ok(kissed(s)); assert.equal(taken(s), 2);
});
T('K1b 正對照：中毒沒有昏厥 ⇒ 不擲', () => {
  let s = board({ active: inst(KOKO), bench: [inst(KISS)] },
                { active: inst(CACNEA, { status: 'poisoned' }), bench: [inst(KOKO)] });
  s = withHeads(() => applyAction(s, { type: 'END_TURN' }, pool));
  assert.ok(!kissed(s)); assert.equal(taken(s), 0);
});
T('K2 裁定 2：對手的戰鬥寶可夢混亂自傷昏厥 ⇒ 擲奇跡之吻', () => {
  let s = board({ active: inst(CACNEA, { status: 'confused', damage: hpOf(CACNEA) - 10, energyAttached: [inst(GRASS)] }), bench: [inst(KOKO)] },
                { active: inst(KOKO), bench: [inst(KISS)] });
  s = withRandoms([0.9, 0.1], () => applyAction(s, { type: 'ATTACK', attackIndex: 0 }, pool));
  assert.ok(s.players[0].discard.some(c => c.cardId === CACNEA), '前置：混亂自傷應昏厥');
  assert.ok(kissed(s)); assert.equal(takenBy(s, 1), 2);
});
T('K3 裁定 2：反噬（這隻寶可夢也受到傷害）讓自己昏厥 ⇒ 對手擲奇跡之吻', () => {
  let s = board({ active: inst(CARVANHA, { damage: hpOf(CARVANHA) - 10, energyAttached: [inst(DARK)] }), bench: [inst(KOKO)] },
                { active: inst(KOKO), bench: [inst(KISS)] });
  s = withHeads(() => applyAction(s, { type: 'ATTACK', attackIndex: atkIdx(CARVANHA, '突擊') }, pool));
  assert.ok(s.players[0].discard.some(c => c.cardId === CARVANHA), '前置：反噬應昏厥');
  assert.ok(kissed(s)); assert.equal(takenBy(s, 1), 2);
});

console.log(`\n${fail === 0 ? '✅' : '❌'} v6.493 中央昏厥管線稽核：${pass} 通過、${fail} 失敗`);
if (fail) process.exit(1);
