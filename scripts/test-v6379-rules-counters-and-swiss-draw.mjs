#!/usr/bin/env node
/**
 * v6.379 守衛 —— B 組（規則書／錦標賽資料一致性）
 *
 *   (甲) B-1  PTCG_RULES.md §16.1 補「放置傷害指示物不計弱點／抵抗力」，
 *             ＋ test-v6254 的硬編行號改成錨點式（Rule 40：守衛不該綁行號）。
 *   (丙) B-3  src/lib/tournament/swiss.ts 的死碼 SwissResult 'T' 與「平 1」註解清掉。
 *   (乙) B-2  **本版只做 recon**（見報告）；這裡留下 recon 的產物：
 *             錦標賽區塊 49 把鎖的**遞迴**盤點 ＋ test-v6291／v6292 鎖清單的完整性斷言
 *             —— v6.365 重釘時漏掉第三個家族的根因就是「清單手抄 ＋ readdirSync 不是遞迴」。
 *
 * ⭐ 全部行為層：規則書那一條配「真的建盤面、跑 ATTACK、看盤面上的 damage 數字」；
 *   swiss 的死碼配「BASE 版與 HEAD 版 swiss.ts 各自編譯、餵同一組賽果、逐字比對 standings」。
 * ⚠ 需要歷史的段落一律 hasBaseCommit 保護、拿不到時 shallowSkip（v6.371 的教訓）。
 * ⚠ 禁止恆真斷言：每一條都能被 __m6a/mutcheck_v6379.mjs 的某一個突變打紅。
 */
