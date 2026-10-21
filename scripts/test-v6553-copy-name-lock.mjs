#!/usr/bin/env node
/**
 * v6.553 守衛（站長 2026-10-12 17:03 裁定逐字：「借招不能借『被鎖住的同名招式』，但如果只是鎖該寶可夢不能使用（如月月熊 赫月 ex的招式血月），就可以」）：
 *   借用方（使出借招的那一隻）身上被鎖住的招式名 ⇒ 同名招式不是借招候選；被借的那一隻自己被鎖（血月）⇒ 照樣可以借。
 * 【H】BASE（v6.552）：NEW 紅、正對照綠。
 *
 * ⚠⚠ v6.558 站長更正（2026-10-13）推翻本版裁定：「揮指等借招 … 下回合，還是能使用揮指，借用超級勇氣（因為皮可西是使用招式揮指，不是使用超級勇氣）」，
 *   只有 夢幻ex｜記憶螺旋（直接使出該招）會被名稱鎖擋。⇒ 本檔的「借用方被鎖 ⇒ 不能借」三條改成「照樣可以借」，
 *   v6.553 之前（v6.552）的行為與更正後相同 ⇒ HEAD 對照改成「v6.552 全部綠」。HEAD-FAIL 與記憶螺旋正對照見 test-v6558-copy-attack-name-lock-correction。
 */
import { extractBaseArchive, linkBaseModules } from './lib/base-archive.mjs';
import { readFileSync, readdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { hasBaseCommit, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.552。
const BASE_SHA = '93c73398';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
const HIJ = (c) => 'HIJ'.includes(c.regulationMark || '?');
const byName = (n) => { for (const c of pool.values()) if (c.name === n && HIJ(c)) return String(c.id); return null; };
const withAttack = (n, a) => { for (const c of pool.values()) if (c.name === n && HIJ(c) && (c.attacks || []).some((x) => x.name === a)) return String(c.id); return null; };
const withAbility = (n, a) => { for (const c of pool.values()) if (c.name === n && HIJ(c) && (c.abilities || []).some((x) => x.name === a)) return String(c.id); return null; };
const EN = { Grass: '草', Fire: '火', Water: '水', Lightning: '雷', Psychic: '超', Fighting: '鬥', Darkness: '惡', Metal: '鋼', Colorless: '水' };
const ID = { filler: '19178', W: byName('基本【水】能量'), zoroark: '13416', ursa: '10299' };
const missing = Object.entries(ID).filter(([, v]) => !v || !pool.get(String(v))).map(([k]) => k);

async function load(srcRoot) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6553-'));
  const E = join(tmp, 'e.ts'), S = join(tmp, 's.js'), O = join(tmp, 'o.mjs');
  writeFileSync(S, 'export const base="";');
  const p = (x) => join(srcRoot, x).replace(/\\/g, '/');
  writeFileSync(E, `export { applyAction, createGame } from '${p('src/lib/game/engine')}';\nexport { copyAttackCandidates, copyAttackCooldownNote } from '${p('src/lib/game/copy-attack')}';\nimport '${p('src/lib/game/effects')}';`);
  try {
    await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
      alias: { '$lib': join(srcRoot, 'src/lib'), '$app/paths': S }, logLevel: 'silent', nodePaths: [join(ROOT, 'node_modules')] });
    return await import(pathToFileURL(O).href);
  } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}

function scenarios(M) {
  let n = 0;
  const inst = (cid, e = {}) => ({ iid: 'i' + (++n), cardId: String(cid), damage: 0, energyAttached: [], ...e });
  const many = (cid, k) => Array.from({ length: k }, () => inst(cid));
  const board = (borrowerExtra, oppExtra) => {
    const s0 = M.createGame({ name: 'P1', entries: [{ cardId: ID.filler, count: 1 }] }, { name: 'P2', entries: [{ cardId: ID.filler, count: 1 }] }, pool);
    const z = inst(ID.zoroark, { energyAttached: many(ID.W, 3), ...borrowerExtra }); const u = inst(ID.ursa, oppExtra);
    const st = { ...s0, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false, setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], log: [],
      players: [
        { ...s0.players[0], hand: [], deck: many(ID.W, 10), discard: [], prizes: many(ID.W, 6), bench: [inst(ID.filler)], active: z },
        { ...s0.players[1], hand: [], deck: many(ID.W, 10), discard: [], prizes: many(ID.W, 6), bench: [inst(ID.filler)], active: u },
      ] };
    return { st, z, u };
  };
  const names = (st) => M.copyAttackCandidates('索羅亞克|欺詐', st, 0, pool).map((c) => c.attackName);
  const out = {};
  const T = (k, f) => { try { out[k] = f(); } catch (e) { out[k] = 'ERR ' + e.message.split('\n')[0]; } };
  // 借用方被鎖住「血月」（下個自己回合無法使用「血月」）⇒ 不能借血月；對戰紀錄說明原因
  T('BORROWER_LOCKED', () => { const { st } = board({ blockedAttackNamesThisTurn: ['血月'] }, {});
    return { names: names(st), note: M.copyAttackCooldownNote('索羅亞克|欺詐', st, 0, pool) }; });
  // 離場前禁用（烈火爆進型）同樣不能借
  T('BORROWER_LOCKED_UNTIL_EXIT', () => { const { st } = board({ blockedAttackNamesUntilExit: ['血月'] }, {}); return { names: names(st) }; });
  // 完整流程：借用方被鎖時硬送「借血月」⇒ 引擎不可以使出血月（對手不受 240）
  T('ENGINE_LOCKED', () => { const { st, z, u } = board({ blockedAttackNamesThisTurn: ['血月'] }, {});
    const a = M.applyAction(st, { type: 'ATTACK', attackIndex: 1, copyAttackChoice: { pokeIid: u.iid, attackIndex: 0 } }, pool);
    const after = a.players[1].active;
    const log = a.log.map((l) => (typeof l === 'string' ? l : l.message ?? '')).join('\n');
    return { oppDmg: after?.iid === u.iid ? after.damage : -1, why: /無法使用「血月」/.test(log) && /使出「欺詐」/.test(log) }; });
  // 正對照（完整流程，審查 P3-2）：被借方自己被血月鎖住 ⇒ 欺詐借血月照樣打出 240
  T('ENGINE_SOURCE_LOCKED_OK', () => { const { st, u } = board({}, { cantAttackPending: true, cantAttackThisTurn: true, blockedAttackNamesThisTurn: ['血月'] });
    const a = M.applyAction(st, { type: 'ATTACK', attackIndex: 1, copyAttackChoice: { pokeIid: u.iid, attackIndex: 0 } }, pool);
    const after = a.players[1].active;
    return { oppDmg: after?.iid === u.iid ? after.damage : -1 }; });
  // 正對照：被借的那一隻自己被血月鎖住（下回合無法使用招式）⇒ 照樣可以借
  T('SOURCE_LOCKED_OK', () => { const { st } = board({}, { cantAttackPending: true, cantAttackThisTurn: true, blockedAttackNamesThisTurn: ['血月'] }); return { names: names(st) }; });
  // 正對照：沒有任何鎖 ⇒ 可以借
  T('NO_LOCK', () => { const { st } = board({}, {}); return { names: names(st) }; });
  return out;
}

