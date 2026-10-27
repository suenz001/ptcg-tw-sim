#!/usr/bin/env node
/**
 * v6.600 守衛：復盤顯示勝／敗與雙方牌組，下載檔名也帶上；本機的對戰完全不留紀錄（玩家建議）
 *
 * 站長 2026-10-24 裁定：
 *   ①復盤標示「這場我是勝還是敗」「我用什麼牌組對上什麼牌組」，下載的預設檔名也帶上；
 *   ②我方＝玩家自己取的牌組名稱；對手＝牌組原型（伺服器分類）；錦標賽對手查不到 ⇒「未知」可以接受；
 *   ③本機的對戰（本機雙人、vs AI）完全不需要任何紀錄（v6.563 起不記；這版連舊的也不列、存新的時清掉）；
 *   ④字數變多 ⇒ 手機排版要檢查。
 *
 * 【U】replay-label：勝敗計算（同側／異側／平手／觀戰）、舊檔推回（同名不標）、檔名（新格式／舊格式／錦標賽雙敗／
 *      對手牌組不明用暱稱／不合法字元）、牌組名稱清理；replayLabelFields 空值不寫；finalizeReplay 帶上欄位且遮蔽版保留；
 *      tournReplayToData 帶自己的牌組；REPLAY_FORMAT_VERSION 沒升
 * 【S】對戰頁：只記線上連線對戰；對手原型取「另一側」；結束時把雙方牌組交給 finalizeReplay；錦標賽下載帶報名的牌組名稱；
 *      清單用 ReplayRowLabel；replay-store 檔名與本機判準只呼叫中央
 * 【B】真瀏覽器（build/）：IndexedDB 存三場（新檔勝、舊檔、本機）⇒ 清單只列兩場、本機那場被清掉；勝敗標籤、牌組行；
 *      下載檔名；手機 390 寬不溢出
 * 【H】HEAD-FAIL：BASE（v6.599）上 U、S 逐條紅
 */
import { extractBaseArchive } from './lib/base-archive.mjs';
import { readFileSync, existsSync, mkdtempSync, rmSync, writeFileSync, createReadStream, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import http from 'node:http';
import { build } from 'esbuild';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { normEol } from './lib/eol-agnostic.mjs';
import { stripCommentsBlank } from './lib/strip-comments.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_SHA = '4e3c1af5';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + String(x).slice(0, 900) : '')); } };
const R = (p) => normEol(readFileSync(join(ROOT, p), 'utf8'));

async function loadMods(srcRoot) {
  if (!existsSync(join(srcRoot, 'src/lib/game/replay-label.ts'))) return null;
  const tmp = mkdtempSync(join(tmpdir(), 'v6600-'));
  const E = join(tmp, 'e.ts'), S = join(tmp, 's.js'), O = join(tmp, 'o.mjs');
  writeFileSync(S, 'export const base="";export const browser=false;');
  const p = (x) => join(srcRoot, x).replace(/\\/g, '/');
  writeFileSync(E, `export * from '${p('src/lib/game/replay-label')}';\nexport * from '${p('src/lib/game/replay-record')}';\nexport { tournReplayToData } from '${p('src/lib/game/replay-tourn')}';`);
  try {
    await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
      alias: { '$lib': join(srcRoot, 'src/lib'), '$app/paths': S, '$app/environment': S }, logLevel: 'silent', nodePaths: [join(ROOT, 'node_modules')] });
    return { ...(await import(pathToFileURL(O).href)) };
  } catch { return null; } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}

// 最小盤面（validateReplayData 只要 players 陣列）
const ST = (over = {}) => ({ id: 'g1', phase: 'playing', turn: 3, activePlayerIndex: 0, log: [{ message: 'x' }], players: [{ name: '小明', hand: [], deck: [], prizes: [] }, { name: '阿華', hand: [], deck: [], prizes: [] }], ...over });

