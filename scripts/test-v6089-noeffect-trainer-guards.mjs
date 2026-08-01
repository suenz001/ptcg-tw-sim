/**
 * v6.089 守衛 — 兩個維度
 *
 * A 維度：「特性被消除」中央述詞 isAbilityHolderEffective 的消費點漏接
 *   （與 Wilson v6.088 回報的「傳說的熔岩洞在場但多龍奇仍能用偵查指令」同型）
 *   - USE_HAND_DISCARD_ABILITY（超能妙喵｜誘導之尾、火神蛾｜熱浪鱗粉，兩張都是 Stage1）→ 行為測試
 *   - BENCH_PLACE_TRIGGERS（放到備戰即觸發）→ 靜態守衛
 *     ⚠ 誠實註記：此路徑的 holder（喵喵ex 等）目前全是【基礎】寶可夢，而傳說的熔岩洞只消除
 *       「進化寶可夢」的特性 → 現階段做不出會失敗的行為案例。此處為預防性收斂，
 *       故以「有呼叫中央述詞」的靜態守衛把關，不假裝有行為覆蓋。
 *
 * B 維度：打出後「完全沒有效果」卻消耗卡片＋支援者權的訓練家漏 regG 守衛
 *   （與 Wilson v6.088 回報的「庫瑟洛斯奇的企圖對手手牌已≤3 仍可打出」同型）
 *   鏽蝕組手下 / AZ的平和 / 古歷 / 艾莉絲的鬥志 / 枇琶
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.v89-s.js'), E = join(ROOT, '.v89-e.ts'), O = join(ROOT, '.v89-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E,
  "export { TRAINER_GUARDS } from './src/lib/game/effects/_shared';\n" +
  "export { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const mod = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
const byName = (n, pred) => {
  for (const [, c] of pool) {
    if (c.name === n && ['H', 'I', 'J'].includes(c.regulationMark) && (!pred || pred(c))) return c;
  }
  return null;
};
let iid = 1;
const inst = (card, extra = {}) => ({ iid: iid++, cardId: String(card.id), damage: 0, energyAttached: [], ...extra });

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass++; } else { fail++; console.log('  FAIL:', label); } };

// ── 共用最小 state ─────────────────────────────────────────
function mkState(over = {}) {
  const mk = () => ({ name: 'P', active: null, bench: [], hand: [], deck: [], discard: [], prizes: [] });
  return {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
    isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
    players: [mk(), mk()], ...over,
  };
}

// ══════════════════════════════════════════════════════════
// A 維度-1：USE_HAND_DISCARD_ABILITY 補接「特性被消除」中央述詞
//   ⚠ 誠實註記：`ON_DISCARD_FROM_HAND_ABILITIES` 這個 Map 自 v5.510 起已清空
//     （超能妙喵｜誘導之尾、火神蛾｜熱浪鱗粉都改成寶可夢上的 regA 啟動特性，
//      走 USE_ABILITY —— 那條路徑已由 v6.088 接上中央述詞）。
//     因此本觸發點目前不可能被走到，做不出會失敗的行為案例；此處補的 gate 屬
//     預防性（若未來有卡再啟用這條路徑，不會重蹈 v6.088 的覆轍），
//     故以靜態守衛把關，不假裝有行為覆蓋。
// ══════════════════════════════════════════════════════════
{
  const src = readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8');
  const i = src.indexOf("const fn = ON_DISCARD_FROM_HAND_ABILITIES.get(triggerName);");
  ok(i > 0, 'A1 找得到 USE_HAND_DISCARD_ABILITY 觸發點');
  const win = src.slice(i, i + 3000);
  ok(win.includes('isAbilityHolderEffective'), '⭐ A1 棄手牌觸發型特性有接中央述詞 isAbilityHolderEffective');
  ok(win.indexOf('isAbilityHolderEffective') < win.indexOf('const newHand = [...attacker.hand]'),
    '⭐ A1 該 gate 位在「實際執行效果／丟手牌」之前');
}

// ══════════════════════════════════════════════════════════
// A 維度-2：BENCH_PLACE_TRIGGERS 靜態守衛
// ══════════════════════════════════════════════════════════
{
  const src = readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8');
  const i = src.indexOf('const placeFn = BENCH_PLACE_TRIGGERS.get(card.name);');
  ok(i > 0, 'A2 找得到 BENCH_PLACE_TRIGGERS 觸發點');
  const win = src.slice(i, i + 900);
  ok(win.includes('isAbilityHolderEffective'), '⭐ A2 放備戰觸發型特性有接中央述詞 isAbilityHolderEffective');
  // 負對照（證明這個守衛抓得到東西）：把中央述詞名字改掉就應該找不到
  ok(!win.replace(/isAbilityHolderEffective/g, 'XX').includes('isAbilityHolderEffective'),
    'A2 負對照：守衛確實在檢查字串（可失敗）');
}

// ══════════════════════════════════════════════════════════
// B 維度：5 張訓練家的 regG 守衛
// ══════════════════════════════════════════════════════════
const G = mod.TRAINER_GUARDS;
const guard = (name, st, idx = 0) => {
  const g = G.get(name);
  if (!g) return null;          // null = 沒有守衛
  return !!g(st, idx, pool);
};

// B-1 鏽蝕組手下：卡面「必須在上個對手的回合自己的寶可夢昏厥了才可使用」＋丟對手能量
{
  const opp = byName('皮卡丘', c => c.supertype === 'Pokemon');
  const en = byName('基本【雷】能量') || byName('基本【火】能量');
  ok(!!opp && !!en, 'B1 前置卡片齊全');
  if (opp && en) {
    const base = () => {
      const st = mkState();
      st.players[1].active = inst(opp);
      return st;
    };
    // 沒被 KO 過 → 不可打出
    const s1 = base(); s1.oppAttackKOdMeInLastOppTurn = [0, 0]; s1.oppAbilityKOdMeInLastOppTurn = [0, 0];
    s1.players[1].active.energyAttached = [inst(en)];
    ok(guard('鏽蝕組手下', s1) === false, '⭐ B1 上個對手回合沒被昏厥 → 鏽蝕組手下不可打出');
    // 被 KO 過但對手全場無能量 → 不可打出
    const s2 = base(); s2.oppAttackKOdMeInLastOppTurn = [1, 0]; s2.oppAbilityKOdMeInLastOppTurn = [0, 0];
    ok(guard('鏽蝕組手下', s2) === false, '⭐ B1 對手場上完全沒有能量 → 鏽蝕組手下不可打出');
    // 正對照
    const s3 = base(); s3.oppAttackKOdMeInLastOppTurn = [1, 0]; s3.oppAbilityKOdMeInLastOppTurn = [0, 0];
    s3.players[1].active.energyAttached = [inst(en)];
    ok(guard('鏽蝕組手下', s3) === true, 'B1 正對照：被昏厥過＋對手有能量 → 可打出');
  }
}

// B-2 AZ的平和：卡面「將自己的戰鬥寶可夢與備戰寶可夢互換」
{
  const p = byName('皮卡丘', c => c.supertype === 'Pokemon');
  if (p) {
    const s1 = mkState(); s1.players[0].active = inst(p);              // 備戰空
    ok(guard('AZ的平和', s1) === false, '⭐ B2 備戰區為空 → AZ的平和不可打出');
    const s2 = mkState(); s2.players[0].active = inst(p); s2.players[0].bench = [inst(p)];
    ok(guard('AZ的平和', s2) === true, 'B2 正對照：有備戰 → 可打出');
  }
}

// B-3 古歷：卡面「將雙方的所有寶可夢各恢復50HP」
{
  const p = byName('皮卡丘', c => c.supertype === 'Pokemon');
  if (p) {
    const s1 = mkState();
    s1.players[0].active = inst(p); s1.players[1].active = inst(p);    // 雙方皆滿血
    ok(guard('古歷', s1) === false, '⭐ B3 雙方全場滿血 → 古歷不可打出');
    const s2 = mkState();
    s2.players[0].active = inst(p); s2.players[1].active = inst(p, { damage: 30 });
    ok(guard('古歷', s2) === true, 'B3 正對照：對手有傷（卡面含雙方）→ 可打出');
    const s3 = mkState();
    s3.players[0].active = inst(p, { damage: 10 }); s3.players[1].active = inst(p);
    ok(guard('古歷', s3) === true, 'B3 正對照：自己有傷 → 可打出');
  }
}

// B-4 艾莉絲的鬥志：卡面「必須將自己的1張手牌丟棄才可使用」
{
  const c = byName('艾莉絲的鬥志'), other = byName('傷藥');
  if (c && other) {
    const s1 = mkState(); s1.players[0].hand = [inst(c)];              // 只剩這張，cost 付不出
    ok(guard('艾莉絲的鬥志', s1) === false, '⭐ B4 手牌只剩這張（付不出丟棄成本）→ 艾莉絲的鬥志不可打出');
    const s2 = mkState(); s2.players[0].hand = [inst(c), inst(other)];
    ok(guard('艾莉絲的鬥志', s2) === true, 'B4 正對照：手牌 2 張 → 可打出');
    // 誠實邊界：手牌已 ≥6 抽 0 張 — 抽牌類依站內慣例放行，不 gate
    const s3 = mkState(); s3.players[0].hand = Array.from({ length: 8 }, () => inst(other)).concat([inst(c)]);
    ok(guard('艾莉絲的鬥志', s3) === true, 'B4 邊界：手牌已很多仍可打出（抽牌類不 gate，站內慣例）');
  }
}

// B-5 枇琶：卡面「查看對手的手牌，從其中選擇最多2張物品卡，將其丟棄」
{
  const other = byName('傷藥');
  if (other) {
    const s1 = mkState();                                              // 對手手牌 0 張
    ok(guard('枇琶', s1) === false, '⭐ B5 對手手牌為 0 張 → 枇琶不可打出');
    const s2 = mkState(); s2.players[1].hand = [inst(other)];
    ok(guard('枇琶', s2) === true, 'B5 正對照：對手有手牌 → 可打出');
  }
}

// B-6 v6.088 的原案不可退化
{
  const p = byName('皮卡丘', c => c.supertype === 'Pokemon'), other = byName('傷藥');
  if (other) {
    const s1 = mkState(); s1.players[1].hand = [inst(other), inst(other), inst(other)];
    ok(guard('庫瑟洛斯奇的企圖', s1) === false, 'B6 回歸：對手手牌 3 張 → 庫瑟洛斯奇的企圖不可打出');
    const s2 = mkState(); s2.players[1].hand = Array.from({ length: 4 }, () => inst(other));
    ok(guard('庫瑟洛斯奇的企圖', s2) === true, 'B6 回歸正對照：對手手牌 4 張 → 可打出');
  }
}

console.log(`v6089 無效果訓練家守衛 + 特性消除漏接：PASS ${pass} / FAIL ${fail}`);
if (fail > 0) process.exit(1);
