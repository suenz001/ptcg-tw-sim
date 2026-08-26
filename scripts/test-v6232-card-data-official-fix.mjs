// ⭐⭐⭐ v6.232 守衛 — 卡片資料 vs 官方卡面 稽核修正（站長 2026-08-26 裁定的四件事）
//
// 【A】M-P-J 三張被 clone 汙染的卡逐欄修正（資料端＋行為端實跑四招）：
//   ・19536 菊草葉 155/M-P：「飛葉快刀 20」→「叫聲＋種子炸彈 30」（官方 2026-08-26 實抓）
//   ・19539 暖暖豬 158/M-P：HP70 撞擊/滾動 撤退1 → HP80 吐火20 撤退2
//   ・19542 小鋸鱷 161/M-P：HP70 咬緊10 → HP80 撞一下40（自傷10）
// 【C】9 張基本能量 regulationMark I→J：官方卡片頁 alpha 已印 J；依 v6.194 SV-P 前例
//   整卡搬入 M-P-J.json。⭐ 已查證 validateDeck 對基本能量完全豁免標記檢查
//   （validation.ts「基本能量在標準賽不受任何構築限制」）⇒ 舊牌組不受影響，行為端釘住。
// 【D】19630「老大的指令」維持不改名（站長 v6.193 裁定）；稽核工具需有白名單
//   讓它不再被報成遊戲性差異（fail-open：兩側值任一改變即回到差異報告）。
// 【B】18965/18969 維持 v6.194 的 HIDDEN_FROM_PLAYERS（完整行為網在 test-v6194-*，
//   這裡只做輕量互驗：卡池仍載入、候選清單不含）。
//
// HEAD-FAIL 依據（在 BASE = 82b6722d66c3fc0b061e89fd836aa677ad557b95 的資料上跑，必紅）：
//   ・BASE 的 19536 attacks 是飛葉快刀、19539/19542 HP 70          → A 資料端＋行為端 FAIL
//   ・BASE 的 9 張基本能量標是 I 且在 M-P-I.json                    → C FAIL
//   ・BASE 的稽核工具沒有 KNOWN_INTENTIONAL_DIVERGENCES            → D FAIL
import { build } from 'esbuild';
import { readFileSync, writeFileSync, unlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x6232-s.js'), E = join(ROOT, '.x6232-e.ts'), O = join(ROOT, '.x6232-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E,
  "export * as VIS from './src/lib/cards/visibility';\n"
  + "export { applyAction } from './src/lib/game/engine';\n"
  + "export { validateDeck } from './src/lib/decks/validation';\n"
  + "export { getStdCardIds } from './src/lib/server/cardIndex';\n"
  + "import './src/lib/game/effects';\n");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const mod = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const INDEX = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
const live = new Set(INDEX.map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
const CSM = JSON.parse(readFileSync(join(ROOT, 'static/card-set-map.json'), 'utf8'));
const MPI = JSON.parse(readFileSync(join(dir, 'M-P-I.json'), 'utf8'));
const MPJ = JSON.parse(readFileSync(join(dir, 'M-P-J.json'), 'utf8'));

let pass = 0, fail = 0;
function T(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e && e.message)); fail++; }
}
const ok = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(m + '：預期 ' + JSON.stringify(b) + '，實際 ' + JSON.stringify(a)); };

T('自驗：卡庫載得到（≥4900 張）、目標卡都在', () => {
  ok(pool.size >= 4900, '只掃到 ' + pool.size + ' 張 —— 掃描器壞了？');
  for (const id of ['19536', '19539', '19542', '19630', '18965', '18969', '14102', '14435'])
    ok(pool.get(id), '卡庫沒有 id ' + id);
});

console.log('【A】三張卡逐欄＝官方卡面（2026-08-26 重跑稽核，試金石 PASS）');