function unitChecks(M) {
  const r = {};
  if (!M) return r;
  const C = M.computeReplayResult;
  // U1 對局結束時的勝敗：同側勝、異側敗、沒有勝者＝平手；記錄者不是 P1／P2、或還沒結束 ⇒ 不標
  r.U1 = C({ phase: 'game-over', winner: 0 }, 0) === 'win' && C({ phase: 'game-over', winner: 0 }, 1) === 'loss'
    && C({ phase: 'game-over', winner: 1 }, 1) === 'win' && C({ phase: 'game-over', winner: null }, 0) === 'draw'
    && C({ phase: 'game-over', winner: 1 }, null) === null && C({ phase: 'playing', winner: 1 }, 1) === null && C(null, 0) === null;
  // U2 顯示用：新檔讀 result；舊檔用「坐哪一側＋勝者名稱」推回；同名分不出來 ⇒ 不標；錦標賽沒有勝者 ⇒「雙敗」
  const O = M.replayResultOf, L = M.replayResultLabel;
  r.U2 = O({ result: 'loss', viewerSeat: 0, p1name: 'A', p2name: 'B', winnerName: 'A' }) === 'loss'
    && O({ viewerSeat: 1, p1name: 'A', p2name: 'B', winnerName: 'B' }) === 'win' && O({ viewerSeat: 0, p1name: 'A', p2name: 'B', winnerName: 'B' }) === 'loss'
    && O({ viewerSeat: 0, p1name: 'A', p2name: 'A', winnerName: 'A' }) === null && O({ viewerSeat: null, p1name: 'A', p2name: 'B', winnerName: 'A' }) === null
    && O({ result: 'bogus', viewerSeat: 0 }) === null
    && L({ result: 'draw', kind: 'tournament' }) === '雙敗' && L({ result: 'draw', kind: 'online' }) === '平手' && L({ result: 'win' }) === '勝' && L({}) === '';
  // U3 檔名：新格式（勝敗＋我的牌組＋對手原型）、對手不明 ⇒ 對手暱稱、舊檔 ⇒ 舊格式、錦標賽雙敗、不合法字元換成 _
  const F = M.replayFileName, ymd = '20261024-2130';
  const f1 = F({ viewerSeat: 1, p1name: '阿華', p2name: '小明', result: 'win', myDeckName: '我的沙奈朵', oppDeckName: '密勒頓ex' }, ymd);
  const f2 = F({ viewerSeat: 0, p1name: '小明', p2name: '阿華', result: 'loss', myDeckName: '我的沙奈朵' }, ymd);
  const f3 = F({ viewerSeat: 0, p1name: '小明', p2name: '阿華', winnerName: null }, ymd);
  const f4 = F({ kind: 'tournament', viewerSeat: 0, p1name: '小明', p2name: '阿華', result: 'draw', myDeckName: 'a/b:c*d\u0007e' }, ymd);
  r.U3 = f1 === '復盤-勝-我的沙奈朵-vs-密勒頓ex-20261024-2130.ptcgreplay' && f2 === '復盤-敗-我的沙奈朵-vs-阿華-20261024-2130.ptcgreplay'
    && f3 === '復盤-小明-vs-阿華-20261024-2130.ptcgreplay' && f4 === '復盤-雙敗-a_b_c_d_e-vs-阿華-20261024-2130.ptcgreplay';
  r.U3n = JSON.stringify([f1, f2, f3, f4]);
  // U4 牌組行與名稱清理；本機判準
  r.U4 = M.replayDeckLine({ myDeckName: 'X', oppDeckName: 'Y' }) === '我：X vs 對手：Y' && M.replayDeckLine({ myDeckName: 'X' }) === '我：X vs 對手：未知'
    && M.replayDeckLine({}) === '' && M.cleanReplayDeckName('  a​\n b ') === 'a b' && M.cleanReplayDeckName('   ') === null
    && M.cleanReplayDeckName('x'.repeat(60)).length === M.REPLAY_DECK_NAME_MAX
    && M.isLocalReplayKind('local') && M.isLocalReplayKind('ai') && !M.isLocalReplayKind('online') && !M.isLocalReplayKind('tournament');
  // U5 finalizeReplay：線上帶勝敗＋雙方牌組；遮蔽版保留；空值不寫；本機（不會被呼叫，但若呼叫）不標勝敗；格式版本沒升
  const rec = M.createReplayRecorder('g1'); M.recordStep(rec, ST());
  const fin = ST({ phase: 'game-over', winner: 1 });
  const d1 = M.finalizeReplay({ rec, finalState: fin, online: true, seat: 1, ai: false, revealOpp: false, appVersion: 't', now: 1, decks: { my: ' 我的 沙奈朵 ', opp: '密勒頓ex' } });
  const d2 = M.finalizeReplay({ rec, finalState: fin, online: true, seat: 0, ai: false, revealOpp: true, appVersion: 't', now: 1, decks: { my: '', opp: null } });
  const d3 = M.finalizeReplay({ rec, finalState: fin, online: false, seat: null, ai: true, revealOpp: true, appVersion: 't', now: 1 });
  r.U5 = !!d1 && d1.meta.result === 'win' && d1.meta.myDeckName === '我的 沙奈朵' && d1.meta.oppDeckName === '密勒頓ex' && d1.meta.revealed === false
    && !!d2 && d2.meta.result === 'loss' && !('myDeckName' in d2.meta) && !('oppDeckName' in d2.meta)
    && !!d3 && !('result' in d3.meta) && M.REPLAY_FORMAT_VERSION === 1 && M.validateReplayData(d1) === null;
  r.U5n = JSON.stringify([d1?.meta, d2?.meta, d3?.meta]);
  // U6 錦標賽下載：帶自己的牌組名稱與勝敗；對手牌組沒有（伺服器沒給）
  const t = M.tournReplayToData({ meta: { p1name: '小明', p2name: '阿華', winnerName: '小明', finalTurn: 5, endedAt: 9 }, finalLog: [], finalState: { ...fin, winner: 0 }, snapshots: [{ turn: 1, activePlayerIndex: 0, logLen: 1, state: ST() }] },
    { matchId: 'm1', viewerSeat: 0, appVersion: 't', now: 1, myDeckName: '報名的牌組' });
  r.U6 = !!t && t.meta.kind === 'tournament' && t.meta.result === 'win' && t.meta.myDeckName === '報名的牌組' && !('oppDeckName' in t.meta)
    && M.replayFileName(t.meta, ymd) === '復盤-勝-報名的牌組-vs-阿華-20261024-2130.ptcgreplay';
  r.U6n = JSON.stringify(t?.meta);
  // U7（審查 P2-1）問對手原型的時機：開打滿 310 秒才問（伺服器快取只用房號當 key、存 5 分鐘）；已拿到／請求中／6 次／非 Oracle／沒房號／不是 P1P2 都不問；
  //    取值取另一側、房號轉大寫、空字串＝查不到
  if (typeof M.canAskOppArchetype === 'function' && typeof M.oppArchetypeFrom === 'function') {
    const A = M.canAskOppArchetype, base = { opp: null, busy: false, tries: 0, oracle: true, roomCode: 'ab12', seat: 0, gameStartTime: 1_000_000, now: 1_000_000 + 310_000, clockSynced: true };
    r.U7 = M.REPLAY_ARCH_FRESH_MS === 310_000 && A(base) && !A({ ...base, now: base.now - 1 }) && A({ ...base, seat: 1 })
      && !A({ ...base, opp: 'x' }) && !A({ ...base, busy: true }) && !A({ ...base, tries: 6 }) && A({ ...base, tries: 5 }) && !A({ ...base, oracle: false })
      && !A({ ...base, clockSynced: false }) && !A({ ...base, roomCode: '' }) && !A({ ...base, seat: null }) && !A({ ...base, gameStartTime: undefined }) && !A({ ...base, gameStartTime: 0 })
      && M.oppArchetypeFrom({ AB12: { p1: 'P1原型', p2: 'P2原型' } }, 'ab12', 0) === 'P2原型' && M.oppArchetypeFrom({ AB12: { p1: 'P1原型', p2: 'P2原型' } }, 'ab12', 1) === 'P1原型'
      && M.oppArchetypeFrom({ AB12: { p1: null, p2: '' } }, 'AB12', 0) === null && M.oppArchetypeFrom({}, 'AB12', 1) === null && M.oppArchetypeFrom(null, 'AB12', 1) === null;
  }
  return r;
}

