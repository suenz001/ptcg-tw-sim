// 守衛 v6.438：大奶罐｜哞哞回轉 —— 卡面「這個招式必須在上個自己的回合這隻寶可夢使用了「滾動」才可使用。」
//
// 【背景】舊版只在 regPre 判斷條件 ⇒ 招式按鈕**亮著**、按下去**宣告了招式**卻 0 傷害（白白耗掉這回合的攻擊），
//   AI 也會把它當候選。卡面是「才可使用」＝**使用條件** ⇒ 條件不成立時這一招不能使用。
// 【修法（中央）】走 v6.350 的 ATTACK_USE_PRECONDITION（engine ATTACK handler 與 getAvailableAttacks 共用同一份），
//   判準只有 v2750_h_wave2_full.ts 的 `prevSelfAttackBlock` 一份；regPre 的防呆分支呼叫同一支（Rule 38）。
//
// 【本守衛】
//   M1～M3 UI 反白（getAvailableAttacks）：沒用過／用過滾動／用過別招
//   M4    引擎拒絕：反白時硬送 ATTACK ⇒ 對手沒受傷、招式沒蓋章、回合沒結束、log 有原因
//   M5    引擎放行：上回合用過滾動 ⇒ 100 傷害
//   M6    端到端：這回合打「滾動」→ 對手回合 → 下個自己的回合「哞哞回轉」亮起來、打得出 100
//   M7    AI：條件不成立時 AI 不會選哞哞回轉（舊版會選到而 0 傷害）
//   B1～B6 借招（站長裁定 2026-09-29「必須視為條件不符，不讓借」）：皮可西｜揮指 借對手的大奶罐 ——
//         借用方上個自己的回合沒用滾動 ⇒ 哞哞回轉不是候選、對戰紀錄說明、實際出招落到別的候選；
//         中央性：賽富豪｜歡慶（手牌剛好 30 張）被借時同樣照使用條件判
//   C0～C5 絕叫／慢芬香 的使用條件從 engine 私有集合搬進中央登記表 ⇒ 借招也照條件（fable 審查 v6.438 建議，同一原則）
//   D1～D3 結構：已登記、regPre 不再就地抄一份判準（Rule 38）、判準函式真的被兩處呼叫
//
// HEAD-FAIL（BASE＝25391a6a）：結果寫在 commit 訊息（Rule 41：不整支 throw）。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAiBundle, loadLivePool } from './lib/ai-sim-harness.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const mod = await buildAiBundle(ROOT, {
  extraExports: ["export { ATTACK_USE_PRECONDITION } from './src/lib/game/effects/_shared';",
    "export { copyAttackCandidates, copyAttackCooldownNote } from './src/lib/game/copy-attack';"],
});
const pool = loadLivePool(ROOT);
const { applyAction, getAvailableAttacks } = mod;

let pass = 0, fail = 0;
const failed = [];
const chk = (t, c, extra = '') => {
  if (c) { pass++; console.log('  ✓', t); } else { fail++; failed.push(t.split(' ')[0]); console.log('  ❌', t, extra); }
};

// ── fixtures ────────────────────────────────────────────────────────────────
const all = [...pool.values()];
const MILTANK = pool.get('12166');                     // 大奶罐 SVM 096/175（H）：滾動／哞哞回轉
const EN = all.find((c) => c.supertype === 'Energy' && c.name === '基本【水】能量');
/** 乾淨的靶：基礎、無特性、非太晶、HP ≥ 200、對【無】沒有弱點／抵抗力 */
const TANK = all.find((c) => c.supertype === 'Pokemon' && c.stage === 'Basic' && !(c.abilities || []).length
  && !(c.tags || []).includes('太晶') && Number(c.hp) >= 200
  && c.weakness?.type !== 'Colorless' && c.resistance?.type !== 'Colorless'
  && ['H', 'I', 'J'].includes(c.regulationMark));
const FILL = all.find((c) => c.supertype === 'Pokemon' && c.stage === 'Basic' && !(c.abilities || []).length
  && Number(c.hp) >= 60 && ['H', 'I', 'J'].includes(c.regulationMark));
const iRoll = (MILTANK?.attacks || []).findIndex((a) => a.name === '滾動');
const iMoo = (MILTANK?.attacks || []).findIndex((a) => a.name === '哞哞回轉');

