#!/usr/bin/env node
/**
 * v6.382 守衛 —— M6a「30th CELEBRATION」完整上線
 *
 * ⭐⭐⭐ 站長 2026-09-14 裁定（推翻 2026-09-09 的舊裁定）：
 *   「請讓 M6a 30th CELEBRATION 完整上線（包含一般對戰、錦標賽對戰都可以使用裡面的卡牌組牌，
 *     卡牌功能也開放）」
 *
 * ⚠ 動手前的實測（這一版**沒有補任何卡效果**，因為根本不需要補）：
 *   ・M6a 168 張裡，H/I/J 標 139 張、其餘 29 張（無標 21 ＋ A/C/D/E/F/G 8）由 `allowedMarks` 擋著。
 *   ・139 張裡有效果的招式 133 條，**未實裝 0 條**（M6a wave1~7 那幾版已經做完）。
 *   ・訓練家只有 3 張（高級球／寶可平板／寶可夢交替）、能量 8 張都是基本能量。
 *   ⇒ 這一版真正動的只有「政策」：三份清單清空 ＋ 四支既有守衛的判準上移。
 *
 * ⚠ 判準一律取行為層：組牌真的跑 validateDeck、卡效果真的跑引擎的 ATTACK。
 */
import assert from 'node:assert';
import { build } from 'esbuild';
import { readFileSync, writeFileSync, unlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { normEol } from './lib/eol-agnostic.mjs';
import * as LOCKED from './lib/deck-locked-sets.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = process.env.V6382_BASE || '3977d1c9';   // v6.381
const REG_REL = 'src/lib/cards/regulation.ts';
const MJS_REL = 'scripts/lib/deck-locked-sets.mjs';
const ADMIN_REL = 'oracle-admin/admin.html';

let pass = 0, fail = 0;
const chk = (t, c, extra = '') => {
  if (c) { pass++; console.log('  PASS ' + t); return true; }
  fail++; console.log('  FAIL ' + t + (extra ? '\n        ' + String(extra).slice(0, 600) : ''));
  return false;
};
const rd = (rel) => normEol(readFileSync(join(ROOT, rel), 'utf8'));

// ── 卡池 ────────────────────────────────────────────────────────────────────
const CARDDIR = join(ROOT, 'static/cards');
const liveSets = new Set(JSON.parse(readFileSync(join(CARDDIR, 'index.json'), 'utf8')).map((e) => e.code));
const POOL = new Map();
for (const f of readdirSync(CARDDIR)) {
  if (!f.endsWith('.json') || f === 'index.json' || !liveSets.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(CARDDIR, f), 'utf8'))) {
    if (c?.id == null) continue;
    POOL.set(String(c.id), { ...c, setCode: c.setCode ?? f.slice(0, -5) });
  }
}
const M6A = [...POOL.values()].filter((c) => String(c.setCode) === 'M6a');

