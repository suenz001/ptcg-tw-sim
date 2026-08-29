#!/usr/bin/env node
/**
 * v6.236 守衛：預估傷害**不得洩漏隱藏區的「組成」**。
 *
 * v6.233 的隱藏資訊防護只把隱藏區的**順序反轉**，於是「傷害取決於隱藏區**內容**」的招式
 * 完全偵測不到 —— 出招前就把對手手牌的組成換算成數字顯示出來：
 *   ⭐ 狩獵鳳蝶｜能量吸管：查看對手的手牌，造成其中**能量卡**的張數×80
 *   ⭐ 風妖精ex｜奇跡棉花：查看對手的手牌，造成其中**訓練家卡**的張數×50
 * v6.236 改成「在同一側的隱藏區之間重新分配（各區張數不變）」，順序與組成同時改變。
 *
 * 這支守衛全部是**行為層**斷言，並附：
 *   - 正對照：這兩招真的依賴對手手牌組成（真打一次，傷害確實不同）
 *   - 突變測試：只反轉順序的舊做法**證明偵測不到**（真打一次，傷害完全不變）
 *   - 反向正對照：一般招式、以及只看「張數」（公開資訊）的招式仍然照常給數字
 */
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE = 'ed3f03f3d2d231bd51a6a278a2fdec8ce3cf3ece';   // v6.235
const HAS_BASE = hasBaseCommit(ROOT, BASE);

const S = join(ROOT, '.hc-s.js'), E = join(ROOT, '.hc-e.ts'), O = join(ROOT, '.hc-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E,
  "export * from './src/lib/game/damage-estimate';\n" +
  "export { applyAction, getEffectiveAttacks } from './src/lib/game/engine';\n" +
  "import './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const mod = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map(); const all = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) { pool.set(String(c.id), c); all.push(c); }
}

let n = 0, bad = 0;
const chk = (label, cond) => { n++; console.log((cond ? '  PASS ' : '  FAIL ') + label); if (!cond) bad++; };

