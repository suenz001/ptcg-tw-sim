// v6.635 守衛：v6.634 審查 P3 兩項既有小問題（站長：「有發現問題就修吧」）
//
// ① 共用 resolver bench-from-discard-samename（刺龍王ex｜王之號召、暴飛龍ex｜轟鳴呼聲、鳳王｜復生火焰、
//    夜巡靈｜前往渡魂 等同名系列）的對戰紀錄把「條件描述」套進引號：
//    「王之號召：從棄牌區放置 2 張「【水】寶可夢」到備戰（…）」⇒ 改成一律列實際卡名。
//    同一支 resolver 補再驗 params.validIids（卡面條件），不只靠 engine 消毒閘。
// ② v311-deck-peek-basic-to-bench（米立龍ex｜硃砂誘餌、人造細胞卵｜傳喚之門）resolver 沒有再驗備戰空位
//    ⇒ 補上；超出空位的留在牌庫一起重洗（不丟卡）。
//
// 【A】王之號召完整流程：log 措辭、正常放置
// 【B】直呼 resolver：偽造 validIids 外的卡 ⇒ 不收（留在棄牌區）；正對照 validIids 內 ⇒ 收
// 【C】硃砂誘餌：開視窗後備戰被補到只剩 1 格，送 2 隻 ⇒ 只放 1 隻、另 1 隻留在牌庫、牌庫張數守恆
// 【D】審查 P3：備戰超過上限／剛好滿的 log、零之大空洞上限 8 與牌庫順序
// 【H】HEAD-FAIL：BASE（v6.634）引擎跑 A1／B1／C1／D1 ⇒ 紅
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hasBaseCommit, shallowSkip } from './lib/base-blob.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = 'f2ef96b2';   // v6.634（本版的上一版）
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + String(x).slice(0, 500) : '')); } };

async function loadEngine(srcRoot, tag) {
  const S = join(srcRoot, `.v6635${tag}-s.js`), E = join(srcRoot, `.v6635${tag}-e.ts`), O = join(srcRoot, `.v6635${tag}-o.mjs`);
  process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* noop */ } } });
  writeFileSync(S, 'export const base="";export const assets="";');
  writeFileSync(E, "export { applyAction } from './src/lib/game/engine';\nexport * as SH from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';\n");
  await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
    alias: { $lib: join(srcRoot, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
  return import(pathToFileURL(O).href);
}

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map(); const all = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) { if (c?.id == null) continue; pool.set(String(c.id), c); all.push(c); }
}
const byId = (id) => { const c = pool.get(String(id)); if (!c) throw new Error('卡池抓不到 id ' + id); return c; };
const H = ['H', 'I', 'J'];
const KINGDRA = byId('10594'), MIRAIDON_LIKE = byId('11261');   // 刺龍王ex（王之號召）、米立龍ex（硃砂誘餌）
const WATER_A = all.find((c) => c.supertype === 'Pokemon' && c.stage === 'Basic' && c.pokemonType === 'Water' && H.includes(c.regulationMark) && !(c.abilities || []).length);
const WATER_B = all.find((c) => c.supertype === 'Pokemon' && c.stage === 'Basic' && c.pokemonType === 'Water' && H.includes(c.regulationMark) && !(c.abilities || []).length && c.name !== WATER_A.name);
const FIRE = all.find((c) => c.supertype === 'Pokemon' && c.stage === 'Basic' && c.pokemonType === 'Fire' && H.includes(c.regulationMark) && !(c.abilities || []).length);
const PLAIN = all.find((c) => c.supertype === 'Pokemon' && c.stage === 'Basic' && !(c.abilities || []).length && c.pokemonType === 'Colorless' && H.includes(c.regulationMark) && Number(c.hp) >= 60);
const TRAINER = all.find((c) => c.supertype === 'Trainer' && c.subtype === 'Item' && H.includes(c.regulationMark));
const EN = (zh) => all.find((c) => c.supertype === 'Energy' && c.name === `基本【${zh}】能量`);
const ENERGY = { Fire: EN('火'), Water: EN('水'), Darkness: EN('惡'), Colorless: EN('水') };

let nn = 0;
const inst = (cid, extra = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], abilityUsedThisTurn: false,
  evolvedThisTurn: false, playedFromHand: false, movedToActiveThisTurn: false, evolvedFromStack: [], ...extra });