const judge = (r) => ({
  BORROWER_LOCKED: !!r.BORROWER_LOCKED?.names && r.BORROWER_LOCKED.names.includes('血月') && !/不能借用同名招式/.test(r.BORROWER_LOCKED.note),
  BORROWER_LOCKED_UNTIL_EXIT: !!r.BORROWER_LOCKED_UNTIL_EXIT?.names && r.BORROWER_LOCKED_UNTIL_EXIT.names.includes('血月'),
  ENGINE_LOCKED: !!r.ENGINE_LOCKED && r.ENGINE_LOCKED.oppDmg === 240,
  ENGINE_SOURCE_LOCKED_OK: !!r.ENGINE_SOURCE_LOCKED_OK && r.ENGINE_SOURCE_LOCKED_OK.oppDmg === 240,
  SOURCE_LOCKED_OK: !!r.SOURCE_LOCKED_OK && r.SOURCE_LOCKED_OK.names.includes('血月'),
  NO_LOCK: !!r.NO_LOCK && r.NO_LOCK.names.includes('血月'),
});
const LABEL = {
  BORROWER_LOCKED: '★★★ （v6.558 更正）借用方被鎖住「血月」⇒ 欺詐照樣可以借血月（使出的是欺詐）',
  BORROWER_LOCKED_UNTIL_EXIT: '★★★ （v6.558 更正）借用方「離開戰鬥場前」被鎖 ⇒ 同樣照樣可以借',
  ENGINE_LOCKED: '★★★ （v6.558 更正）完整流程：借用方被鎖時借血月 ⇒ 照樣造成 240',
  ENGINE_SOURCE_LOCKED_OK: '★ 正對照（完整流程）：被借方被血月鎖住 ⇒ 欺詐借血月照樣造成 240',
  SOURCE_LOCKED_OK: '★ 正對照（站長裁定）：被借的月月熊 赫月ex 自己被血月鎖住 ⇒ 照樣可以借血月',
  NO_LOCK: '★ 正對照：沒有鎖 ⇒ 可以借',
};
const NEW = ['BORROWER_LOCKED', 'BORROWER_LOCKED_UNTIL_EXIT', 'ENGINE_LOCKED'];
if (missing.length) { console.log('fixture 卡片缺：' + missing.join(',')); process.exit(1); }
const HM = await load(ROOT);
const H = scenarios(HM), J = judge(H);
for (const k of Object.keys(LABEL)) ok(LABEL[k], J[k], JSON.stringify(H[k]));

console.log('\n【H】HEAD-FAIL');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6553b-'));
  try {
    extractBaseArchive(ROOT, BASE_SHA, ["src", "scripts", "static/cards"], tmp);
    linkBaseModules(ROOT, tmp);
    const BM = await load(tmp);
    const B = scenarios(BM), BJ = judge(B);
    for (const k of Object.keys(LABEL)) {
      // v6.558 更正後與 v6.553 之前的行為相同 ⇒ v6.552 每一條都必須綠（NEW 清單只剩歷史意義）
      ok(`★[H 對照] v6.552：${k} 綠（更正後行為＝v6.553 之前）`, BJ[k] === true, JSON.stringify(B[k]));
    }
  } catch (e) { ok('★★★[H] BASE 可打包', false, e.message.split('\n')[0]); }
  finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
} else shallowSkip('v6553 H', '需要 v6.552 commit');

console.log(`\n=== v6.553（v6.558 更正）借招不受借用方名稱鎖影響：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