T('⭐⭐⭐ 19536 菊草葉 155/M-P：叫聲＋種子炸彈 30（不再是飛葉快刀）', () => {
  const c = pool.get('19536');
  eq(c.hp, 70, 'hp'); eq(c.regulationMark, 'J', '標');
  eq(c.attacks.length, 2, '招式數');
  eq(c.attacks[0].name, '叫聲', '招1名'); eq(c.attacks[0].damage, '', '招1傷害');
  eq(c.attacks[0].cost.join('+'), 'Colorless', '招1費用');
  ok(c.attacks[0].effect.includes('「-20」'), '叫聲 effect 應含「-20」：' + c.attacks[0].effect);
  eq(c.attacks[1].name, '種子炸彈', '招2名'); eq(c.attacks[1].damage, '30', '招2傷害');
  eq(c.attacks[1].cost.join('+'), 'Grass+Grass', '招2費用'); eq(c.attacks[1].effect, '', '招2無效果');
  eq(c.retreatCost.length, 1, '撤退費'); eq(c.illustrator, 'Kariya', 'illustrator');
  eq(c.weakness.type, 'Fire', '弱點');
  ok(!c.attacks.some((a) => a.name === '飛葉快刀'), '飛葉快刀（clone 汙染）還在');
});

T('⭐⭐⭐ 19539 暖暖豬 158/M-P：HP80、吐火 20、撤退 2（不再是 HP70 撞擊/滾動）', () => {
  const c = pool.get('19539');
  eq(c.hp, 80, 'hp'); eq(c.regulationMark, 'J', '標');
  eq(c.attacks.length, 1, '招式數');
  eq(c.attacks[0].name, '吐火', '招名'); eq(c.attacks[0].damage, '20', '傷害');
  eq(c.attacks[0].cost.join('+'), 'Fire', '費用');
  eq(c.retreatCost.length, 2, '撤退費'); eq(c.illustrator, 'Uninori', 'illustrator');
  eq(c.weakness.type, 'Water', '弱點');
});

T('⭐⭐⭐ 19542 小鋸鱷 161/M-P：HP80、撞一下 40（自傷10）（不再是 HP70 咬緊）', () => {
  const c = pool.get('19542');
  eq(c.hp, 80, 'hp'); eq(c.regulationMark, 'J', '標');
  eq(c.attacks.length, 1, '招式數');
  eq(c.attacks[0].name, '撞一下', '招名'); eq(c.attacks[0].damage, '40', '傷害');
  eq(c.attacks[0].cost.join('+'), 'Water+Water', '費用');
  ok(c.attacks[0].effect.includes('10點傷害'), 'effect 應含自傷 10：' + c.attacks[0].effect);
  eq(c.retreatCost.length, 1, '撤退費'); eq(c.illustrator, 'REND', 'illustrator');
  eq(c.weakness.type, 'Lightning', '弱點');
});

// ── 行為端：四招實跑（reg key『卡名|招式名』真的接上這三張 id）─────────
let iidN = 0;
const inst = (cardId, extra = {}) => ({ iid: 'i' + (++iidN), cardId: String(cardId), damage: 0, energyAttached: [], toolAttached: null, ...extra });
const mkState = (p0, p1) => ({
  phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
  isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
  players: [
    { name: 'A', active: null, bench: [], hand: [], deck: [], discard: [], prizes: [], ...p0 },
    { name: 'B', active: null, bench: [], hand: [], deck: [], discard: [], prizes: [], ...p1 },
  ],
});
const WATER = [...pool.values()].find((c) => c.name === '基本【水】能量');
const atk = (atkId, defId, energyIds, attackIndex) => mod.applyAction(
  mkState({ active: inst(atkId, { energyAttached: energyIds.map((e) => inst(e)) }) }, { active: inst(defId) }),
  { type: 'ATTACK', attackIndex, actorIdx: 0 }, pool);

