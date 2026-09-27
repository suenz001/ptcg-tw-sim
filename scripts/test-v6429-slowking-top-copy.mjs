// 守衛 v6.429：AI 會打呆呆王的「牌庫頂借招」打法，而且只用自己合法知道的牌庫頂（AI 對戰強化）。
//
// 站長說明的打法：把巨金怪、酋雷姆、靈幽馬這類「高傷害／一次打多隻」的招式，用暗碼迷的解讀或夜間學院放到牌庫頂，
//   再用呆呆王｜耀閃挑戰借來打；超級袋獸ex 用完使者衝刺後，靠拉帝亞斯ex｜天空徑線免費撤退換呆呆王。
// 修前（v6.428）實測 80 局：夜間學院 0 次、暗碼迷的解讀最常擺超級袋獸ex／拉帝亞斯ex（擁有規則，借不了）、耀閃挑戰 11 次。
//
// 本守衛驗：
//   A 牌庫頂紀錄（deck-top-known）：只認自己擺的；抽走上面的仍有效；洗牌、放到下方都作廢。
//   B 公平性：試算時只保留行動方自己知道的牌庫頂；對手的牌庫一律整副打亂；沒有紀錄時 AI 不知道牌庫頂。
//   C 暗碼迷的解讀：最好的借招目標放最上方（不擺擁有規則的寶可夢）。
//   D 夜間學院：手牌有目標、牌庫頂未知 ⇒ AI 會用、而且放的是目標。
//   E 出招：借哪一招逐招試打（靈幽馬選幻影碎不選陰森射擊）；ATTACK 帶 copyAttackChoice。
//   F 擺好之後不讓抽牌特性把牌庫頂抽走；使者衝刺要在擺牌庫頂「之前」用；超級袋獸ex 免費撤退換呆呆王。
//   G B1：試打「選對手 1 隻打」的招會把選擇視窗解完（吉雉雞ex｜殘酷箭不再是 unresolved／0 傷害）。
//
// HEAD-FAIL（2026-09-27 手動實測，src 換回 544cdd7b）：新模組不存在的項目以哨兵逐條紅，不整支 throw（Rule 41）。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x-v6429-s.js'), E = join(ROOT, '.x-v6429-e.ts'), O = join(ROOT, '.x-v6429-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
const has = (p) => existsSync(join(ROOT, p));
writeFileSync(E, [
  "export * as ENG from './src/lib/game/engine';",
  "export { getAIAction } from './src/lib/game/ai';",
  "export * as EVAL from './src/lib/game/ai-eval';",
  has('src/lib/game/deck-top-known.ts') ? "export * as DTK from './src/lib/game/deck-top-known';" : 'export const DTK = {};',
  has('src/lib/game/ai-slowking.ts') ? "export * as SK from './src/lib/game/ai-slowking';" : 'export const SK = {};',
  "import './src/lib/game/effects';",
].join('\n'));
// 每條測試開頭把 ai-eval 的試打亂數種子歸零（與 scripts/lib/ai-sim-harness.mjs 同一招：只在本打包附加，不改 src/）
//   ⇒ 每條的結果只取決於自己的盤面，不會因為前面多跑了幾條而翻轉（fable 審查後新增 A4 時 F2 曾因此翻紅）。
const seedResetPlugin = { name: 'sim-seed-reset', setup(b) {
  b.onLoad({ filter: /[\\/]ai-eval\.ts$/ }, (args) => {
    const src = readFileSync(args.path, 'utf8');
    const m = /let _simSeed = (0x[0-9a-fA-F]+|\d+);/.exec(src);
    if (!m) throw new Error('ai-eval.ts 找不到 `let _simSeed = …;`（改名了？請更新本守衛）');
    // k>0：從不同起點開始（多起點統計用；fable 複審：F2 這類擲幣相關的判斷要看多數，不看單一種子）
    return { contents: src + `\nexport function __testResetSimSeed(k = 0) { _simSeed = (${m[1]} + k * 0x9e3779b9) >>> 0; }\n`, loader: 'ts' };
  });
} };
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', plugins: [seedResetPlugin],
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { ENG, getAIAction, EVAL, DTK, SK } = await import(pathToFileURL(O).href);
const { createGame, applyAction, getAvailableAttacks, getEffectiveAttacks } = ENG;
const MISSING = Symbol('missing');
const F = (M, n) => (typeof M?.[n] === 'function' ? M[n] : () => MISSING);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
// 卡片事實一律取自 static/cards（台灣官方卡面）
const C = { slowking: '10934', metagross: '18479', kyurem: '10629', spectrier: '14740', kangaskhan: '14071',
  latias: '16783', cipher: '17169', academy: '10646', psy: '17220', tablet: '17133', ball: '17122', snorlax: '17038', genesect: '16960', noctowl: '13430', budew: '14671', stretcher: '11490', kingambit_pre: '16943', sensePsy: '18056', metal: '17219', burn: '17207' };
