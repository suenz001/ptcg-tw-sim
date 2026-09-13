#!/usr/bin/env node
/**
 * ⭐ v6.377 守衛：C-10（孤兒守衛 harness）＋ C-9（行尾中性靜態掃描器）＋ C-15（兩張網工具）。
 *
 * ⚠⚠ 本版**出貨碼一行都沒改**（`src/` 零變更）。以下每一條守的都是守衛／工具層。
 *
 * 設計原則（#26 不准用 || 放寬、#27 不准恆真、#28 旗標層只能當補充）：
 *   - 被守的東西一律**當子行程真的跑起來**，比 exit code 與輸出，不比原始碼字串。
 *   - 每一條「應該綠」的斷言，旁邊都要有一條「改壞了必須紅」的正對照。
 *   - 需要歷史的段落一律 hasBaseCommit 保護、拿不到時 shallowSkip（v6.371 的教訓：
 *     本機 141/0、免疫網 0 紅，CI 淺複製照樣紅 2 條）。
 *   - 只在 CRLF 工作樹才成立的段落要偵測工作樹行尾，LF 時**大聲跳過**而不是假裝有在守
 *     （不然 CI／LF 免疫網會反過來紅）。
 */
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync, cpSync, unlinkSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { selfTest, scanSource } from './lint-eol-anchors.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_SHA = process.env.V6377_BASE || 'a434f4fc';

let pass = 0, fail = 0;
const chk = (name, cond, detail = '') => {
  if (cond) { console.log('  PASS ' + name); pass++; return true; }
  console.log('  FAIL ' + name + (detail ? '\n        ' + detail : ''));
  fail++; return false;
};
/** 大聲跳過（比照 shallowSkip）：這一段在這台機器上**沒有在守**。 */
const notes = [];
const loudSkip = (what, why) => {
  notes.push(what);
  console.log('  ⚠⚠ ENV-SKIP  ' + what + '　—— ' + why);
  console.log('  ⚠⚠ 這一段在本次執行【沒有在守】。');
};

