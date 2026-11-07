// v6.633 守衛：「從牌庫直接進化」的效果不可以把海豚俠ex（全能靈魂）進化上場
//
// 由來：v6.632 審查列出的既有問題，站長：「審查找到一個既有問題：雙卵細胞球「細胞進化」這類「從牌庫直接進化」的效果，
//   目前可以把波普海豚進化成海豚俠ex，照卡面應該不行。影響四張卡，要下一版修」。
//   海豚俠ex｜全能靈魂（卡面）：「這張卡只可依據『海豚俠』的特性『全能變身』的效果放置於場上。」
//   同一句卡面的百變怪｜整人變身，官方 Q&A（30th CELEBRATION）答「不可以」（v6.632 已修）。
//
// 受影響：雙卵細胞球｜細胞進化、人造細胞卵｜細胞覺醒、彩粉蝶｜進化粉（共用 cellAwakeningStep）、
//   火箭隊的尼多娜｜惡之覺醒（只能選【惡】寶可夢，實務上碰不到，但同一個中央判準）。
//   中央判準 canDeckEvolveOnto（_shared.ts）＝ 候選清單（resolver）＝ 畫面篩選（+page.svelte）＝ AI 篩選（ai.ts）。
//
// 【A】行為：三張卡各跑完整流程（ATTACK → RESOLVE_SELECTION）
//   A1 候選：海豚俠ex 不在、海豚俠在（正對照：候選真的有東西）
//   A2 偽造 payload 選海豚俠ex ⇒ 不進化（resolver 自己再驗）
//   A3 正對照：選海豚俠 ⇒ 進化成功
// 【B】中央判準單元：海豚俠ex ⇒ false；海豚俠 ⇒ true；來源不對 ⇒ false；非寶可夢 ⇒ false
// 【C】畫面與 AI 的篩選都呼叫同一份（剝註解後找得到呼叫、找不到舊的 inline 判準）
// 【H】HEAD-FAIL：BASE（v6.632）引擎跑 A1／A2 ⇒ 紅
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hasBaseCommit, shallowSkip } from './lib/base-blob.mjs';
import { stripCommentsBlankChecked } from './lib/strip-comments.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = '522ddb9f';   // v6.632（本版的上一版）
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + String(x).slice(0, 400) : '')); } };

async function loadEngine(srcRoot, tag) {
  const S = join(srcRoot, `.v6633${tag}-s.js`), E = join(srcRoot, `.v6633${tag}-e.ts`), O = join(srcRoot, `.v6633${tag}-o.mjs`);
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
const POPLIO = byId('16685'), PALAFIN = byId('16686'), PALAFIN_EX = byId('16687');
const TWIN = byId('13729'), ARTI = byId('13730'), VIVI = byId('11186');
const PLAIN = all.find((c) => c.supertype === 'Pokemon' && c.stage === 'Basic' && !(c.abilities || []).length && c.pokemonType === 'Colorless'
  && ['H', 'I', 'J'].includes(c.regulationMark) && Number(c.hp) >= 60);
const COLORLESS = all.find((c) => c.supertype === 'Energy' && /^基本【水】能量$/.test(c.name));

let nn = 0;
const inst = (cid, extra = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], abilityUsedThisTurn: false,
  evolvedThisTurn: false, playedFromHand: false, movedToActiveThisTurn: false, evolvedFromStack: [], ...extra });
const P = (o = {}) => ({ name: 'P', active: null, bench: [], hand: [], deck: Array.from({ length: 10 }, () => inst(PLAIN.id)), discard: [],
  prizes: Array.from({ length: 6 }, () => inst(PLAIN.id)), abilityNamesUsedThisTurn: [], ...o });
const mk = (p0, p1) => ({ phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 7, isFirstTurn: false, log: [],
  pendingSelection: null, setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], coinFlippedThisAttack: false,
  _attackerActiveBonusDone: false, activeStadium: null, activeStadiumOwnerIdx: 0, players: [P({ name: 'A', ...p0 }), P({ name: 'B', ...p1 })] });