import assert from 'node:assert';
import { build, transform } from 'esbuild';
import { readFileSync, writeFileSync, unlinkSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { normEol } from './lib/eol-agnostic.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = process.env.V6379_BASE || 'b2649b46';   // v6.378
const RULES_REL = 'PTCG RULES/PTCG_RULES.md';
const V54_REL = 'scripts/test-v6254-magical-shine-immunity.mjs';
const SWISS_REL = 'src/lib/tournament/swiss.ts';
const SRV_REL = 'oracle-admin/server_admin_patch.js';

let pass = 0, fail = 0;
const chk = (t, c, extra = '') => {
  if (c) { pass++; console.log('  PASS ' + t); return true; }
  fail++; console.log('  FAIL ' + t + (extra ? '\n        ' + String(extra).slice(0, 500) : ''));
  return false;
};
const rd = (rel) => normEol(readFileSync(join(ROOT, rel), 'utf8'));
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

const TMP = [];
const tmp = (name) => { const p = join(ROOT, name); TMP.push(p); return p; };
process.on('exit', () => { for (const p of TMP) { try { unlinkSync(p); } catch { /* noop */ } } });
const runNode = (p) => {
  const r = spawnSync(process.execPath, [p], { encoding: 'utf8', maxBuffer: 1 << 28 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};

// ════════════════════════════════════════════════════════════════════════════
console.log('\n【A】(甲) B-1 規則書那一條：逐字存在 ＋ **行為端**實作真的是那樣');
// ════════════════════════════════════════════════════════════════════════════
const RULE_LINE = '- ⭐ **放置傷害指示物不計算弱點／抵抗力（站長裁定 B-1，v6.379）**：卡面寫『在寶可夢身上放置 N 個傷害指示物』時，那是招式或特性的**效果**，不是招式的**傷害** ⇒ **不計算弱點與抵抗力**，一律就是 N×10 點。（官方依據見 §17.2：「**A**: 不可以。招式「散佈詛咒」不是招式的傷害，而是因招式的效果放置傷害指示物。」）';
const RULES = rd(RULES_REL);
{
  const n = RULES.split(RULE_LINE).length - 1;
  chk('★★★ A1 規則書 §16.1 有這一條、逐字正確、且恰好 1 條', n === 1, '出現 ' + n + ' 次');
  const secStart = RULES.indexOf('### §16.1 通用處理順序原則');
  const secEnd = RULES.indexOf('### §16.2 特性與招式的互動');
  chk('★★ A1b 它確實落在 §16.1（裁定原則）而不是被丟到別節',
    secStart > 0 && secEnd > secStart && RULES.indexOf(RULE_LINE) > secStart && RULES.indexOf(RULE_LINE) < secEnd,
    'sec=' + secStart + '..' + secEnd + ' line=' + RULES.indexOf(RULE_LINE));
  const QUOTE = '招式「散佈詛咒」不是招式的傷害，而是因招式的效果放置傷害指示物';
  const s172 = RULES.indexOf('### §17.2 擴充包「朱ex」'), s173 = RULES.indexOf('### §17.3 擴充包「紫ex」');
  // ⚠ 把自己那一行拿掉之後，出處**仍然**要在 §17.2 的官方問答區塊裡找得到 —— 否則就是自己編的出處。
  chk('★★ A1c 引用的官方問答真的在 §17.2 的官方問答區裡（不是自己編的出處）',
    RULES.split(RULE_LINE).join('').includes(QUOTE) && s172 > 0 && s173 > s172
    && RULES.slice(s172, s173).includes(QUOTE), 's172=' + s172 + ' s173=' + s173);
}

// ── 行為端：真的建盤面、跑 ATTACK、看 damage ────────────────────────────────
const S = tmp('.v6379-s.js'), E = tmp('.v6379-e.ts'), O = tmp('.v6379-o.mjs');
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';\n");
await build({
  entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error',
});
const { applyAction } = await import(pathToFileURL(O).href);

const cardDir = join(ROOT, 'static/cards');
const liveSets = new Set(JSON.parse(readFileSync(join(cardDir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map(); const all = [];
for (const f of readdirSync(cardDir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !liveSets.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(cardDir, f), 'utf8'))) {
    if (c?.id == null) continue;
    pool.set(String(c.id), c); all.push(c);
  }
}
const byId = (id) => { const c = pool.get(String(id)); assert.ok(c, 'fixture 找不到 id ' + id); return c; };
const ZH = { Grass: '草', Fire: '火', Water: '水', Lightning: '雷', Psychic: '超', Fighting: '鬥', Darkness: '惡', Metal: '鋼' };
const EID = {};
for (const c of all) {
  if (c.supertype !== 'Energy') continue;
  for (const [k, z] of Object.entries(ZH)) if (c.name === '基本【' + z + '】能量' && !EID[k]) EID[k] = String(c.id);
}
EID.Colorless = EID.Water;
let nn = 0;
const inst = (cid, extra = {}) => ({
  iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [],
  abilityUsedThisTurn: false, evolvedThisTurn: false, playedFromHand: false,
  movedToActiveThisTurn: false, evolvedFromStack: [], ...extra,
});
const P = (o = {}) => ({ name: 'P', active: null, bench: [], hand: [], deck: [], discard: [], prizes: [], abilityNamesUsedThisTurn: [], ...o });
const mk = (p0, p1, extra = {}) => ({
  phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
  isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
  pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
  coinFlippedThisAttack: false, _attackerActiveBonusDone: false,
  activeStadium: null, activeStadiumOwnerIdx: 0, players: [P(p0), P(p1)], ...extra,
});
const act = (st, a) => {
  const orig = Math.random; Math.random = () => 0.1;
  try { return applyAction(st, a, pool); } catch (e) { return { __err: e.message, log: [], players: [] }; }
  finally { Math.random = orig; }
};
const atkIdx = (card, name) => (card.attacks || []).findIndex((a) => a.name === name);
const costOf = (card, name) => ((card.attacks || []).find((a) => a.name === name)?.cost ?? []).map((t) => inst(EID[t] ?? EID.Water));
const HIJ = (c) => ['H', 'I', 'J'].includes(c.regulationMark);
const okTarget = (c) => c.supertype === 'Pokemon' && c.stage === 'Basic' && HIJ(c)
  && !(c.abilities || []).length && !(c.tags || []).includes('太晶');

const TEA = byId(19149);                       // 斯魔茶（M5 005/081，J）【草】｜無聲加害：對手戰鬥位放 1 個指示物
const WEAK_G = all.find((c) => okTarget(c) && c.weakness?.type === 'Grass' && c.weakness?.value === '×2' && !c.resistance && Number(c.hp) >= 130);
const NEUT = all.find((c) => okTarget(c) && !c.weakness && !c.resistance && Number(c.hp) >= 130);
let GATK = null, GATK_A = null;
for (const c of all) {
  if (c.supertype !== 'Pokemon' || c.pokemonType !== 'Grass' || c.stage !== 'Basic' || !HIJ(c)) continue;
  const a = (c.attacks || []).find((x) => /^[1-9]\d*$/.test(String(x.damage || '')) && !String(x.effect || '').trim()
    && (x.cost || []).length <= 2 && Number(x.damage) <= 60);
  if (a) { GATK = c; GATK_A = a; break; }
}
{
  const ok = chk('★ A2-前提：fixture 都找得到（弱點【草】×2 靶／無弱點靶／純傷害【草】攻擊方）',
    !!(WEAK_G && NEUT && GATK && GATK_A),
    'WEAK_G=' + (WEAK_G && WEAK_G.name) + ' NEUT=' + (NEUT && NEUT.name) + ' GATK=' + (GATK && GATK.name));
  const teaHit = (target) => {
    const st = mk({ active: inst(TEA.id, { energyAttached: costOf(TEA, '無聲加害') }), deck: [inst(NEUT.id)] },
      { active: inst(target.id), deck: [inst(NEUT.id)] });
    const r = act(st, { type: 'ATTACK', attackIndex: atkIdx(TEA, '無聲加害') });
    return r?.players?.[1]?.active?.damage ?? -1;
  };
  if (ok) {
    const dWeak = teaHit(WEAK_G), dNeut = teaHit(NEUT);
    chk('★★★ A2 [行為層] 放置 1 個傷害指示物對「弱點【草】×2」的目標 ＝ **10**（不是 20）⇒ 指示物不計弱點',
      dWeak === 10, '實得 ' + dWeak + '（靶：' + WEAK_G.name + ' 弱點' + JSON.stringify(WEAK_G.weakness) + '）');
    chk('★★ A3 [反對照] 同一招對**無弱點**目標也是 10 ⇒ 那個 10 不是靶的差異造成的',
      dNeut === 10, '實得 ' + dNeut + '（靶：' + NEUT.name + '）');
    const st2 = mk({ active: inst(GATK.id, { energyAttached: costOf(GATK, GATK_A.name) }), deck: [inst(NEUT.id)] },
      { active: inst(WEAK_G.id), deck: [inst(NEUT.id)] });
    const r2 = act(st2, { type: 'ATTACK', attackIndex: atkIdx(GATK, GATK_A.name) });
    const dAtk = r2?.players?.[1]?.active?.damage ?? -1;
    chk('★★★ A4 [正對照／自驗] 同一個靶、同一個 harness：【草】純傷害招式 ' + GATK_A.damage
      + ' ⇒ 真的吃 ×2 ＝ ' + (Number(GATK_A.damage) * 2) + ' ⇒ A2 的「10」不是因為弱點機構根本沒接上',
      dAtk === Number(GATK_A.damage) * 2, '實得 ' + dAtk + '（' + GATK.name + '｜' + GATK_A.name + '）');
  }
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n【B】(甲) test-v6254 改錨點式：規則書插一行不該再讓它翻紅');
// ════════════════════════════════════════════════════════════════════════════
{
  const V54 = rd(V54_REL);
  chk('★★ B1 test-v6254 不再用硬編行號釘規則書（lines[2818]／lines[2733] 全數消失）',
    !/lines\[\s*2[0-9]{3}\s*\]/.test(V54), (V54.match(/lines\[\s*\d+\s*\]/g) || []).join(','));
  chk('★ B1b 它改成「問句定位 ＋ 下一行是答案」的錨點式（而且問句唯一性也在驗）',
    V54.includes("const qaAt = (q, a) => {") && V54.includes('hits.length, 1') && V54.includes('lines[hits[0] + 1]'));

  // ⭐ 正對照：把規則書再插一行（任意位置）⇒ HEAD 版 test-v6254 **不該**因此翻紅。
  //   做法：整支 test-v6254 原始碼一字不動，只把它讀規則書的那個路徑字面量換成暫存副本
  //   ⇒ 同一份判準、只換輸入（不是另外寫一套判準來「自己驗自己」）。
  const RULES_TMP = tmp('.v6379-rules-shift.md');
  const shifted = RULES.replace('### §16.1 通用處理順序原則\n', '### §16.1 通用處理順序原則\n\n<!-- v6379 正對照：在兩段官方問答**之前**插一行 -->\n');
  chk('★ B2-前提：插行突變真的生效（規則檔多了 2 行、且兩段問答逐字未變）',
    shifted !== RULES && shifted.split('\n').length === RULES.split('\n').length + 2
    && shifted.includes('特性「光之翼」會消除嗎') && shifted.includes('特性「光之翼」會生效嗎'));
  writeFileSync(RULES_TMP, shifted);
  const PATH_LIT = "join(ROOT, 'PTCG RULES', 'PTCG_RULES.md')";
  const swapPath = (src) => src.split(PATH_LIT).join(JSON.stringify(RULES_TMP.replace(/\\/g, '/')));
  const mkTmpGuard = (name, src) => { const p = tmp(name); writeFileSync(p, src); return p; };

  if (chk('★ B2-前提：test-v6254 的規則書路徑字面量唯一（換得掉）', V54.split(PATH_LIT).length - 1 === 1)) {
    const r = runNode(mkTmpGuard('scripts/.v6379-v54-head.mjs', swapPath(rd(V54_REL))));
    chk('★★★ B2 [正對照] 規則書任意位置插一行 ⇒ **HEAD 版** test-v6254 仍然全綠（行號耦合真的解掉了）',
      r.code === 0, 'exit=' + r.code + '\n' + r.out.slice(-700));
  }

  if (!hasBaseCommit(ROOT, BASE_SHA)) {
    shallowSkip('B3／B4 HEAD-FAIL（BASE 版 test-v6254 的硬編行號必須紅）', 'B1／B2 的 HEAD 側判準仍在守');
  } else {
    const b = readBaseBlob(ROOT, BASE_SHA, V54_REL);
    if (chk('★ B3-前提：讀得到 BASE 的 test-v6254，且它真的是硬編行號版', b.ok && /lines\[2818\]/.test(b.out))) {
      const rb1 = runNode(mkTmpGuard('scripts/.v6379-v54-base1.mjs', b.out));
      chk('★★★ B3 HEAD-FAIL：BASE 版 test-v6254（硬編行號）對**現行**規則書必紅 —— 本版插的那一行就讓它位移',
        rb1.code !== 0 && /A2/.test(rb1.out), 'exit=' + rb1.code + '\n' + rb1.out.slice(-700));
      const rb2 = runNode(mkTmpGuard('scripts/.v6379-v54-base2.mjs', swapPath(b.out)));
      chk('★★★ B4 HEAD-FAIL：同一份「插一行」的規則書餵給 BASE 版 ⇒ 必紅（證明 B2 的綠不是因為它什麼都沒驗）',
        rb2.code !== 0, 'exit=' + rb2.code + '\n' + rb2.out.slice(-700));
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n【C】(丙) B-3 SwissResult 的死碼 T：刪掉之後勝負／積分逐條不變');
// ════════════════════════════════════════════════════════════════════════════
const SWISS = rd(SWISS_REL);
{
  chk("★★ C1 SwissResult 已經沒有 'T'（型別逐字 ＝ 'W' | 'L' | 'BYE'）",
    SWISS.includes("export type SwissResult = 'W' | 'L' | 'BYE';") && !/SwissResult = .*'T'/.test(SWISS));
  chk('★★ C1b matchPoints 的註解不再寫「平 1」（站上沒有平手得分這回事）',
    !SWISS.includes('平1') && !SWISS.includes('平 1') && SWISS.includes('勝3 / 負0 / Bye3'));
  chk("★★ C1c 全站沒有任何 'T' 的生產者或消費者（遞迴掃 src/ 與 oracle-admin/ 的出貨碼）",
    !/results\.push\(\s*'T'\s*\)/.test(SWISS) && !/===\s*'T'/.test(SWISS)
    && !/results\.push\(\s*'T'\s*\)/.test(rd(SRV_REL)));
}
// ── 行為端：BASE 版與 HEAD 版 swiss.ts 各自編譯，餵同一組賽果，standings 逐字相同 ──
const compileSwiss = async (tsSrc, tag) => {
  const js = (await transform(tsSrc, { loader: 'ts', format: 'esm', target: 'node20' })).code;
  const p = tmp('.v6379-swiss-' + tag + '.mjs');
  writeFileSync(p, js);
  return import(pathToFileURL(p).href);
};
const REGS = [{ uid: 'a', name: 'A' }, { uid: 'b', name: 'B' }, { uid: 'c', name: 'C' }, { uid: 'd', name: 'D' }];
const MATCHES = [
  // 第 1 輪：a 勝 b（一般勝負）／ c vs d 打成**平手** ⇒ 站上的雙敗形狀（done ＋ 無 winner）
  { round: 1, idx: 0, p1uid: 'a', p2uid: 'b', winnerUid: 'a', status: 'done', bye: false },
  { round: 1, idx: 1, p1uid: 'c', p2uid: 'd', winnerUid: null, status: 'done', bye: false, draw: true, gameDraw: true },
  // 第 2 輪：a 輪空（+3 記 BYE）／ b vs c 未打完 ⇒ 絕不可被當成雙敗計分
  { round: 2, idx: 0, p1uid: 'a', p2uid: null, winnerUid: 'a', status: 'done', bye: true },
  { round: 2, idx: 1, p1uid: 'b', p2uid: 'c', winnerUid: null, status: 'pending', bye: false },
];
const runSwiss = (M) => {
  const pl = M.buildSwissPlayersFromMatches(MATCHES, REGS);
  const st = M.computeStandings(pl);
  return st.map((p) => [p.uid, p.rank, p.matchPoints, p.results.join('/'), p.byes,
    Math.round(p.owp * 1e6), Math.round(p.oowp * 1e6)]);
};
{
  const HEAD_M = await compileSwiss(SWISS, 'head');
  const got = runSwiss(HEAD_M);
  chk('★ C2-前提：fixture 真的跑出四個人的 standings（不是空陣列 ⇒ 下面的比對會變恆真式）',
    got.length === 4 && got.every((r) => typeof r[2] === 'number' && !Number.isNaN(r[2])), JSON.stringify(got));
  chk('★★★ C2 [行為層] 平手場 ⇒ c／d 各記一筆 L、各 0 分；a 勝＋Bye ＝ 6 分記 W/BYE；未打完那場完全不計',
    JSON.stringify(got.find((r) => r[0] === 'a')) === JSON.stringify(['a', 1, 6, 'W/BYE', 1, 250000, 1000000])
    && got.find((r) => r[0] === 'c')[2] === 0 && got.find((r) => r[0] === 'c')[3] === 'L'
    && got.find((r) => r[0] === 'd')[2] === 0 && got.find((r) => r[0] === 'd')[3] === 'L'
    && got.find((r) => r[0] === 'b')[3] === 'L',
    JSON.stringify(got));
  chk("★★ C2b [行為層] 整份 standings 裡一個 'T' 都沒有（死碼刪掉不是把平手記成別的東西）",
    !JSON.stringify(got).includes('T'), JSON.stringify(got));

  if (!hasBaseCommit(ROOT, BASE_SHA)) {
    shallowSkip('C3 BASE vs HEAD 的 standings 逐字比對', 'C2 的行為判準（分數／結果字串）仍在守');
  } else {
    const b = readBaseBlob(ROOT, BASE_SHA, SWISS_REL);
    if (chk("★ C3-前提：讀得到 BASE 的 swiss.ts，而且它真的還有 'T'", b.ok && b.out.includes("'W' | 'L' | 'T' | 'BYE'"))) {
      const BASE_M = await compileSwiss(b.out, 'base');
      const gotBase = runSwiss(BASE_M);
      chk('★★★ C3 刪掉死碼之後，同一組賽果在 BASE 與 HEAD 算出**逐字相同**的 standings（純死碼，執行期行為零變化）',
        JSON.stringify(gotBase) === JSON.stringify(got), 'BASE=' + JSON.stringify(gotBase) + '\nHEAD=' + JSON.stringify(got));
      const gotDiff = (() => {
        const M2 = MATCHES.map((m) => (m.round === 1 && m.idx === 1 ? { ...m, winnerUid: 'c' } : m));
        const pl = BASE_M.buildSwissPlayersFromMatches(M2, REGS);
        return BASE_M.computeStandings(pl).map((p) => [p.uid, p.rank, p.matchPoints, p.results.join('/')]);
      })();
      chk('★★ C3b [自驗] C3 不是恆真：把那一場平手改成 c 勝 ⇒ 同一個比對器就會看出差異',
        JSON.stringify(gotDiff) !== JSON.stringify(gotBase.map((r) => [r[0], r[1], r[2], r[3]])), JSON.stringify(gotDiff));
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n【D】(乙) B-2 recon 產物：錦標賽區塊「鎖」的**遞迴**盤點與清單完整性');
//   ⚠ v6.365 重釘時漏掉第三個家族、5 支守衛翻紅，根因有兩個，這一節把兩個都釘住：
//     ①掃描不是遞迴（readdirSync('scripts') 看不到 scripts/lib/ 底下的 revert-chain 節點）；
//     ②test-v6291／v6292 的鎖清單是**手抄**的，漏了就靜默少守。
// ════════════════════════════════════════════════════════════════════════════
const SRV = rd(SRV_REL);
{
  const TAIL_A = "app.get('/api/tournament";
  const TEV_A = "const TEVENTS = db.collection('tournamentEvents');";
  const iTail = SRV.indexOf(TAIL_A), iTev = SRV.indexOf(TEV_A);
  chk('★ D0-前提：兩個區塊錨點都找得到，而且抽出來的區塊夠長（否則下面全是恆真式）',
    iTail > 0 && iTev > 0 && SRV.length - iTail > 200000 && SRV.length - iTev > 200000,
    'iTail=' + iTail + ' iTev=' + iTev);
  const CUR = { tail: sha256(SRV.slice(iTail)), tev: sha256(SRV.slice(iTev)), len: String(SRV.length - iTev) };

  const walk = (dir, out = []) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p, out); else if (e.isFile()) out.push(p);
    }
    return out;
  };
  const scanLocks = (paths) => {
    const rows = [];
    for (const p of paths) {
      if (!p.endsWith('.mjs')) continue;
      const s = normEol(readFileSync(p, 'utf8'));
      if (!s.includes('server_admin_patch') && !s.includes('tourn-revert')) continue;
      const rel = p.slice(ROOT.length).replace(/\\/g, '/').replace(/^\//, '');
      s.split('\n').forEach((L, i) => {
        if (L.includes(CUR.tail)) rows.push({ rel, line: i + 1, kind: 'tail' });
        if (L.includes(CUR.tev)) rows.push({ rel, line: i + 1, kind: 'tev' });
        const m = /\b([A-Z_0-9]*(?:TOURN|TEV)[A-Z_0-9]*LEN[A-Z_0-9]*)\s*=\s*(\d{5,})/.exec(L);
        if (m && m[2] === CUR.len) rows.push({ rel, line: i + 1, kind: 'len' });
      });
    }
    return rows;
  };
  const SCRIPTS = join(ROOT, 'scripts');
  const deep = scanLocks(walk(SCRIPTS));
  const flat = scanLocks(readdirSync(SCRIPTS, { withFileTypes: true })
    .filter((e) => e.isFile()).map((e) => join(SCRIPTS, e.name)));
  const cnt = (rows, k) => rows.filter((r) => r.kind === k).length;
  console.log('        遞迴盤點：tail ' + cnt(deep, 'tail') + ' 把／tev ' + cnt(deep, 'tev')
    + ' 把／len ' + cnt(deep, 'len') + ' 把，合計 ' + deep.length + ' 把（' + new Set(deep.map((r) => r.rel)).size + ' 個檔）');
  chk('★★★ D1 遞迴盤點掃得到全部的區塊鎖（tail ≥ 12、tev ≥ 15、len ≥ 4；掃描器壞掉會掉到 0）',
    cnt(deep, 'tail') >= 12 && cnt(deep, 'tev') >= 15 && cnt(deep, 'len') >= 4,
    JSON.stringify({ tail: cnt(deep, 'tail'), tev: cnt(deep, 'tev'), len: cnt(deep, 'len') }));
  chk('★★★ D2 [自驗／v6.365 的根因] **非遞迴**掃描（只看 scripts/ 第一層）會漏掉 scripts/lib/ 底下的 revert-chain 節點',
    deep.length > flat.length && deep.some((r) => r.rel.startsWith('scripts/lib/'))
    && !flat.some((r) => r.rel.startsWith('scripts/lib/')),
    'deep=' + deep.length + ' flat=' + flat.length);

  // ── 舊值零殘留（遞迴版）：值不硬寫，直接問 revert-chain 的單一資料來源 ──
  const RV65 = await import('./lib/tourn-revert-v6365.mjs');
  const RV92 = await import('./lib/tourn-revert-v6292.mjs');
  const RV91 = await import('./lib/tourn-revert-v6291.mjs');
  const OLD_VALUES = [
    ['v6.290 tail', RV91.OLD_TAIL_SHA_V6290], ['v6.290 tev', RV91.OLD_TEV_SHA_V6290],
    ['v6.291 tail', RV91.NEW_TAIL_SHA_V6291], ['v6.291 tev', RV91.NEW_TEV_SHA_V6291],
    ['v6.292 tail', RV92.NEW_TAIL_SHA_V6292], ['v6.292 tev', RV92.NEW_TEV_SHA_V6292],
    // ⭐v6.381：v6.365 的指紋從「現行值」變成「舊值」⇒ 也要納入零殘留檢查（本版 28 把鎖全部重釘，漏一把這裡就會紅）。
    ['v6.365 tail', RV65.NEW_TAIL_SHA_V6365], ['v6.365 tev', RV65.NEW_TEV_SHA_V6365],
  ];
  chk('★ D3-前提：revert-chain 的舊值都拿得到，而且跟現行值不同（否則「零殘留」是恆真式）',
    OLD_VALUES.every(([, v]) => typeof v === 'string' && v.length === 64 && v !== CUR.tail && v !== CUR.tev),
    JSON.stringify(OLD_VALUES));
  // ⚠ 只有**還原鏈本身**可以寫出舊指紋（那是它的資料／它的終點斷言）。
  //   ⭐ 豁免不是「列上去就沒事」：下面立刻驗每一個被豁免的檔案真的是還原鏈的一員
  //   （lib 三支是宣告端，test-v6292 B3 要斷言「還原到最後有沒有回到 v6.290」⇒ 必須寫出那兩個值）。
  const LIB_DECL = new Set(['scripts/lib/tourn-revert-v6291.mjs', 'scripts/lib/tourn-revert-v6292.mjs',
    'scripts/lib/tourn-revert-v6365.mjs', 'scripts/lib/tourn-revert-v6381.mjs',   // ⭐v6.381 新節點
    'scripts/lib/tourn-revert-v6384.mjs',   // ⭐v6.384 新節點（休閒對戰版本閘的公開端點）
    'scripts/test-v6292-tourn-verified-gate2.mjs']);
  chk('★★ D3-前提：被豁免的 ' + LIB_DECL.size + ' 個檔案**每一個**都真的是還原鏈的一員（豁免不能隨便加）',
    LIB_DECL.size === 6 && [...LIB_DECL].every((rel) => {   // ⭐v6.384 鏈多一節 ⇒ 6
      const s = rd(rel);
      const isLib = /^scripts\/lib\/tourn-revert-v\d+\.mjs$/.test(rel);
      const isConsumer = /from '\.\/lib\/tourn-revert-v\d+\.mjs'/.test(s);
      return (isLib || isConsumer) && /revert(V6291|V6292|ToV6290|V6365)\(/.test(s);
    }), [...LIB_DECL].join(', '));
  const stale = [];
  for (const p of walk(SCRIPTS)) {
    if (!p.endsWith('.mjs')) continue;
    const rel = p.slice(ROOT.length).replace(/\\/g, '/').replace(/^\//, '');
    if (LIB_DECL.has(rel)) continue;            // 還原鏈**本來就**要宣告舊值（那是它的資料）
    const s = normEol(readFileSync(p, 'utf8'));
    for (const [tag, v] of OLD_VALUES) if (s.includes(v)) stale.push(rel + ' :: ' + tag);
  }
  chk('★★★ D3 遞迴版「舊值零殘留」：scripts/ 底下（還原鏈本身除外）沒有任何檔案還釘著 v6.290／v6.291／v6.292 的舊指紋',
    stale.length === 0, stale.join(' | '));

  // ── 清單完整性：v6.365 的第二個根因（手抄清單） ──
  const listOf = (src, name) => {
    const i = src.indexOf('const ' + name + ' = [');
    if (i < 0) return null;
    const j = src.indexOf('\n];', i);
    if (j < 0) return null;
    return (src.slice(i, j).match(/'scripts\/[^']+\.mjs'/g) || []).map((x) => x.slice(1, -1));
  };
  const need = (kind) => [...new Set(deep.filter((r) => r.kind === kind && !r.rel.startsWith('scripts/lib/')).map((r) => r.rel))];
  const needTail = need('tail'), needTev = need('tev');
  for (const g of ['scripts/test-v6291-tourn-verified-gate.mjs', 'scripts/test-v6292-tourn-verified-gate2.mjs']) {
    const src = rd(g);
    const lt = listOf(src, 'TAIL_LOCKS'), lv = listOf(src, 'TEV_LOCKS');
    if (!chk('★ D4-前提：抽得到 ' + g + ' 的兩份鎖清單', Array.isArray(lt) && Array.isArray(lv))) continue;
    const missT = needTail.filter((f) => !lt.includes(f));
    const missV = needTev.filter((f) => !lv.includes(f));
    chk('★★★ D4 ' + g + '：TAIL_LOCKS 涵蓋遞迴掃到的全部 ' + needTail.length + ' 支（v6.365 就是漏在這裡）',
      missT.length === 0, '漏了：' + missT.join(', '));
    chk('★★★ D4 ' + g + '：TEV_LOCKS 涵蓋遞迴掃到的全部 ' + needTev.length + ' 支',
      missV.length === 0, '漏了：' + missV.join(', '));
  }
  if (!hasBaseCommit(ROOT, BASE_SHA)) {
    shallowSkip('D5 HEAD-FAIL（BASE 的鎖清單漏 3 支 ⇒ D4 必紅）', 'D4 的 HEAD 側判準仍在守');
  } else {
    const b = readBaseBlob(ROOT, BASE_SHA, 'scripts/test-v6291-tourn-verified-gate.mjs');
    if (chk('★ D5-前提：讀得到 BASE 的 test-v6291', b.ok)) {
      const lt = listOf(normEol(b.out), 'TAIL_LOCKS'), lv = listOf(normEol(b.out), 'TEV_LOCKS');
      const missT = needTail.filter((f) => !lt.includes(f)), missV = needTev.filter((f) => !lv.includes(f));
      chk('★★★ D5 HEAD-FAIL：BASE(v6.378) 的鎖清單真的漏掉 v6.295／v6.300／v6.302 ⇒ 同一條 D4 在 BASE 必紅',
        missT.length === 3 && missV.length === 3
        && missT.join(',').includes('v6295') && missT.join(',').includes('v6300') && missT.join(',').includes('v6302'),
        'tail 漏 ' + missT.join(',') + ' / tev 漏 ' + missV.join(','));
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n【E】接線');
// ════════════════════════════════════════════════════════════════════════════
{
  const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  chk('★★ E1 本守衛在 package.json 的 test chain 裡（只放進 iron-rules-audit 等於沒放）',
    String(PKG.scripts.test).includes('node scripts/test-v6379-rules-counters-and-swiss-draw.mjs'));
  chk('★ E2 規則書／swiss.ts／test-v6254 三個被本版動到的檔都還在',
    existsSync(join(ROOT, RULES_REL)) && existsSync(join(ROOT, SWISS_REL)) && existsSync(join(ROOT, V54_REL)));
}

console.log('\n' + (fail === 0 ? '全部通過' : '有失敗') + '（PASS ' + pass + ' / FAIL ' + fail + '）');
process.exit(fail === 0 ? 0 : 1);