const inst = (cardId, iid, ex = {}) => ({ iid, cardId: String(cardId), damage: 0, energyAttached: [], evolvedFromStack: [], ...ex });
const ENERGY = {};
for (const c of all) if (c.supertype === 'Energy' && c.subtype === 'Basic') { const m = /基本【(.)】能量/.exec(c.name || ''); if (m) ENERGY[m[1]] = c; }
const T2C = { Grass:'草', Fire:'火', Water:'水', Lightning:'雷', Psychic:'超', Fighting:'鬥', Darkness:'惡', Metal:'鋼', Colorless:'草', Dragon:'草' };
function payFor(cost, pk) {
  const out = []; let k = 0;
  for (const c of (cost || [])) { const t = (c === '無') ? (T2C[pk] || '草') : c; const e = ENERGY[t]; if (e) out.push(inst(e.id, 'e' + (k++))); }
  for (let i = 0; i < 8; i++) out.push(inst(ENERGY[T2C[pk] || '草'].id, 'ex' + (k++)));
  return out;
}
const pokes = all.filter(c => String(c.supertype || '').startsWith('Pok') && ['H','I','J'].includes(c.regulationMark));
const trainers = all.filter(c => c.supertype === 'Trainer' && ['H','I','J'].includes(c.regulationMark));
const NEUTRAL = pokes.find(x => (x.stage ?? x.subtype) === 'Basic' && !x.abilities?.length && !x.weakness && !x.resistance && x.hp >= 200);
const DECK = pokes.slice(0, 20);
const PRIZE = pokes.slice(20, 26);
const findAtk = (name, atkName) => {
  const c = all.find(x => x.name === name && (x.attacks || []).some(a => a.name === atkName));
  return c ? { card: c, idx: (c.attacks || []).findIndex(a => a.name === atkName) } : null;
};
/** oppHand = 卡片陣列（張數固定，只換組成） */
function mkState(c, oppHand) {
  const arr = (a, tag) => a.map((x, i) => inst(x.id, tag + i));
  return { phase:'playing', turnPhase:'main', activePlayerIndex:0, firstPlayerIdx:0, turn:5, isFirstTurn:false,
    log: [], pendingSelection: null, setupDone: [true, true], activeStadium: null, pendingPrizes: [0, 0],
    players: [
      { name:'P1', active: inst(c.id, 'a1', { energyAttached: payFor((c.attacks[0] || {}).cost, c.pokemonType) }),
        bench: [inst(c.id, 'b1')], hand: [inst(c.id, 'h1')], deck: arr(DECK, 'd'),
        discard: [inst(c.id, 'g1')], prizes: arr(PRIZE, 'pz'), energyAttachedThisTurn: false },
      { name:'P2', active: inst(NEUTRAL.id, 'oa1'), bench: [inst(NEUTRAL.id, 'ob1')],
        hand: arr(oppHand, 'oh'), deck: arr(DECK, 'od'), discard: [inst(NEUTRAL.id, 'og1')],
        prizes: arr(PRIZE, 'opz'), energyAttachedThisTurn: false },
    ] };
}
const realDamage = (st, idx) => {
  const w = structuredClone(st); w.lastDealtDamage = 0;
  try { return (mod.applyAction(w, { type: 'ATTACK', attackIndex: idx }, pool).lastDealtDamage ?? 0); } catch { return -1; }
};
function deepDiff(a, b, path = '$', out = []) {
  if (out.length > 20 || a === b) return out;
  const ta = a === null ? 'null' : Array.isArray(a) ? 'array' : typeof a;
  const tb = b === null ? 'null' : Array.isArray(b) ? 'array' : typeof b;
  if (ta !== tb) { out.push(`${path}: ${ta}!=${tb}`); return out; }
  if (ta === 'object' || ta === 'array') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(k in a) || !(k in b)) { out.push(`${path}.${k}: 只在其中一邊`); continue; }
      deepDiff(a[k], b[k], `${path}.${k}`, out);
    }
    return out;
  }
  out.push(`${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  return out;
}

// 對手手牌：張數固定 4 張，只換組成
const HAND_ENERGY_RICH  = [ENERGY['草'], ENERGY['水'], ENERGY['火'], trainers[0]];
const HAND_TRAINER_RICH = [trainers[0], trainers[1], trainers[2], ENERGY['草']];

// ══════════════════════════════════════════════════════════════════════════
console.log('⓪ 前提：fixture 素材齊備（掃描器自身先驗，Rule 25）');
chk('卡池載入（> 4000 張）', pool.size > 4000);
chk('八種基本能量都找得到', Object.keys(ENERGY).length === 8);
chk('中性防守方存在：' + (NEUTRAL?.name ?? '—'), !!NEUTRAL);
chk('兩種對手手牌**張數相同**（4 張）＝只換組成，不動公開的張數資訊',
    HAND_ENERGY_RICH.length === 4 && HAND_TRAINER_RICH.length === 4);
chk('兩種對手手牌組成確實不同', HAND_ENERGY_RICH.map(c => c.id).join() !== HAND_TRAINER_RICH.map(c => c.id).join());

// ══════════════════════════════════════════════════════════════════════════
console.log('\n① 正對照：這兩招**真的**依對手手牌的組成算傷害（否則②是恆真的安慰劑）');
const LEAKY = [
  ['狩獵鳳蝶', '能量吸管', '對手手牌中能量卡的張數×80'],
  ['風妖精ex', '奇跡棉花', '對手手牌中訓練家卡的張數×50'],
];
const found = [];
for (const [nm, atk, why] of LEAKY) {
  const f = findAtk(nm, atk);
  chk(`找得到 ${nm}｜${atk}（${why}）`, !!f);
  if (!f) continue;
  const dA = realDamage(mkState(f.card, HAND_ENERGY_RICH), f.idx);
  const dB = realDamage(mkState(f.card, HAND_TRAINER_RICH), f.idx);
  chk(`  └ 真打一次：能量多的手牌 ${dA} vs 訓練家多的手牌 ${dB} ⇒ 傷害確實隨組成改變`, dA >= 0 && dB >= 0 && dA !== dB);
  found.push({ ...f, nm, atk });
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n② ⭐⭐ 突變測試：只反轉「順序」的舊做法偵測不到（所以 v6.233 的防護不夠）');
for (const f of found) {
  const st = mkState(f.card, HAND_ENERGY_RICH);
  const rev = structuredClone(st);
  rev.players[1].hand.reverse();
  rev.players[1].deck.reverse();
  rev.players[1].prizes.reverse();
  rev.players[0].deck.reverse();
  rev.players[0].prizes.reverse();
  const d0 = realDamage(st, f.idx), d1 = realDamage(rev, f.idx);
  chk(`${f.nm}｜${f.atk}：只反轉順序後傷害仍是 ${d1}（＝${d0}）⇒ 舊判準必然漏掉`, d0 >= 0 && d0 === d1);
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n③ ⭐⭐⭐ 主張：這兩招一律降級成「依看不到的牌而定」，絕不顯示數字');
for (const f of found) {
  for (const [tag, hand] of [['能量多', HAND_ENERGY_RICH], ['訓練家多', HAND_TRAINER_RICH]]) {
    const e = mod.estimateAttackDamage(mkState(f.card, hand), f.idx, pool, 0);
    const txt = mod.estimateShortText(e);
    chk(`${f.nm}｜${f.atk}（對手手牌${tag}）→ ${e.kind}${e.why ? '/' + e.why : ''}：${txt || '（不顯示）'}`,
        !(e.kind === 'exact' || e.kind === 'range' || e.kind === 'open'));
    chk(`  └ 文案不含任何傷害數字`, !/\d/.test(txt));
  }
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n④ 反向正對照：不可以一刀切把功能關掉');
{
  const g = findAtk('菊草葉', '飛葉快刀');
  const e = g && mod.estimateAttackDamage(mkState(g.card, HAND_ENERGY_RICH), g.idx, pool, 0);
  chk('一般招式（菊草葉｜飛葉快刀）仍然照常給數字', !!e && e.kind === 'exact' && e.value > 0);
  // ⚠「對手手牌的**張數**」是畫面上看得到的公開資訊 ⇒ 不可以被誤判成偷看
  const w = findAtk('超級雪妖女ex', '怨言');
  if (w) {
    const e2 = mod.estimateAttackDamage(mkState(w.card, HAND_ENERGY_RICH), w.idx, pool, 0);
    const e3 = mod.estimateAttackDamage(mkState(w.card, HAND_TRAINER_RICH), w.idx, pool, 0);
    chk(`只看「對手手牌張數」（公開資訊）的招式仍給數字：${w.card.name}｜怨言 → ${e2.kind}/${e3.kind}`,
        e2.kind === 'exact' && e3.kind === 'exact' && e2.value === e3.value);
  } else {
    chk('找得到「只看對手手牌張數」的樣本（超級雪妖女ex｜怨言）', false);
  }
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n⑤ hidden 檢查必須排在「沒有傷害就不顯示」前面（否則「有沒有提示」本身會洩漏 1 bit）');
{
  const src = readFileSync(join(ROOT, 'src/lib/game/damage-estimate.ts'), 'utf8');
  const iHidden = src.indexOf("why: 'hidden' };");
  const iNone = src.indexOf("return { kind: 'none' };");
  chk('原始碼裡 hidden 分支確實排在 none 分支之前', iHidden > 0 && iNone > 0 && iHidden < iNone);
  // 行為端：把呆呆王｜耀閃挑戰 放在「牌庫頂讓它打 0」的牌況，仍必須是 hidden 而不是 none
  const sw = findAtk('呆呆王', '耀閃挑戰');
  if (sw) {
    let sawHidden = false, sawNumber = false;
    for (const first of [ENERGY['水'], trainers[0], pokes[3], pokes[7]]) {
      const st = mkState(sw.card, HAND_ENERGY_RICH);
      st.players[0].deck = [inst(first.id, 'top'), ...st.players[0].deck];
      const e = mod.estimateAttackDamage(st, sw.idx, pool, 0);
      if (e.kind === 'depends' && e.why === 'hidden') sawHidden = true;
      if (e.kind === 'exact' || e.kind === 'range') sawNumber = true;
    }
    chk('呆呆王｜耀閃挑戰：任何牌庫頂都不給數字，且至少一種牌況明講「依看不到的牌而定」', sawHidden && !sawNumber);
  } else { chk('找得到 呆呆王｜耀閃挑戰', false); }
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n⑥ 預估跑完後，原本的 GameState 逐位元組不變（多跑一次乾跑也不能破壞這條）');
{
  let dirty = 0, ran = 0;
  const step = Math.max(1, Math.floor(pokes.length / 120));
  for (const c of pokes.filter((_, i) => i % step === 0).slice(0, 120)) {
    const st = mkState(c, HAND_ENERGY_RICH);
    let cnt = 0; try { cnt = mod.getEffectiveAttacks(st, st.players[0].active, pool).length; } catch { continue; }
    if (!cnt) continue;
    const before = structuredClone(st);
    try { mod.estimateAllAttacks(st, cnt, pool, 0); } catch { continue; }
    ran++;
    if (deepDiff(before, st).length) dirty++;
  }
  chk(`實跑 ${ran} 個盤面，污染 ${dirty} 個`, ran >= 50 && dirty === 0);
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n⑦ HEAD-FAIL：BASE（v6.235）不可能通過這支守衛');
// ⭐ v6.263：這條**純 HEAD 檢查**原本被綁在歷史 gate 裡面，淺複製下白白少守一條。
//   它不需要任何歷史，移出來讓它永遠跑。
{
  const curEst = readFileSync(join(ROOT, 'src/lib/game/damage-estimate.ts'), 'utf8');
  chk('HEAD 已不再是「只反轉順序」', !curEst.includes('p.deck.reverse()') && curEst.includes('pooled.reverse()'));
}
if (!HAS_BASE) {
  // ⚠ v6.263：剩下三條是**歷史性**斷言（BASE 的檔案內容長什麼樣），無法內嵌。
  //   改走中央 helper 大聲宣告；守 HEAD 的是 ①~⑥ 的行為端與突變測試。
  shallowSkip('v6.236 ⑦ HEAD-FAIL（BASE v6.235 的 damage-estimate.ts 逐字比對）', '歷史性斷言，無法內嵌');
} else {
  const b = readBaseBlob(ROOT, BASE, 'src/lib/game/damage-estimate.ts');
  chk('取得 BASE 的 damage-estimate.ts', b.ok && b.out.length > 3000);
  chk('HEAD-FAIL：BASE 只反轉順序（p.deck.reverse()）⇒ ③ 會紅', b.out.includes('p.deck.reverse()'));
  chk('HEAD-FAIL：BASE 的 none 分支排在 hidden 之前 ⇒ ⑤ 會紅',
      b.out.indexOf("return { kind: 'none' };") < b.out.indexOf("why: 'hidden' };"));
}

console.log(`\n[v6236-estimate-hidden-composition] PASS ${n - bad} / FAIL ${bad}`);
process.exit(bad ? 1 : 0);
