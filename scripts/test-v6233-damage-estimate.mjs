#!/usr/bin/env node
/**
 * v6.233 預估傷害 守衛。
 *
 * 這一版最怕兩件事，所以守衛的核心就是這兩條不變量：
 *   ⭐ A. **預估值 === 真的打下去之後的實際傷害**（同一組盤面，先跑預估、再真打）
 *   ⭐ B. **預估跑完後原本的 GameState 逐位元組不變**（深比對）
 * 兩條都各自附**突變測試**：把深複製拿掉 ⇒ B 變紅；把預估改成「自己算一份」 ⇒ A 變紅。
 * 沒有突變測試的話，這兩條可能只是恆真的安慰劑（IRON_RULES Rule 25/33）。
 */
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.de-s.js'), E = join(ROOT, '.de-e.ts'), O = join(ROOT, '.de-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E,
  "export * from './src/lib/game/damage-estimate';\n" +
  "export { applyAction, getEffectiveAttacks } from './src/lib/game/engine';\n" +
  "import './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const mod = await import(pathToFileURL(O).href);

// ── 卡池 ────────────────────────────────────────────────────────────────────
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}

let n = 0, bad = 0;
const chk = (label, cond) => { n++; console.log((cond ? '  PASS ' : '  FAIL ') + label); if (!cond) bad++; };

// ── fixture 工具 ────────────────────────────────────────────────────────────
const inst = (cardId, iid, ex = {}) =>
  ({ iid, cardId: String(cardId), damage: 0, energyAttached: [], evolvedFromStack: [], ...ex });
const ENERGY = {};
for (const c of pool.values()) {
  if (c.supertype === 'Energy' && c.subtype === 'Basic') {
    const m = /基本【(.)】能量/.exec(c.name || ''); if (m) ENERGY[m[1]] = c;
  }
}
const T2C = { Grass:'草', Fire:'火', Water:'水', Lightning:'雷', Psychic:'超',
              Fighting:'鬥', Darkness:'惡', Metal:'鋼', Colorless:'草', Dragon:'草' };
function payFor(cost, pkType) {
  const out = []; let k = 0;
  for (const c of (cost || [])) {
    const t = (c === '無') ? (T2C[pkType] || '草') : c;
    const e = ENERGY[t]; if (e) out.push(inst(e.id, 'e' + (k++)));
  }
  // 多給幾顆保險（cost 判定只看夠不夠）
  for (let i = 0; i < 6; i++) out.push(inst((ENERGY[T2C[pkType] || '草']).id, 'ex' + (k++)));
  return out;
}
// ⚠ 牌庫刻意用「不同的卡」——若全部同一張，「反轉牌庫順序」的隱藏資訊偵測就測不出東西
//   （掃描器自己壞掉 vs 真的沒問題長得一模一樣，Rule 25/33）。
const DECK_IDS = [...pool.values()]
  .filter(c => String(c.supertype || '').startsWith('Pok') && ['H','I','J'].includes(c.regulationMark))
  .slice(0, 6).map(c => c.id);
const deckOf = (tag) => DECK_IDS.map((id, i) => inst(id, tag + i));

