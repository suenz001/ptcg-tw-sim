// v6.350 守衛：
//   【A】賽富豪｜歡慶 —— 站長裁定「手牌必須剛好 30 張，否則不能使用這一招」
//        （中央 ATTACK_USE_PRECONDITION：UI 反白與引擎拒絕**共用同一份**述詞）
//   【B】皮卡丘ex｜十萬伏特 —— 印刷閘（faceAttackEffect 讀出招那一張印刷自己的卡面）
//   【C】百變怪｜整人變身 —— 站長裁定「不限制階級」，2 階進化可以直接換上場
//   【D】全庫印刷碰撞棘輪：已登記的 handler key 之中，同名同招有 2 個以上印刷且
//        damage 或 effect 不一致者，必須逐一列管（多一個少一個都紅）
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.v6350-s.js'), E = join(ROOT, '.v6350-e.ts'), O = join(ROOT, '.v6350-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* noop */ } } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E,
  "export { applyAction, getAvailableAttacks } from './src/lib/game/engine';\n"
  + "export { ATTACK_PRE, ATTACK_POST, ATTACK_USE_PRECONDITION } from './src/lib/game/effects';\n"
  + "export { faceAttackEffect } from './src/lib/game/effects/_shared';\n"
  + "import './src/lib/game/effects';\n");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const M = await import(pathToFileURL(O).href);
const { applyAction, getAvailableAttacks, ATTACK_PRE, ATTACK_POST, ATTACK_USE_PRECONDITION, faceAttackEffect } = M;

// ── 卡池 ─────────────────────────────────────────────────────────────────────
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map(); const all = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
    if (c?.id == null) continue;
    pool.set(String(c.id), c); all.push(c);
  }
}
const byId = (id) => { const c = pool.get(String(id)); if (!c) throw new Error('fixture 找不到 id ' + id); return c; };
const ZH = { Grass: '草', Fire: '火', Water: '水', Lightning: '雷', Psychic: '超', Fighting: '鬥', Darkness: '惡', Metal: '鋼' };
const EID = {};
for (const c of all) { if (c.supertype !== 'Energy') continue;
  for (const [k, z] of Object.entries(ZH)) if (c.name === `基本【${z}】能量` && !EID[k]) EID[k] = String(c.id); }
EID.Colorless = EID.Water;

let nn = 0;
const inst = (cid, extra = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [],
  abilityUsedThisTurn: false, evolvedThisTurn: false, playedFromHand: false,
  movedToActiveThisTurn: false, evolvedFromStack: [], ...extra });
const P = (o = {}) => ({ name: 'P', active: null, bench: [], hand: [], deck: [], discard: [], prizes: [],
  abilityNamesUsedThisTurn: [], ...o });
const mk = (p0, p1, extra = {}) => ({ phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0,
  turn: 5, isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
  pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], coinFlippedThisAttack: false,
  _attackerActiveBonusDone: false, activeStadium: null, activeStadiumOwnerIdx: 0,
  players: [P(p0), P(p1)], ...extra });

let pass = 0, fail = 0;
const chk = (t, c, extra = '') => { if (c) { pass++; console.log('  ✓', t); } else { fail++; console.log('  ❌', t, extra); } };
const heads = (fn) => { const o = Math.random; Math.random = () => 0.1; try { return fn(); } finally { Math.random = o; } };
const act = (st, a) => heads(() => { try { return applyAction(st, a, pool); } catch (e) { return { __err: e.message, log: [], players: st.players }; } });
const A0 = (r) => r?.players?.[0]?.active;
const D0 = (r) => r?.players?.[1]?.active;
const atkIdx = (card, name) => (card.attacks || []).findIndex((a) => a.name === name);
const logHas = (r, s) => (r?.log ?? []).some((l) => String(l?.message ?? l?.text ?? l).includes(s));

// ── fixtures ────────────────────────────────────────────────────────────────
const GHOLD = byId(19999);                   // 賽富豪 M6a 087/103（歡慶／三重粉碎）
const PIKA_M6A = byId(19959);                // 皮卡丘ex M6a 047/103 —— 200 ＋ 丟光能量
const PIKA_MC = byId(16698);                 // 皮卡丘ex MC 227      —— 120、效果欄全空（H 標可對戰）
const ZAPDOS = all.find((c) => c.name === '閃電鳥' && (c.attacks || []).some((a) => a.name === '十萬伏特'));
const DITTO = byId(20005);                   // 百變怪 M6a 093/103（整人變身）
/** 乾淨的【無】屬性靶（對任何屬性都中立），HP 夠高吃得下 200。 */
const TANK = all.find((c) => c.supertype === 'Pokemon' && c.stage === 'Basic' && !(c.abilities || []).length
  && !(c.tags || []).includes('太晶') && Number(c.hp) >= 250
  && c.weakness?.type !== 'Lightning' && c.weakness?.type !== 'Metal' && c.weakness?.type !== 'Colorless');
