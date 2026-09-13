// v6.367 守衛：**攻擊方**那一側的「在造成傷害前…」快照也要對齊（站長裁定 六-9）
//
// ⚠⚠ 根因（與 v6.351 修掉的防守方那一半是同一個洞）：
//   `const attacker = { ...players[aIdx] }` 是在 handlePlaying 最上面就抓走的快照，
//   而整條傷害管線讀的都是那個快照 —— damageBonusThisTurn／nextOwnAttackPenalty／
//   gladionDuelBonusThisTurn／伏特【雷】能量張數／攻擊方道具 +N／被動特性 +N／
//   damageBoostFightingThisTurn／getAttackerEffectiveTypes（弱點・抵抗力）…
//   ⇒ 卡面寫「在造成傷害前，…（改變攻擊方自己的狀態）」的 ATTACK_PRE 效果，
//     對**這一次**的傷害結算完全無效。
//   v6.351 只對齊了 defender（`Object.assign(defender, workingState.players[dIdx])`）。
//   v6.367 補上 attacker 側：哨兵 `v6367-attacker-pre-baseline` ＋ `v6367-resync-attacker-after-pre`。
//   ⚠ attacker 不能照抄那一行 Object.assign（整份覆蓋會蓋掉 PRE 之前發生的變更）⇒
//     改成「**只把 PRE 造成的差異疊上去**」：逐欄位比對 PRE 前／後的 PlayerState。
//
// ⚠⚠ 目前**沒有任何實卡**會踩到這個洞（要「在造成傷害前改變攻擊方自己、而且那個狀態會影響傷害」），
//   所以本檔一律用**合成 ATTACK_PRE**（在本守衛裡 `ATTACK_PRE.set(...)` 註冊、try/finally 還原）。
//   ⛔ 絕對不可以把測試用的東西寫進 `src/`。
//
// 斷言分層：
//   【A】行為端 —— 合成 PRE 改攻擊方的各層欄位（player-level／active-level／active 的能量），
//        這一次的傷害必須跟著變（HEAD 綠、BASE 紅）。
//   【B】哨兵 —— 同一個 harness 改防守方 ⇒ v6.351 已經生效（HEAD 與 BASE 都綠 ⇒ harness 是活的）。
//   【C】⭐ PRE 之前發生的變更不可以被蓋掉（旗標清除／能量／PRE 沒碰過的欄位）—— 行為零變更的證明。
//   【D】既有 9 張「在造成傷害前…」卡零變更 ⇒ 直接重跑 v6.351 的守衛，必須 exit=0。
//   【E】中央性 —— 對齊動作只有一處、而且在 PRE 之後；baseline 在 PRE 之前。
//   【F】HEAD-FAIL —— 對 BASE(912e9bf5 ＝ v6.366) 重跑整個矩陣。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = '912e9bf55256a13d6596456d55fc6190473f3973';   // v6.366（v6.367 的上一版）

