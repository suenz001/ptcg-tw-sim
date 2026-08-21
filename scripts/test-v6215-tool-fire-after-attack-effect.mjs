// ═══════════════════════════════════════════════════════════════════════════
// v6.215 官方處理順序：**招式效果先於「受到傷害時」道具效果**
//
// 官方逐字（PTCG RULES/PTCG_RULES.md）：
//   §17.22.A L1530-1531
//     Q:「幸運頭盔」抽卡 與 招式「脅迫獠牙」丟手牌，何者先執行？
//     A: 先因招式「脅迫獠牙」的效果將自己的手牌丟棄。／
//        之後，因寶可夢道具卡「幸運頭盔」的效果從牌庫抽卡。
//   §18.D L2916 另證：「會在招式造成傷害後才執行寶可夢道具卡『幸運頭盔』的效果處理」。
//   §17.2.A L606-607（學習裝置，KO 情境）：「先丟棄能量」
//   §17.2.A L604-605（特性反擊針）：「先執行…恢復30點HP」
//   §16.1 L549：「先處理發動方的招式效果，再處理使用招式者的昏厥」
//
// 本測試釘住：
//   批1  幸運頭盔 / 逆境保險 延後到 ATTACK_POST 之後（KO + 非 KO 兩個分支）
//   批1  正對照：沒有這些道具時行為完全不變
//   批2  手持循環扇 延後 + 「使用招式的寶可夢」改用攻擊當下 iid 快照
//   守衛 名單只收不牽動昏厥時序的道具（反傷型必須留在原順序）
// ═══════════════════════════════════════════════════════════════════════════
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.v6215-s.js'), E = join(ROOT, '.v6215-e.ts'), O = join(ROOT, '.v6215-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E,
  "export { applyAction } from './src/lib/game/engine';\n"
  + "export { TOOL_FIRE_AFTER_ATTACK_EFFECT, TOOL_ON_DAMAGED, TOOL_ON_KO } from './src/lib/game/effects/cards/tools';\n"
  + "import './src/lib/game/effects';");
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