// 臨時檔一律放在 scripts/ 底下（守衛用 import.meta.url 推 ROOT，放別處會推錯根），跑完刪掉。
const temps = [];
function tempScript(name, content) {
  const p = join(ROOT, 'scripts', '.v6377-tmp-' + name);
  writeFileSync(p, content);
  temps.push(p);
  return p;
}
const TMPDIR = mkdtempSync(join(tmpdir(), 'v6377-'));
process.on('exit', () => {
  for (const p of temps) { try { unlinkSync(p); } catch { /* */ } }
  try { rmSync(TMPDIR, { recursive: true, force: true }); } catch { /* */ }
});
const runNode = (file, args = []) => {
  const r = spawnSync(process.execPath, [file, ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
  return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
};
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const CHAIN = String((PKG.scripts && PKG.scripts.test) || '');

/** 這個 checkout 的工作樹是不是 CRLF（決定「拿掉 normEol 必紅」那一段能不能守）。 */
function crlfWorktree() {
  return readFileSync(join(ROOT, 'scripts/test-v6156-still-here.mjs'), 'utf8').includes('\r\n');
}

const LINT = join(ROOT, 'scripts/lint-eol-anchors.mjs');
const TOOL = join(ROOT, 'scripts/tools/shallow-parity.mjs');
const LINT_SRC = readFileSync(LINT, 'utf8');
const TOOL_SRC = readFileSync(TOOL, 'utf8');

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【A】C-9：行尾中性靜態掃描器 scripts/lint-eol-anchors.mjs');
// ══════════════════════════════════════════════════════════════════════════════
{
  const r = runNode(LINT);
  chk('★★★ A1 現況全綠：掃描器真的跑起來、exit=0、0 處違規',
    r.code === 0 && /0 處違規/.test(r.out), 'exit=' + r.code + '\n' + r.out.slice(-900));

  chk('★★ A2 掃描器的內建自驗（正／負對照）在本行程內也通過', selfTest().length === 0, JSON.stringify(selfTest()));

  // ── 正對照①：偵測邏輯改壞 ⇒ 自驗必須當場攔下來（不准退化成「掃到 0 個 ⇒ 全綠」）──
  {
    const mutated = LINT_SRC.replace(
      "return typeof s === 'string' && s.includes('\\n') && /[^\\r\\n]/.test(s);",
      'return false;   // v6377 突變：偵測器改壞');
    const changed = mutated !== LINT_SRC;
    const m = runNode(tempScript('lint-mut-detect.mjs', mutated));
    chk('★★★ A3 正對照：把 isMultilineAnchor 改成恆 false ⇒ 內建自驗必須紅（exit!=0）',
      changed && m.code !== 0 && /內建自驗失敗/.test(m.out),
      'anchorChanged=' + changed + ' exit=' + m.code + '\n' + m.out.slice(-600));
  }
  // ── 正對照②：掃不到檔 ⇒ 下限斷言必須紅 ──
  {
    const mutated = LINT_SRC.replace("['ls-files', '-z', 'scripts']", "['ls-files', '-z', 'scripts/lib']");
    const changed = mutated !== LINT_SRC;
    const m = runNode(tempScript('lint-mut-floor.mjs', mutated));
    chk('★★★ A4 正對照：把掃描範圍縮到只剩幾支 ⇒ 下限斷言必須紅（掃描器壞掉最典型的症狀）',
      changed && m.code !== 0 && /下限斷言失敗/.test(m.out),
      'anchorChanged=' + changed + ' exit=' + m.code + '\n' + m.out.slice(-600));
  }
  // ── 正對照③：白名單過期偵測 ──
  {
    const mutated = LINT_SRC.replace('export const ALLOW = [];',
      "export const ALLOW = [{ file: 'scripts/__v6377_not_exist.mjs', hay: 'X', method: 'indexOf', reason: 'v6377 過期偵測用' }];");
    const changed = mutated !== LINT_SRC;
    const m = runNode(tempScript('lint-mut-allow.mjs', mutated));
    chk('★★★ A5 正對照：ALLOW 塞一條蓋不到任何東西的豁免 ⇒ 必須紅（過期偵測；白名單要有代價）',
      changed && m.code !== 0 && /過期/.test(m.out),
      'anchorChanged=' + changed + ' exit=' + m.code + '\n' + m.out.slice(-600));
  }
  // ── 正／負對照④：直接餵原始碼給真的偵測函式 ──
  {
    const bad = [
      "import { readFileSync } from 'node:fs';",
      "const SRC = readFileSync('a.svelte', 'utf8');",
      "const A = '  {#if x}\\n    <y/>\\n';",
      'export const i = SRC.indexOf(A);',
    ].join('\n');
    const good = [
      "import { readFileSync } from 'node:fs';",
      "import { normEol } from './lib/eol-agnostic.mjs';",
      "const SRC = normEol(readFileSync('a.svelte', 'utf8'));",
      "const A = '  {#if x}\\n    <y/>\\n';",
      'export const i = SRC.indexOf(A);',
    ].join('\n');
    const rb = scanSource('<bad>', bad), rg = scanSource('<good>', good);
    chk('★★★ A6 正對照：同一段碼沒走 helper ⇒ 抓到 1 處；走了 normEol ⇒ 0 處（不是靠關掉偵測換全綠）',
      rb.rows.length === 1 && rg.rows.length === 0,
      'bad=' + JSON.stringify(rb.rows) + ' good=' + JSON.stringify(rg.rows));
  }
  // ── ⭐ A7：修好的守衛真的是**靠 normEol 在守**（拿掉就紅）──
  {
    const rel = 'scripts/test-v6156-still-here.mjs';
    const src = readFileSync(join(ROOT, rel), 'utf8');
    const NEEDLE = "const PAGE = normEol(readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8'));";
    const REVERT = "const PAGE = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');";
    if (!crlfWorktree()) {
      loudSkip('A7「拿掉 normEol 必紅」',
        '本機工作樹是 LF ⇒ normEol 在這裡是 no-op，拿掉不會紅（這正是它對 CI 零風險的原因）');
    } else if (src.split(NEEDLE).length - 1 !== 1) {
      chk('★★★ A7 前提：test-v6156 的 normEol 錨點唯一', false,
        '錨點出現 ' + (src.split(NEEDLE).length - 1) + ' 次');
    } else {
      const m = runNode(tempScript('v6156-nonorm.mjs', src.split(NEEDLE).join(REVERT)));
      const now = runNode(join(ROOT, rel));
      chk('★★★ A7 行為層：現況綠，而把 normEol 拿掉 ⇒ 必紅（證明修法是承重的，不是裝飾）',
        now.code === 0 && m.code !== 0,
        '現況 exit=' + now.code + ' / 拿掉 normEol exit=' + m.code + '\n' + m.out.slice(-400));
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【B】C-10：孤兒守衛的 harness');
// ══════════════════════════════════════════════════════════════════════════════
{
  const FD = 'scripts/test-festival-dance.mjs';
  const EV = 'scripts/test-evolve-iid-regression.mjs';

  const fd = runNode(join(ROOT, FD));
  chk('★★★ B1 test-festival-dance 真的跑起來且 exit=0', fd.code === 0, 'exit=' + fd.code + '\n' + fd.out.slice(-700));

  chk('★★ B2 test-festival-dance 已接進 npm test chain', CHAIN.includes('test-festival-dance.mjs'));
  chk('★★ B3 test-evolve-iid-regression 已接進 npm test chain', CHAIN.includes('test-evolve-iid-regression.mjs'));

  // ⭐ B4／B5：**沒有**接進 chain 的那兩支要留下理由，否則下一版又有人「順手接進去」。
  chk('★★★ B4 test-all-presets 沒有被接進 chain（它是報表工具：1332 場跑完 478 bugs 仍 exit 0，'
    + '接進去＝恆綠安慰劑；要當守衛必須先補判準 —— 待站長裁示）',
    existsSync(join(ROOT, 'scripts/test-all-presets.mjs')) && !CHAIN.includes('test-all-presets.mjs'));
  chk('★★★ B5 test-v2341-a-batch 沒有被接進 chain（harness 已修好，但 9/10 紅在**真判準**：'
    + '鐵荊棘ex／耿鬼ex／幸福蛋ex 等 7 個卡效尚未實裝 —— 待站長裁示）',
    existsSync(join(ROOT, 'scripts/test-v2341-a-batch.mjs')) && !CHAIN.includes('test-v2341-a-batch.mjs'));

  // ── HEAD-FAIL：把 BASE 版本原樣放回 scripts/ 跑，必須紅 ──────────────────────
  if (!hasBaseCommit(ROOT, BASE_SHA)) {
    shallowSkip('【B】HEAD-FAIL（BASE=' + BASE_SHA.slice(0, 8) + ' 的孤兒守衛必須紅）',
      'B1～B5 與【A】【B-mut】【C】都不需要歷史，仍在守');
  } else {
    const bFd = readBaseBlob(ROOT, BASE_SHA, FD);
    if (chk('★ B6 前提：讀得到 BASE 的 test-festival-dance', bFd.ok)) {
      const m = runNode(tempScript('base-festival.mjs', bFd.out));
      chk('★★★ B7 HEAD-FAIL：BASE 版 test-festival-dance 必須紅（pendingPrizes 已是 tuple ⇒ 舊斷言 0 !== 1）',
        m.code !== 0 && /pendingPrizes|0 !== 1|ERR_ASSERTION/.test(m.out),
        'exit=' + m.code + '\n' + m.out.slice(-500));
    }
    if (process.platform !== 'win32') {
      loudSkip('B8 HEAD-FAIL（BASE 版 test-evolve-iid-regression）',
        "BASE 的 bug 是 Windows 專屬：new URL(絕對路徑,'file://') 在 POSIX 上解得出 file:/// ⇒ BASE 在這台機器上是綠的");
    } else {
      const bEv = readBaseBlob(ROOT, BASE_SHA, EV);
      if (chk('★ B8a 前提：讀得到 BASE 的 test-evolve-iid-regression', bEv.ok)) {
        const m = runNode(tempScript('base-evolve.mjs', bEv.out));
        chk('★★★ B8 HEAD-FAIL：BASE 版 test-evolve-iid-regression 必須紅（Windows 絕對路徑當 ESM specifier）',
          m.code !== 0 && /ERR_UNSUPPORTED_ESM_URL_SCHEME/.test(m.out),
          'exit=' + m.code + '\n' + m.out.slice(-400));
      }
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【B-mut】⭐ test-festival-dance 的斷言真的在守（把出貨碼改壞 ⇒ 必紅）');
// ══════════════════════════════════════════════════════════════════════════════
{
  // ⚠ 不動 repo 的 src/：整棵 src 複製到暫存區再改（本專案既有作法，見 base-blob.restoreBaseSubtree）。
  const MUT = join(TMPDIR, 'mut-src');
  cpSync(join(ROOT, 'src'), MUT, { recursive: true });
  const shared = join(MUT, 'lib/game/effects/_shared.ts');
  const s0 = readFileSync(shared, 'utf8');
  // v5.466「自動給獎賞」的唯一入口 addPendingPrize ⇒ 讓它變成 no-op。
  const N_CRLF = '  if (n <= 0) return state;\r\n  const takerPeek = state.players[ownerIdx];';
  const N_LF = N_CRLF.replace(/\r\n/g, '\n');
  const useN = s0.includes(N_CRLF) ? N_CRLF : (s0.includes(N_LF) ? N_LF : null);
  if (chk('★ M0 前提：找得到 addPendingPrize 的唯一突變點（出貨碼重構了就要跟著改，不可以默默跳過）',
    useN !== null && s0.split(useN).length - 1 === 1)) {
    writeFileSync(shared, s0.split(useN).join(useN.replace('n <= 0', 'n >= 0')));
    const ENTRY = join(TMPDIR, 'entry.ts');
    writeFileSync(ENTRY, "export { createGame, applyAction } from './mut-src/lib/game/engine';\n");
    const OUT = join(TMPDIR, 'bundle.mjs');
    await build({
      entryPoints: [ENTRY], outfile: OUT, bundle: true, format: 'esm', platform: 'node', target: 'node20',
      alias: { '$lib': join(MUT, 'lib'), '$app/paths': join(ROOT, 'scripts/shim-app-paths.mjs') },
      external: [], logLevel: 'warning',
    });
    const { createGame, applyAction } = await import(pathToFileURL(OUT).href);
    const pool = new Map();
    const dir = join(ROOT, 'static/cards');
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json') || f === 'index.json') continue;
      for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) pool.set(String(c.id), c);
    }
    const CID = { applin: '10426', goldeen: '10440', swirlix: '10465', stadium: '10513', grass: '17217' };
    let n = 0;
    const inst = (cardId, extra = {}) => ({ iid: 't' + (++n), cardId, damage: 0, energyAttached: [], ...extra });
    let st = createGame(
      { name: 'P1', entries: [{ cardId: CID.applin, count: 1 }, { cardId: CID.grass, count: 1 }] },
      { name: 'P2', entries: [{ cardId: CID.goldeen, count: 1 }, { cardId: CID.swirlix, count: 1 }] }, pool);
    st = {
      ...st, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 1, isFirstTurn: false,
      setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
      activeStadium: inst(CID.stadium), activeStadiumOwnerIdx: 0, festivalDanceUsedThisTurn: [false, false],
      players: [
        { ...st.players[0], name: 'P1', active: inst(CID.applin, { energyAttached: [inst(CID.grass)] }),
          bench: Array.from({ length: 3 }, () => inst(CID.swirlix)), hand: [], deck: [], discard: [],
          prizes: Array.from({ length: 6 }, () => inst(CID.grass)) },
        { ...st.players[1], name: 'P2', active: inst(CID.goldeen), bench: [inst(CID.swirlix)],
          hand: [], deck: [], discard: [], prizes: Array.from({ length: 6 }, () => inst(CID.grass)) },
      ],
    };
    const pb = st.players[0].prizes.length, hb = st.players[0].hand.length;
    st = applyAction(st, { type: 'ATTACK', attackIndex: 0 }, pool);
    // 哨兵：突變必須只打掉「取獎賞」，KO 本身還要照常發生 —— 否則就是整支爆掉造成的假紅。
    chk('★★ M1 哨兵：突變後 KO 照常發生（不是整個引擎爆掉造成的假紅）',
      st.players[1].active === null, JSON.stringify({ defActive: st.players[1].active, turnPhase: st.turnPhase }));
    chk('★★★ M2 行為層佐證：addPendingPrize 改壞 ⇒ 攻擊方獎賞區沒少、手牌沒多 '
      + '⇒ test-festival-dance 新加的那兩條斷言**一定會紅**（證明它不是恆真）',
      st.players[0].prizes.length === pb && st.players[0].hand.length === hb,
      JSON.stringify({ pb, hb, pAfter: st.players[0].prizes.length, hAfter: st.players[0].hand.length }));
    // ⭐⭐ M3：M2 只證明「突變有效」，還沒證明**守衛檔本身**抓得到。
    //   這裡把 scripts/test-festival-dance.mjs **原封不動**拿來，只把它 esbuild 的入口
    //   改指向突變過的 src 副本，然後真的跑起來 —— 它必須紅。
    //   ⇒ 這一條同時擋住「把那兩條斷言改成恆真」：改成恆真的話這裡就會變綠 ⇒ 本守衛紅。
    {
      const fdSrc = readFileSync(join(ROOT, 'scripts/test-festival-dance.mjs'), 'utf8');
      const subs = [
        ["'.tmp-festival-test-bundle.mjs'", "'.tmp-v6377-festmut-bundle.mjs'"],
        ["'.tmp-festival-test-entry.ts'", "'.tmp-v6377-festmut-entry.ts'"],
        ["from './src/lib/game/engine'", 'from ' + JSON.stringify(join(MUT, 'lib/game/engine').split('\\').join('/'))],
        ["'$lib': join(REPO_ROOT, 'src/lib'),", "'$lib': " + JSON.stringify(join(MUT, 'lib')) + ','],
      ];
      let mutFd = fdSrc;
      let allFound = true;
      for (const [a, b] of subs) {
        if (mutFd.split(a).length - 1 !== 1) { allFound = false; console.log('        M3 錨點失配：' + a); continue; }
        mutFd = mutFd.split(a).join(b);
      }
      if (chk('★ M3a 前提：4 個入口改寫錨點都唯一命中（test-festival-dance 換過寫法就要跟著改）', allFound)) {
        const m = runNode(tempScript('festival-mut.mjs', mutFd));
        chk('★★★ M3 ⭐ 把**真的** test-festival-dance 指向突變過的出貨碼 ⇒ 它必須紅 '
          + '（若有人把那兩條斷言改成恆真，這裡就會變綠 ⇒ 本守衛紅）',
          m.code !== 0 && /ERR_ASSERTION|獎賞/.test(m.out),
          'exit=' + m.code + '\n' + m.out.slice(-600));
      }
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【C】C-15：兩張網工具 scripts/tools/shallow-parity.mjs');
// ══════════════════════════════════════════════════════════════════════════════
{
  chk('★ C1 工具存在', existsSync(TOOL));

  /** 從 --dry-run 的輸出抽出**真正要下給 git 的參數**（行為層，不是 grep 原始碼字串）。 */
  const gitArgsOf = (file, extra = []) => {
    const r = runNode(file, ['--dry-run', ...extra]);
    const m = /^GITARGS (.+)$/m.exec(r.out);
    if (!m) return { ok: false, args: null, out: r.out, code: r.code };
    try { return { ok: true, args: JSON.parse(m[1]), out: r.out, code: r.code }; }
    catch { return { ok: false, args: null, out: r.out, code: r.code }; }
  };
  const hasAutocrlfOff = (a) => { const i = a.indexOf('-c'); return i >= 0 && a[i + 1] === 'core.autocrlf=false'; };
  const hasDepth1 = (a) => { const i = a.indexOf('--depth'); return i >= 0 && a[i + 1] === '1'; };

  const real = gitArgsOf(TOOL);
  chk('★★★ C2 淺複製網的 git 參數真的帶 --depth 1 與 -c core.autocrlf=false',
    real.ok && hasDepth1(real.args) && hasAutocrlfOff(real.args),
    JSON.stringify(real.args) + ' out=' + real.out.slice(0, 300));
  const full = gitArgsOf(TOOL, ['--full']);
  chk('★★ C3 完整 clone 網（--full）不帶 --depth，但一樣是 LF（core.autocrlf=false）',
    full.ok && !hasDepth1(full.args) && hasAutocrlfOff(full.args), JSON.stringify(full.args));

  // 正對照：把關鍵旗標拿掉 ⇒ 上面那組檢查必須翻紅（不是只驗字串有沒有出現）
  {
    const mutated = TOOL_SRC.replace("if (mode === 'shallow') args.push('--depth', '1');", '');
    const changed = mutated !== TOOL_SRC;
    const g = gitArgsOf(tempScript('parity-nodepth.mjs', mutated));
    chk('★★★ C4 正對照：拿掉 --depth 1 ⇒ C2 的檢查必須不通過（淺複製網會退化成完整 clone）',
      changed && g.ok && !hasDepth1(g.args), 'changed=' + changed + ' args=' + JSON.stringify(g.args));
  }
  {
    const mutated = TOOL_SRC.replace("const args = ['clone', '-c', 'core.autocrlf=false'];", "const args = ['clone'];");
    const changed = mutated !== TOOL_SRC;
    const g = gitArgsOf(tempScript('parity-noautocrlf.mjs', mutated));
    chk('★★★ C5 正對照：拿掉 core.autocrlf=false ⇒ C2 的檢查必須不通過（clone 出來會是 CRLF，就不是 CI 的環境）',
      changed && g.ok && !hasAutocrlfOff(g.args), 'changed=' + changed + ' args=' + JSON.stringify(g.args));
  }
  chk('★ C6 檔頭寫清楚「推之前要跑兩張網」以及各自抓什麼',
    /推之前要跑兩張網/.test(TOOL_SRC) && /淺複製/.test(TOOL_SRC) && /完整 clone/.test(TOOL_SRC));
  chk('★★ C7 本工具**沒有**被接進 npm test chain（它會 clone 整個 repo，太重）',
    !CHAIN.includes('shallow-parity'));
  // ⭐ C8 跨平台（**行為層**）：ROOT 是從 import.meta.url 推出來的真正 repo 根、DEST 落在系統暫存區。
  //   ⚠ 不用 grep 原始碼有沒有出現 mklink／磁碟機代號 —— 檔頭在講解「為什麼不用它們」時本來就會提到，
  //     那種寫法會把說明文字當成違規（v6.377 實測就踩到了），而且也擋不住「接線沒接上」。
  {
    const lines = real.out.split(/\r?\n/);
    const rootLine = (lines.find((l) => l.startsWith('ROOT ')) || '').slice(5).trim();
    const destLine = (lines.find((l) => l.startsWith('DEST ')) || '').slice(5).trim();
    chk('★★ C8 跨平台（行為層）：ROOT 由 import.meta.url 推出＝真正的 repo 根；DEST 落在系統暫存區（沒有寫死本機路徑）',
      rootLine === ROOT && destLine.startsWith(tmpdir()),
      'ROOT=' + rootLine + ' 期望 ' + ROOT + ' / DEST=' + destLine + ' 期望前綴 ' + tmpdir());
  }
}

console.log('\n' + (fail === 0 ? '✅ 全部通過' : '❌ 有失敗') + '（PASS ' + pass + ' / FAIL ' + fail + '）');
if (notes.length) {
  console.log('⚠⚠⚠ 本次有 ' + notes.length + ' 段因為環境（工作樹行尾／平台）沒有在守：');
  for (const s of notes) console.log('⚠⚠⚠   - ' + s);
}
process.exit(fail === 0 ? 0 : 1);
