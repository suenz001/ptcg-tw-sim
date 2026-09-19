// v6.407 守衛：自身能量的「付出」必須在**造成傷害之後**才執行。
//
// 【玩家回報】超級雷電獸ex｜狂暴噴射 打 330，身上的伏特【雷】能量沒有 +20。
//
// 【官方裁定】招式結算是**三段**，不是兩段：
//   ① 傷害計算與造成 → ② 招式效果（含付出自身能量）→ ③ 受傷時的特性／道具
//   ・①→② 伏特【雷】能量 Q&A（asia.pokemon-card.com 規則搜尋「伏特【雷】能量」）：
//       Q 閃電鳥身上附 3 張伏特【雷】能量，用「十萬伏特」（丟光自身能量）會不會 +60？
//       A 會「+60」點。**這個情況下，會在造成招式傷害後，才丟棄…能量卡。**
//     ＋ `PTCG RULES/PTCG_RULES.md` §17.46.D（粉碎箭 vs 凍原堡壘）：
//       「在因招式『粉碎箭』的效果丟棄…能量之前，就會先計算招式的傷害」
//   ・②→③ §17.46.A（螺旋關節 vs 甲殼刺：能量已放回手牌 ⇒ 甲殼刺選不到）、
//     §17.46.D（夾尾巴逃跑 vs 甲殼刺：不會丟棄）、§17.22.A（幸運頭盔 vs 脅迫獠牙）
//
// 【退化點】v6.367（站長裁定六-9）把「PRE 造成的差異疊回 attacker 快照」之後才暴露出來：
//   v5.992 把付出搬到 PRE 時，傷害管線讀的還是 PRE **之前**的快照 ⇒ 加成意外正確。
//   實測 v6.366（912e9bf5）：390（含 +60）；v6.406：330。
//   ⚠ v6.367 本身是對的（卡面寫「在造成傷害前…」的效果要生效），**不要去動它**；
//     要改的是「付出根本不該在 PRE 執行」。
//
// 【修法】PRE 只 `queueAttackEnergyPayment` 登記，engine 在「傷害造成後、龐克頭盔反擊與
//   KO 結算之前」`flushAttackEnergyPayment` 單點執行。
//
// 本守衛的章節：
//   【A】HEAD-FAIL 錨點（中央 helper 在 BASE 上不存在 ⇒ 用哨兵包起來逐條誠實翻紅）
//   【B】⭐ 主判準：伏特加成吃得到（對照組會讓「讀它 vs 不讀它」給出不同答案）
//   【C】⭐ 反向對照：甲殼刺必須**仍然撲空**（flush 放到受傷特性之後只有這一條會紅）
//   【D】log 時序：「造成 N 點傷害」必須早於「將 M 張能量丟棄」
//   【E】範圍：全站 ATTACK_PRE **零支**在 PRE 移除自身能量（下限自檢 ≥ 1300 支）
//   【F】不付出的路徑沒被連累（選「否」⇒ 能量原封不動）
//   【G】突變測試
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.stub-v6407.js'); writeFileSync(S, 'export const base="";export const assets="";');
const E = join(ROOT, '.ent-v6407.ts'); const O = join(ROOT, '.ent-v6407.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(E, "export { applyAction } from './src/lib/game/engine';\n"
  + "export { ATTACK_PRE, queueAttackEnergyPayment, flushAttackEnergyPayment, OPTIN_NO_PAYMENT } from './src/lib/game/effects';\n"
  + "import './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const M = await import(pathToFileURL(O).href);
// ⚠⚠ IRON_RULES Rule 41：HEAD-FAIL 不可以整支 throw —— 中央 helper 在 BASE 樹上不存在，
//   直接呼叫會 TypeError ⇒ 第一條就爆、後面幾十條永遠跑不到。用哨兵包起來，讓**每一條各自翻紅**。
const MISSING = Symbol('missing');
const F = (n) => (typeof M?.[n] === 'function' ? M[n] : () => MISSING);
const applyAction = F('applyAction');
const ATTACK_PRE = M.ATTACK_PRE instanceof Map ? M.ATTACK_PRE : new Map();

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
const byName = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
    if (!c || c.id == null) continue;
    pool.set(String(c.id), c);
    if (['H', 'I', 'J'].includes(c.regulationMark || '') && c.supertype === 'Pokemon' && !byName.has(c.name)) byName.set(c.name, c);
  }
}
// ⚠ 一律用「卡名 → 最新 H/I/J 印刷」查 id，**不 pin 任何卡 id**（pin 死 id 的守衛換印刷就靜默失效）。
const idOf = (name) => { const c = byName.get(name); assert.ok(c, `找不到 H/I/J 印刷：${name}`); return String(c.id); };
const MEGA_LUXRAY = idOf('超級雷電獸ex');      // 狂暴噴射：200+，若希望丟光自身能量 +130
const TURTONATOR = idOf('爆焰龜獸');           // 特性「甲殼刺」：受傷時丟攻擊方 1 個能量
const VOLT = (() => { for (const c of pool.values()) if (c.name === '伏特【雷】能量' && ['H','I','J'].includes(c.regulationMark||'')) return String(c.id); })();
const BASIC_L = (() => { for (const c of pool.values()) if (c.name === '基本【雷】能量' && ['H','I','J'].includes(c.regulationMark||'')) return String(c.id); })();
const BASIC_F = (() => { for (const c of pool.values()) if (c.name === '基本【鬥】能量' && ['H','I','J'].includes(c.regulationMark||'')) return String(c.id); })();
assert.ok(VOLT && BASIC_L && BASIC_F, '找不到伏特【雷】能量／基本【雷】能量／基本【鬥】能量');
// 靶：HP 夠高、不吃【雷】弱點（免得被一擊 KO 讀不到傷害，也免得弱點 ×2 把差值放大）
const TANK = [...pool.values()].find((c) => c.supertype === 'Pokemon' && Number(c.hp) >= 340
  && (c.weakness?.type ?? c.weakness) !== 'Lightning' && ['H', 'I', 'J'].includes(c.regulationMark || ''));
