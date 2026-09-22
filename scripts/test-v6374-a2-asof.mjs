// v6.374 守衛：站長裁定 A-2（凹洞／熔岩地域）接上 v6.373 的中央述詞
//   ＋ A-9（監視之眼）與 A-7（陳舊的頭蓋化石｜頭蓋尖刺）的**現況鎖與事實複驗**。
//
// ⭐ 與簡報不一致之處（以實測為準）：
//   ・(丙) A-7「頭蓋尖刺」**不是**未實裝 —— v5.494 起就以**卡名**為 key 實裝在
//     effects.ts 的 INHERENT_RETALIATION（grep 特性名「頭蓋尖刺」抓不到，所以被誤判為未實裝）。
//     而且它**本來就**在持有者被同一招 KO 後仍然反擊（呼叫端傳入 defenderCard）。
//     ⇒ 本版對它**不改一行**，只用行為守衛把現況鎖住（3 個／使用招式的寶可夢／只在戰鬥場／只吃招式的傷害）。
//   ・(乙) A-9「監視之眼」**沒有**自動納管（hasOakEye 是純 live 述詞），
//     但目前卡池**不存在**可觸發情境（所有「改放傷害指示物」的招式 damage 全為非數值）
//     ⇒ 接上去只會得到恆真守衛 ⇒ 本版不接，改用**資料驅動、卡池一變就翻紅**的不可觸發性斷言釘住。
//
// 斷言分層：
//   【0】fixture 自驗（卡面逐字，來源一律 abilities[].effect / attacks[].effect）
//   【A】⭐⭐⭐(甲) 行為：持有者被同一招 KO ⇒ 仍生效；被主動移除 ⇒ 不生效
//   【B】⭐(甲) 非 ATTACK 路徑（撤退）行為零變更
//   【C】⭐(丙) 頭蓋尖刺現況鎖
//   【D】⭐(乙) 監視之眼：自動納管不成立 ＋ 不可觸發性（資料驅動）＋ 機制仍活著
//   【E】⭐中央性
//   【F】HEAD-FAIL 對 BASE(2f497b0c ＝ v6.373)，hasBaseCommit 保護、淺複製 shallowSkip
//
// ⚠ 合成 ATTACK_POST 只在本守衛的 bundle 裡註冊、try/finally 還原；⛔ 絕不寫進 src/。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hasBaseCommit, restoreBaseSubtree, shallowSkip } from './lib/base-blob.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = '2f497b0c4ac19f5d6ff0c50e9cedd4abad957528';   // v6.373（本版的上一版）

let pass = 0, fail = 0;
const chk = (name, ok, extra = '') => {
  if (ok) { console.log('  PASS ' + name); pass++; }
  else { console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')); fail++; }
  return !!ok;
};

// ── 卡池 ──────────────────────────────────────────────────────────────────────
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map(); const all = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) { if (c?.id == null) continue; pool.set(String(c.id), c); all.push(c); }
}
const byId = (id) => pool.get(String(id));
const HIJ = (c) => ['H', 'I', 'J'].includes(c?.regulationMark);
const NONRULE = (c) => c.subtype !== 'ex' && !/(ex|EX|V|VMAX|VSTAR)$/.test(String(c.name));
const count = (t, s) => t.split(s).length - 1;

// ── 真卡 fixture（全部 H/I/J）──────────────────────────────────────────────────
const DUG    = byId('14743');   // 火箭隊的三地鼠 M2a 083/193 標I HP100【鬥】1階｜凹洞
const MAG    = byId('9859');    // 熔岩蝸牛      SV5M 018/071 標H HP120【火】1階｜熔岩地域
const OAK    = byId('18488');   // 探探鼠        M4 068/083   標J HP70【無】基礎｜監視之眼
const FOSSIL = byId('19215');   // 陳舊的頭蓋化石 M5 071/081  標J Trainer/Item｜頭蓋尖刺
const ARTIC  = byId('19924');   // 急凍鳥        M6a 標J｜冰雹（對手全體各 30）
const GOU    = byId('19596');   // 勾魂眼        M6 標J｜不祥之眼（放 5 個傷害指示物）
const CAVE   = byId('19623');   // 傳說的熔岩洞（競技場：雙方場上所有進化寶可夢特性全部消除）
const HUDI = all.find(c => c.name === '胡地' && HIJ(c) && (c.attacks || []).some(a => a.name === '奇異駭入'));
const ARTIC_I = ARTIC ? ARTIC.attacks.findIndex(a => a.name === '冰雹') : -1;
const GOU_I   = GOU ? GOU.attacks.findIndex(a => a.name === '不祥之眼') : -1;
const HUDI_I  = HUDI ? HUDI.attacks.findIndex(a => a.name === '奇異駭入') : -1;

const ZH = { Grass: '草', Fire: '火', Water: '水', Lightning: '雷', Psychic: '超', Fighting: '鬥', Darkness: '惡', Metal: '鋼', Dragon: '龍' };
const EID = {};
for (const c of all) { if (c.supertype !== 'Energy') continue; for (const [k, z] of Object.entries(ZH)) if (c.name === '基本【' + z + '】能量' && !EID[k]) EID[k] = String(c.id); }
EID.Colorless = EID.Water;

/** 合成 POST 用的攻擊方：基礎／無特性／非規則／單費純數字招式／無招式效果。 */
const ATK = all.find(c => c.supertype === 'Pokemon' && HIJ(c) && c.pokemonType
  && (c.stage ?? c.subtype) === 'Basic' && !(c.abilities || []).length && !(c.tags || []).length && NONRULE(c)
  && (c.attacks || []).some(a => /^\d+$/.test(String(a.damage)) && Number(a.damage) > 0 && !String(a.effect ?? '').trim() && (a.cost || []).length === 1));
const ATK_ATTACK = ATK ? ATK.attacks.find(a => /^\d+$/.test(String(a.damage)) && Number(a.damage) > 0 && !String(a.effect ?? '').trim() && (a.cost || []).length === 1) : null;
const ATK_IDX = ATK && ATK_ATTACK ? ATK.attacks.findIndex(a => a.name === ATK_ATTACK.name) : -1;
const KEY = ATK && ATK_ATTACK ? ATK.name + '|' + ATK_ATTACK.name : 'x|y';
/** 高 HP 中性靶（放對手戰鬥場，別被 ATK 打死）。 */
const TGT = all.find(c => c.supertype === 'Pokemon' && HIJ(c) && !(c.abilities || []).length && !(c.tags || []).length
  && NONRULE(c) && (c.stage ?? c.subtype) === 'Basic' && Number(c.hp) >= 150
  && c.weakness?.type !== ATK?.pokemonType && c.resistance?.type !== ATK?.pokemonType);