let nn = 0;
const inst = (cid, extra = {}) => ({ iid: 'm' + (++nn), cardId: String(cid), damage: 0, energyAttached: [],
  abilityUsedThisTurn: false, evolvedThisTurn: false, playedFromHand: false,
  movedToActiveThisTurn: false, evolvedFromStack: [], ...extra });
const P = (o = {}) => ({ name: 'P', active: null, bench: [], hand: [], deck: [], discard: [], prizes: [],
  abilityNamesUsedThisTurn: [], ...o });
function mkSt(lastAtk, handN = 2) {
  const me = inst(MILTANK.id, { energyAttached: [inst(EN.id), inst(EN.id)], ...(lastAtk ? { attackUsedLastSelfTurn: lastAtk } : {}) });
  return {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
    log: [], pendingSelection: null, setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
    activeStadium: null, activeStadiumOwnerIdx: 0,
    players: [
      P({ active: me, bench: [inst(FILL.id)], hand: Array.from({ length: handN }, () => inst(EN.id)),
        deck: Array.from({ length: 12 }, () => inst(FILL.id)), prizes: Array.from({ length: 6 }, () => inst(FILL.id)) }),
      P({ active: inst(TANK.id), bench: [inst(FILL.id)], hand: [],
        deck: Array.from({ length: 12 }, () => inst(FILL.id)), prizes: Array.from({ length: 6 }, () => inst(FILL.id)) }),
    ],
  };
}
const act = (st, a) => { try { return applyAction(st, a, pool); } catch (e) { return { __err: e.message, log: [], players: st.players }; } };
const logHas = (r, s) => (r?.log ?? []).some((l) => String(l?.message ?? l?.text ?? l).includes(s));
const avail = (st) => getAvailableAttacks(st, pool);

console.log('\n【0】fixture 自驗');
chk('0a 大奶罐 12166 有「滾動」與「哞哞回轉」，卡面是「才可使用」',
  iRoll >= 0 && iMoo >= 0 && String(MILTANK.attacks[iMoo].effect).includes('才可使用') && MILTANK.regulationMark === 'H',
  JSON.stringify(MILTANK?.attacks));
chk('0b 有乾淨的靶與填充卡', !!TANK && !!FILL && !!EN, JSON.stringify([TANK?.name, FILL?.name, EN?.name]));

console.log('\n【M】行為');
chk('M1 ⭐UI：上個自己的回合沒用過滾動 ⇒ 哞哞回轉**不在**可用清單；滾動在',
  !avail(mkSt(null)).includes(iMoo) && avail(mkSt(null)).includes(iRoll), JSON.stringify(avail(mkSt(null))));
chk('M2 ⭐UI 正對照：上個自己的回合用過滾動 ⇒ 哞哞回轉在可用清單',
  avail(mkSt('滾動')).includes(iMoo), JSON.stringify(avail(mkSt('滾動'))));
