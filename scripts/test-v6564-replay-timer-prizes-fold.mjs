#!/usr/bin/env node
/**
 * v6.564 守衛（站長 2026-10-13 22:49／22:53）：
 *   ①「看錦標賽回放的時候 計時器的時間還會繼續跑，並請你確認計時時間的正確性」
 *      ⇒ 回放時「現在」＝這一格記錄當下的時間（伺服器逐動作格的 at、一般復盤記錄時的 at；舊資料用那一格的回合開始時間；終局用結束時間）；
 *         錦標賽對戰／觀戰改用伺服器時鐘（本機時間＋tClockOffset），因為盤面上的時間是伺服器寫的。
 *   ②「新的一般對戰復盤功能無法確認自己的獎賞卡」⇒ 遮蔽的復盤保留自己的獎賞卡，並在下方（自己）那一側攤開；對手的照樣蓋著。
 *   ③「線上對戰連線 和 我的錦標賽 幫我增加收摺的功能」⇒ 兩個清單可收合，狀態記在這台瀏覽器。
 *
 *   R：replay-record.ts／replay-tourn.ts 實跑（遮蔽保留自己的獎賞、記錄 at、解包保留 at）。
 *   T：對戰頁計時器三個 derived 抽出來實跑（回放停在 at／無 at 用回合開始／終局用結束時間／錦標賽用伺服器時鐘／休閒用本機）；tReplayGoto／tReplaySteps 接線。
 *   P：獎賞卡：視窗取卡三元式實跑（遮蔽復盤只攤開下方；對戰中兩側蓋著的都查不到）、縮圖條件與兩個 derived 的定義。
 *   F：replay-fold.ts 實跑（預設展開、壞資料、切換、localStorage 失敗不丟例外）；模板兩個收合鈕與條件。
 *   （真瀏覽器：test-v6560 E4／E4b 驗遮蔽復盤自己攤開、對手蓋著、計時器停住。）
 * 【H】BASE（v6.563）：R／T／P／F 全紅。
 */
import { extractBaseArchive } from './lib/base-archive.mjs';
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import zlib from 'node:zlib';
import { normEol } from './lib/eol-agnostic.mjs';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.563。
const BASE_SHA = '93582fe0';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

async function loadLibs(srcRoot) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6564-'));
  const E = join(tmp, 'e.ts'), O = join(tmp, 'o.mjs'), S = join(tmp, 's.js');
  writeFileSync(S, 'export const base="";export const browser=false;');
  const p = (x) => join(srcRoot, x).replace(/\\/g, '/');
  const parts = [`export * as RR from '${p('src/lib/game/replay-record')}';`, `export * as RT from '${p('src/lib/game/replay-tourn')}';`];
  if (existsSync(join(srcRoot, 'src/lib/game/replay-fold.ts'))) parts.push(`export * as RF from '${p('src/lib/game/replay-fold')}';`);
  // ⭐v6.565（Rule 40）：計時器四個數字搬進 game-timer.ts（唯一一份）⇒ T1 改呼叫它；BASE 沒有這支 ⇒ T1 照樣紅
  if (existsSync(join(srcRoot, 'src/lib/game/game-timer.ts'))) parts.push(`export * as GT from '${p('src/lib/game/game-timer')}';`);
  writeFileSync(E, parts.join('\n'));
  try {
    await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(srcRoot, 'src/lib'), '$app/paths': S, '$app/environment': S }, logLevel: 'silent', nodePaths: [join(ROOT, 'node_modules')] });
    return await import(pathToFileURL(O).href);
  } catch { return null; } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}