function staticChecks(GAME, STORE) {
  const r = {};
  const g = stripCommentsBlank(GAME), st = stripCommentsBlank(STORE);
  // S1 只記線上連線對戰（v6.563 的條件沒被放寬）
  r.S1 = /const replayRecordable = \$derived\(!!game && !isTournament && !isTReplay && !isTournSpectator && !isAdminMode\s*&& mode === 'online' && !isSpectator && \(myPlayerIndex === 0 \|\| myPlayerIndex === 1\)\);/.test(g);
  // S2 對手原型取另一側；結束時把雙方牌組交給 finalizeReplay（同一局才用）
  r.S2 = /if \(!canAskOppArchetype\(\{ opp: d\.opp, busy: d\.busy, tries: d\.tries, oracle: ORACLE_MODE, roomCode, seat: me, gameStartTime: g\.gameStartTime, now: gameClockNow\(\), clockSynced: getServerClockOffsetMs\(\) !== null \}\)\) return;/.test(g)
    && /if \(_replayDecks !== d\) return;[^\n]*\n\s*const name = oppArchetypeFrom\(m, code, me\);/.test(g)
    && /decks: _replayDecks\.gameId === g\.id \? \{ my: _replayDecks\.my \?\? replayMyDeckName\(\), opp: _replayDecks\.opp \} : \{ my: replayMyDeckName\(\) \} \}\);/.test(g)
    && /_replayDecks = \{ gameId: g\.id, my: replayMyDeckName\(\), opp: null, tries: 0, busy: false \};[^\n]*\n\s*replayFetchOppArchetype\(g\);/.test(g)
    && (g.match(/replayFetchOppArchetype\(g\);/g) || []).length === 2;
  // S3 錦標賽下載帶報名鎖定的牌組名稱（依這場的 eventId）
  r.S3 = /myDeckName: _evId && seat !== null \? \(tEvents\.find\(\(e\) => e && e\._id === _evId\)\?\.myDeckName \?\? null\) : null \}\);/.test(g);
  // S4 清單用 ReplayRowLabel（不在頁面裡另寫一份勝敗判斷）
  r.S4 = /<ReplayRowLabel meta=\{r\.meta\} \/>/.test(g) && !/replayResultOf|computeReplayResult/.test(g);
  // S5 replay-store：檔名與「本機不留」只呼叫中央
  r.S5 = /a\.download = replayFileName\(data\.meta, ymd\);/.test(st) && /!isLocalReplayKind\(r\.meta\.kind\)/.test(st)
    && /const locals = all\.filter\(\(r\) => isLocalReplayKind\(r\.meta\?\.kind\)\)/.test(st) && !/const safe = /.test(st);
  return r;
}