chk('M3 ⭐UI 反對照：上個自己的回合用的是別的招 ⇒ 哞哞回轉不在可用清單',
  !avail(mkSt('哞哞回轉')).includes(iMoo), JSON.stringify(avail(mkSt('哞哞回轉'))));
{
  const st = mkSt(null);
  const r = act(st, { type: 'ATTACK', attackIndex: iMoo });
  chk('M4 ⭐⭐引擎端：條件不成立硬送 ATTACK ⇒ 被拒（對手沒受傷、招式沒蓋章、回合沒結束）',
    !r.__err && (r.players[1].active?.damage ?? 0) === 0 && !r.players[0].active?.attackUsedThisTurn
    && r.activePlayerIndex === 0 && r.turnPhase === 'main',
    JSON.stringify([r.__err, r.players[1].active?.damage, r.players[0].active?.attackUsedThisTurn, r.activePlayerIndex, r.turnPhase]));
  chk('M4b 引擎端有寫下阻擋原因', logHas(r, '無法使用這個招式'), JSON.stringify((r.log ?? []).slice(-2)));
}
{
  const r = act(mkSt('滾動'), { type: 'ATTACK', attackIndex: iMoo });
  const dmg = r.players?.[1]?.active?.damage ?? -1;
  chk('M5 ⭐引擎放行：上個自己的回合用過滾動 ⇒ 哞哞回轉打出 100', !r.__err && dmg === 100, JSON.stringify([r.__err, dmg]));
}
{
  // 端到端：這回合打滾動 → 對手回合什麼都不做 → 下個自己的回合
  let s = act(mkSt(null), { type: 'ATTACK', attackIndex: iRoll });
  const rolled = (s.players?.[1]?.active?.damage ?? 0) === 20;
  for (let i = 0; i < 12 && s.activePlayerIndex !== 1; i++) s = act(s, { type: 'END_TURN' });
  const oppTurn = s.activePlayerIndex === 1;
  for (let i = 0; i < 12 && s.activePlayerIndex !== 0; i++) s = act(s, { type: 'END_TURN' });
  if (s.turnPhase === 'draw') s = act(s, { type: 'DRAW' });
  const back = s.activePlayerIndex === 0 && s.turnPhase === 'main';
  const a1 = back ? avail(s) : [];
  chk('M6 ⭐⭐端到端：這回合打「滾動」→ 對手回合 → 下個自己的回合哞哞回轉亮起來',
    rolled && oppTurn && back && a1.includes(iMoo),
    JSON.stringify({ rolled, oppTurn, back, a1, phase: s.turnPhase, stamp: s.players?.[0]?.active?.attackUsedLastSelfTurn, err: s.__err }));
  const before = s.players?.[1]?.active?.damage ?? 0;
  const r = back ? act(s, { type: 'ATTACK', attackIndex: iMoo }) : s;
  chk('M6b 端到端：接著打哞哞回轉 ⇒ 對手多受 100', (r.players?.[1]?.active?.damage ?? 0) - before === 100,
    JSON.stringify([before, r.players?.[1]?.active?.damage]));
}
{
  // AI：⚠ 手牌必須清空 —— 手上有能量時 AI 第一步是附能量，永遠看不到 ATTACK ⇒ 否定斷言空真（fable 審查抓到的安慰劑）。
  //   先用正對照證明「這個盤面 AI 第一步就是出招、條件成立時會選哞哞回轉」，再做否定斷言。
  const okSt = mkSt('滾動', 0), noSt = mkSt(null, 0);
  const aOk = mod.aiNew(okSt, pool, 0);
  chk('M7a ⭐正對照：條件成立（手牌 0）⇒ AI 第一步就出招，而且選哞哞回轉（100 > 20）',
    aOk?.type === 'ATTACK' && aOk.attackIndex === iMoo, JSON.stringify(aOk));
  const picks = Array.from({ length: 6 }, () => mod.aiNew(noSt, pool, 0));
  chk('M7 ⭐AI：條件不成立（同一盤面、只差上回合沒用滾動）⇒ 出招但不選哞哞回轉（選滾動）',
    picks.every((a) => a?.type === 'ATTACK' && a.attackIndex === iRoll), JSON.stringify(picks));
}

console.log('\n【B】借招（站長裁定：借來用時條件不符，不讓借）');
{
  const CLEFABLE = pool.get('16757');   // 皮可西（H）：揮指「選擇1個對手的戰鬥寶可夢持有的招式，作為這個招式使用。」
  const GHOLD = pool.get('19999');      // 賽富豪 M6a 087/103：歡慶（手牌剛好 30 張才可使用，站長裁定 v6.350）
  const iWag = (CLEFABLE?.attacks || []).findIndex((a) => a.name === '揮指');
  const mkB = ({ oppCard = MILTANK, handN = 2, last = null } = {}) => {
    const st = mkSt(null);
    st.players[0].active = inst(CLEFABLE.id, { energyAttached: [inst(EN.id), inst(EN.id)], ...(last ? { attackUsedLastSelfTurn: last } : {}) });
    st.players[0].hand = Array.from({ length: handN }, () => inst(FILL.id));
    st.players[1].active = inst(oppCard.id);
    return st;
  };
  const names = (st, key = '皮可西|揮指') => (mod.copyAttackCandidates(key, st, 0, pool) || []).map((c) => c.attackName);
  chk('B0 fixture：皮可西有揮指、賽富豪有歡慶', iWag >= 0 && (GHOLD?.attacks || []).some((a) => a.name === '歡慶'),
    JSON.stringify([CLEFABLE?.attacks?.map((a) => a.name), GHOLD?.attacks?.map((a) => a.name)]));
  const n1 = names(mkB());
  chk('B1 ⭐⭐揮指借對手大奶罐：借用方上個回合沒用滾動 ⇒ 哞哞回轉**不是**候選；滾動是',
    !n1.includes('哞哞回轉') && n1.includes('滾動'), JSON.stringify(n1));
  const n2 = names(mkB({ last: '滾動' }));
  chk('B2 ⭐正對照：借用方（這隻寶可夢）上個回合用過滾動 ⇒ 哞哞回轉是候選（讀的是借用方，不是被借的那隻）',
    n2.includes('哞哞回轉'), JSON.stringify(n2));
  const note = mod.copyAttackCooldownNote('皮可西|揮指', mkB(), 0, pool);
  chk('B3 對戰紀錄說明為什麼不能借（原因字串來自中央述詞）', note.includes('不能借用') && note.includes('滾動'), note);
  {
    const st = mkB();
    const mooIdx = MILTANK.attacks.findIndex((a) => a.name === '哞哞回轉');
    const r = act(st, { type: 'ATTACK', attackIndex: iWag, copyAttackChoice: { pokeIid: st.players[1].active.iid, attackIndex: mooIdx } });
    const dmg = r.players?.[1]?.active?.damage ?? -1;
    chk('B4 ⭐⭐端到端：硬指定借哞哞回轉 ⇒ 不被採用（落到候選裡的滾動 20），不會打出 100',
      !r.__err && dmg === 20 && logHas(r, '不能借用'), JSON.stringify([r.__err, dmg, (r.log ?? []).slice(-4).map((l) => l.message)]));
  }
  const g29 = names(mkB({ oppCard: GHOLD, handN: 29 }));
  const g30 = names(mkB({ oppCard: GHOLD, handN: 30 }));
  chk('B5 ⭐中央性：賽富豪｜歡慶被借時同樣照使用條件判（手牌 29 張不是候選、剛好 30 張是）',
    !g29.includes('歡慶') && g30.includes('歡慶'), JSON.stringify([g29, g30]));
  chk('B6 反對照：同一張卡的其他招不受影響（29 張時三重粉碎仍是候選）', g29.includes('三重粉碎'), JSON.stringify(g29));
}