/** 攻擊方備戰用的中性寶可夢（自我互換後會變成新戰鬥寶可夢，要可以被【灼傷】、撤退費 <= 3）。 */
const NEUTB = all.find(c => c.supertype === 'Pokemon' && HIJ(c) && !(c.abilities || []).length && !(c.tags || []).length
  && NONRULE(c) && (c.stage ?? c.subtype) === 'Basic' && Number(c.hp) >= 100 && (c.retreatCost || []).length <= 3
  && c.name !== TGT?.name && c.name !== ATK?.name);
/** 冰雹／不祥之眼 用的中性靶（不被 30 打死、不吃【水】【惡】【超】弱點）。 */
const NEUT2 = all.find(c => c.supertype === 'Pokemon' && HIJ(c) && !(c.abilities || []).length && !(c.tags || []).length
  && NONRULE(c) && (c.stage ?? c.subtype) === 'Basic' && Number(c.hp) >= 150
  && c.weakness?.type !== 'Water' && c.weakness?.type !== 'Darkness' && c.weakness?.type !== 'Psychic');

console.log('\n【0】fixture 自驗（Rule 25：抽不到卡／卡面對不上要大聲紅，不可以靜默全綠）');
chk('0a ⭐火箭隊的三地鼠（M2a 083/193，id 14743，標 I）｜凹洞 卡面逐字',
  DUG?.name === '火箭隊的三地鼠' && DUG?.regulationMark === 'I' && Number(DUG?.hp) === 100
  && DUG?.abilities?.[0]?.name === '凹洞'
  && DUG?.abilities?.[0]?.effect === '只要這隻寶可夢在場上，在對手的回合，每次對手的戰鬥寶可夢回到備戰區時，在那隻寶可夢身上放置2個傷害指示物。',
  JSON.stringify({ n: DUG?.name, m: DUG?.regulationMark, e: DUG?.abilities?.[0]?.effect }));
chk('0b ⭐熔岩蝸牛（SV5M 018/071，id 9859，標 H）｜熔岩地域 卡面逐字',
  MAG?.name === '熔岩蝸牛' && MAG?.regulationMark === 'H' && Number(MAG?.hp) === 120
  && MAG?.abilities?.[0]?.name === '熔岩地域'
  && MAG?.abilities?.[0]?.effect === '只要這隻寶可夢在場上，在對手的回合，每次對手的戰鬥寶可夢回到備戰區時，將新上場的寶可夢【灼傷】。',
  JSON.stringify({ n: MAG?.name, m: MAG?.regulationMark, e: MAG?.abilities?.[0]?.effect }));
chk('0c ⭐探探鼠（M4 068/083，id 18488，標 J）｜監視之眼 卡面逐字',
  OAK?.name === '探探鼠' && OAK?.regulationMark === 'J' && Number(OAK?.hp) === 70
  && OAK?.abilities?.[0]?.name === '監視之眼'
  && OAK?.abilities?.[0]?.effect === '只要這隻寶可夢在場上，雙方的所有寶可夢身上放置的傷害指示物，無法改放於其他寶可夢身上。',
  JSON.stringify({ n: OAK?.name, m: OAK?.regulationMark, e: OAK?.abilities?.[0]?.effect }));
chk('0d ⭐⭐陳舊的頭蓋化石（M5 071/081，id 19215，標 J）｜頭蓋尖刺 卡面逐字；它是 Trainer/Item、'
  + '**沒有 hp 欄位**（HP60 寫在 rulesText），且 M5_jp_legacy(50290) **不在**現行卡池',
  FOSSIL?.name === '陳舊的頭蓋化石' && FOSSIL?.regulationMark === 'J'
  && FOSSIL?.supertype === 'Trainer' && FOSSIL?.subtype === 'Item' && FOSSIL?.hp === undefined
  && FOSSIL?.abilities?.[0]?.name === '頭蓋尖刺'
  && FOSSIL?.abilities?.[0]?.effect === '這隻寶可夢在戰鬥場受到對手的寶可夢招式的傷害時，在使用招式的寶可夢身上放置3個傷害指示物。'
  && String(FOSSIL?.rulesText ?? '').startsWith('這張卡可作為HP60的【無】屬性的【基礎】寶可夢放置於場上。')
  && !byId('50290'),
  JSON.stringify({ st: FOSSIL?.supertype, sub: FOSSIL?.subtype, hp: FOSSIL?.hp, legacy: !!byId('50290') }));
chk('0e ⭐急凍鳥｜冰雹（標 J）／勾魂眼｜不祥之眼（標 J）／傳說的熔岩洞 卡面逐字',
  ARTIC?.regulationMark === 'J' && ARTIC_I >= 0
  && ARTIC.attacks[ARTIC_I].effect === '對手的所有寶可夢各受到30點傷害。[在備戰區不計算弱點・抵抗力。]'
  && GOU?.regulationMark === 'J' && GOU_I >= 0
  && GOU.attacks[GOU_I].effect === '在對手的1隻寶可夢身上放置5個傷害指示物。'
  && CAVE?.name === '傳說的熔岩洞',
  JSON.stringify({ a: ARTIC?.attacks?.[ARTIC_I]?.effect, g: GOU?.attacks?.[GOU_I]?.effect, c: CAVE?.name }));
chk('0f 抓得到合成 POST 用的攻擊方／高 HP 靶／備戰中性寶可夢／冰雹靶（全部 H/I/J）',
  !!ATK && !!ATK_ATTACK && ATK_IDX >= 0 && !!TGT && !!NEUTB && !!NEUT2,
  JSON.stringify({ atk: ATK?.name, dmg: ATK_ATTACK?.damage, tgt: TGT?.name, nb: NEUTB?.name, n2: NEUT2?.name }));
chk('0g ⭐胡地｜奇異駭入（標 H）在卡池（【D】監視之眼行為對照用）',
  !!HUDI && HUDI_I >= 0 && HUDI.attacks[HUDI_I].effect.includes('改放'), JSON.stringify({ n: HUDI?.name, i: HUDI_I }));
if (!DUG || !MAG || !OAK || !FOSSIL || !ARTIC || !GOU || !CAVE || !HUDI
  || !ATK || !ATK_ATTACK || !TGT || !NEUTB || !NEUT2) {
  console.log('\n❌ fixture 不齊，無法繼續'); process.exit(1);
}