const M = await loadMods(ROOT);
const U = unitChecks(M);
ok('★★★ U1 對局結束時的勝敗（同側勝、異側敗、沒有勝者＝平手、觀戰不標）', U.U1 === true);
ok('★★★ U2 顯示用勝敗：新檔讀欄位、舊檔推回、同名不標、錦標賽「雙敗」', U.U2 === true);
ok('★★★ U3 下載檔名：勝敗＋我的牌組＋對手原型；對手不明用暱稱；舊檔維持舊格式；不合法字元換掉', U.U3 === true, U.U3n);
ok('★★ U4 牌組行「我：X vs 對手：Y」（不明＝未知）、名稱清理、本機判準', U.U4 === true);
ok('★★★ U5 finalizeReplay 帶勝敗與雙方牌組，遮蔽版保留，空值不寫，格式版本沒升', U.U5 === true, U.U5n);
ok('★★★ U6 錦標賽下載帶自己報名的牌組與勝敗', U.U6 === true, U.U6n);
ok('★★★ U7 對手原型：開打滿 310 秒才問（避開同房上一局的伺服器快取）、各種不問的情況、取另一側、房號大寫', U.U7 === true);
const S = staticChecks(R('src/routes/game/+page.svelte'), R('src/lib/game/replay-store.ts'));
ok('★★★ S1 只記線上連線對戰（本機雙人、vs AI 不記）', S.S1 === true);
ok('★★★ S2 對手原型的時機與取值走中央、換局不寫舊回應、結束時交給 finalizeReplay', S.S2 === true);
ok('★★ S3 錦標賽下載帶報名鎖定的牌組名稱（不是 P1／P2 不帶）', S.S3 === true);
ok('★★ S4 清單用 ReplayRowLabel（頁面沒有第二份勝敗判斷）', S.S4 === true);
ok('★★★ S5 下載檔名與「本機不留」只呼叫中央', S.S5 === true);
{
  const G = R('src/routes/game/+page.svelte'), ST_ = R('src/lib/game/replay-store.ts');
  const m1 = G.replace('if (_replayDecks !== d) return;', '');
  const m2 = ST_.replace('!isLocalReplayKind(r.meta.kind)', 'true');
  ok('★ 正對照：拿掉換局防護／不過濾本機 ⇒ S2／S5 紅', m1 !== G && m2 !== ST_ && staticChecks(m1, ST_).S2 === false && staticChecks(G, m2).S5 === false);
}