// ── bundle：validation ＋ regulation ＋ 引擎 ─────────────────────────────────
const S = join(ROOT, '.v6382-s.js');
const E1 = join(ROOT, '.v6382-e1.ts'), O1 = join(ROOT, '.v6382-o1.mjs');
const E2 = join(ROOT, '.v6382-e2.ts'), O2 = join(ROOT, '.v6382-o2.mjs');
process.on('exit', () => { for (const p of [S, E1, O1, E2, O2]) { try { unlinkSync(p); } catch { /* noop */ } } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E1,
  "export { validateDeck } from './src/lib/decks/validation';\n"
  + "export { getCardPolicy, setCardPolicy, resetCardPolicy, DEFAULT_CARD_POLICY,"
  + " isDeckLockedCard, filterDeckSelectable, isCardMarkStandardLegal } from './src/lib/cards/regulation';\n");
writeFileSync(E2, "export { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';\n");
let V = null, ENG = null, BUNDLE_ERR = null;
try {
  await build({ entryPoints: [E1], outfile: O1, bundle: true, format: 'esm', platform: 'node', target: 'node20',
    alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'silent' });
  V = await import(pathToFileURL(O1).href + '?t=' + Date.now());
  await build({ entryPoints: [E2], outfile: O2, bundle: true, format: 'esm', platform: 'node', target: 'node20',
    alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'silent' });
  ENG = await import(pathToFileURL(O2).href + '?t=' + Date.now());
} catch (e) { BUNDLE_ERR = (e && e.message ? e.message : String(e)).split('\n')[0]; }
chk('★★ 前提：validation／regulation／引擎都打包得起來', !BUNDLE_ERR, String(BUNDLE_ERR));

// ════════════════════════════════════════════════════════════════════════════
console.log('\n【A】政策：三份清單都空了，而且逐項一致');
// ════════════════════════════════════════════════════════════════════════════
const adminSets = (() => {
  const m = rd(ADMIN_REL).match(/const CARD_POLICY_DEFAULT = \{ allowedMarks: \[([^\]]*)\], lockedSets: \[([^\]]*)\] \};/);
  if (!m) return null;
  return m[2].split(',').map((x) => x.trim().replace(/^'|'$/g, '')).filter(Boolean);
})();
const mjsSets = (() => {
  const m = rd(MJS_REL).match(/DECK_LOCKED_SETS = new Set\(\[([^\]]*)\]\)/);
  if (!m) return null;
  return m[1].split(',').map((x) => x.trim().replace(/^'|'$/g, '')).filter(Boolean);
})();
chk('★★ A0 三份清單都抽得出來（抽取器壞掉就紅，不准靜默全綠）',
  adminSets !== null && mjsSets !== null && !!V,
  'admin=' + JSON.stringify(adminSets) + ' mjs=' + JSON.stringify(mjsSets));