console.log('\n【C】後攻最初回合限定（絕叫／慢芬香）搬進中央使用條件 ⇒ 借招同樣照條件（fable 審查 v6.438）');
{
  const CLEFABLE = pool.get('16757');
  const ROAR = pool.get('16824');     // 吼叫尾ex（H）：絕叫「這個招式只可在後攻玩家的最初回合使用。…」／咬碎
  const iWag = (CLEFABLE?.attacks || []).findIndex((a) => a.name === '揮指');
  // me＝借用方（皮可西）；opp＝吼叫尾ex。turn／先後攻由參數決定
  const mkC = ({ turn = 5, meIdx = 0 } = {}) => {
    const st = mkSt(null);
    const oppIdx = 1 - meIdx;
    const pl = [st.players[0], st.players[1]];
    pl[meIdx] = { ...pl[meIdx], active: inst(CLEFABLE.id, { energyAttached: [inst(EN.id), inst(EN.id)] }), hand: [] };
    pl[oppIdx] = { ...pl[oppIdx], active: inst(ROAR.id), hand: [] };
    return { ...st, players: pl, turn, activePlayerIndex: meIdx, firstPlayerIdx: 0 };
  };
  const cands = (st, i) => (mod.copyAttackCandidates('皮可西|揮指', st, i, pool) || []).map((c) => c.attackName);
  chk('C0 fixture：吼叫尾ex 有絕叫與咬碎、卡面是「只可在後攻玩家的最初回合使用」',
    !!ROAR && ROAR.attacks.some((a) => a.name === '絕叫' && String(a.effect).includes('只可在後攻玩家的最初回合使用')), JSON.stringify(ROAR?.attacks));
  const c1 = cands(mkC({ turn: 5, meIdx: 0 }), 0);
  chk('C1 ⭐⭐第 5 回合揮指借吼叫尾ex ⇒ 絕叫**不是**候選；咬碎是', !c1.includes('絕叫') && c1.includes('咬碎'), JSON.stringify(c1));
  const c2 = cands(mkC({ turn: 1, meIdx: 1 }), 1);
  chk('C2 ⭐正對照：後攻玩家的最初回合（turn 1、後攻方出招）⇒ 絕叫是候選', c2.includes('絕叫'), JSON.stringify(c2));
  const c3 = cands(mkC({ turn: 1, meIdx: 0 }), 0);
  chk('C3 反對照：先攻玩家的第 1 回合 ⇒ 絕叫不是候選', !c3.includes('絕叫'), JSON.stringify(c3));
  {
    const st = mkC({ turn: 5, meIdx: 0 });
    const idx = ROAR.attacks.findIndex((a) => a.name === '絕叫');
    const r = act(st, { type: 'ATTACK', attackIndex: iWag, copyAttackChoice: { pokeIid: st.players[1].active.iid, attackIndex: idx } });
    const locked = JSON.stringify(r.players ?? []).includes('"cantPlaySupporterNextTurn":true');
    chk('C4 ⭐⭐端到端：第 5 回合硬指定借絕叫 ⇒ 不被採用（對手沒有被鎖支援者）', !r.__err && !locked && logHas(r, '不能借用'),
      JSON.stringify([r.__err, locked, (r.log ?? []).slice(-4).map((l) => l.message)]));
  }
  {
    // 吼叫尾ex 自己出招：UI 反白與引擎拒絕仍然成立（判準搬家後行為不變）
    const st = mkC({ turn: 5, meIdx: 1 });
    const own = { ...st, players: [st.players[0], { ...st.players[1], active: inst(ROAR.id, { energyAttached: [inst(EN.id)] }) }], activePlayerIndex: 1 };
    const idx = ROAR.attacks.findIndex((a) => a.name === '絕叫');
    const r = act(own, { type: 'ATTACK', attackIndex: idx });
    chk('C5 吼叫尾ex 第 5 回合自己出絕叫：反白＋引擎拒絕（原因寫進紀錄）',
      !avail(own).includes(idx) && logHas(r, '只能在後攻方最初回合使用'), JSON.stringify([avail(own), (r.log ?? []).slice(-1)]));
  }
}