T('⭐⭐⭐ 行為：19536 叫聲 → 對手下次招式 -20（既有實作自動接上）', () => {
  const r = atk('19536', '19542', ['14102'], 0);
  eq(r.players[1].active.nextOwnAttackPenalty, 20, 'nextOwnAttackPenalty');
  eq(r.players[1].active.damage, 0, '叫聲不造成傷害');
});
T('⭐⭐⭐ 行為：19536 種子炸彈【草草】→ 30（用搬過去的 14102 草能量付費）', () => {
  const r = atk('19536', '19539', ['14102', '14102'], 1);
  eq(r.players[1].active.damage, 30, '種子炸彈傷害');
});
T('⭐⭐⭐ 行為：19539 吐火【火】→ 20（用搬過去的 14428 火能量付費）', () => {
  const r = atk('19539', '19542', ['14428'], 0);
  eq(r.players[1].active.damage, 20, '吐火傷害');
});
T('⭐⭐⭐ 行為：19542 撞一下【水水】→ 對手 40、自身 10（selfHitPost 接上）', () => {
  ok(WATER, '找不到基本【水】能量 —— 掃描器壞了？');
  const r = atk('19542', '19536', [WATER.id, WATER.id], 0);
  eq(r.players[1].active.damage, 40, '撞一下傷害');
  eq(r.players[0].active.damage, 10, '自身反傷');
});

console.log('【C】9 張基本能量 I→J：搬檔一致性＋舊牌組不受影響（行為端）');

const E9 = ['14102', '14103', '14104', '14428', '14429', '14430', '14433', '14434', '14435'];

T('⭐⭐⭐ 9 張全部：標=J、setCode=M-P-J、在 M-P-J.json、不在 M-P-I.json、card-set-map 同步', () => {
  const inJ = new Set(MPJ.map((c) => String(c.id)));
  const inI = new Set(MPI.map((c) => String(c.id)));
  for (const id of E9) {
    const c = pool.get(id);
    ok(c, '卡庫沒有 ' + id);
    eq(c.regulationMark, 'J', id + ' 標'); eq(c.setCode, 'M-P-J', id + ' setCode');
    ok(c.supertype === 'Energy' && c.subtype === 'Basic', id + ' 不是基本能量了？');
    ok(inJ.has(id), id + ' 不在 M-P-J.json');
    ok(!inI.has(id), id + ' 還留在 M-P-I.json');
    eq(CSM[id], 'M-P-J', id + ' card-set-map');
  }
});

T('⭐⭐⭐ index.json 定點數字＝實際檔案（M-P-I 50／M-P-J 101；總數 4935 不變、未重生）', () => {
  const mi = INDEX.find((e) => e.code === 'M-P-I'), mj = INDEX.find((e) => e.code === 'M-P-J');
  eq(mi.cardCount, 50, 'M-P-I cardCount'); eq(mi.count, 50, 'M-P-I count');
  eq(MPI.length, 50, 'M-P-I.json 實際張數');
  ok(!('Energy' in (mi.supertypeCounts || {})), 'M-P-I 不該再有 Energy 供應數');
  eq(Object.values(mi.supertypeCounts).reduce((a, b) => a + b, 0), 50, 'M-P-I supertypeCounts 加總');
  eq(mj.cardCount, 101, 'M-P-J cardCount'); eq(mj.count, 101, 'M-P-J count');
  eq(MPJ.length, 101, 'M-P-J.json 實際張數');
  eq(mj.supertypeCounts.Energy, 18, 'M-P-J Energy 數');
  eq(Object.values(mj.supertypeCounts).reduce((a, b) => a + b, 0), 101, 'M-P-J supertypeCounts 加總');
  eq(INDEX.reduce((s, e) => s + e.cardCount, 0), 4935, '全站總張數');
  ok(mi.regulationMark === 'I' && mj.regulationMark === 'J', '卡包層級的標被動到了');
});