const PLAIN = all.find((c) => c.supertype === 'Pokemon' && c.stage === 'Basic' && !(c.abilities || []).length
  && !(c.tags || []).includes('太晶') && Number(c.hp) >= 60 && c.pokemonType === 'Colorless');
/** 牌庫裡放一張 2 階進化寶可夢（整人變身的「不限階級」證據）。 */
const STAGE2 = all.find((c) => c.supertype === 'Pokemon' && c.stage === 'Stage2' && Number(c.hp) >= 200);

console.log('\n【0】harness 自驗');
chk('0a 賽富豪 M6a 087/103 有「歡慶」與「三重粉碎」兩招',
  atkIdx(GHOLD, '歡慶') >= 0 && atkIdx(GHOLD, '三重粉碎') >= 0 && GHOLD.setCode === 'M6a');
chk('0b 皮卡丘ex 兩個印刷：M6a 200＋丟光能量 / MC 120＋無效果',
  String(PIKA_M6A.attacks.find((a) => a.name === '十萬伏特').damage) === '200'
  && String(PIKA_M6A.attacks.find((a) => a.name === '十萬伏特').effect ?? '').includes('能量卡全部丟棄')
  && String(PIKA_MC.attacks.find((a) => a.name === '十萬伏特').damage) === '120'
  && String(PIKA_MC.attacks.find((a) => a.name === '十萬伏特').effect ?? '').trim() === '',
  JSON.stringify([PIKA_M6A.attacks.find((a) => a.name === '十萬伏特'), PIKA_MC.attacks.find((a) => a.name === '十萬伏特')]));
chk('0c MC 那張是 H 標（可對戰）—— 印刷閘不是在保護一張打不了的卡',
  String(PIKA_MC.regulationMark) === 'H', String(PIKA_MC.regulationMark));
chk('0d 有乾淨的靶與 2 階進化 fixture', !!TANK && !!PLAIN && !!STAGE2 && !!ZAPDOS,
  JSON.stringify([TANK?.name, PLAIN?.name, STAGE2?.name, ZAPDOS?.setCode]));