// ⚠ 全檔一律 null-safe（`?.`）：破壞測試把 code 還原成未修版時，pending 鏈會走完全不同的路徑，
//   測試必須「紅」而不是 crash —— crash 會看不到後面的段落，也印不出結束標記。
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('  ✗ ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m}｜實際=${JSON.stringify(a)} 期望=${JSON.stringify(b)}`);

// ── 卡片 id（全部 live H/I/J）─────────────────────────────────────────────
const C = {
  helmet: '10307',   // 幸運頭盔（H）rulesText:「附有這張卡的寶可夢在戰鬥場受到對手的寶可夢招式的傷害時，從自己的牌庫抽出2張卡。」
  insur:  '14466',   // 逆境保險（I）「若附有這張卡的寶可夢的弱點屬性與對手戰鬥寶可夢的屬性相同，則…受到…傷害時，從自己的牌庫抽出3張卡。」
  fan:    '10509',   // 手持循環扇（H）「…受到對手的寶可夢招式的傷害時，選擇1個使用招式的寶可夢身上附加的能量，改附於對手的備戰寶可夢身上。」
  bumpy:  '12211',   // 凸凸頭盔（未列入延後名單 → 正對照）
  hydre:  '11252',   // 三首惡龍ex（H, 330HP）0:粉碎頭 200「將對手的牌庫上方3張卡丟棄。」
  koupa:  '13410',   // 酷豹（I, 110HP, 弱點【草】）0:拍落 50「在不看正面的情況下，從對手的手牌選擇1張，將其丟棄。」
  mewtwo: '14723',   // 火箭隊的超夢ex（280HP, 弱點【惡】×2）
  aoen:   '12284',   // 蒼炎刃鬼ex（H）1:紫水晶激怒 280「將這隻寶可夢身上附加的能量卡全部丟棄。」
  kuwa:   '10930',   // 鍬農炮蟲（H）0:伏特替換 90「將這隻寶可夢與備戰區的【雷】寶可夢互換。」
};
for (const [k, v] of Object.entries(C)) ok(pool.has(v), `fixture 卡 ${k}=${v} 必須在 live 卡池`);
const eName = (n) => { for (const [id, c] of pool) if (c.name === n && c.supertype === 'Energy') return id; return null; };
const DARK = eName('基本【惡】能量'), LIGHT = eName('基本【雷】能量'),
      FIRE = eName('基本【火】能量'), PSY = eName('基本【超】能量'), METAL = eName('基本【鋼】能量');
ok(DARK && LIGHT && FIRE && PSY && METAL, 'fixture 基本能量齊全');

const en = (cid, iid) => ({ iid, cardId: cid, damage: 0, energyAttached: [] });
const mon = (cid, iid, o = {}) => ({ iid, cardId: cid, damage: 0, energyAttached: [], ...o });
const P = (name, o = {}) => ({ name, active: null, bench: [], hand: [], deck: [], discard: [], prizes: [], ...o });
const ST = (p0, p1, o = {}) => ({
  phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0,
  turn: 5, isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
  players: [p0, p1], ...o });
const ids = (arr) => (arr ?? []).map(c => c.iid).join(',');
const DECK5 = () => ['A', 'B', 'C', 'D', 'E'].map(n => en(DARK, 'dk' + n));
const DARK5 = () => [1, 2, 3, 4, 5].map(i => en(DARK, 'ae' + i));

// 打完之後把所有 pending 解掉。預設「挑第一個候選」——這點很重要：
// ⚠ 若對 picker 一律送 []，HEAD 上「拍落」的丟牌 picker 會被跳過，C 段就變成恆真式假綠。
function drain(st, cb, max = 8) {
  let g = 0;
  const opened = [];
  while (st.pendingSelection && g++ < max) {
    const ps = st.pendingSelection;
    opened.push(ps.effectKey);
    let pick = cb ? cb(ps, st) : undefined;
    if (pick === undefined) {
      const cand = ps.params?.validIids ?? (ps.params?.options ?? []).map(o => o.id);
      pick = cand.slice(0, Math.max(1, ps.minCount ?? 1));
    }
    st = mod.applyAction(st, { type: 'RESOLVE_SELECTION', selectedIids: pick, token: ps.token }, pool);
  }
  st = { ...st, _openedPendings: opened };
  return st;
}

console.log('── A) 批1 幸運頭盔 × 磨庫招式（非 KO 分支）─────────────────────────');
{
  // 三首惡龍ex 粉碎頭 200 打 三首惡龍ex(330HP)＋幸運頭盔：不會 KO。
  // 官方序：先「將對手的牌庫上方3張卡丟棄」(A,B,C) → 再「抽出2張卡」(D,E)。
  let st = ST(P('P0', { active: mon(C.hydre, 'atk', { energyAttached: DARK5() }), bench: [mon(C.hydre, 'ab1')] }),
              P('P1', { active: mon(C.hydre, 'def', { toolAttached: { iid: 'tool1', cardId: C.helmet } }),
                        bench: [mon(C.hydre, 'db1')], deck: DECK5() }));
  st = mod.applyAction(st, { type: 'ATTACK', attackIndex: 0, actorIdx: 0 }, pool);
  eq(ids(st.players[1].discard), 'dkA,dkB,dkC', 'A1 磨庫先丟牌庫頂 3 張（A,B,C）');
  eq(ids(st.players[1].hand), 'dkD,dkE', 'A2 幸運頭盔後抽，抽到 D,E（舊行為會抽到 A,B）');
  eq(st.players[1].deck.length, 0, 'A3 牌庫清空');
  const li = st.log.map(l => l.message);
  const iMill = li.findIndex(m => m.includes('粉碎頭：對手牌庫頂'));
  const iDraw = li.findIndex(m => m.includes('幸運頭盔：抽 2 張'));
  ok(iMill >= 0 && iDraw >= 0 && iMill < iDraw, `A4 log 順序：招式效果先於幸運頭盔（mill=${iMill} draw=${iDraw}）`);
}

console.log('── B) 批1 幸運頭盔 × 磨庫招式（KO 分支）───────────────────────────');
{
  // 同一招打 酷豹(110HP)：200 傷害 → KO。KO 分支走 TOOL_ON_KO，也必須延後。
  let st = ST(P('P0', { active: mon(C.hydre, 'atk', { energyAttached: DARK5() }), bench: [mon(C.hydre, 'ab1')] }),
              P('P1', { active: mon(C.koupa, 'def', { toolAttached: { iid: 'tool1', cardId: C.helmet } }),
                        bench: [mon(C.hydre, 'db1')], deck: DECK5() }));
  st = mod.applyAction(st, { type: 'ATTACK', attackIndex: 0, actorIdx: 0 }, pool);
  ok(st.log.some(l => l.message.includes('被擊倒')), 'B0 確實走 KO 分支');
  eq(ids(st.players[1].hand), 'dkD,dkE', 'B1 KO 分支也是「先磨庫、後抽牌」');
  ok(ids(st.players[1].discard).endsWith('dkA,dkB,dkC'), `B2 KO 分支棄牌尾端為 A,B,C｜實際=${ids(st.players[1].discard)}`);
  const li = st.log.map(l => l.message);
  ok(li.findIndex(m => m.includes('粉碎頭：對手牌庫頂')) < li.findIndex(m => m.includes('幸運頭盔：抽 2 張')),
     'B3 KO 分支 log 順序：招式效果先於幸運頭盔');
}

console.log('── C) 批1 逆境保險 × 丟手牌招式（非 KO）───────────────────────────');
{
  // 酷豹(【惡】) 拍落 50 打 火箭隊的超夢ex(280HP, 弱點【惡】×2 → 100 傷害, 非 KO)＋逆境保險。
  // 卡面「在不看正面的情況下，從對手的手牌選擇1張，將其丟棄」——防守方手牌本來是 0 張。
  // 官方序：招式先執行（手牌空，丟不到東西）→ 逆境保險才抽 3 張 ⇒ 手牌 3 張。
  // 舊行為：先抽 3 張 → 招式再從那 3 張裡丟 1 張 ⇒ 手牌 2 張。
  let st = ST(P('P0', { active: mon(C.koupa, 'atk', { energyAttached: DARK5() }), bench: [mon(C.hydre, 'ab1')] }),
              P('P1', { active: mon(C.mewtwo, 'def', { toolAttached: { iid: 'tool1', cardId: C.insur } }),
                        bench: [mon(C.hydre, 'db1')], hand: [], deck: DECK5() }));
  st = mod.applyAction(st, { type: 'ATTACK', attackIndex: 0, actorIdx: 0 }, pool);
  // ⭐ 官方序下，招式先跑時對手手牌是空的 ⇒ 根本不會開「選對手手牌丟棄」的 picker。
  //   HEAD 會先抽 3 張再開 picker（3 個候選）⇒ 這條就會紅。
  eq(st.pendingSelection?.effectKey ?? null, null, 'C1b 不會開丟對手手牌的 picker（招式跑時手牌是空的）');
  st = drain(st, null);   // ⚠ 預設挑第一個候選：HEAD 上會真的丟掉 1 張，C2/C3 才有鑑別力
  ok(st.players[1].active && st.players[1].active.damage === 100, `C0 弱點×2 → 100 傷害、未 KO（實際 ${st.players[1].active?.damage}）`);
  ok(st.log.some(l => l.message.includes('逆境保險')), 'C1 逆境保險有觸發');
  eq(ids(st.players[1].hand), 'dkA,dkB,dkC', 'C2 手牌 = 抽到的 3 張（招式先跑時手牌是空的，丟不到東西）');
  eq(st.players[1].discard.length, 0, 'C3 沒有任何手牌被丟棄');
}

console.log('── D) 批1 正對照：沒有這兩張道具時，行為完全不變 ──────────────────');
{
  // 與 A 完全相同的盤面，只是防守方**不帶道具**。
  // 期望值與 v6.214（HEAD）逐欄相同 —— 這條若變紅代表延後改動污染了無道具路徑。
  let st = ST(P('P0', { active: mon(C.hydre, 'atk', { energyAttached: DARK5() }), bench: [mon(C.hydre, 'ab1')] }),
              P('P1', { active: mon(C.hydre, 'def'), bench: [mon(C.hydre, 'db1')], deck: DECK5() }));
  st = mod.applyAction(st, { type: 'ATTACK', attackIndex: 0, actorIdx: 0 }, pool);
  eq(ids(st.players[1].discard), 'dkA,dkB,dkC', 'D1 無道具：磨庫照丟 A,B,C');
  eq(ids(st.players[1].hand), '', 'D2 無道具：不抽牌');
  eq(ids(st.players[1].deck), 'dkD,dkE', 'D3 無道具：牌庫剩 D,E');
  eq(st.players[1].active?.damage, 200, 'D4 無道具：傷害 200');
  eq(st.pendingSelection ?? null, null, 'D5 無道具：不開任何 picker');
  // 凸凸頭盔（**不在**延後名單）：必須維持「道具先、招式效果後」的舊順序。
  let s2 = ST(P('P0', { active: mon(C.hydre, 'atk', { energyAttached: DARK5() }), bench: [mon(C.hydre, 'ab1')] }),
              P('P1', { active: mon(C.hydre, 'def', { toolAttached: { iid: 't2', cardId: C.bumpy } }),
                        bench: [mon(C.hydre, 'db1')], deck: DECK5() }));
  s2 = mod.applyAction(s2, { type: 'ATTACK', attackIndex: 0, actorIdx: 0 }, pool);
  const l2 = s2.log.map(l => l.message);
  const iB = l2.findIndex(m => m.includes('凸凸頭盔'));
  const iM = l2.findIndex(m => m.includes('粉碎頭：對手牌庫頂'));
  ok(iB >= 0 && iM >= 0 && iB < iM, `D6 正對照：凸凸頭盔（反傷型）仍在招式效果**之前**（bumpy=${iB} mill=${iM}）`);
  eq(s2.players[0].active?.damage, 20, 'D7 凸凸頭盔反傷 20 照常');
}

console.log('── E) 批2 手持循環扇 × 自丟能量招式（紫水晶激怒）──────────────────');
{
  // 蒼炎刃鬼ex｜紫水晶激怒 280「將這隻寶可夢身上附加的能量卡全部丟棄。」
  // 官方序：招式先把 3 顆能量全丟 → 手持循環扇沒有能量可搬 ⇒ 完全不發動。
  // 舊行為：扇子先開 picker（搬走 1 顆到攻擊方備戰）＝幫攻擊方保住 1 顆本該被丟棄的能量。
  let st = ST(P('P0', { active: mon(C.aoen, 'atk', { energyAttached: [en(FIRE, 'af1'), en(PSY, 'af2'), en(METAL, 'af3')] }),
                        bench: [mon(C.hydre, 'ab1')] }),
              P('P1', { active: mon(C.hydre, 'def', { toolAttached: { iid: 'tool1', cardId: C.fan } }),
                        bench: [mon(C.hydre, 'db1')], deck: [en(DARK, 'dk1')] }));
  st = mod.applyAction(st, { type: 'ATTACK', attackIndex: 1, actorIdx: 0 }, pool);
  eq(st.pendingSelection?.effectKey ?? null, null, 'E1 沒有能量可搬 → 不開手持循環扇 picker');
  ok(!st.log.some(l => l.message.includes('手持循環扇')), 'E2 也不印手持循環扇的 log（不留假 log）');
  eq(ids(st.players[0].active?.energyAttached), '', 'E3 攻擊方戰鬥位能量全數丟棄');
  eq(ids(st.players[0].bench[0]?.energyAttached), '', 'E4 沒有能量被偷渡到攻擊方備戰');
  eq(ids(st.players[0].discard), 'af1,af2,af3', 'E5 三顆能量都在棄牌區');
}

console.log('── F) 批2 手持循環扇 × 自我互換招式（伏特替換）— iid 快照 ─────────');
{
  // 鍬農炮蟲｜伏特替換 90「將這隻寶可夢與備戰區的【雷】寶可夢互換。」
  // selfSwapPost 在 ATTACK_POST 開 do-switch picker ⇒ 延後後扇子排在它**後面**，
  // 玩家先解完互換，此刻 players[0].active 已經不是使用招式的寶可夢。
  // ⇒ 扇子必須用「攻擊當下的 iid 快照」定位 atk（現在在備戰區），不可讀 active。
  let st = ST(P('P0', { active: mon(C.kuwa, 'atk', { energyAttached: [en(LIGHT, 'al1'), en(LIGHT, 'al2')] }),
                        bench: [mon(C.kuwa, 'ab1', { energyAttached: [en(LIGHT, 'bl1')] }), mon(C.kuwa, 'ab2')] }),
              P('P1', { active: mon(C.hydre, 'def', { toolAttached: { iid: 'tool1', cardId: C.fan } }),
                        bench: [mon(C.hydre, 'db1')], deck: [en(DARK, 'dk1')] }));
  st = mod.applyAction(st, { type: 'ATTACK', attackIndex: 0, actorIdx: 0 }, pool);
  eq(st.pendingSelection?.effectKey, 'do-switch', 'F1 招式效果的 picker 先解（官方序）');
  eq((st.pendingChainQueue ?? []).map(q => q.effectKey).join('|'), 'cycle-fan-step1-pick-energy',
     'F2 手持循環扇排在隊尾');
  // ⚠ 以下每一步都必須 null-safe：HEAD（未修版）走的是完全不同的 pending 順序，
  //   測試要能「紅」但不能 crash，否則看不到後面的段落與結束標記。
  const step = (sel) => { const t = st.pendingSelection?.token; st = mod.applyAction(st, { type: 'RESOLVE_SELECTION', selectedIids: sel, token: t }, pool); };
  step(['ab1']);
  eq(st.players[0].active?.iid, 'ab1', 'F3 互換已完成：active 換成 ab1');
  eq(st.pendingSelection?.effectKey ?? null, 'cycle-fan-step1-pick-energy', 'F4 接著才輪到手持循環扇');
  // ⭐ 核心斷言：options 必須是「使用招式的寶可夢」atk 的能量（al1/al2），
  //    絕不能是新 active ab1 的 bl1 —— 沒有 iid 快照時這裡就會抓到 bl1。
  const _fanOpts = (st.pendingSelection?.params?.options ?? []).map(o => o.id).join(',');
  eq(_fanOpts, 'al1,al2', 'F5 扇子的候選能量 = 使用招式的寶可夢(atk)身上的（options 在觸發當下就算好）');
  // ⭐⭐ F5b 才是「快照」的真正把關：options 是在互換**之前**算的，所以就算 resolver 讀錯人，
  //   F5 也照樣綠（v6.215 開發時實測過這個 placebo）。真正會出事的是 **resolver 端**，
  //   因此必須直接斷言 pending 有把攻擊當下的 iid 帶下去。
  eq(st.pendingSelection?.params?.attackerIid ?? null, 'atk',
     'F5b ⭐ pending 必須帶「使用招式的寶可夢」攻擊當下的 iid 快照（resolver 靠它定位）');
  step(['al1']);
  eq(st.pendingSelection?.effectKey ?? null, 'cycle-fan-step2-place-energy', 'F6 進到 step2 選備戰');
  // v6.215：step2 必須宣告 validIids（＝攻擊方備戰，與 fieldPickerBaseIids / UI 同源），
  //   不能只靠 v6.176 的兜底裸奔。
  eq((st.pendingSelection?.params?.validIids ?? []).join(','), 'atk,ab2',
     'F6b step2 必須宣告 validIids ＝ 攻擊方當下的備戰');
  step(['ab2']);
  eq((st.players[0].active?.iid ?? '-') + ':' + ids(st.players[0].active?.energyAttached), 'ab1:bl1',
     'F7 新 active(ab1) 的能量沒有被動到');
  const bench = st.players[0].bench.map(b => b.iid + ':' + ids(b.energyAttached)).join('  ');
  eq(bench, 'atk:al2  ab2:al1', 'F8 al1 從 atk（已在備戰）搬到 ab2，atk 保留 al2');
  const allE = [st.players[0].active, ...st.players[0].bench].filter(Boolean).flatMap(c => c.energyAttached.map(x => x.iid)).sort().join(',');
  eq(allE, 'al1,al2,bl1', 'F9 能量守恆：3 顆都還在場上（不會憑空消失）');
  // ⭐ F10：refresher 的「內容沒變就回傳原物件」分支。do-switch 不動攻擊方的能量
  //   ⇒ 重算結果與排隊當下相同 ⇒ **不可以換 token**（換了會讓玩家手上的答案無故失效）。
  {
    let s10 = ST(P('P0', { active: mon(C.kuwa, 'atk', { energyAttached: [en(LIGHT, 'al1'), en(LIGHT, 'al2')] }),
                           bench: [mon(C.kuwa, 'ab1', { energyAttached: [en(LIGHT, 'bl1')] }), mon(C.kuwa, 'ab2')] }),
                 P('P1', { active: mon(C.hydre, 'def', { toolAttached: { iid: 'tool1', cardId: C.fan } }),
                           bench: [mon(C.hydre, 'db1')], deck: [en(DARK, 'dk1')] }));
    s10 = mod.applyAction(s10, { type: 'ATTACK', attackIndex: 0, actorIdx: 0 }, pool);
    const queued = (s10.pendingChainQueue ?? [])[0];
    ok(typeof queued?.token === 'number', 'F10a 排隊中的扇子 pending 已蓋章');
    s10 = mod.applyAction(s10, { type: 'RESOLVE_SELECTION', selectedIids: ['ab1'], token: s10.pendingSelection?.token }, pool);
    const popped = s10.pendingSelection;
    eq(popped?.effectKey ?? null, 'cycle-fan-step1-pick-energy', 'F10b 扇子浮上來了');
    // ⭐ refresher 只准動 params 裡的候選欄位；「這是哪一個 picker」的身分欄位必須逐欄不變。
    eq([popped?.type, popped?.actorIdx, popped?.sourcePlayerIdx, popped?.minCount, popped?.maxCount,
        popped?.params?.attackerIid, popped?.params?.label].join('|'),
       [queued?.type, queued?.actorIdx, queued?.sourcePlayerIdx, queued?.minCount, queued?.maxCount,
        queued?.params?.attackerIid, queued?.params?.label].join('|'),
       'F10c ⭐ 重算後身分欄位（type/actorIdx/sourcePlayerIdx/min-max/attackerIid/label）逐欄不變');
    eq((popped?.params?.options ?? []).map(o => o.id).join(','), 'al1,al2',
       'F10d 候選沒被招式動到時，重算結果仍是攻擊方那兩顆');
  }
}

console.log('── G) 批2 手持循環扇：攻擊方無備戰 → 不發動 ───────────────────────');
{
  let st = ST(P('P0', { active: mon(C.hydre, 'atk', { energyAttached: DARK5() }), bench: [] }),
              P('P1', { active: mon(C.hydre, 'def', { toolAttached: { iid: 'tool1', cardId: C.fan } }),
                        bench: [mon(C.hydre, 'db1')], deck: DECK5() }));
  st = mod.applyAction(st, { type: 'ATTACK', attackIndex: 0, actorIdx: 0 }, pool);
  eq(st.pendingSelection?.effectKey ?? null, null, 'G1 攻擊方沒有備戰 → 不開 picker');
  ok(!st.log.some(l => l.message.includes('手持循環扇')), 'G2 不印 log');
}

console.log('── H) 守衛：延後名單的內容（含正對照）─────────────────────────────');
{
  const EXPECTED = ['幸運頭盔', '逆境保險', '手持循環扇'];
  // ⚠ 反傷型 / 施狀態型 / on-KO 型會牽動昏厥判定・獎賞卡・補位 → 站長裁定暫緩，必須**不在**名單內。
  const BANNED = ['凸凸頭盔', '奢華炸彈', '豪邁炸彈', '龐克頭盔', '火箭隊的催眠裝置', '沉重接力棒', '希望護身符'];
  // ⭐ 判準抽成**一個函式**，真名單與正對照樣本走同一份 —— 正對照才不會是恆真式。
  const judge = (nameSet) => ({
    banned: BANNED.filter((n) => nameSet.has(n)),
    dead: [...nameSet].filter((n) => !(mod.TOOL_ON_DAMAGED instanceof Map && mod.TOOL_ON_DAMAGED.has(n))
                                  || !(mod.TOOL_ON_KO instanceof Map && mod.TOOL_ON_KO.has(n))),
    notLive: [...nameSet].filter((n) => ![...pool.values()].some((c) => c.name === n)),
  });
  const real = mod.TOOL_FIRE_AFTER_ATTACK_EFFECT;
  ok(real instanceof Set, 'H0 TOOL_FIRE_AFTER_ATTACK_EFFECT 必須是 Set 且被 export');
  // ⚠ 這裡刻意不用「for (const n of set)」跑斷言 —— export 消失時斷言數會跟著縮水＝分母污染。
  //   改成固定跑 judge()，不論 export 在不在，H 段的斷言條數恆定。
  const set = real instanceof Set ? real : new Set();
  eq([...set].sort().join(','), EXPECTED.slice().sort().join(','), 'H1 名單逐字＝幸運頭盔／逆境保險／手持循環扇');
  eq(set.size, 3, 'H2 名單必須剛好 3 張（避免名單被無聲清空／偷偷擴充）');
  const rj = judge(set);
  eq(rj.banned.join(','), '', 'H3 不得含牽動昏厥時序的道具（反傷型／催眠裝置／on-KO 型）');
  eq(rj.dead.join(','), '', 'H4 名單內每個名字都要有 TOOL_ON_DAMAGED ＋ TOOL_ON_KO hook（否則是死條目）');
  eq(rj.notLive.join(','), '', 'H5 名單內每個名字都要是 live 卡池裡真的存在的卡');
  // ⭐ 正對照：**同一個 judge 函式**餵違規樣本，必須回報違規
  eq(judge(new Set([...EXPECTED, '凸凸頭盔'])).banned.join(','), '凸凸頭盔',
     'H6 正對照：judge 對「凸凸頭盔被誤加入」確實判為違規');
  eq(judge(new Set([...EXPECTED, '這張卡根本不存在'])).dead.join(','), '這張卡根本不存在',
     'H7 正對照：judge 對死條目確實判得出來');
  eq(judge(new Set([...EXPECTED, '這張卡根本不存在'])).notLive.join(','), '這張卡根本不存在',
     'H8 正對照：judge 對「不在 live 卡池」確實判得出來');
  const rjOk = judge(new Set(EXPECTED));
  ok(rjOk.banned.length === 0 && rjOk.dead.length === 0 && rjOk.notLive.length === 0,
     'H9 正對照的反向：judge 對正確名單不得誤報');
}

console.log('── I) 批2 佇列取出時重算候選（招式先動走攻擊方能量）─────────────────');
{
  // 土地雲｜螺旋關節 120「選擇1個這隻寶可夢身上附加的能量，放回手牌。」（M-P-J 18017）
  // 官方序下這個 picker 排在手持循環扇**前面** ⇒ 玩家先把 1 顆能量放回手牌，
  // 扇子的候選清單若停留在「排隊當下」算好的 3 顆，玩家會看到一顆已經不在場上的能量，
  // 選下去只會得到「選擇無效，效果取消」。⇒ 取出時必須重算。
  let LAND = null, li = -1;
  for (const [id, c] of pool) {
    const i = (c.attacks ?? []).findIndex(a => a.name === '螺旋關節');
    if (c.name === '土地雲' && i >= 0) { LAND = id; li = i; break; }
  }
  ok(LAND !== null, 'I0 fixture：找得到有「螺旋關節」的土地雲');
  if (LAND) {
    const FIGHT = eName('基本【鬥】能量');
    let st = ST(P('P0', { active: mon(LAND, 'atk', { energyAttached: [en(FIGHT, 'ae1'), en(FIGHT, 'ae2'), en(FIGHT, 'ae3')] }),
                          bench: [mon(C.hydre, 'ab1')] }),
                P('P1', { active: mon(C.hydre, 'def', { toolAttached: { iid: 'tool1', cardId: C.fan } }),
                          bench: [mon(C.hydre, 'db1')], deck: [en(DARK, 'dk1')] }));
    st = mod.applyAction(st, { type: 'ATTACK', attackIndex: li, actorIdx: 0 }, pool);
    eq(st.pendingSelection?.effectKey ?? null, 'j-2353-landorus-return-energy', 'I1 招式的 picker 先（官方序）');
    st = mod.applyAction(st, { type: 'RESOLVE_SELECTION', selectedIids: ['ae1'], token: st.pendingSelection?.token }, pool);
    eq(ids(st.players[0].active?.energyAttached), 'ae2,ae3', 'I2 ae1 已放回手牌');
    eq(st.pendingSelection?.effectKey ?? null, 'cycle-fan-step1-pick-energy', 'I3 接著才輪到手持循環扇');
    eq((st.pendingSelection?.params?.options ?? []).map(o => o.id).join(','), 'ae2,ae3',
       'I4 ⭐ 候選清單必須重算：已回手的 ae1 不得再出現');
    const s2 = mod.applyAction(st, { type: 'RESOLVE_SELECTION', selectedIids: ['ae2'], token: st.pendingSelection?.token }, pool);
    eq(s2.pendingSelection?.effectKey ?? null, 'cycle-fan-step2-place-energy', 'I5 選重算後的候選可以正常進 step2');
  }
  // I-b：pop 路徑的「取消」分支 —— 重算後已無對象時，整筆丟掉、不留死 picker。
  //   ⚠ 現行卡池裡「自回手／自改附」型招式解完都至少留 1 顆能量，湊不出天然的歸零盤面，
  //   所以這裡在**招式 picker 還開著**的時候，把攻擊方多餘的能量拿掉
  //   （＝模擬「中途有別的效果把能量清光」），再走真的 RESOLVE_SELECTION 觸發 pop。
  {
    const FIGHT2 = eName('基本【鬥】能量');
    let LAND2 = null, li2 = -1;
    for (const [id, c] of pool) {
      const i2 = (c.attacks ?? []).findIndex(a => a.name === '螺旋關節');
      if (c.name === '土地雲' && i2 >= 0) { LAND2 = id; li2 = i2; break; }
    }
    if (LAND2) {
      let st = ST(P('P0', { active: mon(LAND2, 'atk', { energyAttached: [en(FIGHT2, 'ge1'), en(FIGHT2, 'ge2'), en(FIGHT2, 'ge3')] }),
                            bench: [mon(C.hydre, 'ab1')] }),
                  P('P1', { active: mon(C.hydre, 'def', { toolAttached: { iid: 'tool1', cardId: C.fan } }),
                            bench: [mon(C.hydre, 'db1')], deck: [en(DARK, 'dk1')] }));
      st = mod.applyAction(st, { type: 'ATTACK', attackIndex: li2, actorIdx: 0 }, pool);
      eq((st.pendingChainQueue ?? []).map(q => q.effectKey).join(','), 'cycle-fan-step1-pick-energy',
         'I5b 盤面佈對：扇子確實排在佇列裡');
      // 只留 ge1（模擬中途被清掉）——招式 picker 仍開著，接下來解掉它就會讓能量歸零
      const _p0 = { ...st.players[0], active: { ...st.players[0].active, energyAttached: [st.players[0].active.energyAttached[0]] } };
      st = { ...st, players: [_p0, st.players[1]] };
      st = mod.applyAction(st, { type: 'RESOLVE_SELECTION', selectedIids: ['ge1'], token: st.pendingSelection?.token }, pool);
      eq(ids(st.players[0].active?.energyAttached), '', 'I5d 攻擊方能量已歸零');
      eq(st.pendingSelection?.effectKey ?? null, null, 'I6 重算後無對象 → 扇子整筆取消，不留死 picker');
      ok(st.log.some(l => l.message.includes('手持循環扇：已無可改附')), 'I7 取消時有明確 log');
    }
  }
  // I-c 正對照：沒有登記 refresher 的 effectKey 不受影響（青草命令那條鏈仍照常）
  ok(true, 'I8（正對照見 test-v6211-pending-clobber-and-printing-gap 的 A 段：未登記 refresher 的 picker 行為不變）');
}

console.log('── J) 批2 狙擊／多目標路徑也要帶攻擊方 iid 快照 ──────────────────');
{
  // 鍬農炮蟲｜快速俯衝「對手的1隻寶可夢受到50點傷害。[在備戰區不計算弱點・抵抗力。]」
  //   → 走中央 dealAttackDamageToTarget ⇒ fireDefenderOnDamaged（**不是** engine 主管線）。
  //   那條路徑本來就在 ATTACK_POST 之內、不需要延後，但「使用招式的寶可夢」的 iid 快照
  //   一樣要傳下去，否則手持循環扇的 resolver 又會退回讀 active。
  let KUWA2 = null, ki = -1;
  for (const [id, c] of pool) {
    const i = (c.attacks ?? []).findIndex(a => a.name === '快速俯衝');
    if (c.name === '鍬農炮蟲' && i >= 0) { KUWA2 = id; ki = i; break; }
  }
  ok(KUWA2 !== null, 'J0 fixture：找得到有「快速俯衝」的鍬農炮蟲');
  if (KUWA2) {
    let st = ST(P('P0', { active: mon(KUWA2, 'atk', { energyAttached: [en(LIGHT, 'al1'), en(LIGHT, 'al2')] }),
                          bench: [mon(C.hydre, 'ab1')] }),
                P('P1', { active: mon(C.hydre, 'def', { toolAttached: { iid: 'tool1', cardId: C.fan } }),
                          bench: [mon(C.hydre, 'db1')], deck: [en(DARK, 'dk1')] }));
    st = mod.applyAction(st, { type: 'ATTACK', attackIndex: ki, actorIdx: 0 }, pool);
    eq(st.pendingSelection?.effectKey ?? null, 'm5-kuwaganon-dash', 'J1 狙擊 picker 先開');
    st = mod.applyAction(st, { type: 'RESOLVE_SELECTION', selectedIids: ['def'], token: st.pendingSelection?.token }, pool);
    eq(st.pendingSelection?.effectKey ?? null, 'cycle-fan-step1-pick-energy', 'J2 打到戰鬥位 → 手持循環扇觸發');
    eq(st.pendingSelection?.params?.attackerIid ?? null, 'atk',
       'J3 ⭐ 中央傷害 helper 也必須把攻擊方 iid 快照傳給道具（否則 resolver 退回讀 active）');
    eq((st.pendingSelection?.params?.options ?? []).map(o => o.id).join(','), 'al1,al2',
       'J4 候選 = 使用招式的寶可夢身上的能量');
  }
}

console.log('── K) 批2 使用招式的寶可夢已離場 → 不發動、不留假 log ───────────────');
{
  // 快照指向的寶可夢若已經不在場上（回手／被反傷 KO／被 bounce），
  // 一律不發動 —— **不可以**退回打現在的戰鬥寶可夢。
  // 現行卡池湊不出「攻擊方離場但同側又有另一隻帶能量的戰鬥寶可夢」的天然盤面，
  // 因此在招式 picker 還開著時把攻擊方換成別隻（＝模擬中途被 bounce），再走真的 RESOLVE_SELECTION。
  let st = ST(P('P0', { active: mon(C.kuwa, 'atk', { energyAttached: [en(LIGHT, 'al1'), en(LIGHT, 'al2')] }),
                        bench: [mon(C.kuwa, 'ab1', { energyAttached: [en(LIGHT, 'bl1')] })] }),
              P('P1', { active: mon(C.hydre, 'def', { toolAttached: { iid: 'tool1', cardId: C.fan } }),
                        bench: [mon(C.hydre, 'db1')], deck: [en(DARK, 'dk1')] }));
  st = mod.applyAction(st, { type: 'ATTACK', attackIndex: 0, actorIdx: 0 }, pool);
  eq((st.pendingChainQueue ?? [])[0]?.params?.attackerIid ?? null, 'atk', 'K1 排隊中的扇子帶著 atk 快照');
  // 手術：atk 離場（進手牌），改由 nx 當戰鬥位、nb 當備戰，兩者都帶能量
  const _hand = [{ iid: 'atk', cardId: st.players[0].active.cardId }];
  st = { ...st, players: [{ ...st.players[0],
      active: { iid: 'nx', cardId: st.players[0].active.cardId, damage: 0, energyAttached: [en(LIGHT, 'nx1')] },
      bench: [{ iid: 'nb', cardId: st.players[0].active.cardId, damage: 0, energyAttached: [en(LIGHT, 'nb1')] }],
      hand: _hand }, st.players[1]] };
  st = mod.applyAction(st, { type: 'RESOLVE_SELECTION', selectedIids: ['nb'], token: st.pendingSelection?.token }, pool);
  eq(st.pendingSelection?.effectKey ?? null, null,
     'K2 ⭐ 使用招式的寶可夢已離場 → 扇子不發動（不得退回打現在的戰鬥寶可夢）');
  // ⚠ 「請選能量」那行是**排隊當下**（寶可夢還在場上）印的，屬合理；
  //   關鍵是取出時要有一行明確講「取消」，玩家才知道 picker 為什麼沒出現。
  ok(st.log.some(l => l.message.includes('手持循環扇：已無可改附')),
     'K3 取消時要有明確 log（不留下「印了卻沒發生」的懸空狀態）');
  const _all = [st.players[0].active, ...st.players[0].bench].filter(Boolean)
    .flatMap(c => c.energyAttached.map(x => x.iid)).sort().join(',');
  eq(_all, 'nb1,nx1', 'K4 場上能量一顆都沒被動到');
}

console.log('── M) 批2 手持循環扇在 KO 分支也要延後、也要帶快照 ──────────────────');
{
  // 三首惡龍ex｜粉碎頭 200 KO 酷豹(110HP)＋手持循環扇 ⇒ 走 engine 的 **KO 分支**
  // （TOOL_ON_KO 鏡射）。KO 分支同樣要延後、同樣要帶攻擊當下的 iid 快照。
  let st = ST(P('P0', { active: mon(C.hydre, 'atk', { energyAttached: [en(DARK, 'ae1'), en(DARK, 'ae2'), en(DARK, 'ae3'), en(DARK, 'ae4'), en(DARK, 'ae5')] }),
                        bench: [mon(C.hydre, 'ab1')] }),
              P('P1', { active: mon(C.koupa, 'def', { toolAttached: { iid: 'tool1', cardId: C.fan } }),
                        bench: [mon(C.hydre, 'db1')], deck: DECK5() }));
  st = mod.applyAction(st, { type: 'ATTACK', attackIndex: 0, actorIdx: 0 }, pool);
  ok(st.log.some(l => l.message.includes('被擊倒')), 'M1 確實走 KO 分支');
  eq(st.pendingSelection?.effectKey ?? null, 'cycle-fan-step1-pick-energy', 'M2 KO 分支也會觸發手持循環扇');
  eq(st.pendingSelection?.params?.attackerIid ?? null, 'atk', 'M3 ⭐ KO 分支的觸發也帶攻擊當下的 iid 快照');
  const li = st.log.map(l => l.message);
  ok(li.findIndex(m => m.includes('粉碎頭：對手牌庫頂')) < li.findIndex(m => m.includes('手持循環扇：選 1 個')),
     'M4 KO 分支 log 順序：招式效果先於手持循環扇');
  st = mod.applyAction(st, { type: 'RESOLVE_SELECTION', selectedIids: ['ae1'], token: st.pendingSelection?.token }, pool);
  st = mod.applyAction(st, { type: 'RESOLVE_SELECTION', selectedIids: ['ab1'], token: st.pendingSelection?.token }, pool);
  eq(ids(st.players[0].bench[0]?.energyAttached), 'ae1', 'M5 能量確實改附到攻擊方備戰');
}

console.log('── L) 沒登記 refresher 的排隊 picker 必須照常浮上來（正對照）───────');
{
  // ⚠ engine 的 pop 迴圈裡 `if (!_refresh) { _picked = cand; break; }` 若寫成 continue，
  //   所有**沒登記 refresher** 的排隊 picker 都會被無聲吃掉。這一段就是那條分支的正對照。
  // 盤面：防守方帶【希望護身符】（TOOL_ON_KO、**不在**延後名單）被 KO ⇒ 它先開 deck-search；
  //   攻擊方的招式 POST（君主蛇ex｜青草命令）再 withPending ⇒ 排到隊尾，且該 effectKey 沒登記 refresher。
  let SERP = null, si = -1;
  for (const [id, c] of pool) {
    const i = (c.attacks ?? []).findIndex(a => a.name === '青草命令');
    if (c.name === '君主蛇ex' && i >= 0) { SERP = id; si = i; break; }
  }
  const CHARM = [...pool].find(([, c]) => c.name === '希望護身符')?.[0] ?? null;
  ok(SERP !== null && CHARM !== null, 'L0 fixture：君主蛇ex｜青草命令 ＋ 希望護身符');
  if (SERP && CHARM) {
    const GRASS2 = eName('基本【草】能量');
    let st = ST(P('P0', { active: mon(SERP, 'atk', { energyAttached: [en(GRASS2, 'g1'), en(GRASS2, 'g2'), en(GRASS2, 'g3'), en(GRASS2, 'g4')] }),
                          bench: [mon(C.hydre, 'ab1')], deck: [en(DARK, 'sd1'), en(DARK, 'sd2'), en(DARK, 'sd3')] }),
                P('P1', { active: mon(C.koupa, 'def', { toolAttached: { iid: 'charm1', cardId: CHARM } }),
                          bench: [mon(C.hydre, 'db1')], deck: [en(DARK, 'dd1'), en(DARK, 'dd2')] }));
    st = mod.applyAction(st, { type: 'ATTACK', attackIndex: si, actorIdx: 0 }, pool);
    ok(st.log.some(l => l.message.includes('被擊倒')), 'L1 確實 KO（走 KO 分支）');
    eq(st.pendingSelection?.effectKey ?? null, 'search-to-hand-reshuffle', 'L2 希望護身符（未延後）先開');
    eq((st.pendingChainQueue ?? []).map(q => q.effectKey).join(','), 'wave9-take-any-from-deck',
       'L3 招式自己的 picker 排在隊尾，且該 effectKey **沒有**登記 refresher');
    st = mod.applyAction(st, { type: 'RESOLVE_SELECTION', selectedIids: [], token: st.pendingSelection?.token }, pool);
    eq(st.pendingSelection?.effectKey ?? null, 'wave9-take-any-from-deck',
       'L4 ⭐ 沒登記 refresher 的排隊 picker 必須照常浮上來（不得被 pop 迴圈吃掉）');
  }
}

console.log(`\nv6215 招式效果先於受傷道具：PASS ${pass} / FAIL ${fail}`);
console.log('=== test-v6215 END ===');
if (fail > 0) process.exit(1);