// ── W：對戰頁 replayFetchOppArchetype 抽出來實跑（假的 oracleRoomArchetypes；審查 P3-1）──
{
  const G = stripCommentsBlank(R('src/routes/game/+page.svelte'));
  const i0 = G.indexOf('function replayFetchOppArchetype(g: any) {');
  let W = null, why = '';
  if (i0 >= 0 && M) {
    let dd = 0, k = G.indexOf('{', i0);
    for (; k < G.length; k++) { if (G[k] === '{') dd++; else if (G[k] === '}') { dd--; if (dd === 0) break; } }
    const { transform } = await import('esbuild');
    const fnSrc = (await transform(G.slice(i0, k + 1), { loader: 'ts' })).code;
    const mk = (env) => {
      const calls = [];
      const box = new Function('M', 'env', 'calls', `
        let _replayDecks = env.decks; const ORACLE_MODE = env.oracle; let roomCode = env.room; let myPlayerIndex = env.seat;
        const gameClockNow = () => env.now; const getServerClockOffsetMs = () => (env.unsynced ? null : 0); const canAskOppArchetype = M.canAskOppArchetype, oppArchetypeFrom = M.oppArchetypeFrom;
        const oracleRoomArchetypes = (ids) => { calls.push(ids); return env.reply(ids); };
        ${fnSrc}
        return { f: replayFetchOppArchetype, get: () => _replayDecks, set: (v) => { _replayDecks = v; } };`)(M, env, calls);
      return { ...box, calls };
    };
    const flush = () => new Promise((rs) => setTimeout(rs, 0));
    const g = { id: 'G1', gameStartTime: 1_000_000 };
    const fresh = () => ({ gameId: 'G1', my: null, opp: null, tries: 0, busy: false });
    try {
      // a 正常：開打 5 分 10 秒後問、房號大寫、取另一側
      const a = mk({ decks: fresh(), oracle: true, room: 'ab12', seat: 1, now: 1_310_000, reply: async () => ({ AB12: { p1: '對手原型', p2: '我的原型' } }) });
      a.f(g); await flush(); await flush();
      // b 太早：不發
      const b = mk({ decks: fresh(), oracle: true, room: 'AB12', seat: 0, now: 1_309_999, reply: async () => ({}) }); b.f(g);
      // c 請求中不重發；回來之前換局 ⇒ 舊回應不寫進新局
      let rel; const c = mk({ decks: fresh(), oracle: true, room: 'AB12', seat: 0, now: 2_000_000, reply: () => new Promise((rs) => { rel = rs; }) });
      c.f(g); c.f(g); const cCalls = c.calls.length; const old = c.get(); c.set({ ...fresh(), gameId: 'G2' }); rel({ AB12: { p1: 'x', p2: '舊局原型' } }); await flush(); await flush();
      // d 非 Oracle（測試站）不發；e 換到別局的 g 不發
      const d = mk({ decks: fresh(), oracle: false, room: 'AB12', seat: 0, now: 2_000_000, reply: async () => ({}) }); d.f(g);
      const e = mk({ decks: fresh(), oracle: true, room: 'AB12', seat: 0, now: 2_000_000, reply: async () => ({}) }); e.f({ id: 'OTHER', gameStartTime: 1 });
      const u = mk({ decks: fresh(), oracle: true, room: 'AB12', seat: 0, now: 2_000_000, unsynced: true, reply: async () => ({}) }); u.f(g);   // 還沒對時 ⇒ 不發
      // f 查不到就再問，最多 6 次
      const f6 = mk({ decks: fresh(), oracle: true, room: 'AB12', seat: 0, now: 2_000_000, reply: async () => ({}) });
      for (let i = 0; i < 9; i++) { f6.f(g); await flush(); await flush(); }
      W = a.calls.length === 1 && a.calls[0][0] === 'AB12' && a.get().opp === '對手原型'
        && b.calls.length === 0 && cCalls === 1 && old.opp === null && c.get().opp === null
        && d.calls.length === 0 && e.calls.length === 0 && u.calls.length === 0 && f6.calls.length === 6;
      why = JSON.stringify({ a: [a.calls, a.get().opp], b: b.calls.length, cCalls, cOld: old.opp, cNew: c.get().opp, d: d.calls.length, e: e.calls.length, f: f6.calls.length });
    } catch (err) { why = 'ERR ' + err.message; }
  }
  ok('★★★ W1 replayFetchOppArchetype 實跑：滿 5 分 10 秒才問、房號大寫、取另一側；請求中不重發、換局不寫舊回應、測試站不發、還沒對時不發、最多 6 次', W === true, why);
}