console.log('\n【D】結構');
{
  const keys = [...(mod.ATTACK_USE_PRECONDITION?.keys?.() ?? [])];
  chk('D1 ⭐大奶罐|哞哞回轉 已登記在中央 ATTACK_USE_PRECONDITION', keys.includes('大奶罐|哞哞回轉'), keys.join('、'));
  const src = readFileSync(join(ROOT, 'src/lib/game/effects/cards/v2750_h_wave2_full.ts'), 'utf8')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const m = src.match(/function requirePrevAttackPre\([\s\S]*?\n\}/);
  chk('D2 ⭐Rule 38：requirePrevAttackPre 不再就地判斷 attackUsedLastSelfTurn（只呼叫 prevSelfAttackBlock）',
    !!m && !/attackUsedLastSelfTurn/.test(m[0]) && /prevSelfAttackBlock\(/.test(m[0]), m ? m[0].slice(0, 200) : '找不到函式');
  chk('D2b 掃描器正對照：樣本含就地判斷時抓得到',
    /attackUsedLastSelfTurn/.test('function requirePrevAttackPre(){ if (a?.attackUsedLastSelfTurn !== x) }'));
  const n = src.split('prevSelfAttackBlock(').length - 1;
  chk('D3 判準函式：1 個定義＋regAttackPrecondition 與 regPre 兩處呼叫', n === 3, `${n} 處`);
  // Rule 38：使用條件登記表只有一份（leaf），_shared 只 re-export；copy-attack.ts 問同一份
  const strip = (t) => t.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
  const rd = (f) => strip(readFileSync(join(ROOT, f), 'utf8'));
  const defs = ['src/lib/game/attack-use-precondition.ts', 'src/lib/game/effects/_shared.ts', 'src/lib/game/engine.ts', 'src/lib/game/copy-attack.ts']
    .filter((f) => /new Map<string,\s*AttackUsePreconditionFn>/.test(rd(f)));
  chk('D4 ⭐登記表只在 leaf attack-use-precondition.ts 定義一次', defs.length === 1 && defs[0].endsWith('attack-use-precondition.ts'), JSON.stringify(defs));
  const ca = rd('src/lib/game/copy-attack.ts');
  chk('D5 ⭐copy-attack.ts 從 leaf import 並在候選枚舉呼叫', /from '\.\/attack-use-precondition'/.test(ca) && /ATTACK_USE_PRECONDITION\.get\(/.test(ca));
  chk('D6 copy-attack.ts 沒有 import _shared／effects／engine（leaf 紀律，防成環）',
    !/from '\.\/(effects|engine)['\/]/.test(ca) && !/effects\/_shared/.test(ca));
}

console.log(`\n=== v6.438 哞哞回轉使用條件：PASS ${pass} / FAIL ${fail} ===`);
if (fail) console.log('紅：' + failed.join('、'));
process.exit(fail === 0 ? 0 : 1);