for (const [k, id] of Object.entries(C)) assert.ok(pool.get(id), `找不到 ${k} ${id}（卡池變了？）`);
assert.ok(/將自己的牌庫上方1張卡丟棄.*擁有規則的寶可夢.*作為這個招式使用/.test(pool.get(C.slowking).attacks[0].effect), '耀閃挑戰卡面變了，請重新查證');
const idxOf = (cid, name) => pool.get(cid).attacks.findIndex((a) => a.name === name);

let nn = 0;
const inst = (cid, e = [], x = {}) => ({ iid: 'w' + (++nn), cardId: String(cid), damage: 0, energyAttached: e, ...x });
const psy = () => inst(C.psy);
const fill = (n, cid = C.tablet) => Array.from({ length: n }, () => inst(cid));
/** 我方：active／bench／hand／deck 自訂；對手：3 隻卡比獸。 */
function mk({ active, bench = [], hand = [], deck = fill(15), stadium = null, oppActiveDamage = 0, oppActive = C.snorlax }) {
  const s = createGame({ name: 'P1', entries: [{ cardId: C.snorlax, count: 1 }] },
    { name: 'P2', entries: [{ cardId: C.snorlax, count: 1 }] }, pool);
  return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
    isFirstTurn: false, setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
    pendingSelection: null, activeStadium: stadium, stadiumUsedThisTurn: [false, false],
    players: [
      { ...s.players[0], hand, deck, discard: [], prizes: fill(6, C.snorlax), active, bench, energyAttachedThisTurn: true, supporterPlayedThisTurn: false },
      { ...s.players[1], hand: [], deck: fill(20, C.snorlax), discard: [], prizes: fill(6, C.snorlax),
        active: inst(oppActive, [], { damage: oppActiveDamage }), bench: [inst(C.snorlax), inst(C.snorlax)] }] };
}
/** 把待選擇交給 AI 解完（最多 6 步）。 */
function resolveAll(st) {
  for (let i = 0; i < 6 && st.pendingSelection; i++) st = applyAction(st, getAIAction(st, pool, st.pendingSelection.actorIdx), pool);
  return st;
}

