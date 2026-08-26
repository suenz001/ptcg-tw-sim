#!/usr/bin/env node
/**
 * v6.239 守衛 —— 兩件事：
 *
 * 【A】傷害公式的**單一來源**。
 *   站長回報：「波動突刺 有列出數值了，但是不像超級勇氣那樣有列出完整的算式」。
 *   實跑重現後真因不在預估端：`composeFormula` 原本是 engine.ts 的 ATTACK handler 裡的
 *   **區域閉包**，只有引擎主管線用得到；走中央 `dealAttackDamageToTarget` 的招式
 *   （狙擊／「先跑效果、最後才造成傷害」的延後範本）**連對戰紀錄都沒有那一行公式**，
 *   而預估的算式正是從那行 log 解析出來的 ⇒ 預估只剩一個數字、沒有「為什麼」。
 *   ⇒ 把 `composeAttackFormula` 提升成模組層級並 export，兩條管線共用同一支。
 *   ⚠ **不新增任何一行 log**：`【…】` 接在這條路徑本來就會寫的那一行後面。
 *
 * 【B】卡面「若希望」的招式，預估不可以偷偷假設玩家一定會發動。
 *   `regPost` 對「ATTACK 沒帶答覆」一律當成「希望」（AI／舊 state 的 fallback），
 *   而預估的乾跑正是沒帶答覆 ⇒ 克雷色利亞｜弦月光芒 永遠只報「翻獎賞」的 160。
 *   ⇒ 多跑一次「否」（送空陣列＝玩家按下「否」時送出的同一個 action），報成範圍並標「若希望」。
 *
 * 【C】全卡池 audit（卡面「若希望」= 玩家可選）：每一張都必須真的問玩家。
 *
 * 不變量（每一條都附突變測試或正對照，IRON_RULES Rule 25/33）：
 *   A1 波動突刺（中央 helper 路徑）的對戰紀錄有完整公式，且與超級勇氣（主管線）格式一致
 *   A2 預估的 formula/terms 與對戰紀錄裡那一行**逐字相同**（沒有第二份字串）
 *   A3 零新增行：公式一定黏在既有的「造成 N 傷害」／「被擊倒！」那一行上
 *   A4 全卡池行為掃描：log 裡每一段公式逐項算下來 === ` = ` 後面的數字（含下限斷言 + 正對照）
 *   A5 fail-closed：算不平就不印（擲幣免傷盤面）＋ 突變測試（強制印 ⇒ A4 必須紅）
 *   A6 突變測試（單一來源）：改 `composeAttackFormula` 一個字元 ⇒ **兩條管線同時**跟著變
 *   A7 HEAD-FAIL：BASE 的 effects.ts ⇒ 波動突刺 沒有公式
 *   B1 弦月光芒：翻／不翻的實際傷害各為 160／80，且「不翻」不會動到獎賞卡
 *   B2 弦月光芒 的預估是範圍 80~160 且標示「若希望」；突變測試：拿掉「否」那次乾跑 ⇒ 必須紅
 *   C1 全卡池：卡面含「若希望」的招式，一律「有 ATTACK_PRE_DISCARD_CHOICE」或「開得出可選 0 的選擇」
 *   C2 C1 的掃描器正對照（餵一張假的違規卡，必須被抓到）
 */
import { readFileSync, readdirSync, writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = '0b47f36b19076796c6b62a066730029145bd7308';   // v6.238

let n = 0, bad = 0;
const chk = (label, cond, extra = '') => {
  n++; console.log((cond ? '  PASS ' : '  FAIL ') + label + (cond ? '' : ' ' + extra));
  if (!cond) bad++;
};

// ── 卡池 ────────────────────────────────────────────────────────────────────
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}

