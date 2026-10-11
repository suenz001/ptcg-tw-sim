#!/usr/bin/env node
/**
 * v6.538 守衛（站長 2026-10-12 裁定 2 選項 A：骨紋巨聲鱷｜純樸 資料改成特性；Q&A L1933 稱「特性『純樸』」）：
 *   ACTIVE／ACTIVE_MC 戰鬥場的骨紋巨聲鱷不必做任何事就不受招式效果（毒粉）
 *   BENCH   備戰的骨紋巨聲鱷不受刺殺魔法放置指示物（attack-effect）
 *   NULL_CAVE 傳說的熔岩洞消除 ⇒ 純樸失效（所有特性規則一併適用）
 *   NO_ATTACK 資料：純樸在 abilities、不在 attacks
 * 原本：存成 0 費招式＋「下回合」旗標 ⇒ 不按就沒有免疫、按了浪費攻擊、只免疫一回合、備戰永遠沒有免疫。
 * 【H】BASE（v6.537 引擎＋卡池）：ACTIVE、ACTIVE_MC、BENCH、NO_ATTACK 紅；正對照與 NULL_CAVE 兩版綠。
 */
import { readFileSync, readdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { hasBaseCommit, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.537。
const BASE_SHA = '701252ff';
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
const ID = {
  filler: '19178', W: byName('基本【水】能量'), G: byName('基本【草】能量'), P: byName('基本【超】能量'),
  croc: '11199', crocMC: '16615', vine: withAttack('蔓藤怪', '毒粉'), musharna: withAttack('夢妖魔', '刺殺魔法'),
  cave: byName('傳說的熔岩洞'),
};
const missing = Object.entries(ID).filter(([, v]) => !v).map(([k]) => k);
const atkIdx = (id, n) => pool.get(id).attacks.findIndex((a) => a.name === n);
const EN2 = { Grass: 'G', Psychic: 'P', Colorless: 'W', Water: 'W' };
const costIds = (id, n) => pool.get(id).attacks.find((a) => a.name === n).cost.map((t) => ID[EN2[t] ?? 'W']);

async function load(srcRoot) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6538-'));
  const E = join(tmp, 'e.ts'), S = join(tmp, 's.js'), O = join(tmp, 'o.mjs');
  writeFileSync(S, 'export const base="";');
  const p = (x) => join(srcRoot, x).replace(/\\/g, '/');
  writeFileSync(E, `export { applyAction, createGame } from '${p('src/lib/game/engine')}';\nimport '${p('src/lib/game/effects')}';`);
  try {
    await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
      alias: { '$lib': join(srcRoot, 'src/lib'), '$app/paths': S }, logLevel: 'silent', nodePaths: [join(ROOT, 'node_modules')] });
    return await import(pathToFileURL(O).href);
  } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}

// ⚠ 卡池：HEAD 用 repo 的 static/cards（純樸在 abilities）；BASE 用 BASE 當時的卡池（純樸在 attacks）
function loadPool(dirPath) {
  const live = new Set(JSON.parse(readFileSync(join(dirPath, 'index.json'), 'utf8')).map((e) => e.code));
  const m = new Map();
  for (const f of readdirSync(dirPath)) {
    if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
    for (const c of JSON.parse(readFileSync(join(dirPath, f), 'utf8'))) if (c?.id != null) m.set(String(c.id), c);
  }
  return m;
}

