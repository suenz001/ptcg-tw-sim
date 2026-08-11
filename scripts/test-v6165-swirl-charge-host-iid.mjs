/**
 * v6.165 HEAD-FAIL 守衛 — 大電海燕ex｜迴旋充能：互換要真的發生，且能量附給「本體」。
 *
 * 卡面（static/cards SV-P-H 10518，台灣官方中文，唯一權威）：
 *   「將這隻寶可夢與備戰寶可夢互換。然後，從自己的手牌選擇最多2張『基本【雷】能量』卡，
 *     附於這隻寶可夢身上。」
 *   ⇒「這隻寶可夢」＝使用招式的大電海燕ex 本體。互換之後它人在**備戰區**，
 *     所以附能目標必須用 **iid 追蹤**，不能用位置（players[idx].active）。
 *
 * HEAD(v6.164) FAIL 點：resolver 寫死 `state.players[aIdx].active` ⇒ 2 張雷能量
 *   全附到「剛換上來的那一隻」。
 *
 * 一併釘住（回歸防護）：`withPending` 遇到已有 pending 會排進 `pendingChainQueue`
 *   而**不是**覆蓋 —— 互換 picker 不可以被後面的 hand-choose 吃掉。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.swl-s.js'), E = join(ROOT, '.swl-e.ts'), O = join(ROOT, '.swl-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E,
  "export { createGame, applyAction } from './src/lib/game/engine';\n"
  + "export { ATTACK_POST } from './src/lib/game/effects/_shared';\n"
  + "export { findOwnFieldPokemon, attachEnergyToOwnPokemonByIid } from './src/lib/game/effects/_shared';\n"
  + "import './src/lib/game/effects';");
await build({
  entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error',
});
const mod = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };
const ok = (c, m) => { if (!c) throw new Error(m); };

const byName = n => { for (const [, c] of pool) if (c.name === n && ['H', 'I', 'J'].includes(c.regulationMark)) return c; return null; };
const swirl = byName('大電海燕ex');
const LIGHT = String(byName('基本【雷】能量').id);
const PLAIN = '14086';   // 願增猿（備戰替身）

T('fixture: 大電海燕ex｜迴旋充能 卡面逐字（含「互換」＋「附於這隻寶可夢身上」）', () => {
  ok(swirl, '找不到 H/I/J 的 大電海燕ex');
  const atk = (swirl.attacks ?? []).find(a => a.name === '迴旋充能');
  ok(atk, '找不到招式 迴旋充能');
  const eff = (atk.effect ?? '').replace(/[​-‍﻿]/g, '');
  ok(eff === '將這隻寶可夢與備戰寶可夢互換。然後，從自己的手牌選擇最多2張「基本【雷】能量」卡，附於這隻寶可夢身上。',
    '卡面 effect 已變更，請回查 static/cards：' + eff);
});

let iid = 0;
const inst = (cid, e = {}) => ({ iid: `s${++iid}`, cardId: String(cid), damage: 0, energyAttached: [], extraTools: [], ...e });
function setup() {
  const b0 = mod.createGame({ name: 'P1', entries: [{ cardId: PLAIN, count: 1 }] },
    { name: 'P2', entries: [{ cardId: PLAIN, count: 1 }] }, pool);
  const b = { ...b0, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, isFirstTurn: false,
    setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0] };
  const host = inst(swirl.id, { energyAttached: [inst(LIGHT)] });   // 招式費用【雷】×1
  const bn = inst(PLAIN);
  const e1 = inst(LIGHT), e2 = inst(LIGHT);
  return { state: { ...b, players: [
    { ...b.players[0], active: host, bench: [bn], hand: [e1, e2], deck: [inst(PLAIN)], discard: [], prizes: [inst(PLAIN)] },
    { ...b.players[1], active: inst(PLAIN), bench: [], hand: [], deck: [inst(PLAIN)], discard: [], prizes: [inst(PLAIN)] },
  ] }, host, bn, e1, e2 };
}
const atkIdx = (swirl.attacks ?? []).findIndex(a => a.name === '迴旋充能');

T('ATTACK_POST：互換 picker 排第一、附能 picker 進 pendingChainQueue（不被覆蓋）', () => {
  const { state } = setup();
  const r = mod.ATTACK_POST.get('大電海燕ex|迴旋充能')(state, 0, pool, {});
  ok(r.pendingSelection?.effectKey === 'h-wave2-self-swap',
    `第一個 pending 應是互換，實得 ${r.pendingSelection?.effectKey}`);
  const q = r.pendingChainQueue ?? [];
  ok(q.length === 1 && q[0].effectKey === 'h-wave2-attach-from-hand',
    '附能 picker 應排進 pendingChainQueue（不得覆蓋互換）');
  ok(typeof q[0].params?.hostIid === 'string', 'v6.165：附能 pending 必須帶 hostIid（用 iid 追本體）');
});

T('完整流程：互換真的發生 ＆ 2 張雷能量附到【備戰的本體】而非新上場那隻（HEAD FAIL）', () => {
  const { state, host, bn, e1, e2 } = setup();
  let r = mod.applyAction(state, { type: 'ATTACK', attackIndex: atkIdx, actorIdx: 0 }, pool);
  ok(r.pendingSelection?.effectKey === 'h-wave2-self-swap', '應先開互換 picker');
  r = mod.applyAction(r, { type: 'RESOLVE_SELECTION', selectedIids: [bn.iid], actorIdx: 0 }, pool);
  // ① 互換真的發生
  ok(r.players[0].active?.iid === bn.iid, `互換後戰鬥位應是備戰那隻，實得 ${r.players[0].active?.iid}`);
  ok(r.players[0].bench.some(b => b.iid === host.iid), '大電海燕ex 本體應在備戰區');
  ok(r.pendingSelection?.effectKey === 'h-wave2-attach-from-hand', '接著應輪到附能 picker');
  // ② 能量附給本體
  r = mod.applyAction(r, { type: 'RESOLVE_SELECTION', selectedIids: [e1.iid, e2.iid], actorIdx: 0 }, pool);
  const hostNow = r.players[0].bench.find(b => b.iid === host.iid);
  ok(hostNow, '本體仍應在備戰區');
  ok(hostNow.energyAttached.length === 3,
    `本體應有 1(費用)+2(新附)=3 個能量，實得 ${hostNow.energyAttached.length}`);
  ok(r.players[0].active.energyAttached.length === 0,
    `換上來的那一隻不該拿到能量，實得 ${r.players[0].active.energyAttached.length}`);
  ok(r.players[0].hand.length === 0, '2 張能量應從手牌移除');
});

T('備戰為空 → 不互換，能量仍附給本體（仍在戰鬥位）', () => {
  const { state, host, e1, e2 } = setup();
  const s = { ...state, players: [{ ...state.players[0], bench: [] }, state.players[1]] };
  let r = mod.applyAction(s, { type: 'ATTACK', attackIndex: atkIdx, actorIdx: 0 }, pool);
  ok(r.pendingSelection?.effectKey === 'h-wave2-attach-from-hand', '沒有備戰 → 直接進附能 picker');
  r = mod.applyAction(r, { type: 'RESOLVE_SELECTION', selectedIids: [e1.iid, e2.iid], actorIdx: 0 }, pool);
  ok(r.players[0].active.iid === host.iid && r.players[0].active.energyAttached.length === 3,
    `本體應留在戰鬥位並拿到 3 個能量，實得 ${r.players[0].active?.energyAttached.length}`);
});

T('選 0 張能量 → 互換仍然成立、手牌不變（picker 送空陣列＝玩家選 0）', () => {
  const { state, host, bn } = setup();
  let r = mod.applyAction(state, { type: 'ATTACK', attackIndex: atkIdx, actorIdx: 0 }, pool);
  r = mod.applyAction(r, { type: 'RESOLVE_SELECTION', selectedIids: [bn.iid], actorIdx: 0 }, pool);
  r = mod.applyAction(r, { type: 'RESOLVE_SELECTION', selectedIids: [], actorIdx: 0 }, pool);
  ok(r.players[0].active?.iid === bn.iid, '互換應仍然成立');
  ok(r.players[0].hand.length === 2, '選 0 張 → 手牌不動');
  const hostNow = r.players[0].bench.find(b => b.iid === host.iid);
  ok(hostNow?.energyAttached.length === 1, '本體能量不變');
});

T('互換後換上【瑪機雅娜】→ 自動治癒 per-energy-card：本體回復 90×2＝180', () => {
  // 卡面（static/cards SV9 12529・I）：「只要這隻寶可夢在戰鬥場上，每次從自己的手牌將能量卡
  //   附於寶可夢身上時，將那隻寶可夢恢復「90」HP。」
  //   ⚠ 一般攻擊型從手牌附能不可能與它共存（攻擊者佔住戰鬥位）——但迴旋充能**會先互換**。
  const MAG = '12529';
  const mg = pool.get(MAG);
  ok(mg?.abilities?.[0]?.name === '自動治癒', 'fixture 不是瑪機雅娜');
  ok(mg.abilities[0].effect.includes('每次從自己的手牌將能量卡附於寶可夢身上時'), '卡面已變更');
  const { state, host, e1, e2 } = setup();
  const mag = inst(MAG);
  const s0 = { ...state, players: [
    { ...state.players[0], active: { ...state.players[0].active, damage: 200 }, bench: [mag] },
    state.players[1],
  ] };
  let r = mod.applyAction(s0, { type: 'ATTACK', attackIndex: atkIdx, actorIdx: 0 }, pool);
  r = mod.applyAction(r, { type: 'RESOLVE_SELECTION', selectedIids: [mag.iid], actorIdx: 0 }, pool);
  ok(r.players[0].active?.iid === mag.iid, '瑪機雅娜應在戰鬥場');
  r = mod.applyAction(r, { type: 'RESOLVE_SELECTION', selectedIids: [e1.iid, e2.iid], actorIdx: 0 }, pool);
  const hostNow = r.players[0].bench.find(b => b.iid === host.iid);
  ok(hostNow?.damage === 20, `200 − 90×2 = 20，實得 ${hostNow?.damage}`);
});

T('resolver 自驗：client 送非「基本【雷】能量」的手牌 iid → 不予附加（v6.009 紀律）', () => {
  const { state, host, bn } = setup();
  const junk = inst(PLAIN);   // 手牌裡混一張寶可夢卡
  const s0 = { ...state, players: [
    { ...state.players[0], hand: [...state.players[0].hand, junk] }, state.players[1] ] };
  let r = mod.applyAction(s0, { type: 'ATTACK', attackIndex: atkIdx, actorIdx: 0 }, pool);
  r = mod.applyAction(r, { type: 'RESOLVE_SELECTION', selectedIids: [bn.iid], actorIdx: 0 }, pool);
  r = mod.applyAction(r, { type: 'RESOLVE_SELECTION', selectedIids: [junk.iid], actorIdx: 0 }, pool);
  ok(r.players[0].hand.some(c => c.iid === junk.iid), '非能量卡不得被吃掉');
  const hostNow = r.players[0].bench.find(b => b.iid === host.iid);
  ok(hostNow?.energyAttached.length === 1, '本體能量不該增加');
});

// ── 中央 helper 直測 ────────────────────────────────────────────────────
T('中央 helper findOwnFieldPokemon / attachEnergyToOwnPokemonByIid（戰鬥位＋備戰區）', () => {
  const { state, host, bn, e1 } = setup();
  ok(mod.findOwnFieldPokemon(state, 0, host.iid)?.zone === 'active', 'active 應找得到');
  ok(mod.findOwnFieldPokemon(state, 0, bn.iid)?.zone === 'bench', 'bench 應找得到');
  ok(mod.findOwnFieldPokemon(state, 0, 'no-such-iid') === null, '不存在的 iid 應回 null');
  const r = mod.attachEnergyToOwnPokemonByIid(state, 0, bn.iid, [e1]);
  ok(r.players[0].bench[0].energyAttached.length === 1, '應能附到備戰區的目標');
  const r2 = mod.attachEnergyToOwnPokemonByIid(state, 0, 'no-such-iid', [e1]);
  ok(r2 === state, '找不到 host 時原封不動回傳');
});

console.log(`\n=== v6.165 swirl-charge host-iid: ${pass} PASS / ${fail} FAIL ===`);
if (fail > 0) process.exit(1);