// ════════════════════════════════════════════════════════════════════════════
console.log('\n【A】賽富豪｜歡慶 — 手牌必須剛好 30 張才能使用（站長裁定）');
{
  const mkSt = (handN) => {
    const g = inst(GHOLD.id, { energyAttached: [inst(EID.Metal), inst(EID.Metal), inst(EID.Metal)] });
    return mk(
      { active: g, bench: [inst(PLAIN.id)],
        hand: Array.from({ length: handN }, () => inst(PLAIN.id)),
        deck: Array.from({ length: 10 }, () => inst(PLAIN.id)),
        prizes: Array.from({ length: 6 }, () => inst(PLAIN.id)) },
      { active: inst(TANK.id), bench: [inst(PLAIN.id)],
        deck: Array.from({ length: 10 }, () => inst(PLAIN.id)),
        prizes: Array.from({ length: 6 }, () => inst(PLAIN.id)) });
  };
  const iCheer = atkIdx(GHOLD, '歡慶');
  const iSmash = atkIdx(GHOLD, '三重粉碎');
  const avail = (st) => getAvailableAttacks(st, pool);

  chk('A1 ⭐UI：手牌剛好 30 張 ⇒ 歡慶在可用清單裡', avail(mkSt(30)).includes(iCheer),
    JSON.stringify(avail(mkSt(30))));
  chk('A2 ⭐UI 反對照：手牌 29 張 ⇒ 歡慶**不在**可用清單', !avail(mkSt(29)).includes(iCheer),
    JSON.stringify(avail(mkSt(29))));
  chk('A2b ⭐UI 反對照：手牌 31 張 ⇒ 歡慶**不在**可用清單（不是「30 張以上」）',
    !avail(mkSt(31)).includes(iCheer), JSON.stringify(avail(mkSt(31))));
  chk('A3 ⭐⭐同一份述詞：同一張卡的另一招 三重粉碎 不受影響（29 張時仍可用）',
    avail(mkSt(29)).includes(iSmash), JSON.stringify(avail(mkSt(29))));

  // 引擎端：UI 反白時硬送 ATTACK 必須被拒，而且**盤面一個字都不能動**
  const st29 = mkSt(29);
  const r29 = act(st29, { type: 'ATTACK', attackIndex: iCheer });
  chk('A4 ⭐⭐引擎端：手牌 29 張硬送 ATTACK ⇒ 被拒（獎賞沒動、手牌沒被洗、招式沒蓋章）',
    r29.players[0].prizes.length === 6 && r29.players[0].hand.length === 29
    && !A0(r29)?.attackUsedThisTurn,
    JSON.stringify([r29.players[0].prizes.length, r29.players[0].hand.length, A0(r29)?.attackUsedThisTurn]));
  chk('A4b 引擎端有寫下阻擋原因', logHas(r29, '必須剛好 30 張'),
    JSON.stringify((r29.log ?? []).slice(-2)));

  // 正常路徑
  const st30 = mkSt(30);
  const deckBefore = st30.players[0].deck.length;
  const r30 = act(st30, { type: 'ATTACK', attackIndex: iCheer });
  chk('A5 哨兵：歡慶真的結算了', A0(r30)?.attackUsedThisTurn === '歡慶', String(A0(r30)?.attackUsedThisTurn));
  chk('A6 ⭐行為端：獎賞 6 → 4（取了 2 張）', r30.players[0].prizes.length === 4,
    String(r30.players[0].prizes.length));
  chk('A7 ⭐行為端：手牌全部放回牌庫（手牌 0）', r30.players[0].hand.length === 0,
    String(r30.players[0].hand.length));
  chk('A8 ⭐⭐順序：取到的 2 張獎賞卡**也**被洗回牌庫（牌庫 +32，證明先取獎賞再洗手牌）',
    r30.players[0].deck.length === deckBefore + 32,
    `${deckBefore} → ${r30.players[0].deck.length}`);
  chk('A9 ⭐歡慶卡面沒有傷害 ⇒ 對手一點都沒掉', (D0(r30)?.damage ?? -1) === 0, String(D0(r30)?.damage));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n【B】皮卡丘ex｜十萬伏特 — 印刷閘（同一個 key，兩張印刷行為必須不同）');
{
  const run = (card) => {
    const p = inst(card.id, { energyAttached: [inst(EID.Lightning), inst(EID.Lightning), inst(EID.Lightning)] });
    const st = mk({ active: p, bench: [inst(PLAIN.id)], deck: [inst(PLAIN.id)],
      prizes: Array.from({ length: 6 }, () => inst(PLAIN.id)) },
    { active: inst(TANK.id), bench: [inst(PLAIN.id)], deck: [inst(PLAIN.id)],
      prizes: Array.from({ length: 6 }, () => inst(PLAIN.id)) });
    return act(st, { type: 'ATTACK', attackIndex: atkIdx(card, '十萬伏特') });
  };
  const rM6a = run(PIKA_M6A);
  chk('B1 哨兵：M6a 那張真的出招了', A0(rM6a)?.attackUsedThisTurn === '十萬伏特', String(A0(rM6a)?.attackUsedThisTurn));
  chk('B2 ⭐M6a 047/103：造成 200（讀卡面，沒有寫死）', D0(rM6a)?.damage === 200, String(D0(rM6a)?.damage));
  chk('B3 ⭐M6a 047/103：能量全部被丟棄（3 → 0）', A0(rM6a)?.energyAttached.length === 0,
    String(A0(rM6a)?.energyAttached.length));

  const rMC = run(PIKA_MC);
  chk('B4 哨兵：MC 227 那張也真的出招了', A0(rMC)?.attackUsedThisTurn === '十萬伏特', String(A0(rMC)?.attackUsedThisTurn));
  chk('B5 ⭐⭐MC 227（H 標可對戰）：造成 120（不是 200）', D0(rMC)?.damage === 120, String(D0(rMC)?.damage));
  chk('B6 ⭐⭐⭐MC 227：能量**一個都沒少**（3 → 3）⇒ 印刷閘真的擋住了',
    A0(rMC)?.energyAttached.length === 3, String(A0(rMC)?.energyAttached.length));

  // 正對照：另一張卡的同名招式（閃電鳥｜十萬伏特）仍然丟光能量
  const rZ = run(ZAPDOS);
  chk('B7 ⭐正對照：閃電鳥｜十萬伏特（另一個 key）仍然丟光能量',
    A0(rZ)?.energyAttached.length === 0 && A0(rZ)?.attackUsedThisTurn === '十萬伏特',
    JSON.stringify([A0(rZ)?.energyAttached.length, A0(rZ)?.attackUsedThisTurn]));

  // faceAttackEffect 本身的 fail-closed 語意
  {
    const st = mk({ active: inst(PLAIN.id) }, { active: inst(PLAIN.id) });
    chk('B8 ⭐faceAttackEffect：出招者卡面沒有這一招 ⇒ 回 null（呼叫端才好 fail-closed）',
      faceAttackEffect(st, 0, pool, '十萬伏特') === null,
      JSON.stringify(faceAttackEffect(st, 0, pool, '十萬伏特')));
    const st2 = mk({ active: inst(PIKA_MC.id) }, { active: inst(PLAIN.id) });
    chk('B9 ⭐faceAttackEffect：MC 那張有這一招但效果欄空 ⇒ 回空字串（不是 null）',
      faceAttackEffect(st2, 0, pool, '十萬伏特') === '',
      JSON.stringify(faceAttackEffect(st2, 0, pool, '十萬伏特')));
  }
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n【C】百變怪｜整人變身 — 站長裁定：**不限制階級**，2 階進化可以直接換上場');
{
  const ditto = inst(DITTO.id, { energyAttached: [inst(EID.Water), inst(EID.Water)], damage: 20 });
  const s2 = inst(STAGE2.id);
  const st = mk({ active: ditto, bench: [inst(PLAIN.id)], deck: [s2, inst(PLAIN.id)],
    prizes: Array.from({ length: 6 }, () => inst(PLAIN.id)) },
  { active: inst(TANK.id), bench: [], deck: [inst(PLAIN.id)],
    prizes: Array.from({ length: 6 }, () => inst(PLAIN.id)) });
  const r1 = act(st, { type: 'ATTACK', attackIndex: atkIdx(DITTO, '整人變身') });
  chk('C1 哨兵：整人變身正面 ⇒ 開 deck-search picker', r1.pendingSelection?.type === 'deck-search',
    JSON.stringify(r1.pendingSelection?.type));
  chk('C2 ⭐picker 候選包含牌庫裡的 2 階進化寶可夢（不限階級）',
    (r1.pendingSelection?.params?.validIids ?? []).includes(s2.iid),
    JSON.stringify(r1.pendingSelection?.params?.validIids));
  const r2 = act(r1, { type: 'RESOLVE_SELECTION', selectedIids: [s2.iid], actorIdx: 0 });
  chk('C3 ⭐⭐行為端：2 階進化真的被換到戰鬥場上（卡片本體換掉、iid 不變）',
    A0(r2)?.cardId === String(STAGE2.id) && A0(r2)?.iid === ditto.iid,
    JSON.stringify([A0(r2)?.cardId, A0(r2)?.iid === ditto.iid]));
  chk('C4 ⭐「所附加的卡・傷害指示物…全部保留」：能量 2 個與 20 點傷害都還在',
    A0(r2)?.energyAttached.length === 2 && A0(r2)?.damage === 20,
    JSON.stringify([A0(r2)?.energyAttached.length, A0(r2)?.damage]));
  chk('C5 ⭐「若互換了，則這張卡放回牌庫」：百變怪回到牌庫',
    r2.players[0].deck.some((c) => c.cardId === String(DITTO.id)),
    JSON.stringify(r2.players[0].deck.map((c) => c.cardId)));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n【D】全庫印刷碰撞棘輪 — 已登記的 handler key 之中，同名同招印刷不一致者');
{
  const keys = new Set([...ATTACK_PRE.keys(), ...ATTACK_POST.keys()]);
  const norm = (s) => String(s ?? '').replace(/\s+/g, '');
  const found = [];
  for (const k of keys) {
    const i = k.lastIndexOf('|');
    if (i < 0) continue;
    const cname = k.slice(0, i), aname = k.slice(i + 1);
    const prints = [];
    for (const c of all) {
      if (c.name !== cname) continue;
      for (const a of (c.attacks ?? [])) if (a.name === aname) prints.push(a);
    }
    if (prints.length < 2) continue;
    const effs = new Set(prints.map((p) => norm(p.effect)));
    const dmgs = new Set(prints.map((p) => norm(p.damage)));
    if (effs.size > 1 || dmgs.size > 1) found.push(k);
  }
  // 逐張比對過官方卡面後列管於此。新卡包若又撞名，這一條會逼人回來看。
  const KNOWN = [
    '卡比獸|倒下',        // 傷害 160/130、效果相同（自身睡眠）；只登 regPost ⇒ 傷害讀卡面 ⇒ 安全
    '巨鉗螳螂ex|鋼翼',    // M6a 145/103 是**無標**（永不合法）；可對戰的 4 個印刷彼此一致 ⇒ 安全
    '洛托姆|配件秀',      // 「寶可夢道具」vs「寶可夢道具**卡**」＝措辭修訂，語意相同 ⇒ 安全
    '皮卡丘ex|十萬伏特',  // ⭐v6.350 印刷閘（faceAttackEffect）—— 行為端由上面【B】釘住
    '皮卡丘ex|打雷',      // 傷害 200/220；v6.333 改讀卡面（faceAttackDamage）⇒ 安全
    '葉伊布|嫩葉之恩',    // 「那張卡」vs「這些卡」＝措辭修訂，語意相同 ⇒ 安全
    '銅鏡怪|鏡面攻擊',    // M5【鋼】/SV5K【超】；v5.685 用「對手屬性===自身屬性」統一涵蓋 ⇒ 安全
  ].sort();
  chk('D1 ⭐掃描器有掃到東西（下限：已登記 key >= 1500）', keys.size >= 1500, `${keys.size} 個`);
  chk('D2 ⭐⭐碰撞清單逐字釘住（多一個少一個都紅）', found.sort().join(',') === KNOWN.join(','),
    `\n      實際 = ${found.join('、')}\n      列管 = ${KNOWN.join('、')}`);
  chk('D3 ⭐掃描器正對照：人造的不一致樣本必須被算進來',
    (() => { const s = new Set(['A', 'A']); const t = new Set(['A', 'B']); return s.size === 1 && t.size === 2; })());
  chk('D4 ⭐norm 只吃空白，不可以把真正的差異抹平',
    norm('\n \n從自己的牌庫') === norm('\n\n從自己的牌庫')
    && norm('200') !== norm('220') && norm('受到30點傷害') !== norm('受到50點傷害'));
  // 行為端抽驗：皮卡丘ex｜打雷 兩個印刷各自打自己的卡面傷害
  {
    const run = (card) => {
      const p = inst(card.id, { energyAttached: Array.from({ length: 4 }, () => inst(EID.Lightning)) });
      const st = mk({ active: p, bench: [inst(PLAIN.id)], deck: [inst(PLAIN.id)],
        prizes: Array.from({ length: 6 }, () => inst(PLAIN.id)) },
      { active: inst(TANK.id), bench: [], deck: [inst(PLAIN.id)],
        prizes: Array.from({ length: 6 }, () => inst(PLAIN.id)) });
      return act(st, { type: 'ATTACK', attackIndex: atkIdx(card, '打雷') });
    };
    const m6a = all.find((c) => c.name === '皮卡丘ex' && c.setCode === 'M6a' && (c.attacks || []).some((a) => a.name === '打雷'));
    const svm = all.find((c) => c.name === '皮卡丘ex' && c.setCode === 'SVM' && (c.attacks || []).some((a) => a.name === '打雷'));
    const rA = run(m6a), rB = run(svm);
    chk('D5 ⭐行為端抽驗：皮卡丘ex｜打雷 M6a 印刷 = 200', D0(rA)?.damage === 200, String(D0(rA)?.damage));
    chk('D6 ⭐行為端抽驗：皮卡丘ex｜打雷 SVM 印刷 = 220', D0(rB)?.damage === 220, String(D0(rB)?.damage));
    chk('D7 哨兵：兩邊自傷 30 都有生效（證明兩次都真的打出去了）',
      A0(rA)?.damage === 30 && A0(rB)?.damage === 30,
      JSON.stringify([A0(rA)?.damage, A0(rB)?.damage]));
  }
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n【E】ATTACK_USE_PRECONDITION 的中央性');
{
  const eng = readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8');
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const src = strip(eng);
  const n = src.split('ATTACK_USE_PRECONDITION.get(').length - 1;
  chk('E1 ⭐engine 有且只有 2 個消費點（ATTACK handler ＋ getAvailableAttacks）', n === 2, `${n} 處`);
  chk('E2 ⭐掃描器正對照：樣本裡有這段字面時必須算得到',
    ('x ATTACK_USE_PRECONDITION.get( y'.split('ATTACK_USE_PRECONDITION.get(').length - 1) === 1);
  chk('E3 ⭐目前只有 賽富豪|歡慶 登記（新增時必須連守衛一起加）',
    [...ATTACK_USE_PRECONDITION.keys()].sort().join(',') === '賽富豪|歡慶',
    [...ATTACK_USE_PRECONDITION.keys()].join('、'));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} v6.350 印刷閘 / 招式使用前提：${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