// ── R ───────────────────────────────────────────────────────────────────
async function libScenarios(L) {
  const r = {};
  if (!L) return r;
  const H = L.RR.HIDDEN_CARD_ID;
  const mk = () => ({
    phase: 'playing', turn: 3, activePlayerIndex: 0, log: [],
    players: [0, 1].map((k) => ({ name: 'P' + k, hand: [{ iid: 'h' + k, cardId: 'c' + k }], prizes: [{ iid: 'p' + k + 'a', cardId: 'pz' + k + 'a' }, { iid: 'p' + k + 'b', cardId: 'pz' + k + 'b', faceUp: true }], deck: [{ iid: 'd' + k, cardId: 'dk' + k }], discard: [], bench: [], active: null })),
  });
  // R1：遮蔽：自己的獎賞卡原樣保留（卡號、iid）；對手未翻開的變卡背、翻開的保留；牌庫雙方照樣卡背；對手手牌卡背
  const red = L.RR.redactStateForSeat(mk(), 1);
  const me = red.players[1], opp = red.players[0];
  r.R1 = me.prizes[0].cardId === 'pz1a' && me.prizes[0].iid === 'p1a' && me.prizes[1].cardId === 'pz1b'
    && opp.prizes[0].cardId === H && opp.prizes[0].iid !== 'p0a' && opp.prizes[1].cardId === 'pz0b'
    && me.deck[0].cardId === H && opp.deck[0].cardId === H && opp.hand[0].cardId === H && me.hand[0].cardId === 'c1'
    && !JSON.stringify(red).includes('"p0a"') && !JSON.stringify(red).includes('pz0a');
  r.R1n = JSON.stringify({ me: me.prizes, opp: opp.prizes });
  // R2：記錄每一格都帶 at（記錄當下的時間）
  const realNow = Date.now; let clock = 123456;
  Date.now = () => clock;
  try {
    const rec = L.RR.createReplayRecorder('G');
    const s1 = mk(); s1.id = 'G'; s1.phase = 'playing'; s1.log = [{ m: 1 }];
    L.RR.recordStep(rec, s1);
    clock = 200000; const s2 = mk(); s2.id = 'G'; s2.phase = 'playing'; s2.log = [{ m: 1 }, { m: 2 }]; s2.turn = 4;
    L.RR.recordStep(rec, s2);
    r.R2 = rec.steps.length === 2 && rec.steps[0].at === 123456 && rec.steps[1].at === 200000;
    r.R2n = JSON.stringify(rec.steps.map((x) => x.at));
  } finally { Date.now = realNow; }
  // R3：錦標賽逐動作格解包保留伺服器的 at；壞值不帶
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify([{ turn: 1, activePlayerIndex: 0, logLen: 2, ver: 5, at: 777, state: { a: 1 } }, { turn: 1, activePlayerIndex: 0, logLen: 3, ver: 6, at: 'x', state: { a: 2 } }]))).toString('base64');
  const dec = await L.RT.decodeTournStepBatches([gz]);
  r.R3 = dec.length === 2 && dec[0].at === 777 && dec[1].at === undefined;
  return r;
}