T('⭐⭐⭐ 行為：舊牌組帶這些能量（含 >4 張）→ 驗證合法、無「已退出標準賽」', () => {
  const BASIC = [...pool.values()].find((c) => c.supertype === 'Pokemon' && !c.evolvesFrom
    && c.subtype !== 'Other' && ['H', 'I', 'J'].includes(c.regulationMark));
  const deck = { id: 'x', name: 'x', createdAt: '', updatedAt: '', entries: [
    { cardId: String(BASIC.id), count: 4 },
    { cardId: '14102', count: 20 }, { cardId: '14433', count: 20 }, { cardId: '14435', count: 16 } ] };
  const r = mod.validateDeck(deck, pool);
  eq(r.totalCount, 60, '張數');
  ok(!r.issues.some((s) => s.includes('已退出標準賽')), '被標記 gate 擋了：' + JSON.stringify(r.issues));
  ok(!r.issues.some((s) => s.includes('查無資料')), '搬檔後查無資料：' + JSON.stringify(r.issues));
  ok(r.legal === true, JSON.stringify(r.issues));
  // 正對照：非基本能量的退環境卡必須還是會被擋（證明 gate 沒被整個拆掉）
  const gCard = [...pool.values()].find((c) => c.regulationMark === 'G' && c.supertype === 'Pokemon'
    && !mod.VIS.isHiddenFromPlayers(c.id));
  if (gCard) {
    const r2 = mod.validateDeck({ ...deck, entries: [{ cardId: String(gCard.id), count: 1 },
      { cardId: '14102', count: 55 }, { cardId: String(BASIC.id), count: 4 }] }, pool);
    ok(r2.issues.some((s) => s.includes('已退出標準賽')) || r2.legal === false,
      '正對照失效：G 標寶可夢竟然合法（' + gCard.name + '）');
  }
});

T('⭐⭐ SEO／伺服器卡索引（getStdCardIds）仍含這 9 張（J 在標準環境）', () => {
  const ids = new Set(mod.getStdCardIds());
  ok(ids.size > 3000, '只拿到 ' + ids.size + ' 個 id —— 掃描器壞了？');
  for (const id of E9) ok(ids.has(id), '索引裡沒有 ' + id);
});

console.log('【D】19630 不改名＋稽核白名單');

T('⭐⭐⭐ 19630 名稱維持「老大的指令」（站長 v6.193 裁定；勿跟進官方後綴）', () => {
  eq(pool.get('19630').name, '老大的指令', '19630 name');
});

T('⭐⭐⭐ 稽核工具有 19630 白名單，且匹配邏輯是「兩側值逐字相符才豁免」（fail-open）', () => {
  const src = readFileSync(join(ROOT, 'scripts/audit-card-data-vs-official.mjs'), 'utf8');
  ok(src.includes('KNOWN_INTENTIONAL_DIVERGENCES'), '白名單常數不存在');
  ok(/id:\s*'19630',\s*field:\s*'name'/.test(src), '缺 19630/name 白名單條目');
  ok(src.includes("ours: '老大的指令', official: '老大的指令（烏羽）'"), '白名單兩側值不對');
  ok(src.includes('normText(w.ours) === d.ours && normText(w.official) === d.official'),
    '匹配邏輯必須兩側值逐字比對（否則官方改名／我們資料被動到會被靜默吞掉）');
  ok(src.includes('waivedDiffs.push(d)') && src.includes('setResult.waived.push('),
    '白名單命中後必須進 waived 區（不是直接丟棄）');
  ok(src.includes('KNOWN_PAGE_GONE_HIDDEN'), '18965/18969 的 pageGone 註記不存在');
  // 正對照：斷言真的在讀原始碼（隨便的字串不會過）
  ok(!/KNOWN_INTENTIONAL_DIVERGENCES/.test('const x = 1;'), '正對照失效');
});

console.log('【B】18965/18969 維持 v6.194 隱藏（輕量互驗；完整網在 test-v6194-*）');

T('⭐⭐ 卡池仍載入 18965/18969、候選清單（filterPlayerSelectable）不含', () => {
  for (const id of ['18965', '18969']) ok(pool.get(id), '卡池沒有 ' + id + '（舊牌組／回放會炸）');
  const sel = mod.VIS.filterPlayerSelectable([...pool.values()]);
  const ids = new Set(sel.map((c) => String(c.id)));
  for (const id of ['18965', '18969']) ok(!ids.has(id), '候選清單仍含 ' + id);
  eq(pool.size - sel.length, 2, '被濾掉的張數');
});

console.log(`\nv6.232 守衛：${pass} PASS / ${fail} FAIL`);
if (fail) process.exit(1);