if (V && adminSets && mjsSets) {
  const tsSets = [...V.DEFAULT_CARD_POLICY.lockedSets];
  chk('★★★ A1 三份「暫不開放」清單全部是空的（M6a 完整上線）',
    tsSets.length === 0 && mjsSets.length === 0 && adminSets.length === 0,
    JSON.stringify({ ts: tsSets, mjs: mjsSets, admin: adminSets }));
  chk('★★★ A2 三份逐項相同（漂移就紅；空清單也要一致）',
    tsSets.join(',') === mjsSets.join(',') && tsSets.join(',') === adminSets.join(','));
  chk('★★★ A3 機制沒有退役：臨時鎖一個卡包，isDeckLockedCard 立刻認得',
    (() => {
      V.setCardPolicy({ allowedMarks: ['H', 'I', 'J'], lockedSets: ['M6a'] });
      const on = V.isDeckLockedCard({ setCode: 'M6a' });
      V.resetCardPolicy();
      return on === true && V.isDeckLockedCard({ setCode: 'M6a' }) === false;
    })());
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n【B】行為層：M6a 的 H/I/J 卡真的組得進牌組；無標／舊標照樣擋');
// ════════════════════════════════════════════════════════════════════════════
const basicEnergy = [...POOL.values()].find((c) => c.supertype === 'Energy' && c.name === '基本【水】能量');
const m6aJ = M6A.filter((c) => c.regulationMark === 'J' && c.supertype === 'Pokemon' && c.stage === 'Basic');
const m6aNoMark = M6A.filter((c) => !c.regulationMark);
const m6aOld = M6A.filter((c) => c.regulationMark && !'HIJ'.includes(c.regulationMark));
const deckOf = (rows) => ({ entries: rows.map(([id, count]) => ({ cardId: String(id), count })) });
chk('★★ B0 fixture：M6a 的 J 標基礎寶可夢／無標卡／舊標卡／基本能量都抓得到',
  m6aJ.length > 0 && m6aNoMark.length > 0 && m6aOld.length > 0 && !!basicEnergy,
  JSON.stringify({ J: m6aJ.length, noMark: m6aNoMark.length, old: m6aOld.length, energy: basicEnergy?.name }));
if (V && m6aJ.length && basicEnergy) {
  V.resetCardPolicy();
  const r = V.validateDeck(deckOf([[m6aJ[0].id, 4], [basicEnergy.id, 56]]), POOL);
  chk('★★★ B1 M6a 的 J 標卡組進 60 張牌組 ⇒ 合法（一般對戰與錦標賽跑的是同一支 validateDeck）',
    r.legal === true && r.issues.length === 0,
    m6aJ[0].name + ' :: ' + JSON.stringify(r.issues));
  const rn = V.validateDeck(deckOf([[m6aNoMark[0].id, 4], [m6aJ[0].id, 4], [basicEnergy.id, 52]]), POOL);
  chk('★★★ B2 M6a 的**無標**純收藏卡照樣不合法（擋它的是 allowedMarks，不是卡包鎖）',
    rn.legal === false && rn.issues.some((x) => x.includes(m6aNoMark[0].name)),
    m6aNoMark[0].name + ' :: ' + JSON.stringify(rn.issues));
  const ro = V.validateDeck(deckOf([[m6aOld[0].id, 4], [m6aJ[0].id, 4], [basicEnergy.id, 52]]), POOL);
  chk('★★★ B3 M6a 裡復刻的舊標卡（A/C/D/E/F/G）照樣不合法',
    ro.legal === false && ro.issues.some((x) => x.includes(m6aOld[0].name)),
    m6aOld[0].name + '（' + m6aOld[0].regulationMark + ' 標）:: ' + JSON.stringify(ro.issues));
  // 候選池
  const all = [...POOL.values()];
  const sel = V.filterDeckSelectable(all);
  chk('★★★ B4 /decks 候選池現在含 M6a 的卡（不再被卡包鎖濾掉）',
    sel.some((c) => String(c.setCode) === 'M6a') && sel.length === all.length,
    all.length + ' → ' + sel.length);
  V.setCardPolicy({ allowedMarks: ['H', 'I', 'J'], lockedSets: ['M6a'] });
  const selLocked = V.filterDeckSelectable(all);
  const rLocked = V.validateDeck(deckOf([[m6aJ[0].id, 4], [basicEnergy.id, 56]]), POOL);
  V.resetCardPolicy();
  chk('★★★ B5 反對照：把 M6a 鎖回去 ⇒ 候選池濾掉它、validateDeck 也擋（B1／B4 不是恆真式）',
    selLocked.every((c) => String(c.setCode) !== 'M6a') && selLocked.length < all.length
    && rLocked.legal === false && rLocked.issues.some((x) => /不開放用於對戰/.test(x)),
    selLocked.length + ' / ' + JSON.stringify(rLocked.issues.slice(0, 2)));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n【C】行為層：M6a 的卡效果真的會動（跑引擎的完整 ATTACK）');
// ════════════════════════════════════════════════════════════════════════════
// 甜甜螢｜絕佳費洛蒙：自己場上有「電螢蟲」⇒ 雙方戰鬥寶可夢的弱點以 ×3 計算
if (ENG) {
  const { applyAction } = ENG;
  const byName = (nm, pred) => [...POOL.values()].find((c) => c.name === nm && (!pred || pred(c)));
  const sweet = M6A.find((c) => c.name === '甜甜螢');
  const firefly = M6A.find((c) => c.name === '電螢蟲');
  chk('★★ C0 fixture：M6a 的甜甜螢與電螢蟲都抓得到，而且卡面就是那一條',
    !!sweet && !!firefly
    && (sweet.abilities || []).some((a) => a.name === '絕佳費洛蒙'
      && a.effect.includes('電螢蟲') && a.effect.includes('×3')),
    JSON.stringify({ sweet: sweet?.id, firefly: firefly?.id }));
  // 找一張「弱點＝草、且有固定傷害招式」的對手寶可夢
  const target = [...POOL.values()].find((c) => c.supertype === 'Pokemon'
    && c.weakness?.type === 'Grass' && String(c.weakness?.value || '').startsWith('×')
    && c.stage === 'Basic' && Number(c.hp) >= 120);
  // 攻擊方：草屬性、有無費用或低費用固定傷害招式
  const atk = [...POOL.values()].find((c) => c.supertype === 'Pokemon' && c.pokemonType === 'Grass'
    && c.stage === 'Basic' && (c.attacks || []).some((a) => /^\d+$/.test(String(a.damage || '')) && !String(a.effect || '').trim()));
  chk('★★ C0b fixture：找得到「弱點【草】」的受招方與「草屬性、固定傷害、無效果」的攻擊方',
    !!target && !!atk, JSON.stringify({ target: target?.name, atk: atk?.name }));
  if (sweet && firefly && target && atk) {
    let nn = 0;
    const inst = (cid) => ({
      iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [],
      abilityUsedThisTurn: false, evolvedThisTurn: false, playedFromHand: false,
      movedToActiveThisTurn: false, evolvedFromStack: [],
    });
    const EID = [...POOL.values()].find((c) => c.supertype === 'Energy' && c.name === '基本【草】能量');
    const theAtk = (atk.attacks || []).find((a) => /^\d+$/.test(String(a.damage || '')) && !String(a.effect || '').trim());
    const cost = (theAtk.cost || []).map(() => inst(EID.id));
    const mk = (benchP0) => ({
      phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
      isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
      pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
      coinFlippedThisAttack: false, _attackerActiveBonusDone: false,
      activeStadium: null, activeStadiumOwnerIdx: 0,
      players: [
        { name: 'P1', active: { ...inst(atk.id), energyAttached: cost }, bench: benchP0,
          hand: [], deck: [], discard: [], prizes: [], abilityNamesUsedThisTurn: [] },
        { name: 'P2', active: inst(target.id), bench: [],
          hand: [], deck: [], discard: [], prizes: [], abilityNamesUsedThisTurn: [] },
      ],
    });
    const run = (st) => {
      const orig = Math.random; Math.random = () => 0.1;
      try { return applyAction(st, { type: 'ATTACK', attackIndex: (atk.attacks || []).indexOf(theAtk) }, POOL); }
      catch (e) { return { __err: e.message, players: [] }; }
      finally { Math.random = orig; }
    };
    const base = Number(theAtk.damage);
    const noSweet = run(mk([]));
    const sweetNoFirefly = run(mk([inst(sweet.id)]));
    const sweetAndFirefly = run(mk([inst(sweet.id), inst(firefly.id)]));
    const dmgOf = (s) => s?.players?.[1]?.active?.damage;
    chk('★★★ C1 基準：沒有甜甜螢 ⇒ 弱點 ×2（' + base + ' → ' + (base * 2) + '）',
      dmgOf(noSweet) === base * 2, '實得 ' + dmgOf(noSweet) + '（' + atk.name + ' vs ' + target.name + '）');
    chk('★★★ C2 只有甜甜螢、沒有電螢蟲 ⇒ 前提不成立，仍然 ×2',
      dmgOf(sweetNoFirefly) === base * 2, '實得 ' + dmgOf(sweetNoFirefly));
    chk('★★★ C3 甜甜螢 ＋ 電螢蟲都在自己場上 ⇒ 弱點以 ×3 計算（' + base + ' → ' + (base * 3) + '）',
      dmgOf(sweetAndFirefly) === base * 3, '實得 ' + dmgOf(sweetAndFirefly));
    chk('★★ C4 [自驗] ×2 與 ×3 真的不同（否則 C1~C3 是恆真式）', base * 2 !== base * 3);
  }
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n【D】M6a 的 H/I/J 卡：有效果的招式未實裝必須是 0');
// ════════════════════════════════════════════════════════════════════════════
{
  const E3 = join(ROOT, '.v6382-e3.ts'), O3 = join(ROOT, '.v6382-o3.mjs');
  let missing = [], scanned = 0, regSize = 0;
  try {
    writeFileSync(E3, "export { ATTACK_PRE, ATTACK_POST, ATTACK_PRE_DISCARD_CHOICE }"
      + " from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';\n");
    await build({ entryPoints: [E3], outfile: O3, bundle: true, format: 'esm', platform: 'node',
      target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'silent' });
    const R = await import(pathToFileURL(O3).href + '?t=' + Date.now());
    const ak = new Set([...R.ATTACK_PRE.keys(), ...R.ATTACK_POST.keys(),
      ...(R.ATTACK_PRE_DISCARD_CHOICE ? R.ATTACK_PRE_DISCARD_CHOICE.keys() : [])]);
    regSize = ak.size;
    for (const c of M6A) {
      if (!['H', 'I', 'J'].includes(c.regulationMark) || c.supertype !== 'Pokemon') continue;
      for (const a of c.attacks || []) {
        if (!String(a.effect || '').trim()) continue;
        scanned++;
        if (!ak.has(c.name + '|' + a.name)) missing.push(c.name + '|' + a.name);
      }
    }
  } catch (e) { missing = ['(bundle 失敗) ' + e.message]; }
  finally { for (const f of [E3, O3]) { try { unlinkSync(f); } catch { /* noop */ } } }
  chk('★★ D0 掃描器下限：招式 registry > 800 筆、M6a 掃到的有效果招式 > 100 條',
    regSize > 800 && scanned > 100, 'registry=' + regSize + ' scanned=' + scanned);
  chk('★★★ D1 M6a 的 H/I/J 卡，有效果的招式**未實裝 0 條**（開放對戰的前提）',
    missing.length === 0, missing.slice(0, 8).join('、'));
}
chk('★★ D2 M6a 的 H/I/J 標卡共 139 張、其餘 29 張由 allowedMarks 擋著（卡包結構沒被改掉）',
  M6A.filter((c) => ['H', 'I', 'J'].includes(c.regulationMark)).length === 139
  && M6A.length === 168,
  'HIJ=' + M6A.filter((c) => ['H', 'I', 'J'].includes(c.regulationMark)).length + ' 總=' + M6A.length);

// ════════════════════════════════════════════════════════════════════════════
console.log('\n【E】HEAD-FAIL：BASE(' + BASE_SHA + ') 上 M6a 還被鎖著');
// ════════════════════════════════════════════════════════════════════════════
if (!hasBaseCommit(ROOT, BASE_SHA)) {
  shallowSkip('【E】對 BASE(' + BASE_SHA + ') 的 HEAD-FAIL', '【A】【B】【C】【D】不需要歷史，仍在守');
} else {
  const blob = (rel) => { const r = readBaseBlob(ROOT, BASE_SHA, rel); return normEol(typeof r === 'string' ? r : r.out); };
  const bReg = blob(REG_REL), bMjs = blob(MJS_REL), bAdmin = blob(ADMIN_REL);
  chk('★★★ E1 BASE 的 regulation.ts 內建政策鎖著 M6a（⇒ A1 在 BASE 上必紅）',
    /lockedSets: Object\.freeze\(\['M6a'\]\)/.test(bReg));
  chk('★★★ E2 BASE 的 deck-locked-sets.mjs 鎖著 M6a（⇒ A1 必紅）',
    /DECK_LOCKED_SETS = new Set\(\['M6a'\]\)/.test(bMjs));
  chk('★★★ E3 BASE 的 admin.html 也鎖著 M6a（⇒ A1／A2 必紅）',
    /lockedSets: \['M6a'\]/.test(bAdmin));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n【F】npm test chain');
// ════════════════════════════════════════════════════════════════════════════
{
  const PKG = rd('package.json');
  chk('★★ F1 本守衛已掛進 npm test chain',
    PKG.includes('scripts/test-v6382-m6a-live.mjs'));
  chk('★★ F2 受影響的四支既有守衛都還在 chain 裡',
    ['test-v6333-m6a-unmarked.mjs', 'test-v6340-card-policy.mjs',
      'test-v6205-chilispice-dualtype-and-tag-parity.mjs', 'test-v6353-weakness-multiplier.mjs']
      .every((f) => PKG.includes('scripts/' + f)));
  chk('★★ F3 守衛端的 DECK_LOCKED_SETS 仍然 export（機制沒被整個刪掉）',
    LOCKED.DECK_LOCKED_SETS instanceof Set && typeof LOCKED.isDeckLockedCard === 'function'
    && typeof LOCKED.allCarriersDeckLocked === 'function');
}

console.log('\n=== v6.382 守衛：PASS ' + pass + ' / FAIL ' + fail + ' ===');
assert.strictEqual(fail, 0, '有 ' + fail + ' 條失敗');