// ── harness ──────────────────────────────────────────────────────────────────
const TMP = mkdtempSync(join(tmpdir(), 'v6374-'));
process.on('exit', () => { try { rmSync(TMP, { recursive: true, force: true }); } catch { /* noop */ } });
const STRAY = [];
process.on('exit', () => { for (const p of STRAY) { try { unlinkSync(p); } catch { /* noop */ } } });

/** ⚠ entry 要寫在 srcDir 的父目錄、用相對路徑 import（Windows 的 E:/… 會被 esbuild 當成套件名）。 */
async function bundleFrom(srcDir, tag) {
  const parent = dirname(srcDir);
  const name = srcDir.slice(parent.length + 1).replace(/\\/g, '/');
  const p = './' + name;
  const S = join(parent, '.v6374-s-' + tag + '.js'), E = join(parent, '.v6374-e-' + tag + '.ts'), O = join(parent, '.v6374-o-' + tag + '.mjs');
  STRAY.push(S, E, O);
  writeFileSync(S, 'export const base="";export const assets="";');
  writeFileSync(E,
    "export { ATTACK_PRE, ATTACK_POST } from '" + p + "/lib/game/effects/_shared';\n"
    + "export { applyAction } from '" + p + "/lib/game/engine';\n"
    + "import '" + p + "/lib/game/effects';\n");
  await build({
    entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
    alias: { $lib: join(srcDir, 'lib'), '$app/paths': S }, logLevel: 'silent',
  });
  return import(pathToFileURL(O).href);
}

const HEAD = await bundleFrom(join(ROOT, 'src'), 'head');
chk('0h ⭐合成用的那一招在 src/ 裡**沒有**既有的 ATTACK_PRE／ATTACK_POST（不會蓋掉真卡實裝）',
  !HEAD.ATTACK_PRE.get(KEY) && !HEAD.ATTACK_POST.get(KEY), KEY);

let seq = 0;
const inst = (id, extra = {}) => ({
  cardId: String(id), iid: 'i' + (++seq), damage: 0, energyAttached: [], toolAttached: null,
  abilityUsedThisTurn: false, evolvedThisTurn: false, playedFromHand: false, movedToActiveThisTurn: false,
  evolvedFromStack: [], ...extra,
});
const P = (o = {}) => ({ name: 'P', active: null, bench: [], hand: [], deck: [], discard: [], prizes: [], abilityNamesUsedThisTurn: [], ...o });
const mk = (p0, p1, extra = {}) => ({
  phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
  isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true], pendingMulliganDraw: [0, 0],
  pendingPrizes: [0, 0], coinFlippedThisAttack: false, _attackerActiveBonusDone: false,
  activeStadium: null, activeStadiumOwnerIdx: 0, players: [P(p0), P(p1)], ...extra,
});
const heads = (fn) => { const o = Math.random; Math.random = () => 0.1; try { return fn(); } finally { Math.random = o; } };
const run = (MOD, st, a) => heads(() => {
  try { return MOD.applyAction(st, a, pool); }
  catch (e) { return { __err: String(e && e.message ? e.message : e), players: st.players, log: [] }; }
});
const eCost = (c, n) => ((c.attacks || []).find(a => a.name === n)?.cost ?? []).map(t => inst(EID[t] ?? EID.Water));
const filler = (n, id) => Array.from({ length: n }, () => inst(id));
const msgs = (r) => (r?.log ?? []).map(l => String(l?.message ?? l));

// 【A】合成 POST：①依 mode 把持有者移出對手備戰 ②攻擊方 active ↔ bench[0] 自我互換
//   ⇒ applyActionImpl 尾段的中央偵測會觸發 applyOppActiveReturnedToBenchTriggers。
const makePost = (mode, holderId) => (s, ai) => {
  const di = 1 - ai;
  const players = [...s.players];
  if (mode !== 'stay' && mode !== 'none') {
    const dp = { ...players[di] };
    const i = dp.bench.findIndex(b => String(b.cardId) === String(holderId));
    if (i >= 0) {
      const moved = dp.bench[i];
      dp.bench = dp.bench.filter((_, k) => k !== i);
      if (mode === 'deck') dp.deck = [...dp.deck, moved];
      else if (mode === 'hand') dp.hand = [...dp.hand, moved];
      else if (mode === 'discard') dp.discard = [...dp.discard, moved];
    }
    players[di] = dp;
  }
  const ap = { ...players[ai] };
  if (ap.active && ap.bench.length) {
    const old = ap.active;
    ap.active = ap.bench[0];
    ap.bench = [old, ...ap.bench.slice(1)];
  }
  players[ai] = ap;
  return { ...s, players };
};

function runSwap(MOD, holderCard, mode, opts = {}) {
  const orig = MOD.ATTACK_POST.get(KEY);
  MOD.ATTACK_POST.set(KEY, makePost(mode, holderCard.id));
  try {
    const bench = mode === 'none'
      ? [inst(NEUT2.id)]
      : (opts.dup ? [inst(holderCard.id), inst(holderCard.id)] : [inst(holderCard.id)]);
    const st = mk(
      { active: inst(ATK.id, { energyAttached: eCost(ATK, ATK_ATTACK.name) }), bench: [inst(NEUTB.id)],
        deck: filler(3, NEUTB.id), prizes: filler(6, NEUTB.id) },
      { active: inst(TGT.id), bench, deck: filler(3, NEUT2.id), prizes: filler(6, NEUT2.id) },
      opts.cave ? { activeStadium: inst(CAVE.id), activeStadiumOwnerIdx: 1 } : {});
    const r = run(MOD, st, { type: 'ATTACK', attackIndex: ATK_IDX });
    return {
      burned: r?.players?.[0]?.active?.status === 'burned',
      retreaterDmg: (r?.players?.[0]?.bench ?? []).reduce((m, b) => Math.max(m, b.damage ?? 0), 0),
      swapped: (r?.players?.[0]?.bench ?? []).some(b => String(b.cardId) === String(ATK.id)),
      err: r?.__err ?? '',
    };
  } finally { if (orig) MOD.ATTACK_POST.set(KEY, orig); else MOD.ATTACK_POST.delete(KEY); }
}

// 【B】非 ATTACK 路徑（撤退）—— 沒有 _attackTimeHolders，行為必須與 v6.373 相同
function runRetreat(MOD, holderCard, present) {
  const bIid = 'RB1';
  const st = mk(
    { active: inst(NEUTB.id, { energyAttached: filler(4, EID.Colorless) }),
      bench: [inst(NEUT2.id, { iid: bIid })], deck: filler(3, NEUTB.id), prizes: filler(6, NEUTB.id) },
    { active: inst(TGT.id), bench: present ? [inst(holderCard.id)] : [inst(NEUT2.id)],
      deck: filler(3, NEUT2.id), prizes: filler(6, NEUT2.id) });
  const r = run(MOD, st, { type: 'RETREAT', newActiveIid: bIid });
  return {
    burned: r?.players?.[0]?.active?.status === 'burned',
    retreaterDmg: (r?.players?.[0]?.bench ?? []).reduce((m, b) => Math.max(m, b.damage ?? 0), 0),
    err: r?.__err ?? '',
  };
}