const filler = (n) => Array.from({ length: n }, () => inst(TRAINER.id));
const P = (o = {}) => ({ name: 'P', active: null, bench: [], hand: [], deck: filler(10), discard: [],
  prizes: Array.from({ length: 6 }, () => inst(PLAIN.id)), abilityNamesUsedThisTurn: [], ...o });
const mk = (p0, p1) => ({ phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 7, isFirstTurn: false, log: [],
  pendingSelection: null, setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], coinFlippedThisAttack: false,
  _attackerActiveBonusDone: false, activeStadium: null, activeStadiumOwnerIdx: 0, players: [P({ name: 'A', ...p0 }), P({ name: 'B', ...p1 })] });
const energyFor = (card, atk) => (card.attacks.find((a) => a.name === atk).cost || []).map((t) => inst((ENERGY[t] || ENERGY.Water).id));
const VOID = all.find((c) => c.name === '零之大空洞');
const TERA = all.find((c) => c.supertype === 'Pokemon' && (c.tags || []).includes('太晶') && H.includes(c.regulationMark));
const msgs = (s) => (s?.log ?? []).map((l) => (typeof l === 'string' ? l : l?.message ?? l?.text ?? '')).filter(Boolean);

function run(M) {
  const act = (st, a) => { try { return M.applyAction(st, a, pool); } catch (e) { return { __err: e.message, players: st.players, log: [] }; } };
  const out = {};
  // 【A】王之號召
  { const a = inst(WATER_A.id), b = inst(WATER_B.id);
    const st = mk({ active: inst(KINGDRA.id, { energyAttached: energyFor(KINGDRA, '王之號召') }), discard: [a, b] }, { active: inst(PLAIN.id) });
    const r = act(st, { type: 'ATTACK', attackIndex: KINGDRA.attacks.findIndex((x) => x.name === '王之號召') });
    const r2 = r?.pendingSelection ? act(r, { type: 'RESOLVE_SELECTION', selectedIids: [a.iid, b.iid], actorIdx: 0 }) : r;
    const line = msgs(r2).find((m) => m.startsWith('王之號召：從棄牌區放置')) ?? '';
    out.A = { line, benched: (r2?.players?.[0]?.bench ?? []).length, pend: r?.pendingSelection?.effectKey }; }
  // 【B】直呼 resolver：validIids 只有 a，偽造送 a＋fire
  { const a = inst(WATER_A.id), f = inst(FIRE.id);
    const st = mk({ active: inst(PLAIN.id), discard: [a, f] }, { active: inst(PLAIN.id) });
    const fn = M.SH.RESOLVERS.get('bench-from-discard-samename');
    let r = null; try { r = fn(st, 0, [a.iid, f.iid], { validIids: [a.iid], targetName: '【水】寶可夢', label: '王之號召' }, pool); } catch (e) { r = { __err: e.message }; }
    const bench = (r?.players?.[0]?.bench ?? []).map((x) => x.iid);
    out.B = { err: r?.__err, aOn: bench.includes(a.iid), fOn: bench.includes(f.iid), fInDiscard: (r?.players?.[0]?.discard ?? []).some((x) => x.iid === f.iid) }; }
  // 【C】硃砂誘餌：開視窗時備戰 0 隻；之後（模擬舊 pending／空位變少）備戰被補到 4 隻，送 2 隻
  { const x = inst(WATER_A.id), y = inst(FIRE.id);
    const st = mk({ active: inst(MIRAIDON_LIKE.id, { energyAttached: energyFor(MIRAIDON_LIKE, '硃砂誘餌') }), deck: [x, y, ...filler(8)] }, { active: inst(PLAIN.id) });
    const r = act(st, { type: 'ATTACK', attackIndex: MIRAIDON_LIKE.attacks.findIndex((q) => q.name === '硃砂誘餌') });
    const ps = r?.pendingSelection;
    const fn = M.SH.RESOLVERS.get('v311-deck-peek-basic-to-bench');
    const crowded = { ...r, pendingSelection: null, players: [{ ...r.players[0], bench: [inst(PLAIN.id), inst(PLAIN.id), inst(PLAIN.id), inst(PLAIN.id)] }, r.players[1]] };
    let r2 = null; try { r2 = fn(crowded, 0, [x.iid, y.iid], ps?.params, pool); } catch (e) { r2 = { __err: e.message }; }
    const p0 = r2?.players?.[0];
    const deckBefore = crowded.players[0].deck.length;
    out.C = { err: r2?.__err, bench: p0?.bench?.length, deckOk: p0 ? p0.deck.length + (p0.bench.length - 4) === deckBefore : false,
      lost: p0 ? ![x, y].every((c) => p0.deck.some((d) => d.iid === c.iid) || p0.bench.some((d) => d.iid === c.iid)) : true, key: ps?.effectKey };
    // 正對照：空位足夠 ⇒ 兩隻都放
    let r3 = null; try { r3 = fn({ ...r, pendingSelection: null }, 0, [x.iid, y.iid], ps?.params, pool); } catch (e) { r3 = { __err: e.message }; }
    out.C2 = { err: r3?.__err, bench: r3?.players?.[0]?.bench?.length }; }
  // 【D】審查 P3：備戰已超過上限／已滿、零之大空洞上限 8 與牌庫順序
  { const fn = M.SH.RESOLVERS.get('bench-from-discard-samename');
    const a = inst(WATER_A.id), b = inst(WATER_B.id);
    const over = mk({ active: inst(PLAIN.id), bench: Array.from({ length: 6 }, () => inst(PLAIN.id)), discard: [a, b] }, { active: inst(PLAIN.id) });
    let r = null; try { r = fn(over, 0, [a.iid, b.iid], { validIids: [a.iid, b.iid], label: '王之號召' }, pool); } catch (e) { r = { __err: e.message }; }
    out.D1 = { err: r?.__err, bench: r?.players?.[0]?.bench?.length, inDiscard: (r?.players?.[0]?.discard ?? []).length, line: msgs(r).slice(-1)[0] ?? '' };
    const full = mk({ active: inst(PLAIN.id), bench: Array.from({ length: 5 }, () => inst(PLAIN.id)), discard: [a, b] }, { active: inst(PLAIN.id) });
    let r2 = null; try { r2 = fn(full, 0, [a.iid], { validIids: [a.iid, b.iid], label: '王之號召' }, pool); } catch (e) { r2 = { __err: e.message }; }
    out.D2 = { err: r2?.__err, bench: r2?.players?.[0]?.bench?.length, line: msgs(r2).slice(-1)[0] ?? '' }; }
  { const x = inst(WATER_A.id), y = inst(FIRE.id), z = inst(WATER_B.id);
    const st = mk({ active: inst(MIRAIDON_LIKE.id, { energyAttached: energyFor(MIRAIDON_LIKE, '硃砂誘餌') }), deck: [x, y, z, ...filler(7)] }, { active: inst(PLAIN.id) });
    const r = act(st, { type: 'ATTACK', attackIndex: MIRAIDON_LIKE.attacks.findIndex((q) => q.name === '硃砂誘餌') });
    const ps = r?.pendingSelection;
    const fn = M.SH.RESOLVERS.get('v311-deck-peek-basic-to-bench');
    // 零之大空洞＋場上有太晶 ⇒ 上限 8；備戰 6 隻 ⇒ 空位 2；送 z、x、y（payload 順序故意打亂）⇒ 依牌庫上方順序放 x、y
    const v = { ...r, pendingSelection: null, activeStadium: inst(VOID.id), activeStadiumOwnerIdx: 0,
      players: [{ ...r.players[0], bench: [inst(TERA.id), ...Array.from({ length: 5 }, () => inst(PLAIN.id))] }, r.players[1]] };
    let r2 = null; try { r2 = fn(v, 0, [z.iid, x.iid, y.iid], ps?.params, pool); } catch (e) { r2 = { __err: e.message }; }
    const bench = (r2?.players?.[0]?.bench ?? []).map((q) => q.iid);
    out.D3 = { err: r2?.__err, n: bench.length, x: bench.includes(x.iid), y: bench.includes(y.iid), zDeck: (r2?.players?.[0]?.deck ?? []).some((q) => q.iid === z.iid) };
    const full = { ...r, pendingSelection: null, players: [{ ...r.players[0], bench: Array.from({ length: 5 }, () => inst(PLAIN.id)) }, r.players[1]] };
    let r3 = null; try { r3 = fn(full, 0, [x.iid], ps?.params, pool); } catch (e) { r3 = { __err: e.message }; }
    out.D4 = { err: r3?.__err, n: r3?.players?.[0]?.bench?.length, line: msgs(r3).slice(-1)[0] ?? '' }; }
  return out;
}