assert.ok(TANK, '找不到夠硬的靶');

let nn = 0;
const inst = (cid, e = []) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: e });
const en = (cid) => ({ iid: 'e' + (++nn), cardId: String(cid), damage: 0, energyAttached: [] });
const mkState = (atk, defCardId) => ({
  phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 3,
  isFirstTurn: false, log: [], pendingSelection: null,
  players: [
    { name: 'P1', active: atk, bench: [inst(TANK.id)], hand: [], deck: [inst(TANK.id), inst(TANK.id)], discard: [], prizes: [] },
    { name: 'P2', active: inst(defCardId), bench: [inst(defCardId)], hand: [], deck: [inst(defCardId)], discard: [], prizes: [] },
  ],
});
/** 跑一次完整 ATTACK。optIn: undefined=不給 payload（AI 預設）／true=選「是」／false=選「否」。 */
function fire({ energyId, n = 3, attackIndex = 1, optIn, defCardId = TANK.id }) {
  const es = Array.from({ length: n }, () => en(energyId));
  const atk = inst(MEGA_LUXRAY, es);
  const action = { type: 'ATTACK', attackIndex };
  if (optIn === true) action.discardedEnergyIids = es.map((e) => e.iid);
  if (optIn === false) action.discardedEnergyIids = [];
  const out = applyAction(mkState(atk, defCardId), action, pool);
  if (out === MISSING) return { missing: true, texts: [], dmg: null };
  const s = out?.state ?? out;
  const texts = (s?.log || []).map((l) => (typeof l === 'string' ? l : l.message || ''));
  const m = texts.map((t) => /造成 (\d+) 點傷害/.exec(t)).filter(Boolean).pop();
  return {
    dmg: m ? Number(m[1]) : null,
    texts,
    state: s,
    atkEnergyLeft: s?.players?.[0]?.active?.energyAttached?.length ?? -1,
    atkDiscardEnergy: (s?.players?.[0]?.discard || []).filter((c) => pool.get(c.cardId)?.supertype === 'Energy').length,
    pend: s?.pendingSelection || null,
  };
}

let pass = 0, fail = 0;
const T = (n, f) => {
  try { f(); console.log('  OK  ', n); pass++; }
  // ⚠ 只捕捉 AssertionError：其他例外（打錯字、模組壞掉）必須直接炸掉，不可被守衛吞成一行 FAIL
  catch (e) { if (e instanceof assert.AssertionError) { console.log('  FAIL', n, '::', e.message); fail++; } else throw e; }
};