// 【C】頭蓋尖刺：真卡 急凍鳥｜冰雹（對手全體各 30）＋ 勾魂眼｜不祥之眼（放 5 個指示物）
/** ⚠ 只認**反擊本身**那一行 log；「被擊倒！」「不祥之眼：對 陳舊的頭蓋化石 造成…」都含卡名，不能只比對卡名。 */
const RETAL_LOG = /^陳舊的頭蓋化石：在 .+ 身上放置 \d+ 個傷害指示物/;
function runHail(MOD, p1Active, p1Bench) {
  const st = mk(
    { active: inst(ARTIC.id, { energyAttached: eCost(ARTIC, '冰雹') }), bench: [inst(NEUT2.id)],
      deck: filler(3, NEUT2.id), prizes: filler(6, NEUT2.id) },
    { active: p1Active, bench: p1Bench, deck: filler(3, NEUT2.id), prizes: filler(6, NEUT2.id) });
  const r = run(MOD, st, { type: 'ATTACK', attackIndex: ARTIC_I });
  return { atk: r?.players?.[0]?.active?.damage ?? -999, logs: msgs(r).filter(m => RETAL_LOG.test(m)).length, err: r?.__err ?? '' };
}
function runEvilEye(MOD) {
  const st = mk(
    { active: inst(GOU.id, { energyAttached: eCost(GOU, '不祥之眼') }), bench: [inst(NEUT2.id)],
      deck: filler(3, NEUT2.id), prizes: filler(6, NEUT2.id) },
    { active: inst(FOSSIL.id, { fossilOnField: true }), bench: [inst(NEUT2.id)],
      deck: filler(3, NEUT2.id), prizes: filler(6, NEUT2.id) });
  let r = run(MOD, st, { type: 'ATTACK', attackIndex: GOU_I });
  if (r?.pendingSelection) {
    const tgt = r.players?.[1]?.active?.iid;
    r = run(MOD, r, { type: 'RESOLVE_SELECTION', selectedIids: [tgt], actorIdx: 0, senderIdx: 0, effectKey: r.pendingSelection.effectKey });
  }
  return { atk: r?.players?.[0]?.active?.damage ?? -999, fossilDmg: r?.players?.[1]?.active?.damage ?? -999,
    logs: msgs(r).filter(m => RETAL_LOG.test(m)).length, err: r?.__err ?? '' };
}

// 【D】監視之眼：機制仍活著（胡地｜奇異駭入 的「改放」被擋）
function runHudi(MOD, oakOnField) {
  const st = mk(
    { active: inst(HUDI.id, { energyAttached: eCost(HUDI, '奇異駭入') }),
      bench: oakOnField ? [inst(OAK.id)] : [inst(NEUT2.id)], deck: filler(3, NEUT2.id), prizes: filler(6, NEUT2.id) },
    { active: inst(NEUT2.id, { damage: 50 }), bench: [inst(NEUT2.id)], deck: filler(3, NEUT2.id), prizes: filler(6, NEUT2.id) });
  const r = run(MOD, st, { type: 'ATTACK', attackIndex: HUDI_I });
  return { blocked: msgs(r).some(m => /監視之眼/.test(m)), pending: r?.pendingSelection ? r.pendingSelection.type : 'null', err: r?.__err ?? '' };
}

/** 整個行為矩陣（HEAD 與 BASE 各跑一次）。 */
function matrix(MOD) {
  const m = { err: '' };
  for (const [tag, card] of [['mag', MAG], ['pit', DUG]]) {
    for (const mode of ['stay', 'discard', 'deck', 'hand', 'none']) {
      const r = runSwap(MOD, card, mode);
      m[tag + '_' + mode] = tag === 'mag' ? (r.burned ? 1 : 0) : r.retreaterDmg;
      m[tag + '_' + mode + '_sw'] = r.swapped ? 1 : 0;
      if (r.err) m.err += ' ' + tag + '/' + mode + ':' + r.err;
    }
    const rc = runSwap(MOD, card, 'discard', { cave: true });
    m[tag + '_cave'] = tag === 'mag' ? (rc.burned ? 1 : 0) : rc.retreaterDmg;
    const rcs = runSwap(MOD, card, 'stay', { cave: true });
    m[tag + '_cave_stay'] = tag === 'mag' ? (rcs.burned ? 1 : 0) : rcs.retreaterDmg;
  }
  m.pit_dup_stay = runSwap(MOD, DUG, 'stay', { dup: true }).retreaterDmg;
  m.pit_dup_discard = runSwap(MOD, DUG, 'discard', { dup: true }).retreaterDmg;
  m.pit_dup_deck = runSwap(MOD, DUG, 'deck', { dup: true }).retreaterDmg;
  const rtM = runRetreat(MOD, MAG, true), rtM0 = runRetreat(MOD, MAG, false);
  const rtP = runRetreat(MOD, DUG, true), rtP0 = runRetreat(MOD, DUG, false);
  m.rt_mag = rtM.burned ? 1 : 0; m.rt_mag0 = rtM0.burned ? 1 : 0;
  m.rt_pit = rtP.retreaterDmg; m.rt_pit0 = rtP0.retreaterDmg;
  m.err += (rtM.err ? ' rtM:' + rtM.err : '') + (rtP.err ? ' rtP:' + rtP.err : '');
  const F = (e = {}) => inst(FOSSIL.id, { fossilOnField: true, ...e });
  const hBoth = runHail(MOD, F(), [F(), inst(NEUT2.id)]);
  const hBench = runHail(MOD, inst(NEUT2.id), [F()]);
  const hKo = runHail(MOD, F({ damage: 40 }), [inst(NEUT2.id)]);
  const hNone = runHail(MOD, inst(NEUT2.id), [inst(NEUT2.id)]);
  m.fo_both = hBoth.atk; m.fo_both_logs = hBoth.logs;
  m.fo_bench = hBench.atk; m.fo_ko = hKo.atk; m.fo_ko_logs = hKo.logs; m.fo_none = hNone.atk;
  const ee = runEvilEye(MOD);
  m.fo_counter_atk = ee.atk; m.fo_counter_dmg = ee.fossilDmg; m.fo_counter_logs = ee.logs;
  const hu1 = runHudi(MOD, true), hu0 = runHudi(MOD, false);
  m.oak_blocked = hu1.blocked ? 1 : 0; m.oak_free = hu0.blocked ? 1 : 0; m.oak_free_pending = hu0.pending;
  return m;
}
const H = matrix(HEAD);

