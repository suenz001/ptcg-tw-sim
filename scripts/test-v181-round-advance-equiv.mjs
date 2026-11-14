// server v1.81 守衛（Fable 審查 P2-2）：推進輪次（checkRoundAdvance／advanceSwiss／單淘汰下一輪／歸檔）
//   在「會照 projection 砍欄位」的假 DB 上，本版與 BASE（server v1.80）的所有寫入與公告逐位元相同（11 個情境），
//   而且本版四處 TMATCH.find 都帶 projection、BASE 都沒有（HEAD-FAIL）。正對照：少一個 gameDraw 欄位 ⇒ 措辭不同。
//   改寫自 Fable 5.2 審查時的離線腳本 r2-advance-equiv.mjs。
import { build } from 'esbuild';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = '46274caa';
const S = join(ROOT, `.v181eq-${process.pid}-s.js`), E = join(ROOT, `.v181eq-${process.pid}-e.ts`), O = join(ROOT, `.v181eq-${process.pid}-o.mjs`);
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* noop */ } } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export * from './src/lib/tournament/swiss';\nexport { createGame, applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';\n");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const TENG = await import(pathToFileURL(O).href);
if (!hasBaseCommit(ROOT, BASE_SHA)) { shallowSkip('v181 推進輪次等價（缺 BASE ' + BASE_SHA + '）'); process.exit(0); }
const _b = readBaseBlob(ROOT, BASE_SHA, 'oracle-admin/server_admin_patch.js');
if (!_b.ok) { console.log('  FAIL 讀不到 BASE blob'); process.exit(1); }
const HEAD = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8').replace(/\r\n/g, '\n'), BASE = _b.out.replace(/\r\n/g, '\n');
function region(src) {
  const i = src.indexOf('    function buildRoundMatches(');
  const j = src.indexOf('    // 對局結束 → 記勝者 + 晉級\n    async function onMatchGameOver', i);
  if (i < 0 || j < i) throw new Error('region not found');
  return src.slice(i, j);
}
const match = (d, q) => Object.entries(q || {}).every(([k, v]) => {
  if (v && typeof v === 'object' && !Array.isArray(v)) { if ('$ne' in v) return d[k] !== v.$ne; if ('$in' in v) return v.$in.includes(d[k]); return true; }
  return d[k] === v;
});
function Col(name, rows, ops, usedProj) {
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const proj = (d, p) => { if (!p) return clone(d); const o = { _id: d._id }; for (const k of Object.keys(p)) if (p[k] && k in d) o[k] = d[k]; return clone(o); };
  return {
    rows,
    find(q, opts) { const p = opts && opts.projection; if (name === 'TMATCH') usedProj.push(p ? Object.keys(p).length : 0);
      let out = rows.filter((d) => match(d, q)); const api = { sort(s) { const ks = Object.keys(s); out = out.slice().sort((a, b) => { for (const k of ks) { if (a[k] !== b[k]) return (a[k] < b[k] ? -1 : 1) * s[k]; } return 0; }); return api; }, project(pp) { api._p = pp; return api; }, limit() { return api; }, async toArray() { return out.map((d) => proj(d, api._p || p)); } }; return api; },
    async findOne(q, opts) { const d = rows.find((x) => match(x, q)); return d ? proj(d, opts && opts.projection) : null; },
    async countDocuments(q) { return rows.filter((d) => match(d, q)).length; },
    async updateOne(q, u, o) { ops.push([name, 'updateOne', clone(q), clone(u), o || null]); const d = rows.find((x) => match(x, q)); if (d && u.$set) Object.assign(d, clone(u.$set)); return { matchedCount: d ? 1 : 0, modifiedCount: d ? 1 : 0 }; },
    async updateMany(q, u) { ops.push([name, 'updateMany', clone(q), clone(u)]); return { matchedCount: 0 }; },
    async insertMany(docs) { ops.push([name, 'insertMany', clone(docs)]); for (const d of docs) rows.push(clone(d)); return {}; },
    async insertOne(doc) { ops.push([name, 'insertOne', clone(doc)]); rows.push(clone(doc)); return {}; },
    async deleteMany(q) { ops.push([name, 'deleteMany', clone(q)]); return { deletedCount: 0 }; },
  };
}
function seeded(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const BIG = { finalState: { players: [{ hand: 'x'.repeat(3000) }], log: ['z'.repeat(2000)] }, finalLog: Array.from({ length: 50 }, (_, i) => ({ t: i, message: 'm' + i })), finalWinReason: 'r', finalTurn: 9, enteredAt: [1, 2], entered: [true, true], enterPushedAt: 5, idleWarnAt: 6, roomId: 'mr_x', timeLimitTurn: 4, timeLimitCalledAt: 7, timeLimitVerdict: 'prizes', timeLimitReached: true };
function mk(ev, round, idx, p1, p2, w, extra = {}) { return Object.assign({ _id: ev + '_r' + round + '_m' + idx, eventId: ev, round, idx, p1uid: p1, p1name: 'N' + p1, p2uid: p2, p2name: p2 ? 'N' + p2 : null, winnerUid: w, winnerName: w ? 'N' + w : null, status: 'done', bye: p2 == null, gameStartedAt: 100 + idx, endedAt: 200 + idx }, p2 == null ? {} : BIG, extra); }
const regsOf = (ev, n, dropped = []) => Array.from({ length: n }, (_, i) => ({ _id: ev + '__u' + i, eventId: ev, uid: 'u' + i, name: 'Nu' + i, checkedIn: true, dropped: dropped.includes(i) || undefined, deckName: 'D' + i, deckEntries: [{ cardId: '1', count: 60 }], email: 'e' + i }));
const SCN = {
  '瑞士第2輪結束→配第3輪（9人、輪空、雙敗、棄賽）': () => { const ev = { _id: 'E1', name: '賽一', status: 'running', currentRound: 2, format: 'swiss-then-cut', phase: 'swiss', swissRounds: 3, topCut: 4, roundCountdownMin: 3, createdAt: 1, startedAt: 2 };
    const ms = [mk('E1', 1, 0, 'u0', 'u1', 'u0', { phase: 'swiss' }), mk('E1', 1, 1, 'u2', 'u3', 'u3', { phase: 'swiss', idleForfeit: true }), mk('E1', 1, 2, 'u4', 'u5', null, { phase: 'swiss', draw: true, timeLimit: true }), mk('E1', 1, 3, 'u6', 'u7', 'u6', { phase: 'swiss' }), mk('E1', 1, 4, 'u8', null, 'u8', { phase: 'swiss' }),
      mk('E1', 2, 0, 'u0', 'u3', 'u3', { phase: 'swiss' }), mk('E1', 2, 1, 'u6', 'u8', 'u6', { phase: 'swiss', forfeit: true }), mk('E1', 2, 2, 'u1', 'u2', null, { phase: 'swiss', doubleNoShow: true }), mk('E1', 2, 3, 'u4', 'u7', 'u7', { phase: 'swiss', noShow: true }), mk('E1', 2, 4, 'u5', null, 'u5', { phase: 'swiss' })];
    return { ev, ms, regs: regsOf('E1', 9, [7]) }; },
  '瑞士最後一輪結束→Top Cut（8人）': () => { const ev = { _id: 'E2', name: '賽二', status: 'running', currentRound: 2, format: 'swiss-then-cut', phase: 'swiss', swissRounds: 2, topCut: 4, createdAt: 1 };
    const ms = [mk('E2', 1, 0, 'u0', 'u1', 'u0', { phase: 'swiss' }), mk('E2', 1, 1, 'u2', 'u3', 'u2', { phase: 'swiss' }), mk('E2', 1, 2, 'u4', 'u5', 'u4', { phase: 'swiss' }), mk('E2', 1, 3, 'u6', 'u7', 'u6', { phase: 'swiss' }),
      mk('E2', 2, 0, 'u0', 'u2', 'u0', { phase: 'swiss' }), mk('E2', 2, 1, 'u4', 'u6', 'u6', { phase: 'swiss' }), mk('E2', 2, 2, 'u1', 'u3', 'u1', { phase: 'swiss' }), mk('E2', 2, 3, 'u5', 'u7', null, { phase: 'swiss', gameDraw: true, draw: true })];
    return { ev, ms, regs: regsOf('E2', 8) }; },
  'Top Cut 一輪結束→下一輪（輪空計數只算 cut 期）': () => { const ev = { _id: 'E3', name: '賽三', status: 'running', currentRound: 4, format: 'swiss-then-cut', phase: 'cut', createdAt: 1 };
    const ms = [mk('E3', 1, 0, 'u0', null, 'u0', { phase: 'swiss' }), mk('E3', 3, 0, 'u1', null, 'u1', { phase: 'cut' }),
      mk('E3', 4, 0, 'u0', 'u1', 'u0', { phase: 'cut' }), mk('E3', 4, 1, 'u2', 'u3', 'u3', { phase: 'cut', timeLimit: true }), mk('E3', 4, 2, 'u4', 'u5', 'u5', { phase: 'cut' }), mk('E3', 4, 3, 'u6', 'u7', null, { phase: 'cut', doubleDrop: true }), mk('E3', 4, 4, 'u8', null, 'u8', { phase: 'cut' })];
    return { ev, ms, regs: regsOf('E3', 9, [5]) }; },
  '單淘汰決賽結束→冠軍＋歸檔': () => { const ev = { _id: 'E4', name: '賽四', status: 'running', currentRound: 2, createdAt: 1, startedAt: 3, createdByPlayer: true };
    const ms = [mk('E4', 1, 0, 'u0', 'u1', 'u0', { adminResolved: true }), mk('E4', 1, 1, 'u2', 'u3', 'u2', { dropForfeit: true, deadlockDraw: true }), mk('E4', 2, 0, 'u0', 'u2', 'u2')];
    return { ev, ms, regs: regsOf('E4', 4) }; },
};
for (const [kind, extra] of [['時限平手', { draw: true, timeLimit: true }], ['規則平手', { gameDraw: true, draw: true }], ['雙方棄賽', { doubleDrop: true }], ['雙未出賽', { doubleNoShow: true }], ['無旗標', {}]])
  SCN['決賽無勝方（' + kind + '）→無冠軍措辭＋歸檔'] = () => ({ ev: { _id: 'E5', name: '賽五', status: 'running', currentRound: 1, createdAt: 1 }, ms: [mk('E5', 1, 0, 'u0', 'u1', null, extra), mk('E5', 1, 1, 'u2', 'u3', null, kind === '無旗標' ? { draw: true } : extra)], regs: regsOf('E5', 4) });
SCN['決賽勝方已棄賽→無冠軍'] = () => ({ ev: { _id: 'E6', name: '賽六', status: 'running', currentRound: 1, createdAt: 1 }, ms: [mk('E6', 1, 0, 'u0', 'u1', 'u0')], regs: regsOf('E6', 2, [0]) });
SCN['本輪還有一場沒打完→不推進'] = () => ({ ev: { _id: 'E7', name: '賽七', status: 'running', currentRound: 1, createdAt: 1 }, ms: [mk('E7', 1, 0, 'u0', 'u1', 'u0'), Object.assign(mk('E7', 1, 1, 'u2', 'u3', null), { status: 'playing' })], regs: regsOf('E7', 4) });

async function run(src, scn) {
  const { ev, ms, regs } = scn(); const ops = [], usedProj = [];
  const env = { TMATCH: Col('TMATCH', ms, ops, usedProj), TREGS: Col('TREGS', regs, ops, usedProj), TEVENTS: Col('TEVENTS', [ev], ops, usedProj), TCHAT: Col('TCHAT', [], ops, usedProj),
    TCHAMPS: Col('TCHAMPS', [], ops, usedProj), TARCHIVE: Col('TARCHIVE', [], ops, usedProj), TROOMS: Col('TROOMS', [], ops, usedProj), TENG, seasonRankInvalidate: () => {},
    Date: { now: () => 424242 }, Math: Object.assign(Object.create(Math), { random: seeded(7) }), console };
  const fn = new Function(...Object.keys(env), '"use strict";\n' + region(src) + '\nreturn checkRoundAdvance;')(...Object.values(env));
  let err = null; try { await fn(ev._id); } catch (e) { err = String(e && e.message); }
  return { ops: JSON.stringify(ops), n: ops.length, err, usedProj };
}
let bad = 0, n = 0, projOk = true;
for (const [name, scn] of Object.entries(SCN)) {
  const h = await run(HEAD, scn), b = await run(BASE, scn);
  n++;
  const same = h.ops === b.ops && h.err === b.err;
  if (!same) bad++;
  if (!(h.usedProj.length > 0 && h.usedProj.every((x) => x > 0) && b.usedProj.every((x) => x === 0))) projOk = false;
  console.log('  ' + (same ? 'PASS ' : 'FAIL ') + name + '｜寫入/公告 ' + h.n + ' 筆｜err=' + h.err + '｜projection 欄位數 HEAD=[' + h.usedProj + '] BASE=[' + b.usedProj + ']');
}
const MUT = HEAD.replace('winnerName: 1, gameDraw: 1, doubleDrop: 1', 'winnerName: 1, doubleDrop: 1');
const kk = '決賽無勝方（規則平手）→無冠軍措辭＋歸檔'; const hm = await run(MUT, SCN[kk]), bb = await run(BASE, SCN[kk]);
const ctrl = MUT !== HEAD && hm.ops !== bb.ops;
console.log('  ' + (projOk ? 'PASS' : 'FAIL') + ' ★★★ 本版每次 TMATCH.find 都帶 projection、BASE 都沒有（HEAD-FAIL）');
console.log('  ' + (ctrl ? 'PASS' : 'FAIL') + ' ★★ 正對照：projection 少 gameDraw ⇒ 輸出與 BASE 不同（比對不是恆真）');
console.log('  ' + (n >= 11 ? 'PASS' : 'FAIL') + ' ★ 情境數下限（' + n + ' ≥ 11）');
const fails = bad + (projOk ? 0 : 1) + (ctrl ? 0 : 1) + (n >= 11 ? 0 : 1);
console.log(`=== server v1.81 推進輪次等價：${fails ? 'FAIL ' + fails : '全部 PASS'}（${n} 個情境）===`);
process.exit(fails ? 1 : 0);