function mkState(attCard, defCard, energyInsts) {
  return {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
    isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
    activeStadium: null, pendingPrizes: [0, 0],
    players: [
      { name: 'P1', active: inst(attCard.id, 'a1', { energyAttached: energyInsts }),
        bench: [inst(attCard.id, 'b1')], hand: [inst(attCard.id, 'h1')], deck: deckOf('d'),
        discard: [inst(attCard.id, 'g1')], prizes: [inst(attCard.id, 'pz1'), inst(attCard.id, 'pz2')],
        energyAttachedThisTurn: false },
      { name: 'P2', active: inst(defCard.id, 'oa1'),
        bench: [inst(defCard.id, 'ob1')], hand: [inst(defCard.id, 'oh1'), inst(defCard.id, 'oh2')],
        deck: deckOf('od'), discard: [inst(defCard.id, 'og1')],
        prizes: [inst(defCard.id, 'opz1'), inst(defCard.id, 'opz2')], energyAttachedThisTurn: false },
    ],
  };
}
const findAtk = (name, atkName) => {
  const c = [...pool.values()].find(x => x.name === name && (x.attacks || []).some(a => a.name === atkName));
  if (!c) return null;
  return { card: c, idx: (c.attacks || []).findIndex(a => a.name === atkName), atk: (c.attacks || []).find(a => a.name === atkName) };
};
const findCard = (name) => [...pool.values()].find(x => x.name === name) ?? null;
function setup(attName, atkName, defName) {
  const f = findAtk(attName, atkName); const d = findCard(defName);
  if (!f || !d) return null;
  return { ...f, def: d, state: mkState(f.card, d, payFor(f.atk.cost, f.card.pokemonType)) };
}
// 中性防守方：無弱點無抵抗力、HP 夠高（不會被一拳打死而改變流程）
const NEUTRAL = [...pool.values()].find(x =>
  String(x.supertype || '').startsWith('Pok') && ['H','I','J'].includes(x.regulationMark) &&
  (x.stage ?? x.subtype) === 'Basic' && !x.abilities?.length && !x.weakness && !x.resistance && x.hp >= 200);

// ══════════════════════════════════════════════════════════════════════════
console.log('⓪ 前提：fixture 素材齊備（掃描器/樣本自身先驗，Rule 25）');
chk('卡池載入（> 4000 張）', pool.size > 4000);
chk('八種基本能量都找得到', Object.keys(ENERGY).length === 8);
chk('中性防守方存在：' + (NEUTRAL?.name ?? '—'), !!NEUTRAL);
chk('牌庫 fixture 用了 ≥ 5 種不同的卡（否則隱藏資訊偵測測不出東西）', new Set(DECK_IDS).size >= 5);