// ── B：真瀏覽器 ──
const BUILD = process.env.PTCG_ACCEPTANCE_BUILD || join(ROOT, 'build');
if (!existsSync(join(BUILD, '404.html'))) shallowSkip('B（沒有 build/；CI 的 build 步驟之後才有）');
else {
  const chromium = pwChromium('v6.600');
  const browser = chromium ? await pwLaunchWith(chromium, 'v6.600') : null;
  if (!browser) shallowSkip('B（沒有可用的 Chromium）');
  else {
    const tmpB = mkdtempSync(join(tmpdir(), 'v6600b-'));
    const E = join(tmpB, 'e.ts'), O = join(tmpB, 'o.js');
    writeFileSync(E, `export * from '${join(ROOT, 'src/lib/game/replay-store').replace(/\\/g, '/')}';`);
    await build({ entryPoints: [E], outfile: O, bundle: true, format: 'iife', globalName: 'RSX', platform: 'browser', target: 'es2020', alias: { '$lib': join(ROOT, 'src/lib') }, logLevel: 'silent' });
    const RSX = readFileSync(O, 'utf8');
    rmSync(tmpB, { recursive: true, force: true });
    const LONG = '我的超級長牌組名稱沙奈朵ex加上一堆字測試換行';
    const mk = (gid, savedAt, meta) => ({ format: 'ptcg-tw-sim-replay', v: 1, finalLog: [], finalState: ST({ phase: 'game-over', winner: 1 }),
      snapshots: [{ turn: 1, activePlayerIndex: 0, logLen: 1, state: ST() }],
      meta: { kind: 'online', gameId: gid, p1name: '小明', p2name: '阿華', winnerName: '阿華', finalTurn: 3, savedAt, appVersion: 't', viewerSeat: 1, revealed: false, ...meta } });
    const FIX = [
      mk('g-local', 1760000000000, { kind: 'local', viewerSeat: null, revealed: true }),
      mk('g-old', 1760000100000, { viewerSeat: 0 }),   // 舊檔：沒有新欄位、小明（自己）輸給阿華 ⇒ 推回「敗」
      mk('g-new', 1760000200000, { result: 'win', myDeckName: LONG, oppDeckName: '密勒頓ex' }),
    ];
    const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      if (u.pathname.startsWith('/api/')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{}'); }
      let p = join(BUILD, decodeURIComponent(u.pathname));
      if (existsSync(p + '.html')) p += '.html'; else if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
      if (!existsSync(p)) p = join(BUILD, '404.html');
      res.writeHead(200, { 'content-type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream' }); createReadStream(p).pipe(res);
    });
    await new Promise((rs) => srv.listen(0, rs));
    const port = srv.address().port;
    const res = {};
    try {
      for (const [tag, theme, vp] of [['desk', 'light', { width: 1280, height: 900 }], ['mob', 'dark', { width: 390, height: 844 }]]) {
        const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: vp, acceptDownloads: true });
        await ctx.addInitScript((t) => { try { localStorage.setItem('ptcg_ui_theme', t); } catch { /* */ } }, theme);
        await ctx.route(/asia\.pokemon-card\.com|ptcg-tw-sim-img|weserv/, (rt) => rt.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="245" height="342"/>' }));
        await ctx.route(/firebase|googleapis|gstatic/, (rt) => rt.fulfill({ status: 404, body: '' }));
        const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
        await pg.goto(`http://localhost:${port}/game`, { waitUntil: 'load' });
        await pg.addScriptTag({ content: RSX });
        // 依序存：本機（舊版留下的）→ 舊檔 → 新檔；存新檔時要把本機那場清掉
        const seeded = await pg.evaluate(async (fx) => {
          const RS = window.RSX;
          await new Promise((r) => { const q = indexedDB.deleteDatabase('ptcg-tw-sim-replays'); q.onsuccess = q.onerror = q.onblocked = () => r(); });
          // 本機那場用原始寫入（模擬 v6.563 以前留下的；saveReplay 只會被線上對戰呼叫）
          await RS.saveReplay(fx[0]);
          const beforeLocal = (await RS.listReplays()).length;
          await RS.saveReplay(fx[1]); await RS.saveReplay(fx[2]);
          const raw = await new Promise((r) => { const q = indexedDB.open('ptcg-tw-sim-replays'); q.onsuccess = () => { const db = q.result; const g = db.transaction('replays', 'readonly').objectStore('replays').getAll(); g.onsuccess = () => { r(g.result.map((x) => x.meta?.kind)); db.close(); }; }; });
          return { beforeLocal, list: (await RS.listReplays()).map((x) => x.meta.gameId), raw };
        }, FIX);
        await pg.goto(`http://localhost:${port}/game`, { waitUntil: 'load' });
        await pg.waitForSelector('.replay-list li', { timeout: 60000 }); await pg.waitForTimeout(500);
        const out = { errs, seeded };
        out.rows = await pg.evaluate(() => [...document.querySelectorAll('.replay-lobby .replay-list')][0] ? [...[...document.querySelectorAll('.replay-lobby .replay-list')][0].querySelectorAll('li')].map((li) => ({
          res: li.querySelector('.rr-res')?.textContent?.trim() ?? null, resCls: li.querySelector('.rr-res')?.className ?? '',
          names: li.querySelector('.rr-names')?.textContent?.replace(/\s+/g, ' ').trim() ?? '', decks: li.querySelector('.rr-decks')?.textContent?.trim() ?? null,
        })) : []);
        out.geo = await pg.evaluate(() => {
          const li = document.querySelector('.replay-lobby .replay-list li'); const r = li.getBoundingClientRect();
          const kids = [...li.querySelectorAll('*')].map((e) => e.getBoundingClientRect().right);
          const b = li.querySelector('.rr-res'); const cs = b ? getComputedStyle(b) : null;
          return { liRight: Math.round(r.right), maxChildRight: Math.round(Math.max(...kids)), vw: innerWidth, sw: document.documentElement.scrollWidth, badgeColor: cs?.color, badgeBg: cs?.backgroundColor };
        });
        // 下載：攔截 <a>.click() 記下 download 屬性（headless 的 blob 下載事件不一定帶檔名）
        await pg.evaluate(() => { const orig = HTMLAnchorElement.prototype.click; window.__dlNames = []; HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__dlNames.push(this.download); return; } return orig.call(this); }; });
        await pg.locator('.replay-lobby .replay-list li').first().locator('button', { hasText: '下載' }).click();
        for (let i = 0; i < 30 && !(await pg.evaluate(() => window.__dlNames.length)); i++) await pg.waitForTimeout(200);
        out.file = await pg.evaluate(() => window.__dlNames[0] ?? null);
        res[tag] = out;
        await ctx.close();
      }
    } finally { await browser.close(); srv.close(); }
    const good = (x) => x && x.errs.length === 0 && x.seeded.beforeLocal === 0 && JSON.stringify(x.seeded.list) === '["g-new","g-old"]'
      && !x.seeded.raw.includes('local') && x.rows.length === 2
      && x.rows[0].res === '勝' && /rr-win/.test(x.rows[0].resCls) && x.rows[0].decks === `🃏 我：${LONG} vs 對手：密勒頓ex`
      && x.rows[1].res === '敗' && x.rows[1].decks === null && /小明 vs 阿華/.test(x.rows[1].names)
      && /^復盤-勝-我的超級長牌組名稱沙奈朵ex加上-vs-密勒頓ex-\d{8}-\d{4}\.ptcgreplay$/.test(x.file || '');
    ok('★★★ B1 桌機（淺色）：本機的舊紀錄不列、存新的時清掉；勝／敗標籤、牌組行；下載檔名帶勝敗與雙方牌組', good(res.desk), JSON.stringify(res.desk));
    ok('★★★ B2 手機（深色）：同樣內容', good(res.mob), JSON.stringify(res.mob));
    const gm = res.mob?.geo;
    ok('★★★ B3 手機排版：長牌組名稱換行、不超出清單框、不撐出橫向捲動', !!gm && gm.maxChildRight <= gm.liRight + 1 && gm.sw <= gm.vw && gm.badgeColor === 'rgb(255, 255, 255)', JSON.stringify(gm));
  }
}