const TMP = mkdtempSync(join(tmpdir(), 'v6239-'));
let _seq = 0;
/** 把 engine/effects/damage-estimate 打成一包；`overrides` 可以換掉某個檔的內容（不碰工作樹）。 */
async function bundle(overrides = {}) {
  const id = 'b' + (_seq++);
  const stub = join(ROOT, `.v6239-${id}-s.js`);
  const entry = join(ROOT, `.v6239-${id}-e.ts`);
  const out = join(TMP, `${id}.mjs`);
  writeFileSync(stub, 'export const base="";');
  const plugins = [];
  if (Object.keys(overrides).length > 0) {
    plugins.push({
      name: 'v6239-override',
      setup(b) {
        b.onLoad({ filter: /\.ts$/ }, (args) => {
          for (const [rel, content] of Object.entries(overrides)) {
            if (args.path.replace(/\\/g, '/').endsWith(rel)) return { contents: content, loader: 'ts' };
          }
          return null;
        });
      },
    });
  }
  writeFileSync(entry,
    "export * from './src/lib/game/damage-estimate';\n" +
    "export { applyAction, composeAttackFormula, attackFormulaReconstructs } from './src/lib/game/engine';\n" +
    "export { ATTACK_PRE_DISCARD_CHOICE } from './src/lib/game/effects/_shared';\n" +
    "import './src/lib/game/effects';");
  await build({ entryPoints: [entry], outfile: out, bundle: true, format: 'esm', platform: 'node',
    target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': stub }, plugins, logLevel: 'error' });
  const mod = await import(pathToFileURL(out).href + '?t=' + id);
  try { unlinkSync(stub); unlinkSync(entry); } catch { /* 清乾淨即可 */ }
  return mod;
}

// ── fixture ────────────────────────────────────────────────────────────────
let _iid = 0;
const inst = (cardId, ex = {}) => ({ iid: 'i' + (++_iid), cardId: String(cardId), damage: 0, energyAttached: [], ...ex });
const byName = (nm) => [...pool.values()].find(c => c.name === nm) ?? null;
const findAtk = (nm, atkName) => {
  const c = [...pool.values()].find(x => x.name === nm && (x.attacks || []).some(a => a.name === atkName));
  return c ? { card: c, idx: c.attacks.findIndex(a => a.name === atkName) } : null;
};
const ENERGY = {};
for (const c of pool.values()) {
  if (c.supertype === 'Energy' && c.subtype === 'Basic') {
    const m = /基本【(.)】能量/.exec(c.name || ''); if (m) ENERGY[m[1]] = c;
  }
}
const T2C = { Grass:'草', Fire:'火', Water:'水', Lightning:'雷', Psychic:'超',
              Fighting:'鬥', Darkness:'惡', Metal:'鋼', Colorless:'水', Dragon:'水' };
const payFor = (cost, pkType) => (cost || []).map(t => inst((ENERGY[t === 'Colorless' ? (T2C[pkType] || '水') : (T2C[t] || '水')] || ENERGY['水']).id));
function mkState(attCard, atkIdx, defCard, extra = {}) {
  const a = inst(attCard.id, { energyAttached: payFor(attCard.attacks[atkIdx].cost, attCard.pokemonType), ...(extra.attacker || {}) });
  const filler = ENERGY['水'];
  return {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
    isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
    activeStadium: null, pendingPrizes: [0, 0],
    players: [
      { name: 'P1', active: a, bench: [inst(attCard.id)], hand: [], deck: Array.from({ length: 8 }, () => inst(filler.id)),
        discard: [], prizes: [inst(filler.id), inst(filler.id), inst(filler.id)], ...(extra.p1 || {}) },
      { name: 'P2', active: inst(defCard.id), bench: [inst(defCard.id)], hand: [], deck: Array.from({ length: 8 }, () => inst(filler.id)),
        discard: [], prizes: [inst(filler.id), inst(filler.id)], ...(extra.p2 || {}) },
    ],
    ...(extra.state || {}),
  };
}

/** 從 log 抽出所有「引擎寫的公式」（形狀比對，不靠「基礎」兩個字 —— 有 breakdown 的招式基礎項不叫基礎）。 */
const FORMULA_SHAPE = /^\[?\d+\([^()]*\)(?: [×+\-]\d+\([^()]*\))*\]?(?: [×+\-]\d+\([^()]*\))* = \d+$/;
function formulasIn(logArr) {
  const out = [];
  for (const l of (logArr || [])) {
    for (const m of String(l?.message ?? '').matchAll(/【([^】]+)】/g)) {
      if (FORMULA_SHAPE.test(m[1])) out.push({ text: m[1], line: String(l.message) });
    }
  }
  return out;
}
/** 公式逐項算下來是不是 === ` = ` 後面那個數字。 */
function formulaSelfConsistent(text) {
  const eq = /(.*) = (\d+)$/.exec(text); if (!eq) return false;
  const want = Number(eq[2]);
  const terms = [...eq[1].matchAll(/([×+\-])?(\d+)\([^()]*\)/g)];
  if (terms.length === 0) return false;
  let v = Number(terms[0][2]);
  if (terms[0][1]) return false;                    // 第一項不該帶符號
  for (let i = 1; i < terms.length; i++) {
    const s = terms[i][1], x = Number(terms[i][2]);
    if (s === '+') v += x; else if (s === '-') v -= x; else if (s === '×') v *= x; else return false;
  }
  return v === want;
}

const mod = await bundle();
const LUC = findAtk('超級路卡利歐ex', '波動突刺');
const BRAVE = findAtk('超級路卡利歐ex', '超級勇氣');
const BELT = byName('極限腰帶');
const WEAK_F = [...pool.values()].find(c => c.supertype === 'Pokemon' && c.weakness?.type === 'Fighting' && c.hp >= 200);

// ══════════════════════════════════════════════════════════════════════════
console.log('\n① 【A】中央 helper 路徑（波動突刺）現在有完整公式');
let lucLog = null, lucFormula = null;
{
  chk('找得到 超級路卡利歐ex 的兩招 + 極限腰帶 + 弱鬥的防守方',
      !!(LUC && BRAVE && BELT && WEAK_F), `${!!LUC} ${!!BRAVE} ${!!BELT} ${!!WEAK_F}`);
  const st = mkState(LUC.card, LUC.idx, WEAK_F,
    { attacker: { toolAttached: inst(BELT.id) }, p1: { damageBoostFightingThisTurn: 30 } });
  const out = mod.applyAction(st, { type: 'ATTACK', attackIndex: LUC.idx }, pool);
  lucLog = out.log;
  const fs = formulasIn(out.log);
  chk('A1 波動突刺 的對戰紀錄有 1 段公式', fs.length === 1, JSON.stringify(fs.map(x => x.text)));
  lucFormula = fs[0]?.text ?? '';
  chk('A1 公式逐字正確（含 [] 括號、極限腰帶、力量蛋白飲、弱點）',
      lucFormula === '[130(基礎) +50(極限腰帶) +30(力量蛋白飲)] ×2(弱點) = 420', lucFormula);
  chk('A3 零新增行：公式黏在既有那一行（同一行同時有「被擊倒」或「造成」）',
      /被擊倒|造成/.test(fs[0]?.line ?? ''), fs[0]?.line);
  // 主管線（超級勇氣）的格式必須長一樣
  const st2 = mkState(BRAVE.card, BRAVE.idx, WEAK_F,
    { attacker: { toolAttached: inst(BELT.id) }, p1: { damageBoostFightingThisTurn: 30 } });
  const out2 = mod.applyAction(st2, { type: 'ATTACK', attackIndex: BRAVE.idx }, pool);
  const f2 = formulasIn(out2.log)[0]?.text ?? '';
  chk('A1 主管線（超級勇氣）的公式格式相同',
      f2 === '[270(基礎) +50(極限腰帶) +30(力量蛋白飲)] ×2(弱點) = 700', f2);
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n② 【A】預估的算式 === 對戰紀錄那一行（沒有第二份字串）');
{
  const st = mkState(LUC.card, LUC.idx, WEAK_F,
    { attacker: { toolAttached: inst(BELT.id) }, p1: { damageBoostFightingThisTurn: 30 } });
  const e = mod.estimateAttackDamage(st, LUC.idx, pool, 0);
  chk('A2 預估是 exact', e.kind === 'exact', JSON.stringify(e));
  chk('A2 預估的 formula 與對戰紀錄逐字相同', e.formula === lucFormula, `${e.formula} vs ${lucFormula}`);
  chk('A2 短文案含完整理由',
      mod.estimateShortText(e) === '預估 420（極限腰帶 +50、力量蛋白飲 +30、弱點 ×2）',
      mod.estimateShortText(e));
  // ⚠ 站長比對的對照組
  const e2 = mod.estimateAttackDamage(
    mkState(BRAVE.card, BRAVE.idx, WEAK_F, { attacker: { toolAttached: inst(BELT.id) }, p1: { damageBoostFightingThisTurn: 30 } }),
    BRAVE.idx, pool, 0);
  chk('A2 超級勇氣 的文案結構相同（兩招現在一致）',
      mod.estimateShortText(e2) === '預估 700（極限腰帶 +50、力量蛋白飲 +30、弱點 ×2）',
      mod.estimateShortText(e2));
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n③ 【A】全卡池：每一段公式都必須自洽（算得出 = 後面那個數字）');
let scanned = 0, badF = [];
{
  const defByWeak = new Map();
  for (const c of pool.values()) { const w = c?.weakness?.type; if (c.supertype === 'Pokemon' && w && c.hp >= 300 && !defByWeak.has(w)) defByWeak.set(w, c); }
  const NEUTRAL = byName('超級快龍ex') ?? [...pool.values()].find(c => c.supertype === 'Pokemon' && c.hp >= 300);
  const seen = new Set();
  const origRandom = Math.random;
  for (const c of pool.values()) {
    if (c.supertype !== 'Pokemon' || !['H', 'I', 'J'].includes(c.regulationMark)) continue;
    for (let i = 0; i < (c.attacks || []).length; i++) {
      const key = c.name + '|' + c.attacks[i].name;
      if (seen.has(key)) continue; seen.add(key);
      let out;
      try {
        Math.random = () => 0.25;
        out = mod.applyAction(
          mkState(c, i, defByWeak.get(c.pokemonType) || NEUTRAL, { attacker: { toolAttached: inst(BELT.id) } }),
          { type: 'ATTACK', attackIndex: i }, pool);
      } catch { Math.random = origRandom; continue; }
      Math.random = origRandom;
      for (const f of formulasIn(out.log)) {
        scanned++;
        if (!formulaSelfConsistent(f.text)) badF.push(key + ' :: ' + f.text);
      }
    }
  }
  chk('A4 掃描器真的掃到東西（下限斷言）', scanned > 1500, String(scanned));
  chk('A4 全卡池沒有算不平的公式', badF.length === 0, badF.slice(0, 5).join(' | '));
  // 正對照：檢查器抓不抓得到「算不平」
  chk('A4 正對照：算不平的公式會被抓到',
      formulaSelfConsistent('[130(基礎) +50(腰帶)] ×2(弱點) = 420') === false
      && formulaSelfConsistent('[130(基礎) +50(腰帶)] ×2(弱點) = 360') === true);
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n④ 【A】fail-closed：公式對不上就不印（擲幣免傷）');
const HIDER = [...pool.values()].find(c => (c.abilities || []).some(a => a.name === '躲藏高手'));
let coinState = null;
{
  chk('找得到 躲藏高手 的持有者', !!HIDER, String(!!HIDER));
  chk('A5 attackFormulaReconstructs 單元：對得上 / 對不上',
      mod.attackFormulaReconstructs([{ sign: '=', value: 130, label: '基礎' }, { sign: '×', value: 2, label: '弱點' }], 260) === true
      && mod.attackFormulaReconstructs([{ sign: '=', value: 130, label: '基礎' }, { sign: '×', value: 2, label: '弱點' }], 0) === false);
  if (HIDER) {
    coinState = mkState(LUC.card, LUC.idx, HIDER, { attacker: { toolAttached: inst(BELT.id) } });
    const orig = Math.random; Math.random = () => 0.25;          // 正面 ⇒ 免傷
    const out = mod.applyAction(coinState, { type: 'ATTACK', attackIndex: LUC.idx }, pool);
    Math.random = orig;
    const avoided = (out.log || []).some(l => /擲幣免疫|不受傷害|避免/.test(l.message ?? ''))
                 || (out.players[1].active?.damage ?? 0) === 0;
    chk('A5 擲幣免傷盤面確實免傷（正對照：這個盤面真的進得去那個分支）', avoided);
    chk('A5 免傷時不印公式（對不平 ⇒ 不印）', formulasIn(out.log).length === 0,
        JSON.stringify(formulasIn(out.log).map(x => x.text)));
  }
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n⑤ 【A】突變測試：composeAttackFormula 是**唯一**來源');
{
  const eng = readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8');
  const head = eng.indexOf('export function composeAttackFormula(');
  const tail = eng.indexOf('\n}\n', head);
  chk('抓得到 composeAttackFormula 函式本體', head > 0 && tail > head, `${head} ${tail}`);
  const mutated = eng.slice(0, head) + eng.slice(head, tail).split(' = ${finalValue}').join(' ⊞ ${finalValue}') + eng.slice(tail);
  chk('突變真的改到東西（正對照）', mutated !== eng);
  const m2 = await bundle({ 'lib/game/engine.ts': mutated });
  const st = mkState(LUC.card, LUC.idx, WEAK_F, { attacker: { toolAttached: inst(BELT.id) }, p1: { damageBoostFightingThisTurn: 30 } });
  const o1 = m2.applyAction(st, { type: 'ATTACK', attackIndex: LUC.idx }, pool);
  const st2 = mkState(BRAVE.card, BRAVE.idx, WEAK_F, { attacker: { toolAttached: inst(BELT.id) }, p1: { damageBoostFightingThisTurn: 30 } });
  const o2 = m2.applyAction(st2, { type: 'ATTACK', attackIndex: BRAVE.idx }, pool);
  const hasMut = (o) => (o.log || []).some(l => /⊞ \d+】/.test(l.message ?? ''));
  chk('A6 突變後「中央 helper 路徑」跟著變（證明它用的就是那一支）', hasMut(o1));
  chk('A6 突變後「引擎主管線」也跟著變（同一支函式）', hasMut(o2));
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n⑥ 【A】HEAD-FAIL：BASE 的 effects.ts ⇒ 波動突刺 沒有公式');
{
  let baseEff = null;
  try {
    baseEff = execFileSync('git', ['-C', ROOT, 'cat-file', '-p', BASE_SHA + ':src/lib/game/effects.ts'],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { baseEff = null; }
  if (!baseEff) {
    // ⚠ CI 的 checkout 是 fetch-depth:1 淺複製，取不到歷史 blob ⇒ SKIP（⑤ 的突變測試涵蓋同一件事）
    console.log('  SKIP  取不到 BASE blob（淺複製）—— 由 ⑤ 的突變測試涵蓋');
  } else {
    const mB = await bundle({ 'lib/game/effects.ts': baseEff });
    const st = mkState(LUC.card, LUC.idx, WEAK_F, { attacker: { toolAttached: inst(BELT.id) }, p1: { damageBoostFightingThisTurn: 30 } });
    const oB = mB.applyAction(st, { type: 'ATTACK', attackIndex: LUC.idx }, pool);
    chk('A7 BASE 的中央 helper 路徑一段公式都沒有（HEAD-FAIL）',
        formulasIn(oB.log).length === 0, JSON.stringify(formulasIn(oB.log).map(x => x.text)));
  }
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n⑦ 【B】克雷色利亞｜弦月光芒：翻不翻由玩家決定');
const CRES = findAtk('克雷色利亞', '弦月光芒');
{
  chk('找得到 克雷色利亞｜弦月光芒', !!CRES);
  const spec = mod.ATTACK_PRE_DISCARD_CHOICE.get('克雷色利亞|弦月光芒');
  chk('B1 出招前的詢問已宣告（UI 開 modal 的判準就是這張表）',
      !!spec && spec.scope === 'binary-yes-no', JSON.stringify(spec));
  const NEU = byName('超級快龍ex');
  const mk = () => mkState(CRES.card, CRES.idx, NEU);
  const noS = mod.applyAction(mk(), { type: 'ATTACK', attackIndex: CRES.idx, discardedEnergyIids: [] }, pool);
  const yesS = mod.applyAction(mk(), { type: 'ATTACK', attackIndex: CRES.idx, discardedEnergyIids: ['yes-token'] }, pool);
  chk('B1 選「否」＝ 80 傷害', (noS.players[1].active?.damage ?? -1) === 80, String(noS.players[1].active?.damage));
  chk('B1 選「否」不會動到任何獎賞卡', noS.players[0].prizes.every(p => !p.faceUp));
  chk('B1 選「是」＝ 160 傷害', (yesS.players[1].active?.damage ?? -1) === 160, String(yesS.players[1].active?.damage));
  chk('B1 選「是」剛好翻 1 張獎賞卡', yesS.players[0].prizes.filter(p => p.faceUp).length === 1);

  const e = mod.estimateAttackDamage(mk(), CRES.idx, pool, 0);
  chk('B2 預估是「若希望」型的範圍 80～160',
      e.kind === 'range' && e.min === 80 && e.max === 160 && e.optIn === true, JSON.stringify(e));
  chk('B2 文案講「若希望」（不是「隨機」）',
      mod.estimateShortText(e) === '預估 80～160（若希望）', mod.estimateShortText(e));
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n⑧ 【B】突變測試：拿掉「否」那一次乾跑 ⇒ 預估退回單一數字');
{
  const est = readFileSync(join(ROOT, 'src/lib/game/damage-estimate.ts'), 'utf8');
  const needle = 'const _optSpec = preAttackChoiceSpecFor(base, attackIndex, pool);';
  chk('抓得到「若希望」那一段（突變測試的錨點）', est.includes(needle));
  const m3 = await bundle({ 'lib/game/damage-estimate.ts': est.replace(needle, 'const _optSpec = undefined;') });
  const eM = m3.estimateAttackDamage(mkState(CRES.card, CRES.idx, byName('超級快龍ex')), CRES.idx, pool, 0);
  chk('B2 突變後變回「預估 160」（證明這條斷言真的靠新程式碼）',
      eM.kind === 'exact' && eM.value === 160, JSON.stringify(eM));
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n⑨ 【C】全卡池 audit：卡面「若希望」的招式一律要問玩家');
{
  // 枚舉（只認卡面實際用字「若希望」；H/I/J + live 卡包）
  const rows = new Map();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
    for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
      if (!['H', 'I', 'J'].includes(c.regulationMark)) continue;
      for (let i = 0; i < (c.attacks || []).length; i++) {
        if (String(c.attacks[i].effect ?? '').includes('若希望')) rows.set(c.name + '|' + c.attacks[i].name, { c, i });
      }
    }
  }
  chk('C1 掃描器真的掃到東西（下限斷言）', rows.size >= 50, String(rows.size));

  /**
   * 這一招會不會問玩家：① 出招前的宣告表 ② 或開得出「可以不選」的選擇視窗。
   * ⚠⚠ 盤面必須**夠有料**：候選為空時「不問」是正確行為（沒得選），拿貧瘠的盤面掃
   *   會誤判成 bug（第一版就誤報了 櫻花魚｜漸強波 與 魔牆人偶｜相仿秀 —— 前者要手牌有
   *   基本【水】能量、後者要對手手牌有支援者）。⇒ 雙方手牌都塞滿各屬性基本能量＋1 張支援者。
   */
  const NEU2 = byName('超級快龍ex');
  const SUP = [...pool.values()].find(c => c.supertype === 'Trainer' && c.subtype === 'Supporter');
  const richHand = () => [...Object.values(ENERGY).map(e => inst(e.id)), inst(SUP.id), inst(NEU2.id)];
  const mkRich = (c, i) => mkState(c, i, NEU2, {
    p1: { hand: richHand(), discard: [...Object.values(ENERGY).map(e => inst(e.id))], bench: [inst(c.id), inst(NEU2.id)] },
    p2: { hand: richHand(), bench: [inst(NEU2.id), inst(NEU2.id)] },
  });
  const asksPlayer = (key, entry) => {
    if (mod.ATTACK_PRE_DISCARD_CHOICE.has(key)) return true;
    let out;
    try { out = mod.applyAction(mkRich(entry.c, entry.i), { type: 'ATTACK', attackIndex: entry.i }, pool); }
    catch { return false; }
    const p = out.pendingSelection;
    if (!p) return false;
    // modal-choice ＝ 選項式（一定含「不做」的選項）；其餘 picker 要能選 0
    return p.type === 'modal-choice' ? (p.params?.options?.length ?? 0) >= 2 : (p.minCount ?? 1) === 0;
  };
  const outliers = [];
  for (const [key, entry] of rows) if (!asksPlayer(key, entry)) outliers.push(key);
  chk('C1 沒有「卡面寫若希望、實作卻自動執行」的招式', outliers.length === 0, outliers.join(' | '));

  // C2 正對照：餵一個一定不會問玩家的招式（卡面沒有「若希望」、實作也不開選擇），
  //   確認 asksPlayer 判得出「沒問」——否則 C1 只是個永遠綠燈的安慰劑。
  const PLAIN = findAtk('超級路卡利歐ex', '超級勇氣');
  chk('C2 正對照：純傷害招式會被判成「沒問玩家」',
      asksPlayer('超級路卡利歐ex|超級勇氣', { c: PLAIN.card, i: PLAIN.idx }) === false);
}

console.log(`\n${bad === 0 ? '✅' : '❌'} v6.239 守衛：${n - bad}/${n} 通過`);
process.exit(bad === 0 ? 0 : 1);