function scenarios(M, P) {
  let n = 0;
  const inst = (cid, e = {}) => ({ iid: 'i' + (++n), cardId: String(cid), damage: 0, energyAttached: [], ...e });
  const many = (cid, k) => Array.from({ length: k }, () => inst(cid));
  const mk = ({ a0, b0 = [], a1, b1 = [], stadium = null }) => {
    const s = M.createGame({ name: 'P1', entries: [{ cardId: ID.filler, count: 1 }] }, { name: 'P2', entries: [{ cardId: ID.filler, count: 1 }] }, P);
    return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
      setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], log: [],
      ...(stadium ? { activeStadium: inst(stadium), activeStadiumOwnerIdx: 0 } : {}),
      players: [
        { ...s.players[0], hand: [], deck: many(ID.W, 10), discard: [], prizes: many(ID.W, 6), bench: b0, active: a0 },
        { ...s.players[1], hand: [], deck: many(ID.W, 10), discard: [], prizes: many(ID.W, 6), bench: b1, active: a1 },
      ] };
  };
  const act = (s, a) => M.applyAction(s, a, P);
  const drive = (s, pick) => { let g = 0; while (s.pendingSelection && s.phase === 'playing' && g++ < 8) { const ps = s.pendingSelection;
      s = act(s, { type: 'RESOLVE_SELECTION', effectKey: ps.effectKey, selectedIids: pick(ps), actorIdx: ps.actorIdx ?? 0, senderIdx: ps.actorIdx ?? 0, pendingToken: ps.token }); } return s; };
  const atker = (id, atk) => inst(id, { energyAttached: costIds(id, atk).map((c) => inst(c)) });
  const out = {};
  const T = (k, f) => { try { out[k] = f(); } catch (e) { out[k] = 'ERR ' + e.message.split('\n')[0]; } };
  const poisoned = (c) => !!c && [c.status, c.secondaryStatus, c.tertiaryStatus].includes('poisoned');

  // 純樸是常駐特性：骨紋巨聲鱷 什麼都沒做（沒有「按招式」），對手的毒粉也毒不到牠
  const poison = (cid, extra = {}, stadium = null) => { const d = inst(cid, extra);
    const s = act(mk({ a0: atker(ID.vine, '毒粉'), a1: d, b1: [inst(ID.filler)], stadium }), { type: 'ATTACK', attackIndex: atkIdx(ID.vine, '毒粉'), actorIdx: 0 });
    return { poisoned: poisoned(s.players[1].active) }; };
  T('ACTIVE', () => poison(ID.croc));
  T('ACTIVE_MC', () => poison(ID.crocMC));
  T('ACTIVE_ctl', () => poison(ID.filler));
  // 特性消除：傳說的熔岩洞（進化寶可夢的特性全部消除；骨紋巨聲鱷是 2 階進化）⇒ 純樸失效、照樣中毒
  T('NULL_CAVE', () => poison(ID.croc, { evolvedFromStack: [inst(ID.filler), inst(ID.filler)] }, ID.cave));
  // 備戰也有效：刺殺魔法（對手戰鬥寶可夢處於特殊狀態時，在 1 隻備戰身上放 6 個指示物）選到備戰的骨紋巨聲鱷 ⇒ 不放
  const stab = (cid) => { const b = inst(cid);
    let s = act(mk({ a0: atker(ID.musharna, '刺殺魔法'), a1: inst(ID.filler, { status: 'poisoned' }), b1: [b] }), { type: 'ATTACK', attackIndex: atkIdx(ID.musharna, '刺殺魔法'), actorIdx: 0 });
    s = drive(s, () => [b.iid]);
    return { benchDmg: s.players[1].bench.find((c) => c.iid === b.iid)?.damage ?? 'gone' }; };
  T('BENCH', () => stab(ID.croc));
  T('BENCH_ctl', () => stab(ID.filler));
  // 資料：骨紋巨聲鱷 沒有「純樸」招式可以按
  T('NO_ATTACK', () => ({ attacks: (P.get(ID.croc).attacks || []).map((a) => a.name), abilities: (P.get(ID.croc).abilities || []).map((a) => a.name) }));
  return out;
}

const judge = (r) => ({
  ACTIVE: !!r.ACTIVE && r.ACTIVE.poisoned === false,
  ACTIVE_MC: !!r.ACTIVE_MC && r.ACTIVE_MC.poisoned === false,
  ACTIVE_ctl: !!r.ACTIVE_ctl && r.ACTIVE_ctl.poisoned === true,
  NULL_CAVE: !!r.NULL_CAVE && r.NULL_CAVE.poisoned === true,
  BENCH: !!r.BENCH && r.BENCH.benchDmg === 0,
  BENCH_ctl: !!r.BENCH_ctl && r.BENCH_ctl.benchDmg === 60,
  NO_ATTACK: !!r.NO_ATTACK && !r.NO_ATTACK.attacks.includes('純樸') && r.NO_ATTACK.abilities.includes('純樸'),
});
const LABEL = {
  ACTIVE: '★★★ 戰鬥場的骨紋巨聲鱷（SV8）不必按任何招式，對手的毒粉就毒不到（常駐特性）',
  ACTIVE_MC: '★★★ MC 印刷同上',
  ACTIVE_ctl: '★ 正對照：一般寶可夢照樣中毒',
  NULL_CAVE: '★★ 傳說的熔岩洞消除進化寶可夢特性 ⇒ 純樸失效、照樣中毒',
  BENCH: '★★★ 備戰的骨紋巨聲鱷不受刺殺魔法放置指示物（原本備戰永遠沒有免疫）',
  BENCH_ctl: '★ 正對照：一般備戰照放 6 個',
  NO_ATTACK: '★★★ 資料：純樸在 abilities，招式列表沒有純樸（不會再出現浪費攻擊的按鈕）',
};
const NEW = ['ACTIVE', 'ACTIVE_MC', 'BENCH', 'NO_ATTACK'];

if (missing.length) { console.log('fixture 卡片缺：' + missing.join(',')); process.exit(1); }
const HM = await load(ROOT);
const H = scenarios(HM, pool), J = judge(H);
for (const k of Object.keys(LABEL)) ok(LABEL[k], J[k], JSON.stringify(H[k]));

console.log('\n【H】HEAD-FAIL（BASE 引擎＋BASE 卡池）');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6538b-'));
  try {
    execFileSync('sh', ['-c', `git -C "${ROOT}" archive ${BASE_SHA} src static/cards | tar -x -C "${tmp}"`]);
    const BM = await load(tmp);
    const B = scenarios(BM, loadPool(join(tmp, 'static/cards'))), BJ = judge(B);
    for (const k of Object.keys(LABEL)) {
      if (NEW.includes(k)) ok(`★★★[H] v6.537：${k} 紅`, BJ[k] === false, JSON.stringify(B[k]));
      else ok(`★[H 正對照] v6.537：${k} 綠`, BJ[k] === true, JSON.stringify(B[k]));
    }
  } catch (e) { ok('★★★[H] BASE 可打包', false, e.message.split('\n')[0]); }
  finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
} else shallowSkip('v6538 H', '需要 v6.537 commit');

console.log(`\n=== v6.538 骨紋巨聲鱷｜純樸 改為特性：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