console.log('\n【A】⭐⭐⭐(甲) 站長裁定 A-2：凹洞／熔岩地域 接上「宣告當時」中央述詞');
chk('A0 哨兵：合成 POST 真的做出「攻擊方戰鬥寶可夢回到自己備戰區」（不然整節是空真）',
  H.mag_stay_sw === 1 && H.pit_stay_sw === 1 && H.mag_discard_sw === 1 && H.pit_discard_sw === 1,
  JSON.stringify([H.mag_stay_sw, H.pit_stay_sw, H.mag_discard_sw, H.pit_discard_sw]) + (H.err ? ' err=' + H.err : ''));
chk('A1 哨兵（v6.373 既有行為）：熔岩蝸牛**留在備戰** ⇒ 新上場的寶可夢【灼傷】', H.mag_stay === 1, String(H.mag_stay));
chk('A2 哨兵：對手場上**沒有**熔岩蝸牛 ⇒ 不灼傷（A1 不是恆真）', H.mag_none === 0, String(H.mag_none));
chk('A3 ⭐⭐⭐核心：熔岩蝸牛被**這一次招式**打到昏厥離場（進棄牌區）⇒ 仍然【灼傷】',
  H.mag_discard === 1, String(H.mag_discard));
chk('A4 ⭐反對照：持有者被**洗回牌庫**（主動移除）⇒ 不灼傷', H.mag_deck === 0, String(H.mag_deck));
chk('A5 ⭐反對照：持有者被**放回手牌**（主動移除）⇒ 不灼傷', H.mag_hand === 0, String(H.mag_hand));
chk('A6 ⭐反對照：宣告當時特性就被【傳說的熔岩洞】消除（熔岩蝸牛是 1 階進化）⇒ 即使進棄牌區也不灼傷',
  H.mag_cave === 0, String(H.mag_cave));
chk('A7 哨兵（v6.373 既有行為）：火箭隊的三地鼠**留在備戰** ⇒ 回備戰那隻 +2 個指示物（20）',
  H.pit_stay === 20, String(H.pit_stay));
chk('A8 哨兵：對手場上**沒有**三地鼠 ⇒ 0 點（A7 不是恆真）', H.pit_none === 0, String(H.pit_none));
chk('A9 ⭐⭐⭐核心：三地鼠被**這一次招式**打到昏厥離場 ⇒ 仍然放 2 個指示物（20）',
  H.pit_discard === 20, String(H.pit_discard));
chk('A10 ⭐反對照：三地鼠被**洗回牌庫**／**放回手牌** ⇒ 0 點',
  H.pit_deck === 0 && H.pit_hand === 0, JSON.stringify([H.pit_deck, H.pit_hand]));
chk('A11 ⭐反對照：宣告當時特性就被【傳說的熔岩洞】消除 ⇒ 0 點', H.pit_cave === 0, String(H.pit_cave));
chk('A11b ⭐⭐(v6.196 現況鎖) 持有者**還在場上**但特性被【傳說的熔岩洞】消除 ⇒ 一樣不生效'
  + '（證明逐隻掃描確實帶著特性消除 gate，不是只看「卡片有沒有印這個特性」）',
  H.mag_cave_stay === 0 && H.pit_cave_stay === 0, JSON.stringify([H.mag_cave_stay, H.pit_cave_stay]));
chk('A11c ⭐正對照：同一個盤面**拿掉競技場** ⇒ 兩者都生效（A11b 不是恆真）',
  H.mag_stay === 1 && H.pit_stay === 20, JSON.stringify([H.mag_stay, H.pit_stay]));
chk('A12 ⭐⭐疊加＋去重：兩隻三地鼠都活著 ⇒ 40；一隻活一隻昏厥離場 ⇒ 仍然 40（不重複計、也不漏計）',
  H.pit_dup_stay === 40 && H.pit_dup_discard === 40, JSON.stringify([H.pit_dup_stay, H.pit_dup_discard]));
chk('A13 ⭐⭐疊加反對照：兩隻三地鼠、其中一隻被**洗回牌庫** ⇒ 只剩 20（證明不是「有快照就全算」）',
  H.pit_dup_deck === 20, String(H.pit_dup_deck));
chk('A14 ⭐「不同結果」本身：棄牌區 與 牌庫／手牌 必須真的不一樣（兩張卡各一組）',
  H.mag_discard !== H.mag_deck && H.pit_discard !== H.pit_deck,
  JSON.stringify([H.mag_discard, H.mag_deck, H.pit_discard, H.pit_deck]));

console.log('\n【B】⭐(甲) 非 ATTACK 路徑（撤退）行為零變更 —— 沒有 _attackTimeHolders 時判準必須退化成原樣');
chk('B1 撤退：對手備戰有熔岩蝸牛 ⇒ 新上場的寶可夢【灼傷】', H.rt_mag === 1, String(H.rt_mag) + ' err=' + H.err);
chk('B2 撤退反對照：沒有熔岩蝸牛 ⇒ 不灼傷', H.rt_mag0 === 0, String(H.rt_mag0));
chk('B3 撤退：對手備戰有三地鼠 ⇒ 撤退回去那隻 +20', H.rt_pit === 20, String(H.rt_pit));
chk('B4 撤退反對照：沒有三地鼠 ⇒ 0 點', H.rt_pit0 === 0, String(H.rt_pit0));

console.log('\n【C】⭐(丙) A-7 陳舊的頭蓋化石｜頭蓋尖刺 —— 現況鎖（v5.494 既有實裝，本版不改一行）');
chk('C1 ⭐⭐化石在**戰鬥場**受到招式傷害 ⇒ 在**使用招式的寶可夢**身上放 **3 個**指示物（30）；'
  + '同一招同時打到備戰的另一隻化石**不追加**（只算戰鬥場那一隻，log 恰好一行）',
  H.fo_both === 30 && H.fo_both_logs === 1, JSON.stringify([H.fo_both, H.fo_both_logs]));
chk('C2 ⭐反對照：化石只在**備戰**被狙擊（冰雹也打備戰）⇒ 完全不反擊（卡面「在戰鬥場」）',
  H.fo_bench === 0, String(H.fo_bench));
