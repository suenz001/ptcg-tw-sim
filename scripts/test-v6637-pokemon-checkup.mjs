import assert from 'node:assert/strict';
import { assertFunctionsMatchBase } from './lib/function-baseline.mjs';
/** v6.637：官方進階規則 F／D／E-04；H/I/J 卡面。固定狀態區、結果有差才問順序、最後同時昏厥。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { extractBaseArchive } from './lib/base-archive.mjs';
import { hasBaseCommit, shallowSkip } from './lib/base-blob.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE = '8b20625968b757407612f3937689f3f352cf6538';
const dirs = [];
process.on('exit', () => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
let passed = 0, failed = 0;
const check = (label, condition, details = '') => { console.log(`  ${condition ? 'PASS' : 'FAIL'} ${label}${condition ? '' : ' ' + details}`); condition ? passed++ : failed++; };
async function load(src) {
  const dir = mkdtempSync(join(tmpdir(), 'v6637-')); dirs.push(dir);
  const out = join(dir, 'engine.mjs');
  await build({ stdin: { contents: `export {applyAction,createGame} from '${src.replaceAll('\\', '/')}/src/lib/game/engine'; export {actionResponsibility} from '${src.replaceAll('\\', '/')}/src/lib/game/action-responsibility'; export {timeoutAction} from '${src.replaceAll('\\', '/')}/src/lib/game/timeout-action'; export {getAIAction} from '${src.replaceAll('\\', '/')}/src/lib/game/ai';`, resolveDir: ROOT, loader: 'ts' },
    outfile: out, bundle: true, format: 'esm', platform: 'node', target: 'node20', logLevel: 'error',
    alias: { $lib: join(src, 'src/lib') }, nodePaths: [join(ROOT, 'node_modules')],
    plugins: [{ name: 'paths', setup(b) { b.onResolve({ filter: /^\$app\/paths$/ }, () => ({ path: 'paths', namespace: 'stub' })); b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const base="";export const assets="";' })); } }] });
  return import(pathToFileURL(out).href);
}
const cardDir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(cardDir, 'index.json'), 'utf8')).map(x => x.code));
const pool = new Map();
for (const f of readdirSync(cardDir)) if (live.has(f.replace(/\.json$/, ''))) {
  for (const c of JSON.parse(readFileSync(join(cardDir, f), 'utf8'))) pool.set(String(c.id), { ...c, name: c.name.replace(/[<>＜＞‌]/g, '') });
}
const all = [...pool.values()].filter(c => ['H', 'I', 'J'].includes(c.regulationMark));
const abilityCard = name => { const c = all.find(c => c.abilities?.some(a => a.name === name)); if (!c) throw Error(name); return c; };
const SNOR = pool.get('20007'), POISON = pool.get('16961'), FROST = pool.get('10447'), SAND = pool.get('12800');
const YVEL = abilityCard('生命制約'), KISS = abilityCard('奇跡之吻');
const PLAIN = all.find(c => c.supertype === 'Pokemon' && c.stage === 'Basic' && !c.name.endsWith('ex') && !c.abilities?.length && c.hp >= 120);
const ENERGY = [...pool.values()].find(c => c.supertype === 'Energy' && c.subtype === 'Basic');
const TRENCH = all.find(c => c.name === '傳說的海溝'), TOWER = all.find(c => c.name === '火箭隊的監視塔');
let seq = 0;
const inst = (c, extra = {}) => ({ iid: `c6637-${++seq}`, cardId: String(c.id), damage: 0, energyAttached: [], ...extra });
const fill = n => Array.from({ length: n }, () => inst(ENERGY));
const p = (x = {}) => ({ name: '玩家', active: inst(PLAIN), bench: [inst(PLAIN)], deck: fill(12), hand: [], discard: [], prizes: fill(6), abilityNamesUsedThisTurn: [], ...x });
const game = (x = {}, y = {}, extra = {}) => ({ phase: 'playing', turnPhase: 'main', turn: 5, activePlayerIndex: 0, firstPlayerIdx: 0,
  isFirstTurn: false, players: [p({ name: '甲', ...x }), p({ name: '乙', ...y })], log: [], setupDone: [true, true], pendingPrizes: [0, 0], pendingMulliganDraw: [0, 0], ...extra });
const logs = s => s.log.map(x => x.message).join('\n');
function run(M) {
  const result = {};
  const act = (s, a, heads = false) => { const prev = Math.random; Math.random = () => heads ? 0.1 : 0.9; try { return M.applyAction(s, a, pool); } finally { Math.random = prev; } };
  const end = (s, h) => act(s, { type: 'END_TURN' }, h);
  const normal = end(game());
  result.noEffects = normal.phase === 'playing' && normal.activePlayerIndex === 1 && normal.players[1].hand.length === 1
    && normal.players.every(p => p.active.damage === 0 && p.prizes.length === 6) && !normal.pokemonCheckup && !normal.pendingSelection;
  const pick = (s, id, h = false, overrides = {}) => act(s, { type: 'RESOLVE_SELECTION', selectedIids: [id], actorIdx: s.pendingSelection?.actorIdx, pendingToken: s.pendingSelection?.token, ...overrides }, h);
  const finish = (s, order = [], heads = false) => {
    for (let n = 0; n < 30 && s.pendingSelection?.effectKey === 'v6637-checkup-order'; n++) {
      const opts = s.pendingSelection.params.options;
      const kind = order.shift() ?? 'status';
      const opt = opts.find(x => x.id.startsWith(kind)) ?? opts[0];
      s = pick(s, opt.id, heads);
    }
    return s;
  };
  for (const seat of [0, 1]) for (const bench of [false, true]) {
    const s = game({ active: inst(POISON, { damage: 20, status: 'poisoned' }), bench: bench ? [inst(PLAIN)] : [] },
      { active: inst(POISON, { damage: 20, status: 'poisoned' }), bench: bench ? [inst(PLAIN)] : [] }, { activePlayerIndex: seat });
    const before = JSON.stringify(s), r = end(s);
    result[`mirror-${seat}-${bench}`] = !r.players[0].active && !r.players[1].active && r.players.every(p => p.prizes.length === 5)
      && (bench ? r.phase === 'playing' && r.endTurnContinueAfterKO === seat : r.isDraw === true);
    result[`pure-${seat}-${bench}`] = JSON.stringify(s) === before;
    if (bench) {
      const firstSeat = 1 - seat;
      const q = act(r, { type: 'SEND_NEW_ACTIVE', senderIdx: firstSeat, iid: r.players[firstSeat].bench[0].iid });
      const after = act(q, { type: 'SEND_NEW_ACTIVE', senderIdx: seat, iid: q.players[seat].bench[0].iid });
      result[`promote-${seat}`] = !!after.players[0].active && !!after.players[1].active && after.activePlayerIndex === 1 - seat
        && after.players.every(p => p.active.damage === 0) && after.players[1 - seat].hand.length === 2;
    }
  }
  for (const heads of [false, true]) for (const blocked of [false, true]) {
    const r = end(game({ active: inst(SNOR, { damage: 150, status: 'asleep', secondaryStatus: 'poisoned' }) },
      { bench: [inst(blocked ? YVEL : PLAIN)] }), heads);
    result[`sleep-${heads}-${blocked}`] = heads || blocked ? !r.players[0].active && r.players[1].prizes.length === 5
      : r.players[0].active?.damage === 0 && r.players[1].prizes.length === 6;
  }
  const orderGame = (extra = {}, sleeper = {}) => game({ active: inst(SAND), bench: [inst(FROST)] },
    { active: inst(SNOR, { damage: 100, status: 'asleep', ...sleeper }) }, extra);
  const first = end(orderGame());
  result.orderPrompt = first.pendingSelection?.actorIdx === 1 && first.activePlayerIndex === 0 && first.turnPhase === 'end'
    && !logs(first).includes('擲硬幣') && JSON.stringify(M.actionResponsibility(first)) === '[1]';
  for (const [order, damage] of [[['frost', 'sand', 'status'], 0], [['status'], 30], [['frost', 'status'], 20], [['sand', 'status'], 10]]) {
    const r = finish(end(orderGame()), [...order]);
    result[`order-${order.join('-')}`] = r.players[1].active?.damage === damage && r.activePlayerIndex === 1 && !r.pokemonCheckup;
  }
  for (const order of [['status'], ['frost', 'sand', 'status']]) {
    const r = finish(end(orderGame({ activeStadium: inst(TRENCH) })), [...order]);
    result[`trench-${order[0]}`] = r.players[1].active?.damage === (order[0] === 'status' ? 30 : 0) && r._checkupHealsHandled === undefined;
  }
  const zero = finish(end(orderGame({}, { damage: 0 })), ['status']);
  result.zeroDamageStillChoice = zero.players[1].active?.damage === 30;
  result.damageOnlyNoPrompt = !end(orderGame({}, { status: undefined })).pendingSelection;
  result.nullifiedNoPrompt = !end(orderGame({ activeStadium: inst(TOWER) })).pendingSelection;
  const block = game({ active: inst(SAND), bench: [inst(FROST), inst(YVEL)] }, { active: inst(SNOR, { damage: 100, status: 'asleep' }) });
  const blocked = end(block);
  result.healBlockNoPrompt = !blocked.pendingSelection && blocked.players[1].active?.damage === 130;
  const blockedPoison = end(game({ active: inst(SNOR, { damage: 100, status: 'asleep', secondaryStatus: 'poisoned' }) }, { bench: [inst(YVEL)] }));
  result.blockedPoisonBaseline = blockedPoison.players[0].active?.damage === 110;
  const endingHeal = end(game({ active: inst(SNOR, { damage: 100, status: 'asleep' }) }));
  result.endingHealFlag = endingHeal.players[0].active?.healedThisTurn === true;
  const later = end(end(endingHeal, true), true);
  result.healFlagExpires = later.players[0].active?.healedThisTurn !== true;
  const multi = game({ bench: [inst(FROST), inst(FROST)] }, { active: inst(SNOR, { status: 'asleep' }) });
  const split = finish(end(multi), ['frost', 'status']);
  result.splitSources = split.players[1].active?.damage === 10;
  const aggregate = end(game({ bench: [inst(FROST), inst(FROST)] }, { active: inst(KISS) }));
  result.commutingBatch = aggregate.players[1].active?.damage === 20 && aggregate.log.filter(l => l.message.startsWith('冰冷之帳：')).length === 1;
  const almost = end(orderGame({}, { damage: 150 }));
  const fro = almost.pendingSelection?.params.options.find(x => x.id.startsWith('frost'));
  const waiting = fro ? pick(almost, fro.id) : almost;
  result.hpZeroRetained = waiting.players[1].active?.damage === 160 && waiting.pendingSelection?.actorIdx === 1
    && waiting.players[0].prizes.length === 6 && waiting.players[1].discard.length === 0;
  const roundtrip = JSON.parse(JSON.stringify(waiting));
  const done = finish(roundtrip, ['sand', 'status']);
  result.reconnect = done.players[1].active?.damage === 0 && done.activePlayerIndex === 1;
  if (first.pendingSelection) {
    const opt = first.pendingSelection.params.options[0].id;
    const wrong = pick(first, opt, false, { senderIdx: 0 });
    result.wrongActor = JSON.stringify(wrong.pokemonCheckup) === JSON.stringify(first.pokemonCheckup) && wrong.pendingSelection?.token === first.pendingSelection.token;
    const stale = pick(first, opt, false, { pendingToken: first.pendingSelection.token - 1 });
    result.staleToken = JSON.stringify(stale.pokemonCheckup) === JSON.stringify(first.pokemonCheckup) && stale.pendingSelection?.token === first.pendingSelection.token;
    let bad = first; for (let n = 0; n < 5; n++) bad = pick(bad, 'invalid');
    result.invalidNeverConsumes = bad.pokemonCheckup?.remaining.length === first.pokemonCheckup.remaining.length && !!bad.pendingSelection;
    const ai = M.getAIAction(first, pool, 1);
    result.ai = ai?.type === 'RESOLVE_SELECTION' && first.pendingSelection.params.options.some(o => o.id === ai.selectedIids[0]);
    const timed = M.timeoutAction(first, pool, 1);
    const completed = timed ? act(first, timed) : first;
    result.timeout = M.timeoutAction(first, pool, 0) === null && timed?.senderIdx === 1
      && completed.activePlayerIndex === 1 && completed.players[1].active?.damage === 30;
  } else { result.wrongActor = result.staleToken = result.invalidNeverConsumes = result.ai = false; }
  const kiss = end(game({ active: inst(KISS, { damage: KISS.hp - 10, status: 'poisoned' }) },
    { active: inst(PLAIN, { damage: PLAIN.hp - 10, status: 'poisoned' }) }));
  result.simultaneousKissSource = logs(kiss).includes('奇跡之吻') && kiss.players.every(p => !p.active);
  const kissHeads = end(game({ active: inst(KISS, { damage: KISS.hp - 10, status: 'poisoned' }) },
    { active: inst(PLAIN, { damage: PLAIN.hp - 10, status: 'poisoned' }) }), true);
  result.kissExtraPrize = kissHeads.players[0].prizes.length === 4 && kissHeads.players[1].prizes.length === 5;
  // 正面獎賞暫停：雙方完成所有檢查後才領獎／補位，JSON重連與重送不增加傷害／獎賞。
  let face = game({ active: inst(POISON, { damage: 20, status: 'poisoned' }) }, { active: inst(POISON, { damage: 20, status: 'poisoned' }) });
  face.players = face.players.map(p => ({ ...p, prizes: p.prizes.map((c, i) => i === 0 ? { ...c, faceUp: true } : c) }));
  let prizes = end(face);
  for (let n = 0; n < 10 && prizes.pendingSelection; n++) {
    const sel = prizes.pendingSelection;
    const id = sel.params?.options?.[0]?.id ?? 'random';
    prizes = pick(JSON.parse(JSON.stringify(prizes)), id, false, { senderIdx: sel.actorIdx });
  }
  result.faceUpPrizeChain = !prizes.pendingSelection && prizes.players.every(p => !p.active && p.prizes.length === 5 && p.hand.length === 1)
    && prizes.endTurnContinueAfterKO === 0;
  // 既有缺口：只有備戰昏厥也要先領完獎賞，不能讓下一位先抽空牌而把勝負判反。
  const lastPrize = [{ ...inst(ENERGY), faceUp: true }];
  const benchOnly = end(game({ bench: [inst(KISS, { damage: KISS.hp - 10 })] },
    { bench: [inst(FROST)], prizes: lastPrize, deck: [] }));
  result.benchPrizeWait = benchOnly.phase === 'playing' && benchOnly.activePlayerIndex === 0
    && benchOnly.pendingSelection?.actorIdx === 1 && benchOnly.players[1].hand.length === 0;
  const prizeId = benchOnly.pendingSelection?.params?.options?.[0]?.id ?? 'random';
  const prizeWin = benchOnly.pendingSelection ? pick(benchOnly, prizeId, false, { senderIdx: 1 }) : benchOnly;
  result.prizeWinsBeforeDeckOut = prizeWin.phase === 'game-over' && prizeWin.winner === 1
    && prizeWin.players[1].prizes.length === 0 && !logs(prizeWin).includes('無法抽牌');
  let bothBench = end(game({ bench: [inst(FROST), inst(KISS, { damage: KISS.hp - 20 })], prizes: [{ ...inst(ENERGY), faceUp: true }, ...fill(5)] },
    { bench: [inst(FROST), inst(KISS, { damage: KISS.hp - 20 })], prizes: [{ ...inst(ENERGY), faceUp: true }, ...fill(5)] }));
  const beforeBoth = bothBench.activePlayerIndex === 0 && bothBench.players.every(p => p.hand.length === 0);
  let waitedBetween = false;
  for (let n = 0; n < 6 && bothBench.pendingSelection; n++) {
    bothBench = pick(bothBench, bothBench.pendingSelection.params?.options?.[0]?.id ?? 'random');
    if (bothBench.pendingSelection) waitedBetween = bothBench.activePlayerIndex === 0 && bothBench.players.every(p => p.deck.length === 12);
  }
  result.bothBenchPrizesBeforeDraw = beforeBoth && waitedBetween && !bothBench.pendingSelection
    && bothBench.activePlayerIndex === 1 && bothBench.players[0].hand.length === 1 && bothBench.players[1].hand.length === 2
    && bothBench.players.every(p => p.prizes.length === 5);
  return result;
}
// Rule54：顯示功能的舊範圍鎖改為函式級，合法檢查流程變動可通過，相關函式變動仍拒絕。
const pinBase = "function countEnergy() { return 1; }\nfunction unrelated() { return 0; }";
let pinGood = false;
try { assertFunctionsMatchBase(pinBase.replace('return 0', 'return 2'), pinBase, ['countEnergy']); pinGood = true; } catch {}
check('函式級pin正對照：無關函式可改', pinGood);
let pinBad = 0;
for (const text of [pinBase.replace('return 1', 'return 2'), 'function unrelated() {}', pinBase + '\nfunction countEnergy() {}']) {
  try { assert.throws(() => assertFunctionsMatchBase(text, pinBase, ['countEnergy'])); pinBad++; } catch {}
}
check('函式級pin拒絕行為突變／缺失／重複', pinBad === 3);
const srcArg = process.argv.find(a => a.startsWith('--src-root='));
const current = await load(srcArg ? srcArg.slice('--src-root='.length) : ROOT);
const outcomes = run(current);
for (const [name, condition] of Object.entries(outcomes)) check(name, condition);
if (!process.argv.includes('--no-base')) {
  if (hasBaseCommit(ROOT, BASE)) {
    const baseDir = mkdtempSync(join(tmpdir(), 'v6637-base-')); dirs.push(baseDir);
    extractBaseArchive(ROOT, BASE, ['src'], baseDir);
    const old = run(await load(baseDir));
    for (const name of ['mirror-0-false', 'mirror-1-true', 'sleep-false-false', 'orderPrompt', 'order-frost-sand-status', 'hpZeroRetained', 'splitSources', 'benchPrizeWait', 'prizeWinsBeforeDeckOut', 'bothBenchPrizesBeforeDraw']) check(`HEAD-FAIL ${name}`, old[name] === false);
    for (const name of ['pure-0-false', 'sleep-true-false', 'sleep-false-true', 'damageOnlyNoPrompt', 'nullifiedNoPrompt']) check(`正對照 BASE/HEAD ${name}`, old[name] === true && outcomes[name] === true);
  } else shallowSkip('v6637 HEAD-FAIL', '需要 v6.636 BASE');
}
console.log(`v6.637 寶可夢檢查：${passed} PASS / ${failed} FAIL`);
if (failed) process.exitCode = 1;