// ── H：HEAD-FAIL ──
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('HEAD-FAIL（缺 BASE ' + BASE_SHA + '）');
else {
  const tmp = mkdtempSync(join(tmpdir(), 'v6600h-'));
  try {
    const { execFileSync } = await import('node:child_process');
    extractBaseArchive(ROOT, BASE_SHA, ['src'], tmp);
    const bU = unitChecks(await loadMods(tmp));
    const bg = readBaseBlob(ROOT, BASE_SHA, 'src/routes/game/+page.svelte'), bs = readBaseBlob(ROOT, BASE_SHA, 'src/lib/game/replay-store.ts');
    const bS = staticChecks(normEol(bg.out), normEol(bs.out));
    const red = [...['U1', 'U2', 'U3', 'U4', 'U5', 'U6', 'U7'].filter((k) => bU[k] !== true), ...['S2', 'S3', 'S4', 'S5'].filter((k) => bS[k] !== true)];
    ok('★★★ HEAD-FAIL：BASE（v6.599）上 U1～U7、S2～S5 逐條紅', red.length === 11, red.join(','));
    ok('★ HEAD-FAIL 正對照：BASE 上 S1（只記線上連線對戰）本來就成立', bS.S1 === true);
  } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}

console.log(`\n=== v6.600 復盤勝敗與雙方牌組：${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