console.log('【A～C】本版');
const CUR = run(await loadEngine(ROOT, 'c'));
ok('★★★ A1 王之號召的 log 列實際卡名、不再把條件描述套進引號', /^王之號召：從棄牌區放置 2 張到備戰區（/.test(CUR.A.line) && CUR.A.line.includes(WATER_A.name) && !CUR.A.line.includes('「【水】寶可夢」'), CUR.A.line);
ok('★★ A2 正對照：王之號召照常把 2 隻【水】放上備戰', CUR.A.benched === 2 && CUR.A.pend === 'bench-from-discard-samename', JSON.stringify(CUR.A));
ok('★★★ B1 直呼 resolver 偽造 validIids 外的【火】⇒ 不收、留在棄牌區', !CUR.B.err && !CUR.B.fOn && CUR.B.fInDiscard, JSON.stringify(CUR.B));
ok('★★ B2 正對照：validIids 內的照收', CUR.B.aOn === true, JSON.stringify(CUR.B));
ok('★★★ C1 硃砂誘餌：備戰只剩 1 格時送 2 隻 ⇒ 只放 1 隻、另一隻留在牌庫（卡不會不見、不會超過上限）', !CUR.C.err && CUR.C.bench === 5 && CUR.C.deckOk && !CUR.C.lost && CUR.C.key === 'v311-deck-peek-basic-to-bench', JSON.stringify(CUR.C));
ok('★★ C2 正對照：空位足夠 ⇒ 兩隻都放', !CUR.C2.err && CUR.C2.bench === 2, JSON.stringify(CUR.C2));