// ══════════════════════════════════════════════════════════════════════
console.log('\n【A】HEAD-FAIL 錨點');
await T('A1 ⭐ 中央 helper queueAttackEnergyPayment／flushAttackEnergyPayment 存在且是函式', () => {
  assert.strictEqual(typeof M.queueAttackEnergyPayment, 'function', 'effects.ts 沒有 export queueAttackEnergyPayment');
  assert.strictEqual(typeof M.flushAttackEnergyPayment, 'function', 'effects.ts 沒有 export flushAttackEnergyPayment');
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n【B】⭐⭐⭐ 主判準：伏特【雷】能量的加成吃得到（官方 Q&A）');
// ⚠⚠ Rule 39：對照組必須讓「讀它 vs 不讀它」給出**不同**答案。
//   基本【雷】那一組是 330（無加成），伏特那兩組 350／390 —— 任何「乾脆不丟」「把加成砍掉」
//   「快照重複加」的假修法都會讓其中至少一條翻紅。
const B_BASE = fire({ energyId: BASIC_L, n: 3, optIn: true });
await T('B1 三張基本【雷】⇒ 330（200+130，無加成）', () => {
  assert.strictEqual(B_BASE.dmg, 330, `基本【雷】組不是 330：${B_BASE.dmg}`);
});
await T('B2 ⭐ 一張伏特＋兩張基本 ⇒ 350（330＋20×1）', () => {
  const es = [en(VOLT), en(BASIC_L), en(BASIC_L)];
  const out = applyAction(mkState(inst(MEGA_LUXRAY, es), TANK.id),
    { type: 'ATTACK', attackIndex: 1, discardedEnergyIids: es.map((e) => e.iid) }, pool);
  if (out === MISSING) assert.fail('applyAction 缺席（BASE 樹）');
  const s = out?.state ?? out;
  const t = (s?.log || []).map((l) => (typeof l === 'string' ? l : l.message || ''));
  const m = t.map((x) => /造成 (\d+) 點傷害/.exec(x)).filter(Boolean).pop();
  assert.strictEqual(m ? Number(m[1]) : null, 350, '一張伏特應該 +20');
});
await T('B3 ⭐⭐⭐ 三張伏特【雷】⇒ 390（330＋20×3）—— 官方 Q&A 的那一題', () => {
  const r = fire({ energyId: VOLT, n: 3, optIn: true });
  assert.strictEqual(r.dmg, 390, `三張伏特應該 +60，實際 ${r.dmg}`);
  assert.ok(r.texts.some((t) => /伏特【雷】能量 3 張 × 20/.test(t)), 'log 沒有印出伏特加成');
});
await T('B4 ⭐⭐ 付出**真的有執行**：攻擊後身上 0 個能量、棄牌區多了 3 張', () => {
  const r = fire({ energyId: VOLT, n: 3, optIn: true });
  assert.strictEqual(r.atkEnergyLeft, 0, `攻擊方還剩 ${r.atkEnergyLeft} 個能量 ⇒ 付出沒執行（「乾脆不丟」的假修法）`);
  assert.strictEqual(r.atkDiscardEnergy, 3, `棄牌區的能量是 ${r.atkDiscardEnergy} 張，應該是 3`);
});
await T('B5 ⭐⭐ AI／headless 路徑（不給 payload）也一樣 ⇒ 390', () => {
  const r = fire({ energyId: VOLT, n: 3, optIn: undefined });
  assert.strictEqual(r.dmg, 390, `AI 路徑不是 390：${r.dmg}`);
});

// ⚠⚠ B6～B8 是 v6.407 獨立審查（Fable 5.1）抓到的三個**守衛盲區**補洞。
//   審查用突變證明：拿掉 engine 的第二次 flush、拿掉 flush 的備戰搜尋、
//   把 registerSelfDiscardMultiply 的「玩家有給 payload」分支退回舊碼，
//   原本的 15 條**全部照樣綠**。三條都是「出貨碼的關鍵行沒有任何行為端斷言」。
const MEGA_EELEKTROSS = idOf('超級麻麻鰻魚王ex');   // 災難衝擊：190＋opt-in 丟 2 個【雷】⇒ 走 ATTACK_POST
const THUNDURUS_EX    = idOf('猛雷鼓ex');           // 極降駕：丟「自己場上」的基本能量（含備戰）×70
const RAICHU          = idOf('雷丘');               // 強力伏特：150＋選 1 個【雷】丟棄（registerSelfDiscardMultiply）
/** 自訂盤面跑一次完整 ATTACK（B6～B8 用；`fire()` 綁死了超級雷電獸ex）。 */
function fireCustom({ atkCardId, attackIndex, activeEnergy = [], benchEnergy = [], pick = 'none' }) {
  const aes = activeEnergy.map((cid) => en(cid));
  const bes = benchEnergy.map((cid) => en(cid));
  const atk = inst(atkCardId, aes);
  const benchMon = inst(TANK.id, bes);
  const st = {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 3,
    isFirstTurn: false, log: [], pendingSelection: null,
    players: [
      { name: 'P1', active: atk, bench: [benchMon], hand: [], deck: [inst(TANK.id), inst(TANK.id)], discard: [], prizes: [] },
      { name: 'P2', active: inst(TANK.id), bench: [inst(TANK.id)], hand: [], deck: [inst(TANK.id)], discard: [], prizes: [] },
    ],
  };
  const action = { type: 'ATTACK', attackIndex };
  if (pick !== 'none') action.discardedEnergyIids = pick(aes, bes);
  const out = applyAction(st, action, pool);
  if (out === MISSING) return { missing: true, texts: [], dmg: null };
  const s2 = out?.state ?? out;
  const texts = (s2.log || []).map((l) => (typeof l === 'string' ? l : l.message || ''));
  const m = texts.map((t) => /造成 (\d+) 點傷害/.exec(t)).filter(Boolean).pop();
  return {
    state: s2,
    texts,
    dmg: m ? Number(m[1]) : null,
    activeE: s2.players[0].active?.energyAttached?.length ?? -1,
    benchE: (s2.players[0].bench || []).reduce((n, b) => n + (b.energyAttached?.length || 0), 0),
    discardE: (s2.players[0].discard || []).filter((c) => pool.get(c.cardId)?.supertype === 'Energy').length,
    leaked: Object.prototype.hasOwnProperty.call(s2, '_attackEnergyPayment'),
  };
}
await T('B6 ⭐⭐⭐ ATTACK_POST 路徑（超級麻麻鰻魚王ex｜災難衝擊）：傷害 190+60=250、能量真的丟、transient 不外洩', () => {
  // 卡面：「若希望，將2個這隻寶可夢身上附加的【雷】能量丟棄，將對手的戰鬥寶可夢【麻痺】。」
  // ⚠ 這一支的 opt-in 走的是 **ATTACK_POST**（resolveOptInPayment 在 regPost 裡），
  //   engine 的第一次 flush 早於 POST ⇒ 只有「postFn 之後的第二次 flush」才救得了它。
  //   身上 3 張伏特【雷】：傷害在丟之前算 ⇒ 190 + 20×3 = 250（不是丟完剩 1 張的 210）。
  const r = fireCustom({
    atkCardId: MEGA_EELEKTROSS, attackIndex: 1,
    activeEnergy: [VOLT, VOLT, VOLT],
    pick: (aes) => aes.slice(0, 2).map((e) => e.iid),
  });
  assert.strictEqual(r.dmg, 250, `災難衝擊應該是 190+20×3=250，實際 ${r.dmg}`);
  assert.strictEqual(r.activeE, 1, `丟了 2 個之後身上應該剩 1 個，實際 ${r.activeE} ⇒ 第二次 flush 沒有執行`);
  assert.strictEqual(r.discardE, 2, `棄牌區應該有 2 張能量，實際 ${r.discardE}`);
  assert.ok(!r.leaked, '⚠⚠ _attackEnergyPayment 洩漏到回傳 state ⇒ 會被 JSON 同步寫進房間／錦標賽資料庫');
});
await T('B7 ⭐⭐⭐ flush 必須連**備戰**身上的能量一起找（猛雷鼓ex｜極降駕：卡面是「自己的場上寶可夢」）', () => {
  // 卡面：「將自己的場上寶可夢身上附加的任意數量的基本能量卡丟棄，造成其張數×70點傷害。」
  // 戰鬥場 2 張（1 雷 1 鬥，付費用）＋ 備戰 2 張；選 3 張（戰鬥場的雷 ＋ 備戰兩張）⇒ 3×70=210。
  const r = fireCustom({
    atkCardId: THUNDURUS_EX, attackIndex: 1,
    activeEnergy: [BASIC_L, BASIC_F], benchEnergy: [BASIC_L, BASIC_L],
    pick: (aes, bes) => [aes[0].iid, ...bes.map((e) => e.iid)],
  });
  assert.strictEqual(r.dmg, 210, `極降駕選 3 張應該是 3×70=210，實際 ${r.dmg}`);
  assert.strictEqual(r.benchE, 0, `備戰的能量沒有被丟（還剩 ${r.benchE}）⇒ flush 的備戰搜尋被拿掉了`);
  assert.strictEqual(r.discardE, 3, `棄牌區應該有 3 張能量，實際 ${r.discardE}`);
  assert.strictEqual(r.activeE, 1, `戰鬥場應該只剩 1 張（【鬥】），實際 ${r.activeE}`);
});
await T('B8 ⭐⭐⭐ registerSelfDiscardMultiply 的「玩家有給 payload」分支（雷丘｜強力伏特）：150+60=210', () => {
  // 卡面：「選擇1個這隻寶可夢身上附加的【雷】能量，將其丟棄。」傷害固定 150。
  // 身上 3 張伏特【雷】⇒ 傷害在丟之前算 ⇒ 150 + 20×3 = 210（BASE 是丟完才算 ⇒ 190）。
  // ⚠ 這條專門守「有 payload」那一支 —— B1～B5 走的是 resolveOptInPayment，
  //   E1 掃描器又不帶 payload ⇒ 這個分支原本完全沒有人守。
  const r = fireCustom({
    atkCardId: RAICHU, attackIndex: 1,
    activeEnergy: [VOLT, VOLT, VOLT],
    pick: (aes) => [aes[0].iid],
  });
  assert.strictEqual(r.dmg, 210, `強力伏特應該是 150+20×3=210，實際 ${r.dmg}`);
  assert.strictEqual(r.activeE, 2, `丟 1 個之後應該剩 2 個，實際 ${r.activeE}`);
  assert.strictEqual(r.discardE, 1, `棄牌區應該有 1 張能量，實際 ${r.discardE}`);
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n【C】⭐⭐⭐ 反向對照：甲殼刺必須仍然撲空（②→③ 的順序）');
const C_SELF = fire({ energyId: BASIC_L, n: 3, attackIndex: 1, optIn: true, defCardId: TURTONATOR });
const C_NONE = fire({ energyId: BASIC_L, n: 3, attackIndex: 0, optIn: undefined, defCardId: TURTONATOR });
await T('C1 ⭐ 正對照：**不**自丟能量的招式打爆焰龜獸 ⇒ 甲殼刺必須有動靜（否則 C2 是空真）', () => {
  const fired = !!(C_NONE.pend && /spike-shell|甲殼刺/.test(JSON.stringify(C_NONE.pend)))
    || C_NONE.texts.some((t) => /甲殼刺/.test(t));
  assert.ok(fired, '閃光射線打爆焰龜獸，甲殼刺完全沒動靜 ⇒ 這組對照本身壞了，C2 不算數');
});
await T('C2 ⭐⭐⭐ 自丟全部能量之後，甲殼刺**撲空**（§17.46.A 螺旋關節／§17.46.D 夾尾巴逃跑）', () => {
  const opened = !!(C_SELF.pend && /spike-shell|甲殼刺/.test(JSON.stringify(C_SELF.pend)));
  assert.ok(!opened, '甲殼刺竟然開了 picker ⇒ 付出被延後到「受傷時特性」之後了（flush 位置錯）');
  assert.strictEqual(C_SELF.atkEnergyLeft, 0, `攻擊方還剩 ${C_SELF.atkEnergyLeft} 個能量 ⇒ 付出沒有執行`);
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n【D】log 時序（順序本身就是證據）');
await T('D1 ⭐⭐⭐ 「造成 N 點傷害」必須早於「將 M 張能量丟棄」', () => {
  const r = fire({ energyId: VOLT, n: 3, optIn: true });
  const iDmg = r.texts.findIndex((t) => /造成 \d+ 點傷害/.test(t));
  const iPay = r.texts.findIndex((t) => /狂暴噴射：將 \d+ 張能量丟棄/.test(t));
  assert.ok(iDmg >= 0, 'log 裡找不到「造成 N 點傷害」');
  assert.ok(iPay >= 0, 'log 裡找不到「將 M 張能量丟棄」⇒ 付出沒被執行');
  assert.ok(iDmg < iPay, `順序反了：傷害在第 ${iDmg} 行、丟棄在第 ${iPay} 行`);
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n【E】範圍：全站零支在 PRE 移除自身能量');
await T('E1 ⭐⭐⭐ 逐支呼叫 ATTACK_PRE，攻擊方身上的能量數**不得減少**（下限自檢 ≥ 1300 支）', () => {
  assert.ok(ATTACK_PRE.size >= 1300, `ATTACK_PRE 只有 ${ATTACK_PRE.size} 支 ⇒ 掃描器壞了（空真）`);
  const bad = [];
  let scanned = 0;
  let scannedRuns = 0;
  for (const [key, fn] of ATTACK_PRE) {
    const i = key.indexOf('|'); if (i < 0) continue;
    const card = byName.get(key.slice(0, i)); if (!card) continue;
    const ai = (card.attacks || []).findIndex((a) => a.name === key.slice(i + 1)); if (ai < 0) continue;
    scanned++;
    // ⚠⚠ 一定要跑**兩趟**：不給 payload（AI／headless）與給滿 payload（玩家真的勾了能量）。
    //   v6.407 的獨立審查就是靠第二趟才抓到「厄鬼椪 水井面具ex｜激流水泵」——
    //   它只有在玩家把 3 個能量勾起來時才會走到「當場搬進牌庫」那一段，
    //   只跑第一趟的掃描器對它**永遠是綠的**（安慰劑型態 4 的變體：餵的輸入讓兩條路徑同值）。
    for (const withPayload of [false, true]) {
      const es = [en(VOLT), en(BASIC_L), en(BASIC_L), en(BASIC_L)];
      const st = mkState(inst(card.id, es), TANK.id);
      const before = st.players[0].active.energyAttached.length;
      const action = { type: 'ATTACK', attackIndex: ai };
      if (withPayload) action.discardedEnergyIids = es.map((e) => e.iid);
      let out;
      try { out = fn(st, 0, pool, action); } catch { continue; }
      const after = out?.state?.players?.[0]?.active?.energyAttached?.length ?? before;
      if (after < before) bad.push(`${key}（${before}→${after}${withPayload ? '，帶 payload' : ''}）`);
      scannedRuns++;
    }
  }
  // ⚠ 兩趟都要真的跑到（否則「payload 那一趟」可能被某個 early-continue 整批跳過 ⇒ 又是空真）
  assert.ok(scannedRuns >= scanned * 2, `掃描趟數 ${scannedRuns} < ${scanned}×2 ⇒ payload 那一趟被跳過了`);
  // ⚠ 下限自檢（避免空真）：實測 898 支。取 850 當保守下限 —— 卡池會成長，
  //   寫死 898 反而會在下一個卡包誤紅（安慰劑型態 9：pin 死數字）。
  assert.ok(scanned >= 850, `只掃到 ${scanned} 支 H/I/J 招式 ⇒ 掃描器壞了`);
  assert.deepStrictEqual(bad, [], `這些招式在 PRE 就把自身能量移除了（付出必須延後到傷害之後）：\n    ${bad.join('\n    ')}`);
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n【F】不付出的路徑沒被連累');
await T('F1 ⭐⭐ 選「否」⇒ 260（200＋伏特 3×20），而且能量**一個都沒少**', () => {
  const r = fire({ energyId: VOLT, n: 3, optIn: false });
  assert.strictEqual(r.dmg, 260, `選「否」不是 260：${r.dmg}`);
  assert.strictEqual(r.atkEnergyLeft, 3, `選「否」卻少了能量：剩 ${r.atkEnergyLeft}`);
  assert.strictEqual(r.atkDiscardEnergy, 0, '選「否」卻有能量進棄牌區');
});
await T('F2 ⭐ 身上 0 能量時 opt-in 仍 +130（v5.992 站長裁定，不可回退）', () => {
  // ⚠⚠ 這一條**不能**走完整 applyAction：狂暴噴射要 3 個【雷】能量，
  //   身上 0 能量根本付不出招式費用、出不了招 ⇒ 量到的會是「沒出招」而不是「+130」。
  //   直呼 regPre 繞過費用檢查（與 test-optin-pay-what-you-can 同一種做法）。
  const fn = ATTACK_PRE.get('超級雷電獸ex|狂暴噴射');
  assert.strictEqual(typeof fn, 'function', '找不到狂暴噴射的 regPre');
  const SENTINEL = typeof M.OPTIN_NO_PAYMENT === 'string' ? M.OPTIN_NO_PAYMENT : '__optin_no_payment__';
  const r = fn(mkState(inst(MEGA_LUXRAY, []), TANK.id), 0, pool, { type: 'ATTACK', attackIndex: 1, discardedEnergyIids: [SENTINEL] });
  assert.strictEqual(r.damage, 330, `0 能量 opt-in 應該仍然 200+130=330，實際 ${r.damage}`);
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n【G】突變測試（沒紅 ＝ 守衛是安慰劑）');
await T('G1 ⭐⭐ flush 不執行（模擬：登記完就把欄位丟掉）⇒ B4 的「付出真的有執行」必紅', () => {
  const q = M.queueAttackEnergyPayment;
  const fl = M.flushAttackEnergyPayment;
  assert.ok(typeof q === 'function' && typeof fl === 'function', '中央 helper 缺席');
  // 直呼中央 helper 做等價突變：登記之後不 flush ⇒ 能量還在身上
  const es = [en(BASIC_L), en(BASIC_L)];
  const st = mkState(inst(MEGA_LUXRAY, es), TANK.id);
  const queued = q(st, 0, st.players[0].active.energyAttached, 'discard', '突變');
  assert.strictEqual(queued.players[0].active.energyAttached.length, 2,
    '⚠⚠ queueAttackEnergyPayment 竟然當場就把能量移除了 ⇒ 它不是「登記」，整條時序修正失效');
  const flushed = fl(queued, pool);
  assert.strictEqual(flushed.players[0].active.energyAttached.length, 0, 'flush 之後能量應該歸零');
  assert.strictEqual((flushed.players[0].discard || []).length, 2, 'flush 之後應該有 2 張進棄牌區');
  assert.ok(!flushed._attackEnergyPayment, 'flush 之後 transient 欄位必須清掉（不可以跟著房間同步出去）');
});
await T('G2 ⭐⭐ flush 對「沒有登記」的 state 是 no-op（不可以誤傷其他招式）', () => {
  const fl = M.flushAttackEnergyPayment;
  // ⚠ Rule 41：BASE 樹上這個中央 helper 不存在 ⇒ 必須用哨兵讓「這一條」誠實翻紅，
  //   不可以讓 TypeError 把整支守衛炸掉（那樣只證明了第一條）。
  assert.ok(typeof fl === 'function', '中央 helper flushAttackEnergyPayment 缺席');
  const st = mkState(inst(MEGA_LUXRAY, [en(BASIC_L)]), TANK.id);
  const out = fl(st, pool);
  assert.strictEqual(out.players[0].active.energyAttached.length, 1, 'no-op 竟然動到了能量');
  assert.strictEqual((out.players[0].discard || []).length, 0, 'no-op 竟然往棄牌區塞東西');
});
await T('G3 ⭐⭐ 要付的能量已經不在身上 ⇒ flush 安靜跳過，不丟例外、不亂動別的能量', () => {
  const fl = M.flushAttackEnergyPayment;
  const q = M.queueAttackEnergyPayment;
  // ⚠ Rule 41：同上，缺席時誠實翻紅而不是整支 throw。
  assert.ok(typeof fl === 'function' && typeof q === 'function', '中央 helper 缺席');
  const ghost = en(BASIC_L);
  const real = en(BASIC_L);
  const st = mkState(inst(MEGA_LUXRAY, [real]), TANK.id);
  const queued = q(st, 0, [ghost], 'discard', '幽靈');
  const out = fl(queued, pool);
  assert.strictEqual(out.players[0].active.energyAttached.length, 1, '找不到的 iid 不該影響身上的其他能量');
  assert.strictEqual((out.players[0].discard || []).length, 0, '找不到的 iid 不該有東西進棄牌區');
});

console.log(`\n=== v6.407 自身能量付出的時序：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