chk('C3 ⭐⭐站長 C-7 家族：化石被**同一招**打到昏厥離場 ⇒ 仍然放 3 個指示物（30），且只放一次',
  H.fo_ko === 30 && H.fo_ko_logs === 1, JSON.stringify([H.fo_ko, H.fo_ko_logs]));
chk('C4 哨兵：完全沒有化石時 0 點（C1/C3 不是恆真）', H.fo_none === 0, String(H.fo_none));
chk('C5 ⭐⭐反對照：化石在戰鬥場、但傷害是**放置傷害指示物**（勾魂眼｜不祥之眼 5 個＝50）'
  + '而非「招式的傷害」⇒ **不反擊**',
  H.fo_counter_dmg === 50 && H.fo_counter_atk === 0 && H.fo_counter_logs === 0,
  JSON.stringify([H.fo_counter_dmg, H.fo_counter_atk, H.fo_counter_logs]));

console.log('\n【D】⭐(乙) A-9 探探鼠｜監視之眼 —— 「自動納管」不成立，且目前卡池無可觸發情境');
const sharedSrc = readFileSync(join(ROOT, 'src/lib/game/effects/_shared.ts'), 'utf8');
chk('D1 ⭐靜態事實：hasOakEye 是**純 live** 述詞 —— 完全沒有接上「宣告當時」中央述詞'
  + '（⇒ 簡報說的「v6.373 做完就自動納管」不成立）',
  count(sharedSrc, 'export function hasOakEye(') === 1
  && !sharedSrc.includes('isEffectiveAsOfDeclaration')
  && !sharedSrc.includes('_attackTimeHolders'));
/** ⭐ 資料驅動的不可觸發性：卡池裡所有「改放／移放傷害指示物」的招式，damage 全部不是數值。 */
function counterMoveAttacks() {
  const out = [];
  for (const c of all) {
    if (!HIJ(c)) continue;
    for (const a of (c.attacks || [])) {
      if (!/改放|移放/.test(String(a.effect ?? ''))) continue;
      out.push({ card: c.name, atk: a.name, dmg: String(a.damage ?? ''), numeric: /^\d+$/.test(String(a.damage ?? '')) });
    }
  }
  return out;
}
const CMA = counterMoveAttacks();
chk('D2 哨兵：卡池裡確實存在「改放傷害指示物」的招式（D3 不是空真）',
  CMA.length >= 6, String(CMA.length));
chk('D3 ⭐⭐不可觸發性（資料驅動，卡池一變就會翻紅）：所有「改放傷害指示物」的招式 damage 全部**非數值**'
  + ' ⇒ 招式宣告後不可能把監視之眼的持有者打到離場 ⇒ 現在接上中央述詞只會得到恆真斷言',
  CMA.every(x => !x.numeric), JSON.stringify(CMA.filter(x => x.numeric)));
chk('D4 ⭐另兩個消費點是**特性**（腎上腺腦力／火箭腦力）＝ USE_ABILITY 路徑，'
  + '不是 ATTACK ⇒ 永遠沒有 _attackTimeHolders 快照',
  count(sharedSrc, "'腎上腺腦力'") === 1 && count(sharedSrc, "'火箭腦力'") === 1
  && sharedSrc.includes('MOVE_DAMAGE_COUNTER_ABILITIES'));
chk('D5 ⭐行為：監視之眼在場 ⇒ 胡地｜奇異駭入 的「改放」被擋（機制仍然活著，不是死碼）',
  H.oak_blocked === 1, String(H.oak_blocked));
chk('D6 ⭐反對照：場上沒有探探鼠 ⇒ 不會出現「被監視之眼擋下」的 log（D5 不是恆真）',
  H.oak_free === 0, JSON.stringify([H.oak_free, H.oak_free_pending]));

console.log('\n【E】⭐中央性：一個判準一份，消費點不得自寫快照讀取');
const asofPath = join(ROOT, 'src/lib/game/as-of-declaration.ts');
const asof = readFileSync(asofPath, 'utf8');
const g3Src = readFileSync(join(ROOT, 'src/lib/game/effects/cards/v3001_g3_wave3.ts'), 'utf8');
const effSrc = readFileSync(join(ROOT, 'src/lib/game/effects.ts'), 'utf8');
const engSrc = readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8');
const typSrc = readFileSync(join(ROOT, 'src/lib/game/types.ts'), 'utf8');
const ABIL = (() => {
  const m = asof.match(/AS_OF_DECLARATION_ABILITIES[^=]*=\s*\[([\s\S]*?)\n\];/);
  return m ? [...m[1].matchAll(/^\s*'([^']+)',/gm)].map(x => x[1]) : [];
})();
// ⭐v6375-abilities-list-grows：這份名單是**會成長**的——v6.375 又接上了
//   field-wide 減傷 5 張 ＋ 漩渦言靈。原本寫死「恰好 7 個」，每接一張就假紅一次
//   （v6.375 實測：本條是全 chain 裡唯一因為 v6.375 合法變更而翻紅的斷言）。
//   ⭐ 改成「這 7 個都還在、沒被刪掉」＋數量下限，仍然守得住「有人把名單清空」。
chk('E1 ⭐AS_OF_DECLARATION_ABILITIES 含 v6.373 的五個 ＋ v6.374 的「凹洞」「熔岩地域」（名單可再成長，見 ⭐v6375-abilities-list-grows）',
  ABIL.length >= 7
  && ['花之帷幔', '抵抗之幕', '球形盾牌', '平穩境地', '生命制約', '凹洞', '熔岩地域'].every(n => ABIL.includes(n)),
  JSON.stringify(ABIL));
chk('E2 ⭐「監視之眼」與「頭蓋尖刺」刻意**不在**名單裡（理由見【D】與本檔檔頭）',
  !ABIL.includes('監視之眼') && !ABIL.includes('頭蓋尖刺'), JSON.stringify(ABIL));
const SRC_FILES = [];
(function walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p); else if (e.name.endsWith('.ts')) SRC_FILES.push(p);
  }
})(join(ROOT, 'src'));
const WIDE_RE = /\|\|\s*(?:state|s|next|workingState|st)\._attackTime\w+/g;
const wideHits = (txt) => (txt.match(WIDE_RE) ?? []).length;
let wideTotal = 0; const wideWhere = [];
for (const p of SRC_FILES) { const n = wideHits(readFileSync(p, 'utf8')); if (n) { wideTotal += n; wideWhere.push(p.slice(ROOT.length) + 'x' + n); } }
chk('E3 ⭐⭐⭐src/ 全掃：過寬寫法 0 處（沿用 v6.373 守衛 F1 的掃描器形狀）',
  wideTotal === 0, JSON.stringify(wideWhere));