let pass = 0, fail = 0;
const chk = (name, ok, extra = '') => {
  if (ok) { console.log('  PASS ' + name); pass++; } else { console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')); fail++; }
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
const NONRULE = (c) => c.subtype !== 'ex' && !/(ex|EX|V|VMAX|VSTAR)$/.test(String(c.name));

/** 攻擊方：【雷】/基礎/無特性/無 tag/非規則寶可夢，且有一招「純數字傷害、卡面無效果文」。 */
const ATK = all.find(c => c.supertype === 'Pokemon' && c.pokemonType === 'Lightning'
  && (c.stage ?? c.subtype) === 'Basic' && !(c.abilities || []).length && !(c.tags || []).length && NONRULE(c)
  && (c.attacks || []).some(a => /^\d+$/.test(String(a.damage)) && Number(a.damage) > 0 && !String(a.effect ?? '').trim()
    && (a.cost || []).length === 1));
const ATK_ATTACK = ATK ? (ATK.attacks.find(a => /^\d+$/.test(String(a.damage)) && Number(a.damage) > 0
  && !String(a.effect ?? '').trim() && (a.cost || []).length === 1)) : null;
const ATK_IDX = ATK && ATK_ATTACK ? ATK.attacks.findIndex(a => a.name === ATK_ATTACK.name) : -1;
const BASE_DMG = ATK_ATTACK ? Number(ATK_ATTACK.damage) : -1;
const KEY = ATK && ATK_ATTACK ? `${ATK.name}|${ATK_ATTACK.name}` : 'x|y';

/** 靶：非規則寶可夢、無特性、無 tag、HP 夠高不會被打倒、對【雷】不弱也不抗（弱抗會把數字打歪）。 */
const TGT = all.find(c => c.supertype === 'Pokemon' && !(c.abilities || []).length && !(c.tags || []).length
  && NONRULE(c) && Number(c.hp) >= 150
  && c.weakness?.type !== 'Lightning' && c.resistance?.type !== 'Lightning');

const VOLT = all.find(c => c.name === '伏特【雷】能量');          // 特殊能量：附有它的【雷】寶可夢招式 +20／張
const BASIC_L = all.find(c => c.name === '基本【雷】能量');

console.log('\n【0】fixture 自驗（Rule 25：抽不到卡要大聲紅，不可以靜默全綠）');
chk('0a 抓得到合用的【雷】攻擊方（基礎／無特性／非規則／單費純數字招式）',
  !!ATK && !!ATK_ATTACK && ATK_IDX >= 0 && BASE_DMG > 0,
  JSON.stringify({ atk: ATK?.name, attack: ATK_ATTACK?.name, idx: ATK_IDX, dmg: BASE_DMG }));
chk('0b 抓得到合用的靶（非規則／無特性／HP≥150／對【雷】不弱不抗）',
  !!TGT && Number(TGT.hp) >= 150, JSON.stringify({ tgt: TGT?.name, hp: TGT?.hp, w: TGT?.weakness?.type, r: TGT?.resistance?.type }));
chk('0c 抓得到 伏特【雷】能量 與 基本【雷】能量', !!VOLT && !!BASIC_L,
  JSON.stringify([VOLT?.name, BASIC_L?.name]));
chk('0d ⭐這一招的基礎傷害 + 最大加成不會把靶打倒（打倒會讓 damage 讀不到，變成空真）',
  !!TGT && BASE_DMG > 0 && BASE_DMG + 80 < Number(TGT.hp), `${BASE_DMG}+80 vs HP${TGT?.hp}`);
if (!ATK || !TGT || !VOLT || !BASIC_L) {
  console.log('\n❌ fixture 不齊，無法繼續'); process.exit(1);
}

// ── harness ──────────────────────────────────────────────────────────────────
const TMP = mkdtempSync(join(tmpdir(), 'v6367-'));
process.on('exit', () => { try { rmSync(TMP, { recursive: true, force: true }); } catch { /* noop */ } });
const STRAY = [];
process.on('exit', () => { for (const p of STRAY) { try { unlinkSync(p); } catch { /* noop */ } } });

/** ⚠ entry 要寫在 srcDir 的父目錄、用相對路徑 import（Windows 的 `E:/…` 會被 esbuild 當成套件名）。 */
async function bundleFrom(srcDir, tag) {
  const parent = dirname(srcDir);
  const name = srcDir.slice(parent.length + 1).replace(/\\/g, '/');
  const p = `./${name}`;
  const S = join(parent, `.v6367-s-${tag}.js`), E = join(parent, `.v6367-e-${tag}.ts`), O = join(parent, `.v6367-o-${tag}.mjs`);
  STRAY.push(S, E, O);
  writeFileSync(S, 'export const base="";export const assets="";');
  writeFileSync(E,
    `export { ATTACK_PRE } from '${p}/lib/game/effects/_shared';\n`
    + `export { applyAction } from '${p}/lib/game/engine';\n`
    + `import '${p}/lib/game/effects';\n`);
  await build({
    entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
    alias: { $lib: join(srcDir, 'lib'), '$app/paths': S }, logLevel: 'silent',
  });
  return import(pathToFileURL(O).href);
}

const HEAD = await bundleFrom(join(ROOT, 'src'), 'head');
chk('0e ⭐這一招在 src/ 裡**沒有**既有的 ATTACK_PRE（合成 PRE 不會蓋掉真卡實裝）',
  !HEAD.ATTACK_PRE.get(KEY), KEY);

let seq = 0;
const inst = (id, extra = {}) => ({
  cardId: String(id), iid: 'i' + (++seq), damage: 0, energyAttached: [], toolAttached: null,
  abilityUsedThisTurn: false, evolvedThisTurn: false, playedFromHand: false, movedToActiveThisTurn: false,
  evolvedFromStack: [], ...extra,
});
const P = (o = {}) => ({ name: 'P', active: null, bench: [], hand: [], deck: [], discard: [], prizes: [], abilityNamesUsedThisTurn: [], ...o });
const mk = (p0, p1) => ({
  phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
  isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true], pendingMulliganDraw: [0, 0],
  pendingPrizes: [0, 0], coinFlippedThisAttack: false, _attackerActiveBonusDone: false,
  activeStadium: null, activeStadiumOwnerIdx: 0, players: [P(p0), P(p1)],
});
/** 強制擲幣正面（干擾命中判定用 `Math.random() < 0.5`）。 */
const heads = (fn) => { const o = Math.random; Math.random = () => 0.1; try { return fn(); } finally { Math.random = o; } };

// ── 合成 ATTACK_PRE：把「在造成傷害前」對盤面做的事包成一個 mutate ───────────────
const setAtkPlayer = (patch) => (s, ai) => {
  const players = [...s.players]; players[ai] = { ...players[ai], ...patch }; return { ...s, players };
};
const setAtkActive = (patch) => (s, ai) => {
  const players = [...s.players];
  players[ai] = { ...players[ai], active: { ...players[ai].active, ...patch } };
  return { ...s, players };
};
const addAtkVolt = (n) => (s, ai) => {
  const players = [...s.players]; const act = players[ai].active;
  players[ai] = { ...players[ai], active: { ...act, energyAttached: [...act.energyAttached, ...Array.from({ length: n }, () => inst(VOLT.id))] } };
  return { ...s, players };
};
const dropAtkVolt = () => (s, ai) => {
  const players = [...s.players]; const act = players[ai].active;
  const keep = act.energyAttached.filter(e => String(e.cardId) !== String(VOLT.id));
  const gone = act.energyAttached.filter(e => String(e.cardId) === String(VOLT.id));
  players[ai] = { ...players[ai], active: { ...act, energyAttached: keep }, discard: [...players[ai].discard, ...gone] };
  return { ...s, players };
};
const setDefActive = (patch) => (s, ai) => {
  const di = 1 - ai; const players = [...s.players];
  players[di] = { ...players[di], active: { ...players[di].active, ...patch } };
  return { ...s, players };
};

/**
 * 跑一次攻擊。`mutate` 就是合成 ATTACK_PRE 在「造成傷害前」對盤面做的事。
 * ⚠ 合成 PRE 一律回傳 `damage: BASE_DMG`（＝卡面數字）⇒ 傷害的差異只可能來自快照對齊。
 */
function run(MOD, mutate, { volt = 0, atkActiveExtra = {} } = {}) {
  const orig = MOD.ATTACK_PRE.get(KEY);
  MOD.ATTACK_PRE.set(KEY, (s, ai) => ({ state: mutate ? mutate(s, ai) : s, damage: BASE_DMG }));
  try {
    const a = inst(ATK.id, {
      energyAttached: [inst(BASIC_L.id), inst(BASIC_L.id), ...Array.from({ length: volt }, () => inst(VOLT.id))],
      ...atkActiveExtra,
    });
    const st = mk(
      { active: a, bench: [inst(ATK.id)], deck: [inst(ATK.id), inst(ATK.id)], hand: [inst(ATK.id)], prizes: Array.from({ length: 6 }, () => inst(ATK.id)) },
      { active: inst(TGT.id), bench: [inst(TGT.id)], deck: [inst(TGT.id), inst(TGT.id)], prizes: Array.from({ length: 6 }, () => inst(TGT.id)) });
    return heads(() => {
      try { return MOD.applyAction(st, { type: 'ATTACK', attackIndex: ATK_IDX }, pool); }
      catch (e) { return { __err: String(e && e.message ? e.message : e), players: st.players, log: [] }; }
    });
  } finally { if (orig) MOD.ATTACK_PRE.set(KEY, orig); else MOD.ATTACK_PRE.delete(KEY); }
}
const dmgOf = (r) => (r && r.players && r.players[1] && r.players[1].active ? r.players[1].active.damage : -1);
const dmg = (MOD, mutate, opt) => dmgOf(run(MOD, mutate, opt));

/** 整個行為矩陣（HEAD 與 BASE 各跑一次）。 */
function matrix(MOD) {
  const flagRun = run(MOD, setAtkPlayer({ gladionDuelBonusThisTurn: true }),
    { atkActiveExtra: { attackFailureFlipCountThisTurn: 1 } });
  const ctlRun = run(MOD, null);
  return {
    ctl: dmgOf(ctlRun),
    gladion: dmg(MOD, setAtkPlayer({ gladionDuelBonusThisTurn: true })),
    bonus: dmg(MOD, setAtkActive({ damageBonusThisTurn: 50 })),
    penalty: dmg(MOD, setAtkActive({ nextOwnAttackPenalty: 10 })),
    voltAdd: dmg(MOD, addAtkVolt(2)),
    voltCtl: dmg(MOD, null, { volt: 2 }),
    voltDrop: dmg(MOD, dropAtkVolt(), { volt: 2 }),
    defWeak: dmg(MOD, setDefActive({ weaknessOverrideTypeThisTurn: 'Lightning' })),
    // 【C】PRE 之前的變更不可以被蓋掉
    flagDmg: dmgOf(flagRun),
    flagAfter: flagRun?.players?.[0]?.active?.attackFailureFlipCountThisTurn,
    flagGladionKept: flagRun?.players?.[0]?.gladionDuelBonusThisTurn,
    ctlEnergy: ctlRun?.players?.[0]?.active?.energyAttached?.length,
    ctlHand: ctlRun?.players?.[0]?.hand?.length,
    ctlDeck: ctlRun?.players?.[0]?.deck?.length,
    ctlBench: ctlRun?.players?.[0]?.bench?.length,
    ctlDiscard: ctlRun?.players?.[0]?.discard?.length,
    ctlBonusDone: ctlRun?._attackerActiveBonusDone,
    dropVoltLeft: run(MOD, dropAtkVolt(), { volt: 2 })?.players?.[0]?.active?.energyAttached
      ?.filter(e => String(e.cardId) === String(VOLT.id)).length,
    err: ctlRun?.__err ?? flagRun?.__err ?? '',
  };
}

const H = matrix(HEAD);

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【A】⭐ 合成 PRE 改**攻擊方**自己 ⇒ 這一次的傷害必須跟著變');
chk('A0 哨兵：PRE 什麼都不改時傷害 = 卡面基礎值（盤面沒搭錯、靶對【雷】中立）',
  H.ctl === BASE_DMG, `${H.ctl} vs ${BASE_DMG}${H.err ? ' err=' + H.err : ''}`);
chk(`A1 ⭐⭐⭐player-level：PRE 蓋上 gladionDuelBonusThisTurn ⇒ 這一擊 +80（${BASE_DMG} → ${BASE_DMG + 80}）`,
  H.gladion === BASE_DMG + 80, String(H.gladion));
chk(`A2 ⭐⭐⭐active-level：PRE 蓋上 damageBonusThisTurn=50 ⇒ 這一擊 +50（${BASE_DMG} → ${BASE_DMG + 50}）`,
  H.bonus === BASE_DMG + 50, String(H.bonus));
chk(`A3 ⭐⭐⭐active-level（減傷方向）：PRE 蓋上 nextOwnAttackPenalty=10 ⇒ 這一擊 -10（${BASE_DMG} → ${BASE_DMG - 10}）`,
  H.penalty === BASE_DMG - 10, String(H.penalty));
chk(`A4 ⭐⭐⭐附加能量：PRE 幫攻擊方附上 2 張 伏特【雷】能量 ⇒ 這一擊 +40（${BASE_DMG} → ${BASE_DMG + 40}）`,
  H.voltAdd === BASE_DMG + 40, String(H.voltAdd));
chk(`A5 哨兵：開打前就帶著 2 張 伏特【雷】能量、PRE 不動 ⇒ +40（${BASE_DMG + 40}）`,
  H.voltCtl === BASE_DMG + 40, String(H.voltCtl));
chk(`A6 ⭐⭐⭐丟棄能量（站長裁定 六-9 的正主）：PRE 在造成傷害前丟掉攻擊方自己的 2 張 伏特【雷】能量`
  + ` ⇒ 這一擊**不可以**再算那 +40（${BASE_DMG}，不是 ${BASE_DMG + 40}）`,
  H.voltDrop === BASE_DMG, String(H.voltDrop));

console.log('\n【B】哨兵：同一個 harness 改**防守方** ⇒ v6.351 早就生效（證明 harness 是活的）');
chk(`B1 ⭐PRE 把防守方的弱點改成攻擊方屬性 ⇒ 這一擊 ×2（${BASE_DMG} → ${BASE_DMG * 2}）`,
  H.defWeak === BASE_DMG * 2, String(H.defWeak));

console.log('\n【C】⭐ PRE **之前**發生的變更不可以被蓋掉（本版行為零變更的證明）');
chk('C1 ⭐⭐旗標：干擾命中判定（attackFailureFlipCountThisTurn）在 PRE 之前就被清掉 ⇒ 攻擊後仍然是清掉的',
  H.flagAfter === undefined, JSON.stringify(H.flagAfter));
chk('C2 ⭐同一次攻擊仍然照常結算（旗標盤面下 PRE 的攻方加成照樣看得到）',
  H.flagDmg === BASE_DMG + 80, String(H.flagDmg));
chk('C3 ⭐PRE 蓋在攻擊方 player-level 的旗標，攻擊結束後仍然留在盤面上',
  H.flagGladionKept === true, JSON.stringify(H.flagGladionKept));
chk('C4 ⭐招式費用不會把能量丟掉（PTCG 規則：招式費用不支付能量）⇒ 2 張基本能量仍在身上',
  H.ctlEnergy === 2, String(H.ctlEnergy));
chk('C5 ⭐PRE 丟掉的自身能量**真的**不在身上（不是被快照復活）',
  H.dropVoltLeft === 0, String(H.dropVoltLeft));
chk('C6 ⭐PRE 沒碰過的欄位一律保留（手牌／牌庫／備戰／棄牌沒有被對齊動到）',
  H.ctlHand === 1 && H.ctlDeck === 2 && H.ctlBench === 1 && H.ctlDiscard === 0,
  JSON.stringify([H.ctlHand, H.ctlDeck, H.ctlBench, H.ctlDiscard]));
chk('C7 GameState 級旗標不受對齊影響（_attackerActiveBonusDone 仍然被標起來）',
  H.ctlBonusDone === true, JSON.stringify(H.ctlBonusDone));

console.log('\n【D】既有 9 張「在造成傷害前…」的卡：行為零變更');
{
  const r = spawnSync(process.execPath, ['scripts/test-v6351-pre-effects-visible-to-damage.mjs'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
  const out = (r.stdout || '') + (r.stderr || '');
  chk('D1 ⭐⭐ v6.351 的守衛（家族 9 張 + 防守方對齊中央性）維持全綠', r.status === 0,
    out.split('\n').filter(l => l.includes('❌')).slice(0, 3).join(' / ') || ('exit=' + r.status));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【E】中央性：對齊動作只有一處，而且排在 PRE 之後');
{
  const eng = readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8');
  const count = (t, s) => t.split(s).length - 1;
  chk('E1 ⭐對齊區塊全檔只有一處（>>> / <<< 各一次）',
    count(eng, '>>> v6367-resync-attacker-after-pre') === 1 && count(eng, '<<< v6367-resync-attacker-after-pre') === 1,
    `${count(eng, '>>> v6367-resync-attacker-after-pre')} / ${count(eng, '<<< v6367-resync-attacker-after-pre')}`);
  chk('E2 ⭐掃描器正對照：樣本裡有這段字面時必須算得到（避免恆真）',
    count('a >>> v6367-resync-attacker-after-pre b', '>>> v6367-resync-attacker-after-pre') === 1
    && count('nothing here', '>>> v6367-resync-attacker-after-pre') === 0);
  const iPre = eng.indexOf('preFn(workingState, aIdx, pool, action)');
  const iBase = eng.indexOf('const _v6367AtkBeforePre = workingState.players[aIdx];');
  const iSync = eng.indexOf('>>> v6367-resync-attacker-after-pre');
  chk('E3 ⭐⭐對齊必須在 preFn **之後**（放在之前等於沒修）', iPre > 0 && iSync > iPre, `${iPre} / ${iSync}`);
  chk('E4 ⭐⭐baseline 必須在 preFn **之前**（之後就抓不到差異了）', iBase > 0 && iBase < iPre, `${iBase} / ${iPre}`);
  // ⚠ 必須先把註解剝掉再數：本版的說明文字裡就引用了 `Object.assign(attacker, …)` 這串字面，
  //   直接數原始檔會永遠 ≥ 1（那是誤紅，不是安慰劑）。
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const srcNoComment = strip(eng);
  chk('E5 ⭐⭐不可以退回「整份 Object.assign」（那會蓋掉 PRE 之前發生的變更；v6.351 守衛 C4 同步釘住）',
    count(srcNoComment, 'Object.assign(attacker,') === 0, String(count(srcNoComment, 'Object.assign(attacker,')));
  chk('E5b ⭐剝註解掃描器的正對照：程式碼裡真的有這串時要算得到、註解裡的不算',
    count(strip('  Object.assign(attacker, x);\n  // Object.assign(attacker, y);\n'), 'Object.assign(attacker,') === 1);
  const blk = eng.slice(iSync, eng.indexOf('<<< v6367-resync-attacker-after-pre'));
  chk('E6 ⭐對齊的作法必須是「逐欄位比 PRE 前／後、只寫回真的變過的欄位」',
    /_after\[_k\] !== _before\[_k\]/.test(blk) && /_dst\[_k\] = _after\[_k\]/.test(blk), String(blk.length) + ' chars');
  chk('E7 ⭐防守方那一份（v6.351）必須原封不動地還在',
    count(eng, 'Object.assign(defender, workingState.players[dIdx]);') === 1);
}

// ══════════════════════════════════════════════════════════════════════════════
const BASE = BASE_SHA;
console.log(`\n【F】HEAD-FAIL：對 BASE(${BASE.slice(0, 8)} ＝ v6.366，本版的上一版) 重跑整個矩陣`);
if (!hasBaseCommit(ROOT, BASE)) {
  shallowSkip('【F】HEAD-FAIL 對 BASE 的重建比對', '【A】~【E】不需要歷史，仍在守');
} else {
  const baseSrc = join(TMP, 'base-src');
  cpSync(join(ROOT, 'src'), baseSrc, { recursive: true });
  // ⚠ 本版**只動 engine.ts**（effects 子樹逐字未動）⇒ 只換 engine.ts 就是自洽的 BASE 樹。
  const b = readBaseBlob(ROOT, BASE, 'src/lib/game/engine.ts');
  const rebuilt = chk('F0 BASE 樹重建成功（engine.ts 換回 BASE blob）', b.ok);
  if (rebuilt) {
    writeFileSync(join(baseSrc, 'lib/game/engine.ts'), b.out, 'utf8');
    const BMOD = await bundleFrom(baseSrc, 'base');
    const B = matrix(BMOD);
    // Rule 41 哨兵：BASE bundle 必須是活的（不是整支爆掉造成「全紅」）
    chk('F1 ⭐哨兵：BASE 上「PRE 什麼都不改」也是卡面基礎值（BASE bundle 是活的）',
      B.ctl === BASE_DMG, `${B.ctl}${B.err ? ' err=' + B.err : ''}`);
    chk('F2 ⭐哨兵：BASE 上防守方那一半（v6.351）早就生效 ⇒ 弱點 ×2 照樣算得到',
      B.defWeak === BASE_DMG * 2, String(B.defWeak));
    chk('F3 ⭐哨兵：BASE 上「開打前就帶著 2 張伏特【雷】能量」也是 +40（快照本來就看得到）',
      B.voltCtl === BASE_DMG + 40, String(B.voltCtl));

    chk('F4 ⭐⭐⭐BASE 上 player-level 旗標被 stale 快照吃掉（+80 沒生效）',
      B.gladion === BASE_DMG, `${B.gladion}（HEAD=${H.gladion}）`);
    chk('F5 ⭐⭐⭐BASE 上 active-level damageBonusThisTurn 被吃掉（+50 沒生效）',
      B.bonus === BASE_DMG, `${B.bonus}（HEAD=${H.bonus}）`);
    chk('F6 ⭐⭐⭐BASE 上 active-level nextOwnAttackPenalty 被吃掉（-10 沒生效）',
      B.penalty === BASE_DMG, `${B.penalty}（HEAD=${H.penalty}）`);
    chk('F7 ⭐⭐⭐BASE 上「PRE 附加的伏特【雷】能量」被吃掉（+40 沒生效）',
      B.voltAdd === BASE_DMG, `${B.voltAdd}（HEAD=${H.voltAdd}）`);
    chk('F8 ⭐⭐⭐BASE 上「PRE 在造成傷害前丟掉的能量」還被算進去（仍然 +40）',
      B.voltDrop === BASE_DMG + 40, `${B.voltDrop}（HEAD=${H.voltDrop}）`);

    chk('F9 ⭐哨兵：BASE 上旗標清除的行為與 HEAD **一致**（本版沒有改到那件事）',
      B.flagAfter === H.flagAfter && B.ctlEnergy === H.ctlEnergy && B.dropVoltLeft === H.dropVoltLeft
      && B.ctlHand === H.ctlHand && B.ctlDeck === H.ctlDeck && B.ctlBench === H.ctlBench && B.ctlDiscard === H.ctlDiscard,
      JSON.stringify({ base: [B.flagAfter, B.ctlEnergy, B.dropVoltLeft, B.ctlHand, B.ctlDeck, B.ctlBench, B.ctlDiscard],
        head: [H.flagAfter, H.ctlEnergy, H.dropVoltLeft, H.ctlHand, H.ctlDeck, H.ctlBench, H.ctlDiscard] }));
  }
}

console.log(`\n${fail === 0 ? '✅' : '❌'} v6.367 攻擊方側「造成傷害前」快照對齊：${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