ok('★★★ D1 棄牌區 resolver：備戰已超過上限（6 隻）⇒ 一張都不放、兩張都留在棄牌區', !CUR.D1.err && CUR.D1.bench === 6 && CUR.D1.inDiscard === 2, JSON.stringify(CUR.D1));
ok('★★ D2 棄牌區 resolver：備戰剛好滿 ⇒ log 寫「備戰區已滿」、不出現空括號', CUR.D2.bench === 5 && /備戰區已滿/.test(CUR.D2.line) && !/（）/.test(CUR.D2.line), JSON.stringify(CUR.D2));
ok('★★★ D3 硃砂誘餌：零之大空洞＋太晶上限 8、空位 2 ⇒ 依牌庫上方順序放 2 隻，第 3 隻留在牌庫', !CUR.D3.err && CUR.D3.n === 8 && CUR.D3.x && CUR.D3.y && CUR.D3.zDeck, JSON.stringify(CUR.D3));
ok('★★ D4 硃砂誘餌：備戰已滿卻送了卡 ⇒ log 寫「備戰區已滿」（不是「未選擇」）', CUR.D4.n === 5 && /備戰區已滿/.test(CUR.D4.line), JSON.stringify(CUR.D4));

console.log('【H】HEAD-FAIL');
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('H（缺 BASE ' + BASE_SHA + '）');
else {
  const tmp = mkdtempSync(join(tmpdir(), 'v6635-base-'));
  try {
    execFileSync('bash', ['-c', `git -C "${ROOT}" archive ${BASE_SHA} src | tar -x -C "${tmp}"`]);
    const B = run(await loadEngine(tmp, 'b'));
    ok('★★★ H1 BASE（v6.634）的 log 把「【水】寶可夢」套進引號', B.A.line.includes('「【水】寶可夢」'), B.A.line);
    ok('★★★ H2 BASE 直呼 resolver 會收 validIids 外的卡', B.B.fOn === true, JSON.stringify(B.B));
    ok('★★★ H3 BASE 硃砂誘餌 resolver 會放超過備戰上限', B.C.bench === 6, JSON.stringify(B.C));
    ok('★★ H5 BASE 棄牌區 resolver 在備戰超過上限時仍會放卡（slice 負數）', B.D1.bench > 6, JSON.stringify(B.D1));
    ok('★★ H4 BASE 上正對照照常（harness 沒壞）', B.A.benched === 2 && B.B.aOn && B.C2.bench === 2);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

console.log(`=== v6.635 放備戰兩項後續：${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