// ── T／P：對戰頁 ────────────────────────────────────────────────────────
function derivedExpr(pg, name) {
  const re = new RegExp('const ' + name + ' = \\$derived\\(([\\s\\S]*?)\\n  \\);');
  const m = re.exec(pg);
  return m ? m[1] : null;
}
function pageScenarios(pg, lib) {
  const r = {};
  // ⭐v6.565（Rule 40）：liveTurnTimeMs／gameTotalMs 改成讀 game-timer.ts computeTimerView 的結果 ⇒
  //   timerNow 照舊從頁面抽出來實跑（休閒那一支多了 getServerClockOffsetMs()，這裡給 null＝沒同步過，與 v6.564 同義），
  //   回合／總時間改呼叫 lib，並逐字鎖住頁面的接線（傳 timerNow、回放才給 tReplayAt 當備用結束時刻）。意圖（回放停住、錦標賽用伺服器時鐘）不變。
  const eNow = derivedExpr(pg, 'timerNow');
  const GT = lib && lib.GT;
  const wired = /const timerView = \$derived\(computeTimerView\(game, timerNow, isTReplay \? tReplayAt : null\)\);/.test(pg)
    && /const liveTurnTimeMs = \$derived\(timerView\.live\);/.test(pg) && /const gameTotalMs = \$derived\(timerView\.total\);/.test(pg);
  if (eNow && GT && wired) {
    const calc = (ctx) => {
      // eslint-disable-next-line no-new-func
      const now = new Function('isTReplay', 'tReplayAt', 'game', 'tickTime', 'isTournament', 'tClockOffset', 'getServerClockOffsetMs', 'return (' + eNow + ');')(ctx.isTReplay, ctx.tReplayAt, ctx.game, ctx.tickTime, ctx.isTournament, ctx.tClockOffset, () => null);
      const v = GT.computeTimerView(ctx.game, now, ctx.isTReplay ? ctx.tReplayAt : null);
      return { now, turn: v.live, total: v.total };
    };
    const g = { phase: 'playing', gameStartTime: 1_000_000, currentTurnStartTime: 1_600_000 };
    const base = { game: g, tickTime: 9_000_000, isTournament: false, tClockOffset: 0, isTReplay: false, tReplayAt: null };
    // 回放：停在這一格記錄的時間；隔了一段時間（tickTime 變大）也一樣
    const a1 = calc({ ...base, isTReplay: true, isTournament: true, tReplayAt: 1_660_000 });
    const a2 = calc({ ...base, isTReplay: true, isTournament: true, tReplayAt: 1_660_000, tickTime: 99_000_000 });
    // 舊資料沒有 at：用那一格的回合開始時間（本回合 0、總時間＝到回合開始）
    const b = calc({ ...base, isTReplay: true, tReplayAt: null });
    // 終局格：總時間＝結束時間 − 開始（不是到最後一個回合開始）
    const c = calc({ ...base, isTReplay: true, tReplayAt: 2_000_000, game: { ...g, phase: 'game-over' } });
    // 錦標賽對戰／觀戰：伺服器時鐘（本機慢了 5 分鐘 ⇒ offset +300000）
    const d = calc({ ...base, isTournament: true, tickTime: 1_700_000, tClockOffset: 300_000 });
    // 休閒：本機時鐘（不加 offset）
    const e = calc({ ...base, tickTime: 1_700_000, tClockOffset: 300_000 });
    r.T1 = a1.turn === 60_000 && a1.total === 660_000 && a2.turn === 60_000 && a2.total === 660_000
      && b.turn === 0 && b.total === 600_000 && c.total === 1_000_000
      && d.turn === 400_000 && d.total === 1_000_000 && e.turn === 100_000 && e.total === 700_000;
    r.T1n = JSON.stringify({ a1, a2, b, c, d, e });
  }
  // T2：接線：每一格帶 at、終局用 endedAt／savedAt、跳格時設定 tReplayAt
  const st = pg.match(/function tReplaySteps\(\): any\[\] \{[\s\S]*?\n  \}/);
  const go = pg.match(/function tReplayGoto\(i: number\) \{[\s\S]*?\n  \}/);
  r.T2 = !!st && /at: Number\.isFinite\(s\.at\) \? s\.at : null,/.test(st[0]) && /at: Number\.isFinite\(tReplay\.meta\?\.endedAt\) \? tReplay\.meta\.endedAt : \(Number\.isFinite\(tReplay\.meta\?\.savedAt\) \? tReplay\.meta\.savedAt : null\),/.test(st[0])
    && !!go && /tReplayAt = Number\.isFinite\(step\.at\) \? step\.at : null;/.test(go[0]) && /let tReplayAt = \$state<number \| null>\(null\);/.test(pg);
  // P1：獎賞卡視窗：遮蔽復盤只攤開下方（自己）；對戰中雙方蓋著的都查不到；攤開回放全部
  const m = pg.match(/\{@const\s+_pvcard\s*=\s*([^{}\n]*)\}/);
  if (m) {
    const run = (mode, faceUp, pvi, own) => { let calls = 0;
      const ret = new Function('prizeViewMode', '_pvc', 'getCard', '_pvi', 'replayShowsOwnPrizes', 'return (' + m[1] + ');')(mode, { faceUp, cardId: 'S' }, () => { calls++; return { n: 1 }; }, pvi, own);
      return !!ret && calls === 1; };
    r.P1 = run('battle', false, 0, true) === true && run('battle', false, 1, true) === false
      && run('battle', false, 0, false) === false && run('battle', false, 1, false) === false && run('battle', true, 1, false) === true && run('replay', false, 1, false) === true;
  }
  // P2：兩個 derived 的定義＋下方縮圖條件（舊檔自己的獎賞是卡背 ⇒ 不畫成翻正面）
  r.P2 = /const replayShowsOwnPrizes = \$derived\(isTReplay && !replayRevealAll\);/.test(pg) && /const replayShowsMyPrizes = \$derived\(replayShowsHidden \|\| replayShowsOwnPrizes\);/.test(pg)
    && /\{@const _pz = myPlayer\?\.prizes\[i\]\}\{@const _pc = _pz && \(_pz\.faceUp \|\| replayShowsMyPrizes\) \? getCard\(_pz\.cardId\) : null\}/.test(pg)
    && /class:prize-faceup=\{!!_pz && \(!!_pz\.faceUp \|\| \(replayShowsMyPrizes && !!_pc\)\)\}/.test(pg)
    && /\{@const _pz = oppPlayer\?\.prizes\[i\]\}\{@const _pc = _pz && \(_pz\.faceUp \|\| replayShowsHidden\) \? getCard/.test(pg);
  // F2：兩個收合鈕、條件、收合時列出場數
  r.F2 = (pg.match(/<button type="button" class="replay-fold-btn" aria-expanded=\{replayFold\.(online|tourn)\} onclick=\{\(\) => toggleReplayFold\('(online|tourn)'\)\}>/g) || []).length === 2
    && /\{#if !replayFold\.online\}\s*<!-- 收合中 -->\s*\{:else if replayList\.length === 0\}/.test(pg)
    && /\{#if !replayFold\.tourn\}\s*<!-- 收合中 -->\s*\{:else if myTournMatches\.needLogin\}/.test(pg)
    && /function toggleReplayFold\(sec: ReplayFoldSection\) \{ replayFold = toggleReplayFoldState\(replayFold, sec\); saveReplayFold\(replayFold\); \}/.test(pg)
    && /let replayFold = \$state\(loadReplayFold\(\)\);/.test(pg);
  return r;
}

// ── M：手機直式的計時器吃父層那一份（審查 P1：手機原本自己用本機 tickTime 再算一份 ⇒ 回放照跑）──
function mobileScenarios(pg, mp) {
  const r = {};
  if (!pg || !mp) return r;
  const code = mp.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');
  const ownCalc = /tickTime|Date\.now\(\)|currentTurnStartTime|playerTurnTimeMs/.test(code);   // gameStartTime 另有對戰紀錄時間戳的合法用途，不列
  r.M1 = !ownCalc
    && /const liveTurnTimeMs = \$derived\(timerMs\.live\);/.test(code) && /const p0TotalMs = \$derived\(timerMs\.p0\);/.test(code)
    && /const p1TotalMs = \$derived\(timerMs\.p1\);/.test(code) && /const gameTotalMs = \$derived\(timerMs\.total\);/.test(code)
    && /timerMs: \{ live: number; p0: number; p1: number; total: number \};/.test(code)
    && /<MobilePortraitBattle[\s\S]{0,1500}?timerMs=\{\{ live: liveTurnTimeMs, p0: p0TotalMs, p1: p1TotalMs, total: gameTotalMs \}\}/.test(pg);
  r.M1n = JSON.stringify({ ownCalc });
  return r;
}

// ── F：收合 leaf ──────────────────────────────────────────────────────
function foldScenarios(L) {
  const r = {};
  if (!L || !L.RF) return r;
  const F = L.RF;
  const t = F.toggleReplayFoldState(F.REPLAY_FOLD_DEFAULT, 'online');
  const store = {};
  globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  F.saveReplayFold(t);
  const back = F.loadReplayFold();
  globalThis.localStorage = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
  let threw = false, broke = null;
  try { F.saveReplayFold(t); broke = F.loadReplayFold(); } catch { threw = true; }
  delete globalThis.localStorage;
  r.F1 = F.REPLAY_FOLD_DEFAULT.online === true && F.REPLAY_FOLD_DEFAULT.tourn === true && t.online === false && t.tourn === true && F.REPLAY_FOLD_DEFAULT.online === true
    && back.online === false && back.tourn === true && !threw && broke && broke.online === true
    && F.parseReplayFold('{bad').online === true && F.parseReplayFold('{"tourn":false}').tourn === false && F.parseReplayFold('{"tourn":false}').online === true;
  return r;
}

const LABEL = {
  R1: '★★★ R1 遮蔽保留自己的獎賞卡（原卡號、原 iid）；對手未翻開的照樣卡背、原 iid 不外洩；牌庫與對手手牌照舊遮',
  R2: '★★ R2 一般復盤每一格記下記錄當下的時間（at）', R3: '★★ R3 錦標賽逐動作格解包保留伺服器的 at（壞值不帶）',
  T1: '★★★ T1 計時器實跑：回放停在那一格的時間（隔多久都不變）／舊資料用回合開始／終局用結束時間；錦標賽用伺服器時鐘；休閒用本機',
  T2: '★★ T2 接線：回放每一格帶 at、終局用 endedAt／savedAt、跳格時更新 tReplayAt',
  P1: '★★★ P1 獎賞卡視窗實跑：遮蔽的復盤只攤開下方（自己）；對戰中雙方蓋著的都查不到；攤開回放全部',
  P2: '★★ P2 兩個 derived 定義＋下方縮圖條件（舊檔卡背不畫成翻正面）；上方照舊',
  F1: '★★ F1 收合狀態：預設展開、切換不改原物件、存回讀得到、壞資料／localStorage 失敗不丟例外',
  F2: '★★ F2 模板：兩個收合鈕（aria-expanded）、收合時不列清單、切換即存',
  M1: '★★★ M1 手機直式計時器：不再自己用本機時間算（只剩一份），四個數字由父層 timerNow 那一份傳進來',
};
const PG = normEol(readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8'));
const MP = normEol(readFileSync(join(ROOT, 'src/routes/game/MobilePortraitBattle.svelte'), 'utf8'));
const L = await loadLibs(ROOT);
const g = async (fn) => { try { const x = await fn(); return x && typeof x === 'object' ? x : {}; } catch { return {}; } };
const all = async (pg, lib, mp) => ({ ...(await g(() => mobileScenarios(pg, mp))), ...(await g(() => libScenarios(lib))), ...(await g(() => pageScenarios(pg, lib))), ...(await g(() => foldScenarios(lib))) });
const R = await all(PG, L, MP);
for (const k of Object.keys(LABEL)) ok(LABEL[k], R[k] === true, R[k + 'n']);

console.log('【H】HEAD-FAIL（BASE v6.563）');
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('v6564 HEAD-FAIL', '需要歷史 commit');
else {
  const tmp = mkdtempSync(join(tmpdir(), 'v6564b-'));
  try {
    extractBaseArchive(ROOT, BASE_SHA, ["src/lib"], tmp);
    const LB = await loadLibs(tmp);
    const BP = normEol(readBaseBlob(ROOT, BASE_SHA, 'src/routes/game/+page.svelte').out || '');
    const BM = normEol(readBaseBlob(ROOT, BASE_SHA, 'src/routes/game/MobilePortraitBattle.svelte').out || '');
    const B = await all(BP, LB, BM);
    for (const k of Object.keys(LABEL)) ok(`★★★[H] v6.563：${k} 紅`, B[k] !== true, String(B[k]));
  } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}
console.log(`\n=== v6.564 回放計時器／自己的獎賞卡／復盤收合：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