let pass = 0, fail = 0; const failed = [];
const T = (n, f) => { try { EVAL.__testResetSimSeed(); f(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; failed.push(n.split(' ')[0]); } };

// ── A 牌庫頂紀錄 ─────────────────────────────────────────────────────────────
T('A1 ⭐ 記錄後讀得到；抽走最上面一張，剩下的已知卡仍有效', () => {
  const record = F(DTK, 'recordKnownDeckTop'), known = F(DTK, 'knownDeckTopIids');
  const deck = [inst(C.metagross), inst(C.kyurem), ...fill(10)];
  let st = mk({ active: inst(C.slowking, [psy(), psy()]), deck });
  st = record(st, 0, [deck[0].iid, deck[1].iid]);
  assert.notEqual(st, MISSING, 'recordKnownDeckTop 不存在');
  assert.deepEqual(known(st, 0), [deck[0].iid, deck[1].iid]);
  const drawn = { ...st, players: [{ ...st.players[0], deck: st.players[0].deck.slice(1) }, st.players[1]] };
  assert.deepEqual(known(drawn, 0), [deck[1].iid], '抽走一張後應只剩第二張已知');
});
T('A2 ⭐ 洗牌、放到牌庫下方、從中間拿走 ⇒ 紀錄作廢（什麼都不知道）', () => {
  const record = F(DTK, 'recordKnownDeckTop'), known = F(DTK, 'knownDeckTopIids');
  const deck = [inst(C.metagross), ...fill(10)];
  const st = record(mk({ active: inst(C.slowking), deck }), 0, [deck[0].iid]);
  const with_ = (d) => ({ ...st, players: [{ ...st.players[0], deck: d }, st.players[1]] });
  assert.deepEqual(known(with_([...deck].reverse()), 0), [], '洗牌（順序變了）要作廢');
  assert.deepEqual(known(with_([...deck, inst(C.tablet)]), 0), [], '有卡放到下方要作廢');
  assert.deepEqual(known(with_([deck[0], ...deck.slice(2)]), 0), [], '從中間拿走要作廢');
  assert.deepEqual(known(with_(deck), 0), [deck[0].iid], '正對照：原封不動仍有效');
});
T('A3 暗碼迷的解讀／夜間學院的效果會記錄（真流程）', () => {
  const known = F(DTK, 'knownDeckTopIids');
  const deck = [...fill(6), inst(C.metagross), ...fill(6)];
  let st = mk({ active: inst(C.slowking, [psy(), psy()]), hand: [inst(C.cipher)], deck });
  st = applyAction(st, { type: 'PLAY_TRAINER', iid: st.players[0].hand[0].iid }, pool);
  assert.equal(st.pendingSelection?.effectKey, 'cipher-geek-arrange-top', '沒有開暗碼迷的解讀的選擇視窗');
  const two = [st.players[0].deck[3].iid, st.players[0].deck[6].iid];
  st = applyAction(st, { type: 'RESOLVE_SELECTION', selectedIids: two }, pool);
  assert.deepEqual(known(st, 0), [two[1], two[0]], '後選的在最上方、先選的在第 2 張');
});

T('A4 夜間學院疊在已知牌庫頂上：新放的在最上方、原本已知的仍然知道（真流程）', () => {
  const record = F(DTK, 'recordKnownDeckTop');
  const known = F(DTK, 'knownDeckTopIids');
  const deck = [inst(C.metagross), ...fill(10)];
  let st = mk({ active: inst(C.slowking, [psy(), psy()]), hand: [inst(C.spectrier)], stadium: inst(C.academy), deck });
  st = record(st, 0, [deck[0].iid]);
  if (st === MISSING) throw new Error('recordKnownDeckTop 不存在');
  st = applyAction(st, { type: 'USE_STADIUM' }, pool);
  assert.equal(st.pendingSelection?.effectKey, 'night-academy-top', '沒有開夜間學院的選擇視窗');
  const sp = st.players[0].hand[0].iid;
  st = applyAction(st, { type: 'RESOLVE_SELECTION', selectedIids: [sp] }, pool);
  assert.deepEqual(known(st, 0), [sp, deck[0].iid], '應為 [靈幽馬, 巨金怪]');
});

T('A5 ⭐ 牌庫太少（< 5 張）時一律當作不知道：重洗後剛好洗回原順序的機率太高（1/n!）', () => {
  const record = F(DTK, 'recordKnownDeckTop');
  const known = F(DTK, 'knownDeckTopIids');
  const mkDeck = (n) => { const deck = [inst(C.metagross), ...fill(n - 1)]; const st = record(mk({ active: inst(C.slowking), deck }), 0, [deck[0].iid]); return { st, deck }; };
  const a = mkDeck(5);
  if (a.st === MISSING) throw new Error('recordKnownDeckTop 不存在');
  assert.deepEqual(known(a.st, 0), [a.deck[0].iid], '正對照：5 張時知道');
  const b = mkDeck(4);
  assert.deepEqual(known(b.st, 0), [], '4 張時應該當作不知道');
  // 行為：3 張牌庫整副重洗 200 次，「以為還知道」的次數必須是 0
  const c = mkDeck(3);
  let fooled = 0;
  for (let i = 0; i < 200; i++) {
    const d = [...c.st.players[0].deck];
    for (let j = d.length - 1; j > 0; j--) { const r = Math.floor(Math.random() * (j + 1)); [d[j], d[r]] = [d[r], d[j]]; }
    const s2 = { ...c.st, players: [{ ...c.st.players[0], deck: d }, c.st.players[1]] };
    if (known(s2, 0).length) fooled++;
  }
  assert.equal(fooled, 0, `重洗後仍以為知道牌庫頂 ${fooled}/200 次`);
});

// ── B 公平性 ─────────────────────────────────────────────────────────────────
T('B1 ⭐ 試算時只保留行動方自己的已知牌庫頂；對手的紀錄不採用、牌庫整副打亂', () => {
  const record = F(DTK, 'recordKnownDeckTop');
  const deck = [inst(C.metagross), ...fill(20)];
  let st = mk({ active: inst(C.slowking), deck });
  st = record(st, 0, [deck[0].iid]);
  if (st === MISSING) throw new Error('recordKnownDeckTop 不存在');
  const oppTop = st.players[1].deck[0].iid;
  st = record(st, 1, [oppTop]);
  let keptMine = 0, keptOpp = 0;
  // 200 次：對手牌庫 20 張，整副打亂時頂牌不變的期望值 10 次（標準差約 3）；門檻 30 ⇒ 不會因亂數偶發翻紅，
  //   而「對手的紀錄也被保留」會是 200/200。（fable 複審：20 次／門檻 5 在某些種子起點會偶發紅）
  const N = 200;
  for (let i = 0; i < N; i++) {
    const sim = EVAL.withIsolatedRandom(() => EVAL.shuffleHiddenZonesForSim(structuredClone(st), 0));
    if (sim.players[0].deck[0].iid === deck[0].iid) keptMine++;
    if (sim.players[1].deck[0].iid === oppTop) keptOpp++;
  }
  assert.equal(keptMine, N, '自己擺的牌庫頂要保留在原位');
  assert.ok(keptOpp <= 30, `對手擺的牌庫頂不可以被 AI 採用（${N} 次裡有 ${keptOpp} 次沒被打亂）`);
});
T('B2 ⭐ 沒有紀錄時，AI 不知道牌庫頂（已知牌庫頂的借招評估回 null）', () => {
  const best = F(SK, 'bestKnownTopCopy');
  const st = mk({ active: inst(C.slowking, [psy(), psy()]), deck: [inst(C.metagross), ...fill(10)] });
  const r = best(st, 0, idxOf(C.slowking, '耀閃挑戰'), pool);
  assert.notEqual(r, MISSING, 'bestKnownTopCopy 不存在');
  assert.equal(r, null, '牌庫頂明明不是自己擺的，AI 卻知道是巨金怪');
});

// ── C 暗碼迷的解讀 ───────────────────────────────────────────────────────────
T('C1 ⭐ 暗碼迷的解讀：最上方放最好的借招目標（巨金怪／酋雷姆／靈幽馬之一），不放擁有規則的寶可夢、也不放弱的（含羞苞）', () => {
  const known = F(DTK, 'knownDeckTopIids');
  // 含羞苞（癢癢花粉 10）也借得了、而且排在牌庫前面 ⇒ 不排序只取「前幾張借得了的」會把它放上去（fable 審查 E：候選要有區分力）
  const deck = [inst(C.kangaskhan), inst(C.latias), inst(C.budew), ...fill(4), inst(C.metagross), inst(C.spectrier), ...fill(4)];
  let st = mk({ active: inst(C.slowking, [psy(), psy()]), hand: [inst(C.cipher)], deck });
  st = applyAction(st, { type: 'PLAY_TRAINER', iid: st.players[0].hand[0].iid }, pool);
  st = resolveAll(st);
  const top = pool.get(st.players[0].deck[0].cardId).name;
  assert.ok(['巨金怪', '靈幽馬', '酋雷姆'].includes(top), `最上方是「${top}」`);
  assert.notEqual(pool.get(st.players[0].deck[1].cardId).name, '含羞苞', '第 2 張放了含羞苞（應該放次好的目標）');
  const k = known(st, 0);
  assert.ok(Array.isArray(k) && k[0] === st.players[0].deck[0].iid, '擺好之後 AI 應該知道牌庫頂');
});

// ── D 夜間學院 ───────────────────────────────────────────────────────────────
let D_AFTER = null;
T('D1 ⭐ 夜間學院在場、手牌有巨金怪、牌庫頂未知 ⇒ AI 用夜間學院，把巨金怪放到牌庫頂', () => {
  // 手牌另有劈斬司令（1 階進化、居合斬 30；也借得了、排在前面，且場上沒有進化前所以不會被打出去）
  //   ⇒ 驗得到「挑最好的」而不是「挑第一張借得了的」
  const st0 = mk({ active: inst(C.slowking, [psy(), psy()]), hand: [inst(C.kingambit_pre), inst(C.metagross)],
    stadium: inst(C.academy), deck: fill(12) });
  const act = getAIAction(st0, pool, 0);
  assert.equal(act?.type, 'USE_STADIUM', 'AI 沒有用夜間學院：' + JSON.stringify(act));
  let st = applyAction(st0, act, pool);
  st = resolveAll(st);
  assert.equal(pool.get(st.players[0].deck[0].cardId).name, '巨金怪', '放上去的不是巨金怪');
  D_AFTER = st;
});

// ── E 出招 ───────────────────────────────────────────────────────────────────
T('E1 ⭐ 牌庫頂擺好巨金怪 ⇒ AI 出耀閃挑戰，ATTACK 帶 copyAttackChoice（指到牌庫頂那張）', () => {
  assert.ok(D_AFTER, 'D1 沒有產生盤面');
  const act = getAIAction(D_AFTER, pool, 0);
  assert.equal(act?.type, 'ATTACK', JSON.stringify(act));
  assert.equal(act.attackIndex, idxOf(C.slowking, '耀閃挑戰'));
  assert.equal(act.copyAttackChoice?.pokeIid, D_AFTER.players[0].deck[0].iid, '沒有指定借哪一招');
});
T('E2 ⭐ 牌庫頂是靈幽馬、對手戰鬥位剩 120 HP ⇒ 借幻影碎（12 個指示物擊倒）而不是陰森射擊', () => {
  const record = F(DTK, 'recordKnownDeckTop');
  const deck = [inst(C.spectrier), ...fill(10)];
  let st = mk({ active: inst(C.slowking, [psy(), psy()]), deck, oppActiveDamage: 40 });
  st = record(st, 0, [deck[0].iid]);
  if (st === MISSING) throw new Error('recordKnownDeckTop 不存在');
  const act = getAIAction(st, pool, 0);
  assert.equal(act?.type, 'ATTACK', JSON.stringify(act));
  assert.equal(act.copyAttackChoice?.attackIndex, idxOf(C.spectrier, '幻影碎'), '沒有選幻影碎：' + JSON.stringify(act));
});

// ── F 保護牌庫頂與出場順序 ───────────────────────────────────────────────────
T('F1 ⭐ 使者衝刺要在擺牌庫頂之前用：超級袋獸ex 在前、手上有暗碼迷的解讀 ⇒ 先用使者衝刺', () => {
  const st = mk({ active: inst(C.kangaskhan), bench: [inst(C.slowking, [psy(), psy()]), inst(C.latias)],
    hand: [inst(C.cipher)], deck: [...fill(6), inst(C.metagross), ...fill(6)] });
  const act = getAIAction(st, pool, 0);
  assert.equal(act?.type, 'USE_ABILITY', '第一個動作應該是使者衝刺：' + JSON.stringify(act));
});
T('F2 ⭐ 牌庫頂已擺好 ⇒ 不用會把它抽走的使者衝刺；超級袋獸ex 免費撤退換呆呆王（借金屬之錘打得比機關槍合擊好）', () => {
  const record = F(DTK, 'recordKnownDeckTop');
  const deck = [inst(C.metagross), ...fill(10)];
  // 對手戰鬥位＝超級袋獸ex（HP 300）：機關槍合擊 200＋擲幣多半打不倒；耀閃挑戰借金屬之錘（150＋150）剛好擊倒、拿 2 張獎賞
  let st = mk({ active: inst(C.kangaskhan, [psy(), psy(), psy()]), bench: [inst(C.slowking, [psy(), psy()]), inst(C.latias)], deck,
    oppActive: C.kangaskhan });
  st = record(st, 0, [deck[0].iid]);
  if (st === MISSING) throw new Error('recordKnownDeckTop 不存在');
  // 多起點統計（fable 複審）：機關槍合擊的試打擲到 ≥2 次正面時也能擊倒（分數追平）⇒ 單一種子的結果不是確定行為。
  //   12 個起點：使者衝刺 0 次、撤退換呆呆王 ≥ 9 次。
  const K = 12;
  let retreat = 0, ability = 0; const seen = [];
  for (let k = 0; k < K; k++) {
    EVAL.__testResetSimSeed(k);
    const act = getAIAction(st, pool, 0);
    if (act?.type === 'USE_ABILITY') ability++;
    if (act?.type === 'RETREAT' && act.newActiveIid === st.players[0].bench[0].iid) retreat++;
    seen.push(act?.type);
  }
  assert.equal(ability, 0, '不可以用使者衝刺把牌庫頂的巨金怪抽走：' + seen.join(','));
  assert.ok(retreat >= 9, `應該撤退換呆呆王（${K} 個起點只有 ${retreat} 次）：` + seen.join(','));
});

T('F3 ⭐ 牌庫頂已擺好 ⇒ 不打會重洗牌庫的訓練家（寶可平板），直接耀閃挑戰', () => {
  // 寶可平板卡面：「…加入手牌。並且重洗牌庫。」⇒ 打出去牌庫頂的巨金怪就沒了
  assert.ok(/重洗牌庫/.test(pool.get(C.tablet).rulesText ?? ''), '寶可平板卡面變了，請重新查證');
  const record = F(DTK, 'recordKnownDeckTop');
  const build = () => {
    const deck = [inst(C.metagross), inst(C.snorlax), inst(C.snorlax), ...fill(6)];
    const st0 = mk({ active: inst(C.slowking, [psy(), psy()]), hand: [inst(C.tablet)], deck });
    return { st0, deck };
  };
  // 正對照：牌庫頂不知道時，AI 會打寶可平板（否則下面的否定斷言是空真）
  const a = build();
  const actU = getAIAction(a.st0, pool, 0);
  assert.equal(actU?.type === 'PLAY_TRAINER' && actU.iid === a.st0.players[0].hand[0].iid, true, '前置條件：牌庫頂未知時應該打寶可平板：' + JSON.stringify(actU));
  const b = build();
  const st = record(b.st0, 0, [b.deck[0].iid]);
  if (st === MISSING) throw new Error('recordKnownDeckTop 不存在');
  const act = getAIAction(st, pool, 0);
  assert.ok(!(act?.type === 'PLAY_TRAINER' && act.iid === st.players[0].hand[0].iid), '不可以打寶可平板把牌庫頂的巨金怪洗掉：' + JSON.stringify(act));
  assert.equal(act?.type, 'ATTACK', '應該直接耀閃挑戰：' + JSON.stringify(act));
});

T('F4 牌庫頂已擺好時，不會動到牌庫的訓練家（夜間擔架）照常打（F3 的正對照：保護只擋會弄掉牌庫頂的卡）', () => {
  assert.ok(/棄牌區/.test(pool.get(C.stretcher).rulesText ?? '') && !/牌庫/.test(pool.get(C.stretcher).rulesText ?? ''), '夜間擔架卡面變了，請重新查證');
  const record = F(DTK, 'recordKnownDeckTop');
  const deck = [inst(C.metagross), ...fill(8)];
  let st = mk({ active: inst(C.slowking, [psy(), psy()]), hand: [inst(C.stretcher)], deck });
  st = { ...st, players: [{ ...st.players[0], discard: [inst(C.snorlax)] }, st.players[1]] };
  st = record(st, 0, [deck[0].iid]);
  if (st === MISSING) throw new Error('recordKnownDeckTop 不存在');
  const act = getAIAction(st, pool, 0);
  assert.equal(act?.type === 'PLAY_TRAINER' && act.iid === st.players[0].hand[0].iid, true, '應該照常打夜間擔架：' + JSON.stringify(act));
});

T('F5 ⭐ 會耀閃挑戰的寶可夢在備戰、戰鬥位無法免費撤退 ⇒ 暗碼迷的解讀留在手上（擺了下回合開頭就被抽走）', () => {
  // 正對照：備戰多一隻拉帝亞斯ex（天空徑線：基礎寶可夢撤退費 0）⇒ 換得上去 ⇒ 打暗碼迷的解讀
  const build = (withLatias) => mk({ active: inst(C.snorlax), bench: [inst(C.slowking, [psy(), psy()]), ...(withLatias ? [inst(C.latias)] : [])],
    hand: [inst(C.cipher)], deck: [...fill(4), inst(C.metagross), ...fill(6)] });
  const isCipher = (st, a) => a?.type === 'PLAY_TRAINER' && a.iid === st.players[0].hand[0].iid;
  const sOk = build(true);
  assert.equal(isCipher(sOk, getAIAction(sOk, pool, 0)), true, '前置條件：換得上去時應該打暗碼迷的解讀');
  const sNo = build(false);
  const a = getAIAction(sNo, pool, 0);
  assert.equal(isCipher(sNo, a), false, '換不上去還打暗碼迷的解讀：' + JSON.stringify(a));
});

T('F6 ⭐ 牌庫頂已擺好 ⇒ 不附會重洗牌庫的能量（感應【超】能量），改附基本【超】能量', () => {
  // 卡面：「從手牌將這張卡附於【超】寶可夢身上時，從自己的牌庫選擇最多2張【超】屬性的【基礎】寶可夢卡，放置於備戰區。並且重洗牌庫。」
  assert.ok(/並且重洗牌庫/.test(pool.get(C.sensePsy).rulesText ?? ''), '感應【超】能量卡面變了，請重新查證');
  const record = F(DTK, 'recordKnownDeckTop');
  const build = () => {
    const deck = [inst(C.metagross), inst(C.slowking), ...fill(8)];
    return { deck, st: mk({ active: inst(C.slowking, [psy()]), hand: [inst(C.sensePsy), inst(C.psy)], deck }) };
  };
  const setAttach = (st) => ({ ...st, players: [{ ...st.players[0], energyAttachedThisTurn: false }, st.players[1]] });
  // 正對照：牌庫頂未知時，感應【超】能量排在前面 ⇒ 附它（否則下面的否定斷言是空真）
  const u = build(); const su = setAttach(u.st);
  const au = getAIAction(su, pool, 0);
  assert.equal(au?.type === 'ATTACH_ENERGY' && au.energyIid === su.players[0].hand[0].iid, true, '前置條件：牌庫頂未知時應附感應【超】能量：' + JSON.stringify(au));
  const k = build(); let st = setAttach(k.st);
  st = record(st, 0, [k.deck[0].iid]);
  if (st === MISSING) throw new Error('recordKnownDeckTop 不存在');
  const a = getAIAction(st, pool, 0);
  assert.equal(a?.type, 'ATTACH_ENERGY', JSON.stringify(a));
  assert.equal(a.energyIid, st.players[0].hand[1].iid, '牌庫頂已擺好還附感應【超】能量（會重洗牌庫）：' + JSON.stringify(a));
});

T('F7 已知牌庫頂是弱目標（劈斬司令）、戰鬥位的超級袋獸ex 自己就打得倒 ⇒ 直接攻擊，不撤退換呆呆王（撤退要比分數）', () => {
  const record = F(DTK, 'recordKnownDeckTop');
  const deck = [inst(C.kingambit_pre), ...fill(10)];
  let st = mk({ active: inst(C.kangaskhan, [psy(), psy(), psy()]), bench: [inst(C.slowking, [psy(), psy()]), inst(C.latias)], deck });
  st = record(st, 0, [deck[0].iid]);
  if (st === MISSING) throw new Error('recordKnownDeckTop 不存在');
  // 前置條件：這個盤面確實會走到「撤退換呆呆王」的判斷（已知頂借得了、會耀閃挑戰的寶可夢在備戰）
  assert.equal(F(SK, 'hasValuableKnownTop')(st, 0, pool), true, '前置條件：已知牌庫頂應被視為可借');
  const act = getAIAction(st, pool, 0);
  assert.equal(act?.type, 'ATTACK', '應該直接用機關槍合擊（卡比獸 160 HP 必定擊倒）：' + JSON.stringify(act));
});

T('F8 牌庫頂借招打法附能量：能提供【超】的優先（耀閃挑戰要【超】【無】）', () => {
  const st0 = mk({ active: inst(C.slowking), hand: [inst(C.metal), inst(C.psy)], deck: fill(10) });
  const st = { ...st0, players: [{ ...st0.players[0], energyAttachedThisTurn: false }, st0.players[1]] };
  const a = getAIAction(st, pool, 0);
  assert.equal(a?.type, 'ATTACH_ENERGY', JSON.stringify(a));
  assert.equal(a.energyIid, st.players[0].hand[1].iid, '應先附基本【超】能量：' + JSON.stringify(a));
});

T('F9 ⭐「付不付得起」看屬性不看張數：呆呆王身上 2 個【鋼】能量（付不起【超】）⇒ 暗碼迷的解讀留在手上', () => {
  const metal = () => inst(C.metal);
  const build = (en) => mk({ active: inst(C.slowking, en), hand: [inst(C.cipher)], deck: [...fill(4), inst(C.metagross), ...fill(6)] });
  const isCipher = (st, a) => a?.type === 'PLAY_TRAINER' && a.iid === st.players[0].hand[0].iid;
  // 正對照：【超】＋【鋼】付得起 ⇒ 打暗碼迷的解讀
  const sOk = build([psy(), metal()]);
  assert.equal(isCipher(sOk, getAIAction(sOk, pool, 0)), true, '前置條件：付得起時應該打暗碼迷的解讀');
  const sNo = build([metal(), metal()]);
  const a = getAIAction(sNo, pool, 0);
  assert.equal(isCipher(sNo, a), false, '付不起耀閃挑戰還打暗碼迷的解讀：' + JSON.stringify(a));
});

T('F10 （v6.432）備戰的呆呆王要能量、手上只有燃火能量（回合結束就被丟）⇒ 不附給備戰的呆呆王', () => {
  assert.ok(/在自己的回合結束時丟棄/.test(pool.get(C.burn).rulesText ?? ''), '燃火能量卡面變了');
  // ⚠ 呆呆王在戰鬥位時燃火能量可以附（這回合就能用來出招）；在備戰時回合結束就被丟，白附
  const st0 = mk({ active: inst(C.snorlax), bench: [inst(C.slowking)], hand: [inst(C.burn)], deck: fill(10) });
  const st = { ...st0, players: [{ ...st0.players[0], energyAttachedThisTurn: false }, st0.players[1]] };
  const a = getAIAction(st, pool, 0);
  assert.ok(!(a?.type === 'ATTACH_ENERGY' && a.targetIid === st.players[0].bench[0].iid),
    '把燃火能量附給備戰的呆呆王（回合結束就被丟）：' + JSON.stringify(a));
  // 正對照：基本【超】能量會附
  const st2 = { ...st0, players: [{ ...st0.players[0], hand: [inst(C.psy)], energyAttachedThisTurn: false }, st0.players[1]] };
  const a2 = getAIAction(st2, pool, 0);
  assert.ok(a2?.type === 'ATTACH_ENERGY' && a2.targetIid === st2.players[0].bench[0].iid, '正對照：基本【超】能量應該附給備戰的呆呆王：' + JSON.stringify(a2));
});

// ── G B1：試打把自己的選擇視窗解完 ──────────────────────────────────────────
T('G1 ⭐ 吉雉雞ex｜殘酷箭（選對手 1 隻受 100）試打不再停在選擇視窗、傷害 > 0', () => {
  const st = mk({ active: inst(C.genesect, [psy(), psy(), psy()]), deck: fill(10) });
  const ev = EVAL.evaluateAttack(st, 0, idxOf(C.genesect, '殘酷箭'), pool);
  assert.ok(ev.ok, '試打失敗');
  assert.equal(ev.unresolved, false, '仍停在選擇視窗（unresolved）');
  assert.ok(ev.oppDamage >= 100, `對手受到的傷害 ${ev.oppDamage}（應 ≥ 100）`);
});

T('G2 ⭐ 對手要做的選擇一律不代答：哈約克｜吼叫（[由對手選擇放置於戰鬥場的寶可夢]）試打停在對手的選擇視窗', () => {
  // 卡面：「將對手的戰鬥寶可夢與備戰寶可夢互換。[由對手選擇放置於戰鬥場的寶可夢。]」
  assert.ok(/由對手選擇放置於戰鬥場的寶可夢/.test(pool.get(C.noctowl).attacks.find((a) => a.name === '吼叫')?.effect ?? ''), '吼叫卡面變了，請重新查證');
  // 前置條件：真流程下吼叫確實開出「對手的」選擇視窗（否則下面的否定斷言是空真）
  const st = mk({ active: inst(C.noctowl, [psy()]), deck: fill(10) });
  const real = applyAction(st, { type: 'ATTACK', attackIndex: idxOf(C.noctowl, '吼叫') }, pool);
  assert.equal(real.pendingSelection?.actorIdx, 1, '前置條件：吼叫之後應該是對手的選擇視窗');
  const ev = EVAL.evaluateAttack(st, 0, idxOf(C.noctowl, '吼叫'), pool);
  assert.ok(ev.ok, '試打失敗');
  assert.equal(ev.unresolved, true, '試打替對手做了選擇（應該停在對手的視窗、回報 unresolved）');
});

// ── H 其他牌組不受影響 ───────────────────────────────────────────────────────
T('H1 沒有耀閃挑戰的一方不算「牌庫頂借招」打法', () => {
  const f = F(SK, 'isTopCopyPlayer');
  const st = mk({ active: inst(C.genesect, [psy()]), deck: fill(10) });
  const r = f(st, 0, pool);
  assert.notEqual(r, MISSING, 'isTopCopyPlayer 不存在');
  assert.equal(r, false);
  const st2 = mk({ active: inst(C.slowking), deck: fill(10) });
  assert.equal(f(st2, 0, pool), true, '正對照：呆呆王在場要算');
});

console.log(`\n=== v6.429 呆呆王牌庫頂借招：PASS ${pass} / FAIL ${fail} ===`);
if (fail) { console.log('紅的：' + failed.join('、')); process.exit(1); }