// ══════════════════════════════════════════════════════════════════════════
console.log('\n① ⭐⭐ 核心不變量 A：預估值 === 真的打下去之後的實際傷害');
// 同一組盤面：先跑預估、再真打，兩者必須相等。
const CASES = [
  // [標題, 攻擊方, 招式, 防守方, 期望在公式裡看到的 label（沒有就 null）]
  ['固定傷害（無弱抗）', '菊草葉', '飛葉快刀', NEUTRAL?.name, null],
  ['弱點 ×2',            '菊草葉', '飛葉快刀', '狃拉', '弱點'],
  ['抵抗力 −30',         '大岩蛇', '怪力',     '凱西', '抵抗力'],   // v6.234：label 改用卡面官方用語
  ['+N 條件（對手為 ex）', '火焰鳥', '鬥志之翼', '超級拉帝亞斯ex', null],
  ['+N 條件（負對照：對手非 ex）', '火焰鳥', '鬥志之翼', '菊草葉', null],
  ['×N 依數量（自身能量數）', '拉普拉斯ex', '水炮迴旋', NEUTRAL?.name, null],
];
const consistencyPairs = [];
for (const [title, an, atkn, dn, wantLabel] of CASES) {
  const s = dn ? setup(an, atkn, dn) : null;
  if (!s) { chk(`${title}（${an}｜${atkn} vs ${dn}）—— fixture 找不到`, false); continue; }
  const before = JSON.stringify(s.state);
  const est = mod.estimateAttackDamage(s.state, s.idx, pool, 0);
  const real = mod.applyAction(s.state, { type: 'ATTACK', attackIndex: s.idx }, pool);
  const actual = real.lastDealtDamage ?? 0;
  const ok = est.kind === 'exact' && est.value === actual;
  chk(`${title}：${an}｜${atkn} vs ${dn} → 預估 ${est.kind === 'exact' ? est.value : est.kind} / 實打 ${actual}`, ok);
  if (wantLabel) {
    chk(`  └ 有講「為什麼」：公式含「${wantLabel}」→ ${est.formula || '(無)'}`,
        est.kind === 'exact' && (est.terms || []).some(t => t.label === wantLabel));
  }
  consistencyPairs.push({ title, est, actual, before, after: JSON.stringify(s.state), state: s.state, idx: s.idx });
}
// 弱點案例必須真的翻倍（否則「一致」可能只是兩邊都沒算弱點）
{
  const plain = setup('菊草葉', '飛葉快刀', NEUTRAL?.name);
  const weak  = setup('菊草葉', '飛葉快刀', '狃拉');
  const a = plain && mod.estimateAttackDamage(plain.state, plain.idx, pool, 0);
  const b = weak && mod.estimateAttackDamage(weak.state, weak.idx, pool, 0);
  chk('正對照：弱點案例的數字確實是無弱抗案例的 2 倍（證明①不是恆真）',
      !!a && !!b && a.kind === 'exact' && b.kind === 'exact' && b.value === a.value * 2);
}
// +N 條件正負對照
{
  const yes = setup('火焰鳥', '鬥志之翼', '超級拉帝亞斯ex');
  const no  = setup('火焰鳥', '鬥志之翼', '菊草葉');
  const a = yes && mod.estimateAttackDamage(yes.state, yes.idx, pool, 0);
  const b = no  && mod.estimateAttackDamage(no.state,  no.idx,  pool, 0);
  chk('正對照：+N 條件成立/不成立的預估確實不同（證明條件真的有被算進去）',
      !!a && !!b && a.kind === 'exact' && b.kind === 'exact' && a.value !== b.value);
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n② ⭐⭐ 核心不變量 B：預估跑完後原本的 GameState 逐位元組不變');
{
  const cases = [
    ['固定傷害', '菊草葉', '飛葉快刀', NEUTRAL?.name],
    ['弱點',     '菊草葉', '飛葉快刀', '狃拉'],
    ['擲幣',     '喵喵',   '亂抓',     NEUTRAL?.name],
    ['直到反面', '胖丁',   '滾球',     NEUTRAL?.name],
    ['開 picker','凱路迪歐','能量反射', NEUTRAL?.name],
  ];
  for (const [t, an, atkn, dn] of cases) {
    const s = dn ? setup(an, atkn, dn) : null;
    if (!s) { chk(`${t}：fixture 找不到 ${an}｜${atkn}`, false); continue; }
    const before = JSON.stringify(s.state);
    mod.estimateAttackDamage(s.state, s.idx, pool, 0);
    chk(`${t}（${an}｜${atkn}）：跑完預估後盤面深比對完全相同`, JSON.stringify(s.state) === before);
  }
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n③ ⭐ 突變測試（沒有這一段，①②可能只是恆真的安慰劑）');
{
  // 突變 1a：把 runOnce 的 structuredClone 拿掉，其餘一字不改 ⇒ ②的斷言必須變紅
  const s = setup('菊草葉', '飛葉快刀', '狃拉');
  const before = JSON.stringify(s.state);
  const work = s.state;                 // ← 就是「沒有深複製」的那一行
  work.lastDealtDamage = 0;             // runOnce 對複本做的第一件事
  mod.applyAction(work, { type: 'ATTACK', attackIndex: s.idx }, pool);
  chk('突變1a：拿掉 structuredClone ⇒ 真盤面確實被改到（證明②的深比對抓得到）',
      JSON.stringify(s.state) !== before);
}
{
  // 突變 1b：示範**為什麼**淺複製不夠 —— handlePlaying 只做 `[...state.players]` 與
  //   `{...players[aIdx]}`，內層的 CardInstance 仍是同一個物件參照。
  const s = setup('菊草葉', '飛葉快刀', '狃拉');
  const dmg0 = s.state.players[1].active.damage;
  const shallow = { ...s.state, players: [...s.state.players] };
  shallow.players[1] = { ...shallow.players[1] };     // 淺複製到 PlayerState 為止（＝引擎的做法）
  shallow.players[1].active.damage += 10;             // 任一效果就地改 CardInstance
  chk('突變1b：淺複製擋不住內層 CardInstance 的就地修改（這正是深複製存在的理由）',
      s.state.players[1].active.damage === dmg0 + 10);
  s.state.players[1].active.damage = dmg0;            // 還原，免得影響後面的斷言
}
{
  // 反向：現行引擎的 ATTACK 路徑目前**是**純函式（沒有就地修改），
  //   所以 ② 現在是「保險」而不是「修正」。這條把現況記下來：真的哪天引擎開始就地改，
  //   這條會變紅、提醒讀者去看 ② 是不是還擋得住。
  const s = setup('菊草葉', '飛葉快刀', NEUTRAL?.name);
  const before = JSON.stringify(s.state);
  mod.applyAction(s.state, { type: 'ATTACK', attackIndex: s.idx }, pool);
  chk('現況記錄：引擎 ATTACK 路徑目前沒有就地修改盤面（深複製是保險，不是在修 bug）',
      JSON.stringify(s.state) === before);
}
{
  // 突變 2：把預估改成「自己算一份」（照卡面印刷傷害）⇒ ①的斷言必須變紅
  const s = setup('菊草葉', '飛葉快刀', '狃拉');
  const naive = Number(String(s.atk.damage).replace(/[^0-9]/g, '')) || 0;   // 20（沒算弱點）
  const real = mod.applyAction(s.state, { type: 'ATTACK', attackIndex: s.idx }, pool).lastDealtDamage ?? 0;
  chk(`突變2：自己算的 ${naive} ≠ 實打 ${real}（證明①真的在比對，不是恆等式）`, naive !== real);
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n④ 擲幣：下界＝全反面實跑值、上界＝全正面實跑值');
{
  const s = setup('帕底亞 烏波', '打滾', NEUTRAL?.name);       // 10+，正面 +20
  const e = s && mod.estimateAttackDamage(s.state, s.idx, pool, 0);
  chk('帕底亞 烏波｜打滾 → 範圍 10～30' + (e ? `（實得 ${e.kind === 'range' ? e.min + '～' + e.max : e.kind}）` : ''),
      !!e && e.kind === 'range' && e.min === 10 && e.max === 30);
  chk('  └ 標明是擲幣造成的', !!e && e.kind === 'range' && e.coin === true);
  const s2 = setup('喵喵', '亂抓', NEUTRAL?.name);              // 擲 3 次，正面數 ×20
  const e2 = s2 && mod.estimateAttackDamage(s2.state, s2.idx, pool, 0);
  chk('喵喵｜亂抓（擲3次×20）→ 範圍 0～60' + (e2 ? `（實得 ${e2.kind === 'range' ? e2.min + '～' + e2.max : e2.kind}）` : ''),
      !!e2 && e2.kind === 'range' && e2.min === 0 && e2.max === 60);
  chk('  └ 短文案有「預估」二字、且不是寫成「實際傷害」',
      !!e2 && mod.estimateShortText(e2).includes('預估') && !mod.estimateShortText(e2).includes('實際'));
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n⑤ ⭐「擲硬幣直到出現反面」一律不給範圍（行為端偵測 × 卡面枚舉 交叉驗證）');
{
  // 卡面枚舉（唯一權威來源＝static/cards 的 effect 原文）
  const byText = new Map();     // '卡名|招式名' -> true
  const coinBounded = [];       // 有擲幣但**有次數上限**的招式（反向對照樣本）
  for (const c of pool.values()) {
    if (!String(c.supertype || '').startsWith('Pok')) continue;
    if (!['H','I','J'].includes(c.regulationMark)) continue;
    for (let i = 0; i < (c.attacks || []).length; i++) {
      const a = c.attacks[i]; const e = a.effect || '';
      const key = c.name + '|' + a.name;
      if (/直到出現(反|正)面/.test(e)) byText.set(key, { c, i });
      else if (e.includes('硬幣') && String(a.damage || '').length) {
        if (coinBounded.length < 60 && !coinBounded.some(x => x.key === key)) coinBounded.push({ key, c, i });
      }
    }
  }
  // ⚠ 掃描器下限斷言：沒有這條，掃描器壞掉時整段會「全部通過」
  chk(`掃描器自身：卡面枚舉到 ${byText.size} 個「直到出現反面」招式（下限 20）`, byText.size >= 20);
  chk(`掃描器自身：反向對照樣本（有擲幣但有上限）${coinBounded.length} 個（下限 20）`, coinBounded.length >= 20);

  let openOk = 0, openBad = [];
  for (const [key, { c, i }] of byText) {
    const st = mkState(c, NEUTRAL, payFor(c.attacks[i].cost, c.pokemonType));
    const e = mod.estimateAttackDamage(st, i, pool, 0);
    // 允許 none/unknown/depends（有些是純效果或會開 picker），但**絕不可以是 range**
    if (e.kind === 'range') openBad.push(key + ' → range ' + e.min + '～' + e.max);
    else if (e.kind === 'open') openOk++;
  }
  chk(`「直到出現反面」全部 ${byText.size} 個都沒有被顯示成範圍（違規 ${openBad.length} 個）${openBad.slice(0,3).join(' / ')}`,
      openBad.length === 0);
  chk(`  └ 其中 ${openOk} 個被行為端判成「無上限」（下限 10；證明偵測不是恆真地放棄）`, openOk >= 10);

  // 反向：有擲幣但有次數上限的招式，**不可以**被誤判成無上限
  let falseOpen = [];
  for (const { key, c, i } of coinBounded) {
    const st = mkState(c, NEUTRAL, payFor(c.attacks[i].cost, c.pokemonType));
    const e = mod.estimateAttackDamage(st, i, pool, 0);
    if (e.kind === 'open') falseOpen.push(key);
  }
  chk(`反向對照：${coinBounded.length} 個「有上限」的擲幣招式沒有被誤判成無上限（誤判 ${falseOpen.length}）${falseOpen.slice(0,3).join(' / ')}`,
      falseOpen.length === 0);

  const s = setup('胖丁', '滾球', NEUTRAL?.name);
  const e = s && mod.estimateAttackDamage(s.state, s.idx, pool, 0);
  // v6.234：文案改成「傷害依擲幣次數而定」（站長裁定；舊的「0+」讀起來很怪）。
  chk('胖丁｜滾球 講「依擲幣次數而定」而不是給假的上界：' + (e ? mod.estimateShortText(e) : '—'),
      !!e && e.kind === 'open' && mod.estimateShortText(e).includes('傷害依擲幣次數而定'));
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n⑥ 會跳選擇視窗的招式：顯示「依選擇而定」，絕不顯示成 0');
{
  // 傷害尚未定案就先開 picker 的招式（呼朋引伴型：先選要放哪幾隻上備戰）
  let sample = null;
  for (const [an, atkn] of [['波加曼', '朋友呼喚'], ['毒電嬰', '呼朋引伴'], ['波皇子', '瞄準俯衝']]) {
    const f = findAtk(an, atkn); if (!f) continue;
    const st = mkState(f.card, NEUTRAL, payFor(f.atk.cost, f.card.pokemonType));
    const e = mod.estimateAttackDamage(st, f.idx, pool, 0);
    if (e.kind === 'depends' && e.why === 'selection') { sample = { c: f.card, i: f.idx, e }; break; }
  }
  chk('找得到「會跳選擇視窗」的招式樣本：' + (sample ? sample.c.name + '｜' + sample.c.attacks[sample.i].name : '—'), !!sample);
  if (sample) {
    const txt = mod.estimateShortText(sample.e);
    chk('  └ 文案是「依選擇而定」而不是 0：' + txt, txt.includes('依選擇而定') && !/\b0\b/.test(txt));
  }
  // 正對照：先造成傷害、之後才開 picker 的招式，傷害已定案 ⇒ 照常顯示數字
  const s = setup('拉普拉斯ex', '水炮迴旋', NEUTRAL?.name);
  const e = s && mod.estimateAttackDamage(s.state, s.idx, pool, 0);
  chk('正對照：傷害已定案、之後才開 picker 的招式仍顯示數字（拉普拉斯ex｜水炮迴旋）',
      !!e && e.kind === 'exact' && e.value > 0);
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n⑦ ⚠ 不得洩漏隱藏資訊（瀏覽器端那份盤面看得到牌庫/獎賞/對手手牌）');
{
  // 呆呆王｜耀閃挑戰：傷害取決於「自己牌庫上方 1 張」＝玩家看不到的資訊
  const s = setup('呆呆王', '耀閃挑戰', NEUTRAL?.name);
  const e = s && mod.estimateAttackDamage(s.state, s.idx, pool, 0);
  chk('呆呆王｜耀閃挑戰（傷害取決於自己牌庫頂）→ 不給數字，顯示「依未知的牌序而定」'
      + (e ? `（實得 ${e.kind}${e.kind === 'depends' ? '/' + e.why : ''}）` : ''),
      !!e && e.kind === 'depends' && e.why === 'hidden');
  // 正對照：一般招式不可以被誤判成 hidden（否則這條 gate 等於把功能整個關掉）
  const s2 = setup('菊草葉', '飛葉快刀', '狃拉');
  const e2 = s2 && mod.estimateAttackDamage(s2.state, s2.idx, pool, 0);
  chk('正對照：一般招式沒有被誤判成「依未知的牌序而定」', !!e2 && e2.kind === 'exact');
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n⑧ Math.random 一定還原（含引擎 throw 的路徑）');
{
  const before = Math.random;
  const s = setup('菊草葉', '飛葉快刀', '狃拉');
  mod.estimateAttackDamage(s.state, s.idx, pool, 0);
  chk('正常路徑後 Math.random 已還原', Math.random === before);
  mod.estimateAttackDamage(s.state, s.idx, new Map(), 0);   // 空 pool → 引擎會 throw
  chk('引擎 throw 後 Math.random 仍還原（try/finally）', Math.random === before);
  chk('空 pool 時不硬掰數字（回 unknown/depends，不顯示）',
      !mod.hasEstimateToShow(mod.estimateAttackDamage(s.state, s.idx, new Map(), 0)));
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n⑨ 接線（靜態）：只在休閒對戰、兩套 UI、一份計算、沒有拿 @media 當手機開關');
{
  const PAGE = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
  const MOB  = readFileSync(join(ROOT, 'src/routes/game/MobilePortraitBattle.svelte'), 'utf8');
  const MODSRC = readFileSync(join(ROOT, 'src/lib/game/damage-estimate.ts'), 'utf8');
  chk(`掃描器前提：兩個 svelte 都讀得到（未截斷）— ${PAGE.length}/${MOB.length} 字`,
      PAGE.length > 900000 && MOB.length > 90000);

  // ⭐ 錦標賽 gate 用的是既有的中央述詞 isTournament，而且是 derived 的第一條
  const iDer = PAGE.indexOf('const damageEstimates = $derived.by');
  chk('桌機有 damageEstimates 這個唯一入口', iDer > 0);
  chk('⭐ 第一道 gate 就是既有中央述詞 isTournament（錦標賽完全不顯示）',
      iDer > 0 && /const damageEstimates = \$derived\.by<[^>]*>\(\(\) => \{\s*\n\s*if \(isTournament\) return null;/.test(PAGE));
  chk('觀戰／回放也不顯示', iDer > 0 && /if \(isSpectator \|\| isTournSpectator \|\| isTReplay\) return null;/.test(PAGE));
  chk('沒有自己新寫一份「是不是錦標賽」的判斷（只用 isTournament）',
      !/tournamentMode\s*===\s*true[\s\S]{0,120}damageEstimate/i.test(PAGE));

  // ⭐ 計算只有一份：estimateAllAttacks 全站只有 +page.svelte 呼叫，手機元件不得自己算
  chk('⭐ 計算只有一份：estimateAllAttacks 只在 +page.svelte 被呼叫一次',
      (PAGE.match(/estimateAllAttacks\(/g) || []).length === 1);
  chk('⭐ 手機直式元件不自己算（沒有 import estimateAllAttacks）',
      !MOB.includes('estimateAllAttacks'));
  chk('⭐ 手機直式元件靠 props 拿結果（attackEstimates）',
      MOB.includes('attackEstimates') && PAGE.includes('attackEstimates={damageEstimates}'));
  chk('⭐ 文案也共用同一支（兩邊都用 estimateShortText，沒有各寫一套措辭）',
      PAGE.includes('estimateShortText(') && MOB.includes('estimateShortText('));

  // ⭐ 桌機 hover：CSS 顯示，不是 JS 事件（hover 事件裡同步跑會卡頓）
  // ⭐v6.237：hover 的目標從按鈕本身改成外層容器 .atk-slot ——
  //   能量還沒附夠的招式按鈕是原生 disabled，disabled 元件不派送滑鼠事件、
  //   各家瀏覽器對 :hover 的處理也不一致 ⇒ 掛在按鈕上等於「最需要時看不到」。
  //   （按鈕仍維持原生 disabled，玩家按不下去；細節由 test-v6237 釘死。）
  chk('桌機是 CSS :hover 顯示（v6.237 起目標是外層 .atk-slot:hover .dmg-est）',
      /\.atk-slot:hover \.dmg-est\{/.test(PAGE) && !/\.btn-act\.atk:hover \.dmg-est\{/.test(PAGE));
  chk('桌機提示不影響版面（position:absolute + 平常 display:none）',
      /\.dmg-est\{[\s\S]{0,200}position:absolute;[\s\S]{0,200}display:none;/.test(PAGE));
  chk('沒有把預估掛在 hover 的 JS 事件上（onmouseenter/onmouseover 不碰 estimate）',
      !/on(mouseenter|mouseover)=\{[^}]*[eE]stimate/.test(PAGE));

  // ⚠ 禁止用 @media 當「是不是手機」的開關：新樣式不得被包在 @media 裡
  {
    const i = PAGE.indexOf('.dmg-est{');
    const head = PAGE.lastIndexOf('@media', i);
    // 取 .dmg-est 之前最近的 @media，確認它的區塊在 .dmg-est 之前就已經關閉
    let inMedia = false;
    if (head > 0) {
      let depth = 0;
      for (let k = PAGE.indexOf('{', head); k < i; k++) {
        if (PAGE[k] === '{') depth++;
        else if (PAGE[k] === '}') depth--;
        if (depth === 0 && k > PAGE.indexOf('{', head)) break;
      }
      inMedia = depth > 0;
    }
    chk('⚠ .dmg-est 樣式沒有被包在 @media 裡（禁止拿 @media 當手機開關）', i > 0 && !inMedia);
  }

  // 模板用到的 class 都有 CSS（class 名寫錯只會靜默失效）
  for (const cls of ['dmg-est', 'dmg-est-main', 'dmg-est-formula']) {
    chk(`class .${cls} 模板有用、CSS 也有定義`,
        PAGE.includes(`class="${cls}"`) && PAGE.includes(`.${cls}`));
  }

  // 模組本身：不得出現「另外算一份傷害」的痕跡
  chk('⭐ damage-estimate.ts 只呼叫真實 applyAction，沒有自己乘弱點/減抵抗力',
      MODSRC.includes("import { applyAction } from './engine'")
      && !/\*\s*2\b[^\n]*弱點/.test(MODSRC) && !/baseDamage/.test(MODSRC));
  chk('⭐ 深複製用 structuredClone，而且沒有淺複製的退路',
      MODSRC.includes('structuredClone(base)') && !/\{\s*\.\.\.base\s*\}/.test(MODSRC));
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n⑩ HEAD-FAIL：上一版（BASE v6.232）不可能通過這支守衛');
{
  const BASE = '4ed788b19b1ba416b3bab1cda17cf57752d350cc';
  // ⚠ CI（actions/checkout@v4）預設是 `fetch-depth: 1` 的**淺複製**，物件庫裡根本沒有 BASE 那顆
  //   commit。那不是「守衛發現問題」，是「這台機器沒有可比對的舊版」。
  // ⚠ v6.263：這一節是**歷史性**的 HEAD-FAIL 證明（「上一版連這個檔都沒有」）。
  //   把它換成內嵌常數只會變成恆真安慰劑（我們無法在沒有歷史時驗證歷史）⇒ 維持跳過，
  //   但改走中央 helper，讓「這一段沒有在守」在 CI log 上大聲印出來。
  //   ⭐ 守 HEAD 的責任在 ①~⑨（行為端），這一節從來不是唯一防線。
  if (!hasBaseCommit(ROOT, BASE)) {
    shallowSkip('v6.233 ⑩ HEAD-FAIL（BASE 連 damage-estimate.ts 都沒有）',
                '歷史性斷言，無法內嵌；守 HEAD 的是 ①~⑨');
  } else {
    chk('BASE 沒有 src/lib/game/damage-estimate.ts（新檔）',
        !readBaseBlob(ROOT, BASE, 'src/lib/game/damage-estimate.ts').ok);
    const r = readBaseBlob(ROOT, BASE, 'src/routes/game/+page.svelte');
    chk('BASE 的 +page.svelte 沒有 damageEstimates（⑨ 會全紅）', r.ok && !r.out.includes('damageEstimates'));
  }
}

// ══════════════════════════════════════════════════════════════════════════
// ⭐ IRON_RULES Rule 32：效能數字必須附量測腳本 —— 就是這一段。
console.log('\n⑪ 效能實測（本段就是那份量測腳本；沙盒 CPU 約比正式 VM 慢一個量級）');
{
  const bench = [
    ['固定傷害', '菊草葉', '飛葉快刀', NEUTRAL?.name],
    ['弱點',     '菊草葉', '飛葉快刀', '狃拉'],
    ['擲幣範圍', '喵喵',   '亂抓',     NEUTRAL?.name],
    ['直到反面', '胖丁',   '滾球',     NEUTRAL?.name],
    ['×N 依數量','拉普拉斯ex','水炮迴旋', NEUTRAL?.name],
  ].map(([t, an, atkn, dn]) => ({ t, s: dn ? setup(an, atkn, dn) : null })).filter(x => x.s);
  // 先暖機（第一次含 JIT，量出來會失真）
  for (const b of bench) mod.estimateAttackDamage(b.s.state, b.s.idx, pool, 0);
  const REP = 20; let total = 0, worst = ['', 0];
  for (const b of bench) {
    const t0 = process.hrtime.bigint();
    for (let r = 0; r < REP; r++) mod.estimateAttackDamage(b.s.state, b.s.idx, pool, 0);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6 / REP;
    total += ms;
    if (ms > worst[1]) worst = [b.t, ms];
    console.log(`  ${b.t}：${ms.toFixed(2)} ms/招`);
  }
  const avg = total / bench.length;
  console.log(`  平均 ${avg.toFixed(2)} ms/招（最慢：${worst[0]} ${worst[1].toFixed(2)} ms）`);
  chk(`平均 ${avg.toFixed(2)} ms/招 ≤ 30ms（超過就要重新檢討「盤面變動時全算」這個策略）`, avg <= 30);
}

console.log(`\n[v6233-damage-estimate] PASS ${n - bad} / FAIL ${bad}`);
process.exit(bad ? 1 : 0);