chk('E4 ⭐正對照：偵測器對樣本字串算得到（E3 不是恆真）',
  wideHits('if (live || state._attackTimeOppFlowerVeil) {}') === 1
  && wideHits('const a = state._attackTimeHolders;') === 0);
/** 去掉 // 行註解與 block 註解（斷言要看**程式碼**，不能被註解裡的欄位名誤導）。 */
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '');
/** ⭐ 枚舉式掃描：src/ 裡誰的**程式碼**直接讀 _attackTimeHolders。 */
const holderReaders = SRC_FILES.filter(p => stripComments(readFileSync(p, 'utf8')).includes('_attackTimeHolders'))
  .map(p => p.slice(ROOT.length).replace(/\\/g, '/')).sort();
chk('E5 ⭐⭐直接碰 _attackTimeHolders 的檔案恰好 3 個：types.ts（宣告）／engine.ts（設定＋清除）／'
  + 'as-of-declaration.ts（唯一消費入口）—— 消費點（v3001_g3_wave3.ts）一律透過中央述詞',
  holderReaders.length === 3
  && holderReaders.includes('src/lib/game/types.ts')
  && holderReaders.includes('src/lib/game/engine.ts')
  && holderReaders.includes('src/lib/game/as-of-declaration.ts'),
  JSON.stringify(holderReaders));
chk('E5b ⭐正對照：stripComments 真的有作用（E5 不是「掃不到就綠」）—— v3001_g3_wave3.ts 的'
  + '**註解**提到 _attackTimeHolders，但**程式碼**沒有',
  g3Src.includes('_attackTimeHolders') && !stripComments(g3Src).includes('_attackTimeHolders')
  && stripComments('const x = state._attackTimeHolders;').includes('_attackTimeHolders'));
/** 取 as-of-declaration.ts 裡某個 export function 的函式本體（到第一個行首 '}' 為止）。 */
function bodyOf(src, fnName) {
  const i = src.indexOf('export function ' + fnName + '(');
  if (i < 0) return '';
  const j = src.indexOf('\n}', i);
  return j < 0 ? src.slice(i) : src.slice(i, j + 2);
}
const IIDS_BODY = bodyOf(asof, 'asOfDeclarationHolderIids');
chk('E6 ⭐⭐判準核心只有一份：declarationHolderStillCounts 定義 1 處；'
  + '本版新入口 asOfDeclarationHolderIids 逐一交給它，**函式本體內沒有**自寫第二份區位判斷'
  + '（不得出現 hand／deck／discard／bench／active 的比對）',
  count(asof, 'export function declarationHolderStillCounts(') === 1
  && count(asof, 'export function asOfDeclarationHolderIids(') === 1
  && IIDS_BODY.length > 0
  && count(IIDS_BODY, 'declarationHolderStillCounts(state, holderIdx, [iid])') === 1
  && !/\b(hand|deck|discard|bench|active)\b/.test(IIDS_BODY),
  JSON.stringify({ core: count(asof, 'export function declarationHolderStillCounts('), len: IIDS_BODY.length,
    leak: (IIDS_BODY.match(/\b(hand|deck|discard|bench|active)\b/g) ?? []) }));
chk('E6b ⭐正對照：bodyOf 抓得到本體，且對「自寫區位判斷」的樣本會判紅（E6 不是恆真）',
  bodyOf(asof, 'declarationHolderStillCounts').includes('p.hand?.some')
  && /\b(hand|deck)\b/.test('if (p.hand?.some(x => x.iid === iid)) continue;'),
  String(bodyOf(asof, 'declarationHolderStillCounts').length));
chk('E7 ⭐v6.373 的六個消費點沒有被動到（effects.ts 5 處 ＋ v3001_g3_wave3.ts 2 處 isEffectiveAsOfDeclaration）',
  count(effSrc, 'isEffectiveAsOfDeclaration(') === 5 && count(g3Src, 'isEffectiveAsOfDeclaration(') === 2,
  JSON.stringify([count(effSrc, 'isEffectiveAsOfDeclaration('), count(g3Src, 'isEffectiveAsOfDeclaration(')]));
chk('E8 ⭐(甲) 的兩個消費點都走 asOfDeclarationHolderIids，且逐隻掃描只有一份'
  + '（countEffectiveAbilityOnSide ＝ effectiveAbilityHolderIidsOnSide().length）',
  count(g3Src, 'asOfDeclarationHolderIids(state, oppIdx,') === 2
  && count(g3Src, 'export function effectiveAbilityHolderIidsOnSide(') === 1
  && count(g3Src, 'return effectiveAbilityHolderIidsOnSide(state, ownerIdx, pool, abilityName).length;') === 1,
  JSON.stringify([count(g3Src, 'asOfDeclarationHolderIids(state, oppIdx,'),
    count(g3Src, 'export function effectiveAbilityHolderIidsOnSide(')]));
chk('E9 ⭐本版**沒有**新增 GameState 欄位（沿用 v6.373 的 _attackTimeHolders，形狀仍是 { p1, p2 } 物件 map）',
  /_attackTimeHolders\?:\s*\{\s*p1:\s*Record<string,\s*string\[\]>;\s*p2:\s*Record<string,\s*string\[\]>;?\s*\}/.test(typSrc),
  (typSrc.match(/_attackTimeHolders\?:[^\n]*/) ?? ['(找不到)'])[0]);
chk('E10 ⭐(丙) 現況事實複驗：頭蓋尖刺走的是**卡名** key 的 INHERENT_RETALIATION（3 個指示物），'
  + '不是特性 dispatch ⇒ 本版沒有動它',
  count(effSrc, "['陳舊的頭蓋化石', 3]") === 1
  && count(effSrc, 'export const INHERENT_RETALIATION') === 1
  && count(effSrc, 'export function applyInherentRetaliation(') === 1
  // ⚠ Rule 40（v6.427）：兩個呼叫點多傳第 5 個參數（持有者實例，頭蓋尖刺卡面是「特性」⇒ 特性消除閘），
  //   本條要守的意圖（仍以卡名為 key、engine KO／非 KO 兩處都有接線）不變 ⇒ 觀測點改成不含右括號的前綴。
  && count(engSrc, 'applyInherentRetaliation(newState, dIdx, defenderCard, pool') === 2,
  JSON.stringify([count(effSrc, "['陳舊的頭蓋化石', 3]"),
    count(engSrc, 'applyInherentRetaliation(newState, dIdx, defenderCard, pool')]));