/** 跑一張卡的流程，回傳 { cands, forged, honest }：候選 iid、偽造選海豚俠ex 的結果、選海豚俠的結果 */
function runCard(M, attacker, atkName) {
  const act = (st, a) => { try { return M.applyAction(st, a, pool); } catch (e) { return { __err: e.message, players: st.players, log: [] }; } };
  const out = {};
  for (const mode of ['cands', 'forged', 'honest']) {
    const base = inst(POPLIO.id);
    const ex = inst(PALAFIN_EX.id), normal = inst(PALAFIN.id);
    const st = mk({ active: inst(attacker.id, { energyAttached: [inst(COLORLESS.id)] }), bench: [base], deck: [ex, normal, ...Array.from({ length: 5 }, () => inst(PLAIN.id))] },
      { active: inst(PLAIN.id) });
    const ai = attacker.attacks.findIndex((a) => a.name === atkName);
    let r = act(st, { type: 'ATTACK', attackIndex: ai });
    // 細胞進化：先選底座（波普海豚）
    if (r?.pendingSelection && r.pendingSelection.type === 'bench-choose') r = act(r, { type: 'RESOLVE_SELECTION', selectedIids: [base.iid], actorIdx: 0 });
    const ps = r?.pendingSelection;
    if (mode === 'cands') {
      // deck-search 的候選：畫面走 filter（EvilAwakening:EvolveFrom），引擎消毒閘看 validIids／filter ⇒ 這裡取「中央判準＋deck」重算
      const deck = r?.players?.[0]?.deck ?? [];
      const baseName = ps?.params?.baseName;
      const f = typeof M.SH?.canDeckEvolveOnto === 'function' ? (c) => M.SH.canDeckEvolveOnto(pool.get(c.cardId), baseName)
        : (c) => { const card = pool.get(c.cardId); return card?.supertype === 'Pokemon' && card.evolvesFrom === baseName; };
      out.cands = { type: ps?.type, filter: ps?.filter, baseName, list: deck.filter(f).map((c) => pool.get(c.cardId).name), err: r?.__err };
      continue;
    }
    const pick = mode === 'forged' ? ex.iid : normal.iid;
    const r2 = ps ? act(r, { type: 'RESOLVE_SELECTION', selectedIids: [pick], actorIdx: 0 }) : r;
    const b = r2?.players?.[0]?.bench?.find((x) => x.iid === base.iid) ?? r2?.players?.[0]?.bench?.[0];
    out[mode] = { name: pool.get(b?.cardId)?.name, deckHasEx: (r2?.players?.[0]?.deck ?? []).some((c) => c.iid === ex.iid), pend: ps?.type };
  }
  return out;
}

/** 牌庫只有海豚俠ex（沒有別的進化卡）⇒ 引擎自己的候選計算（validEvoIids／底座篩選）必須判「沒有可進化的」、不開牌庫選卡 */
function runOnlyEx(M, attacker, atkName) {
  const act = (st, a2) => { try { return M.applyAction(st, a2, pool); } catch (e) { return { __err: e.message, players: st.players, log: [] }; } };
  const base = inst(POPLIO.id);
  const st = mk({ active: inst(attacker.id, { energyAttached: [inst(COLORLESS.id)] }), bench: [base], deck: [inst(PALAFIN_EX.id), ...Array.from({ length: 5 }, () => inst(PLAIN.id))] }, { active: inst(PLAIN.id) });
  let r = act(st, { type: 'ATTACK', attackIndex: attacker.attacks.findIndex((x) => x.name === atkName) });
  if (r?.pendingSelection && r.pendingSelection.type === 'bench-choose') r = act(r, { type: 'RESOLVE_SELECTION', selectedIids: [base.iid], actorIdx: 0 });
  const ps = r?.pendingSelection;
  return { opened: ps?.type === 'deck-search' && ps?.effectKey !== 'deck-view-reshuffle' && (ps?.params?.baseName === '波普海豚'), ptype: ps?.type, key: ps?.effectKey, log: (r?.log ?? []).slice(-2).map((l) => l?.message ?? l) };
}
const CASES = [['雙卵細胞球｜細胞進化', TWIN, '細胞進化'], ['人造細胞卵｜細胞覺醒', ARTI, '細胞覺醒'], ['彩粉蝶｜進化粉', VIVI, '進化粉']];
async function runAll(M) {
  const res = {};
  for (const [label, card, atk] of CASES) res[label] = { ...runCard(M, card, atk), onlyEx: runOnlyEx(M, card, atk) };
  return res;
}

console.log('【A】三張卡完整流程');
const CUR = await loadEngine(ROOT, 'c');
const A = await runAll(CUR);
for (const [label] of CASES) {
  const r = A[label];
  ok(`★★★ A1 ${label}：候選不含海豚俠ex、含海豚俠（正對照）`, r.cands.type === 'deck-search' && !r.cands.list.includes('海豚俠ex') && r.cands.list.includes('海豚俠'), JSON.stringify(r.cands));
  ok(`★★★ A2 ${label}：偽造選海豚俠ex ⇒ 不進化、海豚俠ex 留在牌庫`, r.forged.name === '波普海豚' && r.forged.deckHasEx, JSON.stringify(r.forged));
  ok(`★★ A3 ${label}：正對照：選海豚俠 ⇒ 進化成功`, r.honest.name === '海豚俠', JSON.stringify(r.honest));
  ok(`★★★ A4 ${label}：牌庫只有海豚俠ex ⇒ 引擎判定「沒有可進化的」，不開牌庫選卡（validEvoIids 走中央判準）`, !r.onlyEx.opened, JSON.stringify(r.onlyEx));
}