// ══════════════════════════════════════════════════════════════════════════════
// 【F】HEAD-FAIL 對 BASE
// ══════════════════════════════════════════════════════════════════════════════
const BASE = process.env.V6374_BASE || BASE_SHA;
console.log('\n【F】HEAD-FAIL：對 BASE(' + BASE.slice(0, 8) + ' ＝ v6.373，本版的上一版) 重跑整個行為矩陣');
if (!hasBaseCommit(ROOT, BASE)) {
  shallowSkip('【F】HEAD-FAIL 對 BASE 的重建比對', '【A】~【E】都不需要歷史，仍在守');
} else {
  const baseSrc = join(TMP, 'base-src');
  cpSync(join(ROOT, 'src'), baseSrc, { recursive: true });
  const r = restoreBaseSubtree(ROOT, BASE, baseSrc, 'src');
  if (chk('F0 BASE 樹重建成功（整個 src/ 子樹）', r.ok, r.reason ?? ('replaced=' + r.replaced + ' removed=' + r.removed))) {
    const BMOD = await bundleFrom(baseSrc, 'base');
    const B = matrix(BMOD);
    chk('F1 哨兵：BASE bundle 是活的（哨兵情境照樣綠，不是整支爆掉造成的「全紅」）',
      B.mag_stay === 1 && B.pit_stay === 20 && B.mag_none === 0 && B.pit_none === 0,
      JSON.stringify({ ms: B.mag_stay, ps: B.pit_stay, mn: B.mag_none, pn: B.pit_none, err: B.err }));
    chk('F2 ⭐⭐⭐(甲) BASE 一定要紅：熔岩蝸牛被同一招打到昏厥離場後，BASE **不灼傷**、HEAD 灼傷',
      B.mag_discard === 0 && H.mag_discard === 1, 'BASE=' + B.mag_discard + ' HEAD=' + H.mag_discard);
    chk('F3 ⭐⭐⭐(甲) BASE 一定要紅：三地鼠被同一招打到昏厥離場後，BASE **0 點**、HEAD 20 點',
      B.pit_discard === 0 && H.pit_discard === 20, 'BASE=' + B.pit_discard + ' HEAD=' + H.pit_discard);
    chk('F4 ⭐⭐(甲) BASE 一定要紅：兩隻三地鼠、一隻昏厥離場 ⇒ BASE 20、HEAD 40',
      B.pit_dup_discard === 20 && H.pit_dup_discard === 40, 'BASE=' + B.pit_dup_discard + ' HEAD=' + H.pit_dup_discard);
    chk('F5 ⭐⭐零變更：持有者**留在場上** BASE 與 HEAD 逐字相同',
      B.mag_stay === H.mag_stay && B.pit_stay === H.pit_stay && B.pit_dup_stay === H.pit_dup_stay,
      JSON.stringify([B.mag_stay, B.pit_stay, B.pit_dup_stay]));
    chk('F6 ⭐⭐零變更：持有者被**洗回牌庫／放回手牌**（主動移除）BASE 與 HEAD 都不生效',
      B.mag_deck === H.mag_deck && B.mag_hand === H.mag_hand
      && B.pit_deck === H.pit_deck && B.pit_hand === H.pit_hand && B.pit_dup_deck === H.pit_dup_deck,
      JSON.stringify([B.mag_deck, B.mag_hand, B.pit_deck, B.pit_hand, B.pit_dup_deck]));
    chk('F7 ⭐⭐零變更：特性被【傳說的熔岩洞】消除 BASE 與 HEAD 都不生效',
      B.mag_cave === H.mag_cave && B.pit_cave === H.pit_cave && H.mag_cave === 0 && H.pit_cave === 0,
      JSON.stringify([B.mag_cave, B.pit_cave]));
    chk('F7b ⭐⭐零變更：持有者還在場上但特性被【傳說的熔岩洞】消除，BASE 與 HEAD 都不生效',
      B.mag_cave_stay === H.mag_cave_stay && B.pit_cave_stay === H.pit_cave_stay
      && H.mag_cave_stay === 0 && H.pit_cave_stay === 0,
      JSON.stringify([B.mag_cave_stay, B.pit_cave_stay]));
    chk('F8 ⭐⭐零變更：撤退路徑（非 ATTACK）四條 BASE 與 HEAD 逐字相同',
      B.rt_mag === H.rt_mag && B.rt_mag0 === H.rt_mag0 && B.rt_pit === H.rt_pit && B.rt_pit0 === H.rt_pit0,
      JSON.stringify([B.rt_mag, B.rt_mag0, B.rt_pit, B.rt_pit0]));
    chk('F9 ⭐⭐(丙) 零變更：頭蓋尖刺五條（戰鬥場 30／備戰 0／被 KO 仍 30／無化石 0／指示物不算傷害 0）'
      + ' BASE 與 HEAD 逐字相同 ⇒ 本版**沒有**新實裝這張卡（它在 BASE 就已經完整運作）',
      B.fo_both === H.fo_both && B.fo_bench === H.fo_bench && B.fo_ko === H.fo_ko
      && B.fo_none === H.fo_none && B.fo_counter_atk === H.fo_counter_atk
      && B.fo_both_logs === H.fo_both_logs && B.fo_ko_logs === H.fo_ko_logs && H.fo_ko === 30,
      JSON.stringify([B.fo_both, B.fo_bench, B.fo_ko, B.fo_none, B.fo_counter_atk]));
    chk('F10 ⭐⭐(乙) 零變更：監視之眼兩條 BASE 與 HEAD 逐字相同 ⇒ 本版**沒有**動它',
      B.oak_blocked === H.oak_blocked && B.oak_free === H.oak_free && H.oak_blocked === 1,
      JSON.stringify([B.oak_blocked, B.oak_free]));
    const baseAsof = readFileSync(join(baseSrc, 'lib/game/as-of-declaration.ts'), 'utf8');
    chk('F11 ⭐結構 BASE 一定要紅：BASE 的 AS_OF_DECLARATION_ABILITIES **沒有**凹洞／熔岩地域，'
      + '也沒有 asOfDeclarationHolderIids；HEAD 兩者都有',
      !baseAsof.includes("'凹洞'") && !baseAsof.includes("'熔岩地域'")
      && !baseAsof.includes('asOfDeclarationHolderIids')
      && asof.includes("'凹洞'") && asof.includes("'熔岩地域'")
      && asof.includes('asOfDeclarationHolderIids'));
  }
}

console.log('\n=== v6.374 守衛：PASS ' + pass + ' / FAIL ' + fail + ' ===');
process.exit(fail === 0 ? 0 : 1);