console.log('【B】中央判準 canDeckEvolveOnto');
{ const f = CUR.SH.canDeckEvolveOnto;
  ok('★★ B1 海豚俠ex ⇒ false（全能靈魂）', typeof f === 'function' && f(PALAFIN_EX, '波普海豚') === false);
  ok('★★ B2 海豚俠 ⇒ true（逐字對得上）', f(PALAFIN, '波普海豚') === true);
  ok('★ B3 來源不對 ⇒ false；非寶可夢／undefined ⇒ false', f(PALAFIN, '海豚俠') === false && f(COLORLESS, '波普海豚') === false && f(undefined, '波普海豚') === false);
  // 所有全能靈魂的印刷都擋（不是只擋一個 id）
  const exs = all.filter((c) => c.name === '海豚俠ex' && ['H', 'I', 'J'].includes(c.regulationMark));
  ok(`★ B4 全部 ${exs.length} 個海豚俠ex 印刷都擋`, exs.length >= 3 && exs.every((c) => f(c, '波普海豚') === false)); }

console.log('【C】畫面與 AI 的篩選走同一份判準');
{ const page = stripCommentsBlankChecked(readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8'), 'svelte');
  const ai = stripCommentsBlankChecked(readFileSync(join(ROOT, 'src/lib/game/ai.ts'), 'utf8'), 'ts');
  const seg = (s) => { const i = s.indexOf("if (f === 'EvilAwakening:EvolveFrom') {"); return i < 0 ? '' : s.slice(i, s.indexOf('\n        }', i)); };
  const ps = seg(page), as = seg(ai);
  ok('★★ C1 對戰頁 EvilAwakening:EvolveFrom 篩選呼叫 canDeckEvolveOnto、沒有舊的 inline canEvolveOnto', ps.length > 40 && ps.length < 1200 && /canDeckEvolveOnto\(/.test(ps) && !/canEvolveOnto\(/.test(ps), ps.slice(0, 300));
  ok('★★ C2 AI 的同一篩選也呼叫 canDeckEvolveOnto', as.length > 40 && as.length < 1200 && /canDeckEvolveOnto\(/.test(as) && !/canEvolveOnto\(/.test(as), as.slice(0, 300));
  const misc = stripCommentsBlankChecked(readFileSync(join(ROOT, 'src/lib/game/effects/cards/v2650_i_wave15_misc8.ts'), 'utf8'), 'ts');
  ok('★ C3 細胞系三段候選與三個 resolver 都改走中央判準（候選 4 處＋再驗 3 處，舊的 canEvolveOnto 呼叫 0 處）', (misc.match(/canDeckEvolveOnto\(/g) || []).length === 7 && !/canEvolveOnto\(/.test(misc), String((misc.match(/canDeckEvolveOnto\(/g) || []).length)); }

console.log('【H】HEAD-FAIL');
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('H（缺 BASE ' + BASE_SHA + '）');
else {
  const tmp = mkdtempSync(join(tmpdir(), 'v6633-base-'));
  try {
    execFileSync('bash', ['-c', `git -C "${ROOT}" archive ${BASE_SHA} src | tar -x -C "${tmp}"`]);
    const B = await runAll(await loadEngine(tmp, 'b'));
    const reds = CASES.filter(([l]) => B[l].cands.list.includes('海豚俠ex') && B[l].forged.name === '海豚俠ex' && B[l].onlyEx.opened).map(([l]) => l);
    console.log('    BASE 上可以進化出海豚俠ex：' + reds.join('、'));
    ok('★★★ H1 BASE（v6.632）三張卡都可以把波普海豚進化成海豚俠ex、只有海豚俠ex 時也會開選卡（本版修的就是這個）', reds.length === CASES.length, JSON.stringify(B));
    ok('★★ H2 BASE 上正對照照常（選海豚俠會進化 ⇒ harness 沒壞）', CASES.every(([l]) => B[l].honest.name === '海豚俠'));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

console.log(`=== v6.633 從牌庫直接進化排除全能靈魂：${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
