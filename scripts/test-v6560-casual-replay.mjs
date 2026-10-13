#!/usr/bin/env node
/**
 * v6.560 守衛：一般對戰（本機雙人／vs AI／休閒線上）復盤。
 *   站長 2026-10-13 裁定：①線上對戰的復盤先預設「看不到」對手手牌與獎賞卡，admin 監控有開關 ②瀏覽器保留最近 10 場
 *   ③每個動作一格，另有「跳到上／下一回合」。
 *
 *   A：replay-record.ts（逐動作記錄、去重、退回時截斷、只記 playing、結束組資料、遮蔽規則、驗證、跳回合）——用 AI 對打的真實對局驗。
 *   S：replay-store.ts 的 gzip 檔案來回（parseReplayBytes）；保留 10 場常數。
 *   P：replay-policy.ts 預設關、只有 true 才開；policy-loader 讀同一份 config/cardPolicy；admin 寫入只動 replayRevealOpp 且 merge。
 *   W：對戰頁接線（記錄條件、結束時走 finalizeReplay＋saveReplay、獎賞卡只在攤開的回放翻正面、遮蔽時不給切視角、錦標賽回放走同一個入口）。
 *   E：真瀏覽器（build/）：匯入復盤檔 → 逐步／跳回合／遮蔽時獎賞卡蓋著且視角固定；開一局 vs AI 打幾步 ⇒ 瀏覽器裡有進行中的記錄。
 * 【H】BASE（v6.559）：A／S／P／W 紅。
 */
import { readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import { build } from 'esbuild';
import { hasBaseCommit, shallowSkip, readBaseBlob } from './lib/base-blob.mjs';
import { buildAiBundle, loadLivePool, presetById, playGame, firstPlayerOf } from './lib/ai-sim-harness.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';
import { normEol } from './lib/eol-agnostic.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.559。
const BASE_SHA = '14f5c0f5';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

const mod = await buildAiBundle(ROOT, {});
const pool = loadLivePool(ROOT);

async function loadLib(srcRoot) {
  if (!existsSync(join(srcRoot, 'src/lib/game/replay-record.ts'))) return null;
  const tmp = mkdtempSync(join(tmpdir(), 'v6560-'));
  const E = join(tmp, 'e.ts'), S = join(tmp, 's.js'), O = join(tmp, 'o.mjs');
  writeFileSync(S, 'export const base="";export const browser=false;');
  const p = (x) => join(srcRoot, x).replace(/\\/g, '/');
  writeFileSync(E, `export * as RR from '${p('src/lib/game/replay-record')}';\nexport * as RS from '${p('src/lib/game/replay-store')}';\nexport * as RP from '${p('src/lib/game/replay-policy')}';`);
  try {
    await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
      alias: { '$lib': join(srcRoot, 'src/lib'), '$app/paths': S, '$app/environment': S }, logLevel: 'silent', nodePaths: [join(ROOT, 'node_modules')] });
    return await import(pathToFileURL(O).href);
  } catch { return null; } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}

/** 用 AI 對打一場，餵給 recorder；回傳 { rec, final, states }。 */
function playAndRecord(L, seed = 3) {
  const agents = [(st, i) => mod.aiNew(st, pool, i), (st, i) => mod.aiNew(st, pool, i)];
  let rec = null; let final = null; const states = [];
  playGame({ mod, pool, decks: [presetById(mod, '__preset_cynthia_garchomp__'), presetById(mod, '__preset_mbg__')], agents, seed, firstPlayer: firstPlayerOf(seed),
    onStep: (st, act, next) => {
      for (const g of [st, next]) {
        if (!g || !g.id) continue;
        if (!rec) rec = L.RR.createReplayRecorder(g.id);
        L.RR.recordStep(rec, g); states.push(g);
        if (g.phase === 'game-over') final = g;
      }
    } });
  return { rec, final, states };
}

async function scenarios(L, srcRoot) {
  const r = {};
  if (!L) { for (const k of ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'S1', 'P1']) r[k] = false; }
  else {
    const RR = L.RR;
    const { rec, final, states } = playAndRecord(L);
    // A1：逐動作記錄——只記 playing、每一步 log 長度不遞減、沒有重複盤面、步數遠多於半回合數
    const half = new Set(rec.steps.map((s) => s.turn + '|' + s.activePlayerIndex)).size;
    const keys = rec.steps.map((s) => JSON.stringify(s.state));
    r.A1 = !!final && rec.steps.length > 3 * half && half >= 6 && rec.steps.every((s) => s.state.phase === 'playing' && s.state.log.length === 0)
      && rec.steps.every((s, i) => i === 0 || s.logLen >= rec.steps[i - 1].logLen) && new Set(keys).size === keys.length;
    r.A1n = JSON.stringify({ steps: rec.steps.length, half, final: !!final });
    // A2：同一份盤面重複推 ⇒ 不記；log 變短（退回）⇒ 截斷再記；別局／setup ⇒ 拒記
    {
      const r2 = RR.createReplayRecorder(rec.gameId);
      const play = states.filter((g) => g.phase === 'playing');
      const a = play[10], b = play[40];
      const n1 = [RR.recordStep(r2, a), RR.recordStep(r2, a), RR.recordStep(r2, b)];
      const back = { ...a, log: a.log.slice(0, Math.max(0, a.log.length - 1)), turn: a.turn, _probe: 1 };
      const n2 = RR.recordStep(r2, back);
      const other = RR.recordStep(r2, { ...a, id: 'another-game' });
      const setup = RR.recordStep(r2, { ...a, phase: 'setup' });
      // undo 回到剩下最後一格的盤面 ⇒ 不重複記（審查 P3）
      const r3 = RR.createReplayRecorder(rec.gameId);
      RR.recordStep(r3, a); RR.recordStep(r3, b);
      const undoBack = RR.recordStep(r3, a);
      r.A2 = n1.join() === 'true,false,true' && n2 === true && r2.steps.length === 1 && r2.steps[0].logLen === back.log.length && other === false && setup === false
        && (b.log.length > a.log.length ? (undoBack === false && r3.steps.length === 1) : true);
      r.A2n = JSON.stringify({ n1, n2, len: r2.steps.length, other, setup });
    }
    // A3：本機／AI 一律攤開；線上 revealOpp=false ⇒ 遮蔽
    const seat = 0, other = 1;
    const now = 1760000000000;
    const local = RR.finalizeReplay({ rec, finalState: final, online: false, seat: null, ai: true, revealOpp: false, appVersion: 'T', now });
    const onRed = RR.finalizeReplay({ rec, finalState: final, online: true, seat, ai: false, revealOpp: false, appVersion: 'T', now });
    const onRev = RR.finalizeReplay({ rec, finalState: final, online: true, seat, ai: false, revealOpp: true, appVersion: 'T', now });
    r.A3 = local.meta.kind === 'ai' && local.meta.revealed === true && local.meta.viewerSeat === null
      && onRed.meta.kind === 'online' && onRed.meta.revealed === false && onRed.meta.viewerSeat === 0
      && onRev.meta.revealed === true && onRev.meta.viewerSeat === 0
      && local.snapshots.length === rec.steps.length && local.finalLog.length === final.log.length && local.finalState.log.length === 0
      && local.meta.p1name === final.players[0].name && local.meta.winnerName === final.players[final.winner].name && local.meta.savedAt === now;
    // A4：遮蔽規則（每一份快照＋終局）：對手手牌、雙方未翻開的獎賞、雙方牌庫 → __HIDDEN__；張數不變；自己手牌、棄牌、場上保留；待選視窗清空
    const H = RR.HIDDEN_CARD_ID;
    const all = [...onRed.snapshots.map((s) => s.state), onRed.finalState];
    const orig = [...local.snapshots.map((s) => s.state), local.finalState];
    const bad = [];
    all.forEach((st, i) => {
      const o = orig[i];
      const P = st.players, OP = o.players;
      if (P[other].hand.length !== OP[other].hand.length || P[other].hand.some((c) => c.cardId !== H)) bad.push(i + ':opp-hand');
      if (JSON.stringify(P[seat].hand) !== JSON.stringify(OP[seat].hand)) bad.push(i + ':my-hand');
      for (const k of [0, 1]) {
        if (P[k].prizes.length !== OP[k].prizes.length) bad.push(i + ':prize-len');
        // ⭐v6.564（站長／玩家回報，Rule 40）：自己的獎賞卡保留（原卡、原 iid）；對手的未翻開照樣卡背
        P[k].prizes.forEach((c, j) => { const want = (k === seat || OP[k].prizes[j].faceUp) ? OP[k].prizes[j].cardId : H; if (c.cardId !== want) bad.push(i + ':prize'); if (k === seat && c.iid !== OP[k].prizes[j].iid) bad.push(i + ':my-prize-iid'); });
        if (P[k].deck.length !== OP[k].deck.length || P[k].deck.some((c) => c.cardId !== H)) bad.push(i + ':deck');
        if (JSON.stringify(P[k].discard) !== JSON.stringify(OP[k].discard) || JSON.stringify(P[k].active) !== JSON.stringify(OP[k].active)) bad.push(i + ':public');
      }
      if (st.pendingSelection != null) bad.push(i + ':pending');
      for (const k of ['pendingChainQueue', 'deckTopKnown', '_discardWatch']) if (k in st) bad.push(i + ':' + k);
      // 被遮住的卡：iid 一律是不透明編號；原本的 iid 不得出現在這一份快照的任何地方（抓所有可能洩漏的欄位）
      const js = JSON.stringify(st);
      const hiddenOrig = [];
      for (const k of [0, 1]) {
        if (k === other) OP[k].hand.forEach((c) => hiddenOrig.push(c.iid));
        if (k === other) OP[k].prizes.forEach((c) => { if (!c.faceUp) hiddenOrig.push(c.iid); });   // ⭐v6.564 只有對手的獎賞卡被遮
        OP[k].deck.forEach((c) => hiddenOrig.push(c.iid));
        for (const z of ['hand', 'prizes', 'deck']) for (const c of P[k][z]) if (c.cardId === H && !/^h[01][hpd]\d+$/.test(c.iid)) bad.push(i + ':opaque');
      }
      for (const iid of hiddenOrig) if (js.includes('"' + iid + '"')) { bad.push(i + ':iid-leak:' + iid); break; }
    });
    const cardIdsInFile = JSON.stringify(onRed);
    r.A4 = bad.length === 0 && all.length === orig.length;
    r.A4n = bad.slice(0, 5).join(',');
    // A5：遮蔽後檔案裡找不到對手任何一張手牌的真卡號（以最後一步對手手牌抽查）
    // A5：iid 對照攻擊（審查 P1）——拿檔案裡所有公開位置的 iid→卡號，去對照被遮住的卡，一張都對不到；
    //   正對照：同樣的攻擊對「只換卡號、保留 iid」的舊遮法能還原一大半
    {
      const attack = (snaps) => {
        const known = new Map();
        const walk = (x) => { if (Array.isArray(x)) { x.forEach(walk); return; } if (x && typeof x === 'object') { if (typeof x.iid === 'string' && typeof x.cardId === 'string' && x.cardId !== H) known.set(x.iid, x.cardId); for (const v of Object.values(x)) walk(v); } };
        snaps.forEach(walk);
        let hidden = 0, cracked = 0;
        for (const st of snaps) for (const k of [0, 1]) for (const z of ['hand', 'prizes', 'deck']) for (const c of st.players[k][z]) if (c.cardId === H) { hidden++; if (known.has(c.iid)) cracked++; }
        return { hidden, cracked };
      };
      const now1 = attack(all);
      const oldStyle = orig.map((st) => { const q = JSON.parse(JSON.stringify(st)); q.players.forEach((p, k) => { if (k === other) p.hand = p.hand.map((c) => ({ iid: c.iid, cardId: H })); p.deck = p.deck.map((c) => ({ iid: c.iid, cardId: H })); }); return q; });
      const old1 = attack(oldStyle);
      r.A5 = now1.hidden > 1000 && now1.cracked === 0 && old1.cracked > old1.hidden * 0.2 && cardIdsInFile.includes(H);
      r.A5n = JSON.stringify({ now1, old1 });
    }
    // A10：遮蔽清掉暫存欄位（AI 對局不一定出現，人工放進去驗）
    {
      const st = JSON.parse(JSON.stringify(orig[5]));
      st.deckTopKnown = { p1: { iids: [st.players[0].deck[0]?.iid], restSig: 'x' }, p2: { iids: [st.players[1].deck[0]?.iid], restSig: 'y' } };
      st.pendingChainQueue = [{ type: 'deck-search', params: { validIids: st.players[1].deck.map((c) => c.iid) } }];
      st._discardWatch = { p1: [], p2: [], logLen: 1, h1: {}, h2: {} };
      st.pendingSelection = { type: 'deck-search' };
      const red = RR.redactStateForSeat(st, 0);
      r.A10 = !('deckTopKnown' in red) && !('pendingChainQueue' in red) && !('_discardWatch' in red) && red.pendingSelection === null && ('deckTopKnown' in st);
    }
    // A9：fail-closed 與進行中那份
    {
      const noSeat = RR.finalizeReplay({ rec, finalState: final, online: true, seat: null, ai: false, revealOpp: false, appVersion: 'T', now });
      const sOnOff = RR.stepsForStorage(rec.steps, { online: true, seat: 1, revealOpp: false });
      const sOnOn = RR.stepsForStorage(rec.steps, { online: true, seat: 1, revealOpp: true });
      const sLoc = RR.stepsForStorage(rec.steps, { online: false, seat: null, revealOpp: false });
      const sNo = RR.stepsForStorage(rec.steps, { online: true, seat: null, revealOpp: false });
      r.A9 = noSeat === null && sNo === null && sOnOn === rec.steps && sLoc === rec.steps && sOnOff.length === rec.steps.length
        && sOnOff.every((x) => x.state.players[0].hand.every((c) => c.cardId === H)) && sOnOff.every((x) => JSON.stringify(x.state.players[1].hand) === JSON.stringify(rec.steps[sOnOff.indexOf(x)].state.players[1].hand));
    }
    // A11（複審 P3）：stepsForStorage 的遮蔽快取 ⇒ 結果與「每步現算 redactStateForSeat」逐位元相同；第二次呼叫重用同一份物件；
    //   兩個座位各自快取（不會把 seat 0 的遮蔽結果拿給 seat 1）；新增一步只多遮那一步
    {
      const fresh = rec.steps.map((x) => JSON.stringify(RR.redactStateForSeat(x.state, 1)));
      const c1 = RR.stepsForStorage(rec.steps, { online: true, seat: 1, revealOpp: false });
      const c2 = RR.stepsForStorage(rec.steps, { online: true, seat: 1, revealOpp: false });
      const c0 = RR.stepsForStorage(rec.steps, { online: true, seat: 0, revealOpp: false });
      const fresh0 = rec.steps.map((x) => JSON.stringify(RR.redactStateForSeat(x.state, 0)));
      r.A11 = c1.every((x, i) => JSON.stringify(x.state) === fresh[i]) && c2.every((x, i) => x.state === c1[i].state)
        && c0.every((x, i) => JSON.stringify(x.state) === fresh0[i]) && c0.some((x, i) => JSON.stringify(x.state) !== fresh[i]);
    }
    // A6：對戰紀錄：對手的私有訊息拿掉、自己的保留（造一份有私訊的 log 驗）
    {
      const fake = { ...final, log: [...final.log, { turn: 9, playerIndex: other, message: '對手搜到一張卡', privateMessage: '對手搜到 祕密卡' }, { turn: 9, playerIndex: seat, message: '你搜到一張卡', privateMessage: '你搜到 公開卡' }] };
      const d = RR.finalizeReplay({ rec, finalState: fake, online: true, seat, ai: false, revealOpp: false, appVersion: 'T', now });
      const tail = d.finalLog.slice(-2);
      r.A6 = tail[0].privateMessage === undefined && tail[0].message === '對手搜到一張卡' && tail[1].privateMessage === '你搜到 公開卡' && !JSON.stringify(d).includes('祕密卡');
    }
    // A7：驗證
    r.A7 = RR.validateReplayData(local) === null && RR.validateReplayData(onRed) === null && RR.validateReplayData({}) && RR.validateReplayData({ ...local, format: 'x' })
      && RR.validateReplayData({ ...local, v: 999 }) && RR.validateReplayData({ ...local, snapshots: [{ state: {} }] });
    // A8：跳回合（與對戰頁 tReplaySteps 同形：snapshots + 終局）
    {
      const steps = [...local.snapshots.map((s) => ({ turn: s.turn, activePlayerIndex: s.activePlayerIndex })), { turn: local.meta.finalTurn, activePlayerIndex: null, isFinal: true }];
      const hk = (s) => s.turn + '|' + s.activePlayerIndex;
      let i = 0, hops = 0, okNext = true;
      while (i < steps.length - 1 && hops < 500) { const j = RR.nextTurnStepIndex(steps, i); if (!(j > i) || (!steps[j].isFinal && hk(steps[j]) === hk(steps[i])) || (j > 0 && !steps[j].isFinal && hk(steps[j - 1]) === hk(steps[j]))) { okNext = false; break; } i = j; hops++; }
      const mid = Math.floor(steps.length / 2);
      const p1 = RR.prevTurnStepIndex(steps, mid), p2 = RR.prevTurnStepIndex(steps, p1);
      const startOk = p1 === 0 || hk(steps[p1 - 1]) !== hk(steps[p1]);
      r.A8 = okNext && hops >= half - 1 && i === steps.length - 1 && p1 <= mid && startOk && p2 < p1 && hk(steps[p2]) !== hk(steps[p1])
        && RR.prevTurnStepIndex(steps, 0) === 0 && RR.nextTurnStepIndex(steps, steps.length - 1) === steps.length - 1;
      r.A8n = JSON.stringify({ hops, half, mid, p1, p2 });
    }
    // S1：檔案來回（gzip）＋純 JSON 也讀得進來＋壞檔回錯誤
    {
      const gz = await L.RS.gzipText(JSON.stringify(onRed));
      const back = await L.RS.parseReplayBytes(gz);
      const plain = await L.RS.parseReplayBytes(new TextEncoder().encode(JSON.stringify(local)));
      const broken = await L.RS.parseReplayBytes(new TextEncoder().encode('{nope'));
      r.S1 = gz[0] === 0x1f && gz[1] === 0x8b && gz.length < JSON.stringify(onRed).length / 10 && 'data' in back && JSON.stringify(back.data) === JSON.stringify(onRed)
        && 'data' in plain && 'error' in broken && L.RS.MAX_SAVED_REPLAYS === 10;
      r.S1n = `gz=${gz.length} raw=${JSON.stringify(onRed).length}`;
      r.fixture = { redacted: onRed, revealed: local, gzRed: gz, gzRev: await L.RS.gzipText(JSON.stringify(local)) };
    }
    // P1：開關預設關、只有 true 才開
    L.RP.setReplayRevealOppPref('true'); const s1 = L.RP.replayRevealsOpponent();
    L.RP.setReplayRevealOppPref(true); const s2 = L.RP.replayRevealsOpponent();
    L.RP.setReplayRevealOppPref(undefined); const s3 = L.RP.replayRevealsOpponent();
    r.P1 = s1 === false && s2 === true && s3 === false;
  }
  // P2：policy-loader 讀同一份文件；admin 只寫 replayRevealOpp 且 merge
  const pl = readFileSync(join(srcRoot, 'src/lib/cards/policy-loader.ts'), 'utf8');
  r.P2 = /setReplayRevealOppPref\(\(data as \{ replayRevealOpp\?: unknown \} \| undefined\)\?\.replayRevealOpp\)/.test(pl) && /if \(!snap\.exists\(\)\) setReplayRevealOppPref\(undefined\);/.test(pl);
  const adm = existsSync(join(srcRoot, 'oracle-admin/admin.html')) ? normEol(readFileSync(join(srcRoot, 'oracle-admin/admin.html'), 'utf8')) : ''   // 多行錨點 \n}; ⇒ 讀檔處收斂行尾（lint-eol-anchors）;
  {
    const i = adm.indexOf('window.monSetReplayReveal = async function');
    const body = i >= 0 ? adm.slice(i, adm.indexOf('\n};', i) + 3) : '';
    let calls = [];
    if (body) {
      // eslint-disable-next-line no-new-func
      const fn = new Function('window', 'setDoc', 'doc', 'dbF', 'confirm', 'alert', 'loadMonitor', body + '; return window.monSetReplayReveal;');
      const w = {}; const f = fn(w, async (ref, data, opt) => { calls.push({ ref, data, opt }); }, (db, a, b) => a + '/' + b, 'DB', () => true, () => {}, async () => {});
      await f(true, null); await f(false, null);
    }
    r.P3 = calls.length === 2 && calls.every((c) => c.ref === 'config/cardPolicy' && c.opt?.merge === true && Object.keys(c.data).join() === 'replayRevealOpp')
      && calls[0].data.replayRevealOpp === true && calls[1].data.replayRevealOpp === false
      && /snap\.data\(\)\.replayRevealOpp === true\) \? 'on' : 'off'/.test(adm) && /monSetReplayReveal\(false, this\)">看不到（預設）/.test(adm);
    r.P3n = JSON.stringify(calls);
  }
  // W：對戰頁接線
  const pg = readFileSync(join(srcRoot, 'src/routes/game/+page.svelte'), 'utf8').replace(/\r\n/g, '\n');
  const a = pg.indexOf('// >>> v6560-casual-replay'), b = pg.indexOf('// <<< v6560-casual-replay');
  const blk = a >= 0 && b > a ? pg.slice(a, b) : '';
  // ⭐v6.563（Rule 40，站長改需求）：只記休閒線上對戰，本機雙人／vs AI 不記
  r.W1 = /const replayRecordable = \$derived\(!!game && !isTournament && !isTReplay && !isTournSpectator && !isAdminMode\s*&& mode === 'online' && !isSpectator && \(myPlayerIndex === 0 \|\| myPlayerIndex === 1\)\);/.test(blk)
    && /finalizeReplay\(\{ rec, finalState: g, online: mode === 'online', seat: \(myPlayerIndex === 0 \|\| myPlayerIndex === 1\) \? myPlayerIndex : null,\s*ai: aiPlayerIndex !== null, revealOpp: replayRevealsOpponent\(\), appVersion: VERSION, now: (?:Date\.now|gameClockNow)\(\) \}\);/.test(blk)   // ⭐v6.565（Rule 40）：savedAt 改用遊戲時鐘（跟盤面同一個時鐘），兩種寫法都只代表「現在」，意圖不變
    && /if \(data\) \{ lastSavedReplay = data; void saveReplay\(data\); \}/.test(blk) && /if \(!g \|\| !replayRecordable\) return;\s*untrack\(\(\) => onReplayGameState\(g\)\);/.test(blk)
    && /const toSave = stepsForStorage\(rec\.steps, \{ online: mode === 'online', seat: \(myPlayerIndex === 0 \|\| myPlayerIndex === 1\) \? myPlayerIndex : null, revealOpp: replayRevealsOpponent\(\) \}\);\s*if \(toSave\) void saveInProgress\(rec\.gameId, toSave\);/.test(blk);
  // W5：onReplayGameState 本體實跑（假的存檔函式）：線上＋開關關 ⇒ 存遮蔽版；開關開 ⇒ 攤開；本機 AI ⇒ kind ai；錦標賽條件外不會被呼叫（W6）
  r.W5 = false; r.W5n = '';
  if (L && blk) {
    try {
      const i0 = blk.indexOf('function onReplayGameState(g: any) {');
      let d = 0, k = blk.indexOf('{', i0);
      for (; k < blk.length; k++) { if (blk[k] === '{') d++; else if (blk[k] === '}') { d--; if (d === 0) break; } }
      const fnSrc = (await (await import('esbuild')).transform(blk.slice(i0, k + 1), { loader: 'ts' })).code;
      const run = async (states, env) => {
        const saved = [], prog = [];
        // eslint-disable-next-line no-new-func
        const make = new Function('L', 'env', 'saved', 'prog', `
          let _replayRec = null, _replayFinalizedId = '', _replayLastHalf = '', lastSavedReplay = null;
          const { createReplayRecorder, recordStep, finalizeReplay, stepsForStorage } = L.RR;
          const loadInProgress = async () => null;
          const saveInProgress = (id, steps) => { prog.push(steps); };
          const saveReplay = (d) => { saved.push(d); };
          const replayRevealsOpponent = () => env.reveal;
          const mode = env.mode, myPlayerIndex = env.seat, aiPlayerIndex = env.ai, VERSION = 'T';
          const gameClockNow = () => Date.now();   // ⭐v6.565（Rule 40）：頁面改用遊戲時鐘，替身＝沒同步過的本機時鐘
          ${fnSrc}
          return onReplayGameState;`);
        const f = make(L, env, saved, prog);
        for (const g of states) f(g);
        return { saved, prog };
      };
      const { states, final: fin } = playAndRecord(L, 5);
      const H = L.RR.HIDDEN_CARD_ID;
      const on = await run(states, { mode: 'online', seat: 0, reveal: false, ai: null });
      const onRev = await run(states, { mode: 'online', seat: 0, reveal: true, ai: null });
      const loc = await run(states, { mode: 'local', seat: null, reveal: false, ai: 1 });
      const s0 = on.saved[0], s1 = onRev.saved[0], s2 = loc.saved[0];
      r.W5 = !!fin && on.saved.length === 1 && s0.meta.revealed === false && s0.snapshots.every((x) => x.state.players[1].hand.every((c) => c.cardId === H))
        && on.prog.length > 3 && on.prog.every((steps) => steps.every((x) => x.state.players[1].hand.every((c) => c.cardId === H)))
        && s1.meta.revealed === true && s1.snapshots.some((x) => x.state.players[1].hand.some((c) => c.cardId !== H))
        && s2.meta.kind === 'ai' && s2.meta.revealed === true && s2.snapshots.length > 20;
      r.W5n = JSON.stringify({ on: on.saved.length, prog: on.prog.length, loc: s2?.meta });
    } catch (e) { r.W5n = 'ERR ' + e.message; }
  }
  {
    const m = pg.match(/const replayRecordable = \$derived\(([\s\S]*?)\);\n/);
    const ev = (o) => { try { /* eslint-disable-next-line no-new-func */ return new Function(...Object.keys(o), 'return (' + m[1] + ');')(...Object.values(o)); } catch { return 'ERR'; } };
    const base = { game: { id: 'x' }, isTournament: false, isTReplay: false, isTournSpectator: false, isAdminMode: false, mode: 'local', isSpectator: false, myPlayerIndex: null };
    // ⭐v6.563（Rule 40）：本機（含 vs AI）改成不記
    r.W6 = !!m && ev(base) === false && ev({ ...base, mode: 'online', myPlayerIndex: 1 }) === true && ev({ ...base, mode: 'online', myPlayerIndex: 0 }) === true
      && [{ isTournament: true }, { isTReplay: true }, { isTournSpectator: true }, { isAdminMode: true }, { game: null }, { mode: 'online', myPlayerIndex: null }, { mode: 'online', myPlayerIndex: 0, isSpectator: true }, { mode: null }]
        .every((d) => ev({ ...base, ...d }) === false);
  }
  r.W7 = /\{#if game\.phase === 'game-over' && \(game\.winner === null \|\| game\.winner === undefined\) && !isTournament && !isTReplay\}/.test(pg)
    && /\{#if game\.phase === 'game-over' && game\.winner !== null && game\.winner !== undefined && !isTReplay\}/.test(pg)
    && (pg.match(/if \(!isTournament && !isTReplay && mode === 'online' && onlineStep === 'join' && (myUid|loggedIn)\)/g) || []).length === 2;
  const codeOnly = pg.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');   // 註解行不算（兩個獎賞列各有卡圖與正面樣式兩處）
  // ⭐v6.564（Rule 40）：下方（自己）那一列改用 replayShowsMyPrizes＝攤開的回放 或 遮蔽的復盤；上方（對手）兩處照舊只看 replayShowsHidden
  r.W2 = /const replayShowsHidden = \$derived\(isTReplay && replayRevealAll\);/.test(pg) && (codeOnly.match(/_pz\.faceUp \|\| replayShowsHidden/g) || []).length === 2
    && /const replayShowsOwnPrizes = \$derived\(isTReplay && !replayRevealAll\);/.test(pg) && /const replayShowsMyPrizes = \$derived\(replayShowsHidden \|\| replayShowsOwnPrizes\);/.test(pg)
    && (codeOnly.match(/_pz\.faceUp \|\| replayShowsMyPrizes\)/g) || []).length === 1 && (codeOnly.match(/!!_pz\.faceUp \|\| \(replayShowsMyPrizes && !!_pc\)/g) || []).length === 1
    && !/_pz\.faceUp \|\| isTReplay/.test(codeOnly) && /let prizeViewMode = \$derived\(replayShowsHidden \? 'replay' : 'battle'\)/.test(pg);
  r.W3 = /const _lockedView: 'p1' \| 'p2' \| 'auto' = \(!replayRevealAll && \(_seat === 0 \|\| _seat === 1\)\) \? \(_seat === 0 \? 'p1' : 'p2'\) : 'auto';/.test(pg) && /spectatorView = _lockedView;/.test(pg)
    && /await openReplayData\(data, 'tournament'\);/.test(pg) && /await openReplayData\(r\.data, 'casual'\);/.test(pg) && /replayRevealAll = kind === 'tournament' \|\| data\?\.meta\?\.revealed !== false;/.test(pg)
    && /\{#if replayRevealAll\}\s*<span class="spec-toolbar">/.test(pg) && (pg.match(/nextTurnStepIndex\(_m?steps, tReplayStep\)/g) || []).length === 2 && (pg.match(/prevTurnStepIndex\(_m?steps, tReplayStep\)/g) || []).length === 2;
  // ⭐v6.563（Rule 40，站長改版面）：不再有「復盤」卡，清單直接列在開始對戰頁；離開時回清單（含從清單打開的錦標賽回放）
  r.W4 = !/<div class="mode-title">復盤<\/div>/.test(pg) && /\{#if replayLobbyOpen\}\s*<section class="replay-lobby">/.test(pg)
    && (pg.match(/onclick=\{downloadLastReplay\}/g) || []).length === 2 && /if \(replayKind === 'casual' \|\| replayFromCasualLobby \|\| !isTournament\) \{/.test(pg);
  return r;
}

const L = await loadLib(ROOT);
const R = await scenarios(L, ROOT);
const LABEL = {
  A1: '★★★ A1 逐動作記錄：只記 playing、快照清掉 log、log 長度不遞減、無重複盤面、步數遠多於半回合',
  A2: '★★★ A2 重複盤面不記、log 變短（退回）先截斷再記、別局與 setup 拒記',
  A3: '★★★ A3 結束組資料：本機／AI 一律攤開；線上依開關（預設遮蔽、記錄者視角）；名稱、勝者、步數、終局正確',
  A4: '★★★ A4 遮蔽：對手手牌、未翻開的獎賞、雙方牌庫變卡背（張數不變、iid 換成不透明編號、原 iid 不出現在該快照任何地方）；公開區不動；待選／連鎖待選／牌庫頂已知／棄牌監看清掉',
  A5: '★★★ A5 iid 對照攻擊：用檔案裡公開位置的 iid 對照被遮住的卡，一張都還原不了（正對照：舊遮法能還原兩成以上）',
  A6: '★★★ A6 對戰紀錄：對手的私有訊息拿掉、自己的保留',
  A7: '★★ A7 復盤檔驗證：合格的通過、格式／版本／損毀被擋',
  A8: '★★★ A8 跳回合：下一回合每次落在新半回合的第一格、一路跳到終局；上一回合先回本回合開頭再往前',
  S1: '★★★ S1 復盤檔 gzip 來回一致、純 JSON 也能讀、壞檔回錯誤；保留 10 場',
  P1: '★★★ P1 線上復盤遮蔽開關：預設關、只有 true 才開',
  P2: '★★ P2 policy-loader 從 config/cardPolicy 讀開關（文件不存在也重設為關）',
  P3: '★★★ P3 admin 開關實跑：只寫 replayRevealOpp、merge:true；畫面讀同一欄位、預設按鈕標「看不到」',
  W1: '★★★ W1 對戰頁：記錄條件（v6.563 起只記休閒線上；錦標賽／觀戰／回放／admin／本機不記）、結束走 finalizeReplay＋saveReplay、半回合存進度',
  W2: '★★★ W2 獎賞卡：攤開的回放雙方翻正面；遮蔽的復盤只翻自己那一側（v6.564）；對手那一側＝對戰中規則',
  W3: '★★ W3 錦標賽與一般復盤走同一個入口；遮蔽時不給切視角；桌機／手機都有跳回合',
  W4: '★★ W4 開始對戰頁直接列出復盤清單（v6.563 拿掉「復盤」卡）、兩個終局視窗都有下載復盤檔、離開復盤回清單',
  W5: '★★★ W5 onReplayGameState 實跑：線上＋開關關 ⇒ 存的復盤與進行中進度都遮住；開關開 ⇒ 攤開；本機 vs AI ⇒ kind ai 攤開',
  W6: '★★★ W6 記錄條件實算：本機（v6.563）／錦標賽／回放／觀戰／admin／線上沒座位都不記',
  W7: '★★★ W7 回放的終局格不跳勝負／平手視窗；復盤時不在背景輪詢休閒大廳',
  A10: '★★★ A10 遮蔽清掉牌庫頂已知順序、連鎖待選、棄牌監看、待選視窗',
  A11: '★★ A11 進行中存檔的遮蔽快取與逐步現算逐位元相同、座位分開快取、重複呼叫重用（複審 P3：終盤不重遮全部）',
  A9: '★★★ A9 線上要遮卻不知道座位 ⇒ 不產生（不退回攤開）；進行中那份線上關開關也先遮',
};
for (const k of Object.keys(LABEL)) ok(LABEL[k], R[k], R[k + 'n']);

// ── E：真瀏覽器 ───────────────────────────────────────────────────────────
console.log('\n【E】真瀏覽器（build/）');
const BUILD = join(ROOT, 'build');
const chromium = existsSync(join(BUILD, '404.html')) && R.fixture ? pwChromium('v6.560 復盤') : null;
if (!existsSync(join(BUILD, '404.html'))) console.log('  ENV-SKIP E（沒有 build/）');
else if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.560 復盤');
  if (browser) {
    const { createReadStream, statSync } = await import('node:fs');
    const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x'); let p = join(BUILD, decodeURIComponent(u.pathname));
      if (existsSync(p + '.html')) p += '.html'; else if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
      if (!existsSync(p)) p = join(BUILD, '404.html');
      res.writeHead(200, { 'content-type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream' }); createReadStream(p).pipe(res);
    });
    await new Promise((r) => srv.listen(0, r));
    const port = srv.address().port;
    const tmp = mkdtempSync(join(tmpdir(), 'v6560e-'));
    try {
      const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1600, height: 1000 } });
      await ctx.route(/pokemon-card\.com|ptcg-tw-sim-img/, (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="63" height="88"><rect width="63" height="88" fill="#4a6"/></svg>' }));
      const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
      const openFile = async (bytes, name) => {
        const f = join(tmp, name); writeFileSync(f, bytes);
        await pg.goto(`http://localhost:${port}/game`, { waitUntil: 'load' });
        await pg.waitForSelector('.mode-card:not([disabled])', { timeout: 60000 });
        await pg.waitForSelector('.replay-lobby', { timeout: 20000 });   // ⭐v6.563：清單直接在開始對戰頁
        await pg.locator('.replay-lobby input[type=file]').setInputFiles(f);
        await pg.waitForSelector('.treplay-bar', { timeout: 30000 });
      };
      const info = () => pg.evaluate(() => ({
        step: document.querySelector('.treplay-step')?.textContent ?? '',
        title: document.querySelector('.treplay-title')?.textContent ?? '',
        faceUpPrizes: document.querySelectorAll('.prize-card.prize-faceup').length,
        myFaceUp: document.querySelectorAll('.prize-card.my-prize.prize-faceup').length,
        oppFaceUp: document.querySelectorAll('.prize-card.prize-faceup:not(.my-prize)').length,
        timer: document.querySelector('.timer-total .t-val')?.textContent ?? null,
        specBtns: document.querySelectorAll('.spec-toolbar .spec-btn').length,
        copyLink: [...document.querySelectorAll('.treplay-btn')].some((b) => /複製連結/.test(b.textContent)),
      }));
      const click = async (re) => { await pg.locator('.treplay-btn', { hasText: re }).first().click(); await pg.waitForTimeout(250); };
      const total = (s) => Number((s.match(/（(\d+)\/(\d+)）/) || [])[2]);
      const cur = (s) => Number((s.match(/（(\d+)\/(\d+)）/) || [])[1]);
      // 攤開版（本機／AI）
      await openFile(R.fixture.gzRev, 'a.ptcgreplay');
      const a0 = await info();
      await click(/^下一步/); const a1 = await info();
      await click(/下一回合/); const a2 = await info();
      await click(/上一回合/); const a3 = await info();
      const nSteps = R.fixture.revealed.snapshots.length + 1;
      ok('★★★[E1] 匯入復盤檔 → 回放畫面、每個動作一格（總格數＝快照數＋終局）、下一步＋1', /復盤/.test(a0.title) && total(a0.step) === nSteps && cur(a0.step) === 1 && cur(a1.step) === 2, JSON.stringify({ a0, a1, nSteps }));
      ok('★★[E2] 下一回合往後跳、上一回合往回跳', cur(a2.step) > cur(a1.step) && cur(a3.step) < cur(a2.step), JSON.stringify({ a1: a1.step, a2: a2.step, a3: a3.step }));
      ok('★★[E3] 攤開的復盤：獎賞卡翻正面、可切視角；一般復盤沒有「複製連結」', a0.faceUpPrizes > 0 && a0.specBtns === 3 && !a0.copyLink, JSON.stringify(a0));
      // 審查 P1-2：跳到最後一格（終局）不可以跳出勝負視窗（按「離開房間」會留下回放狀態）
      await pg.locator('.treplay-btn', { hasText: '⏭' }).click(); await pg.waitForTimeout(400);
      const endInfo = await pg.evaluate(() => ({ step: document.querySelector('.treplay-step')?.textContent ?? '', modal: document.querySelectorAll('.gameover-modal').length }));
      ok('★★★[E3b] 回放跳到終局格：沒有勝負／平手視窗', /最終盤面/.test(endInfo.step) && endInfo.modal === 0, JSON.stringify(endInfo));
      // 遮蔽版（線上、開關關閉）
      await openFile(R.fixture.gzRed, 'b.ptcgreplay');
      const b0 = await info(); await click(/下一回合/); await click(/下一回合/); const b1 = await info();
      // ⭐v6.564（玩家回報，Rule 40）：遮蔽的復盤＝自己（下方）的獎賞卡攤開、對手的蓋著；不給切視角
      ok('★★★[E4] 遮蔽的復盤：自己的獎賞卡攤開、對手的蓋著、不給切視角', b0.myFaceUp > 0 && b0.oppFaceUp === 0 && b1.oppFaceUp === 0 && b0.specBtns === 0, JSON.stringify({ b0, b1 }));
      // ⭐v6.564（站長回報「回放時計時器還會繼續跑」）：停在同一格 2 秒，對戰總時間不可以變
      await pg.waitForTimeout(2300); const b2 = await info();
      ok('★★★[E4b] 回放時計時器停住（同一格 2 秒後總時間不變）', b1.timer != null && b1.timer === b2.timer, JSON.stringify({ t1: b1.timer, t2: b2.timer }));
      // 離開 ⇒ 回到復盤清單
      await pg.locator('.treplay-btn', { hasText: '離開' }).click(); await pg.waitForTimeout(400);
      const back = await pg.evaluate(() => !!document.querySelector('.replay-lobby') && !document.querySelector('.treplay-bar'));
      ok('★★[E5] 離開復盤回到復盤清單', back);
      // 記錄：開一局 vs AI，打到自己的回合再結束幾次 ⇒ 瀏覽器裡有這一局的進行中記錄
      await pg.goto(`http://localhost:${port}/game`, { waitUntil: 'load' });
      await pg.waitForSelector('.mode-card:not([disabled])', { timeout: 60000 });
      await pg.locator('.mode-card', { hasText: '本機雙人' }).click();
      const sels = pg.locator('main.lobby select');
      await sels.nth(0).selectOption('__preset_tactic_dragonite__');
      await sels.nth(1).selectOption('__preset_tactic_gardevoir__');
      const start = pg.locator('button.btn-primary', { hasText: '開始' });
      for (let i = 0; i < 30 && !(await start.isEnabled()); i++) await pg.waitForTimeout(500);
      await start.click();
      await pg.waitForSelector('.hand-card.draggable', { timeout: 60000 }); await pg.waitForTimeout(1200);
      const a = await pg.locator('.hand-card.draggable').first().boundingBox(), z = await pg.locator('.my-active-zone').boundingBox();
      await pg.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await pg.mouse.down();
      await pg.mouse.move(a.x + 20, a.y - 10, { steps: 3 }); await pg.mouse.move(z.x + z.width / 2, z.y + z.height / 2, { steps: 12 }); await pg.mouse.up(); await pg.waitForTimeout(700);
      const sysBtn = pg.locator('button:visible:not([disabled])', { hasText: /^確定|我看完了|不選|確認補抽|完成補抽|準備完成|跳過攻擊|結束回合/ });
      let ip = null;
      // ⭐v6.563（Rule 40，站長：本機不記）：打 15 輪動作後，瀏覽器裡必須**沒有**這一局的記錄（記錄端的正對照在 W5 線上路徑）
      for (let w = 0; w < 15; w++) {
        if (await sysBtn.count()) await sysBtn.first().click().catch(() => {});
        await pg.waitForTimeout(600);
        if (w % 5 === 4) ip = await pg.evaluate(async () => {
          const db = await new Promise((res) => { const r = indexedDB.open('ptcg-tw-sim-replays', 1); r.onsuccess = () => res(r.result); r.onerror = () => res(null); r.onupgradeneeded = () => { r.result.createObjectStore('replays', { keyPath: 'id' }); }; });
          if (!db) return null;
          const row = await new Promise((res) => { const t = db.transaction('replays', 'readonly'); const q = t.objectStore('replays').get('__in_progress__'); q.onsuccess = () => res(q.result); q.onerror = () => res(null); });
          if (!row) return { steps: 0, halves: 0 };
          const txt = await new Response(new Blob([row.gz]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
          const steps = JSON.parse(txt);
          return { steps: steps.length, halves: new Set(steps.map((s) => s.turn + '|' + s.activePlayerIndex)).size, gameId: row.gameId, phases: [...new Set(steps.map((s) => s.state.phase))] };
        });
      }
      // 正對照（Opus 審查 P3-5）：對局真的進入 playing 並換過回合（否則「沒有記錄」可能只是卡在 setup）
      const turnTxt = await pg.evaluate(() => document.querySelector('.turn-info')?.textContent || '');
      const turnNo = Number((turnTxt.match(/回合\s*(\d+)/) || [])[1] || 0);
      ok('★★★[E6] 本機對局（v6.563 起不記）：已經打到第 2 回合以上，瀏覽器裡仍然沒有進行中的記錄', turnNo >= 2 && !!ip && ip.steps === 0, JSON.stringify({ turnNo, ip }));
      ok('★[E7] 沒有 JS 例外', errs.length === 0, errs.slice(0, 3).join(' ｜ '));
      // E8：replay-store 在真的 IndexedDB 上跑（同源頁面注入本版模組）：存 11 場 ⇒ 只留最新 10 場；同一局重存只留一份；存檔後清掉進行中那份；讀回內容一致
      {
        const tmpB = mkdtempSync(join(tmpdir(), 'v6560i-'));
        try {
          const E = join(tmpB, 'e.ts'), O = join(tmpB, 'o.js');
          writeFileSync(E, `export * from '${join(ROOT, 'src/lib/game/replay-store').replace(/\\/g, '/')}';`);
          await build({ entryPoints: [E], outfile: O, bundle: true, format: 'iife', globalName: 'RSX', platform: 'browser', target: 'es2020', alias: { '$lib': join(ROOT, 'src/lib') }, logLevel: 'silent' });
          await pg.goto(`http://localhost:${port}/game`, { waitUntil: 'load' });
          await pg.addScriptTag({ content: readFileSync(O, 'utf8') });
          const res = await pg.evaluate(async (base) => {
            const RS = window.RSX;
            await new Promise((r) => { const q = indexedDB.deleteDatabase('ptcg-tw-sim-replays'); q.onsuccess = q.onerror = q.onblocked = () => r(); });
            await RS.saveInProgress('g-live', [{ turn: 1, activePlayerIndex: 0, logLen: 1, state: base.snapshots[0].state }]);
            const mk = (i, gid) => ({ ...base, meta: { ...base.meta, gameId: gid, savedAt: 1000 + i } });
            for (let i = 0; i < 11; i++) await RS.saveReplay(mk(i, 'g' + i));
            const afterInProg = await RS.loadInProgress('g-live');
            await RS.saveReplay(mk(20, 'g5'));   // 同一局重存
            const list = await RS.listReplays();
            // ⭐複審 P3：listReplays 自己就會切成 10 筆 ⇒ 另外直接數 IndexedDB 原始列數（真的只存 10 場）
            const raw = await new Promise((r) => { const q = indexedDB.open('ptcg-tw-sim-replays'); q.onsuccess = () => { const db = q.result; const g = db.transaction('replays', 'readonly').objectStore('replays').count(); g.onsuccess = () => { r(g.result); db.close(); }; g.onerror = () => { r(-1); db.close(); }; }; q.onerror = () => r(-2); });
            const top = await RS.loadReplay(list[0].id);
            return { n: list.length, raw, ids: list.map((x) => x.meta.gameId), inProg: afterInProg, same: JSON.stringify(top.snapshots) === JSON.stringify(base.snapshots) };
          }, R.fixture.revealed);
          ok('★★★[E8] 真 IndexedDB：只留最新 10 場、同一局只留一份、存檔後進行中那份清掉、讀回一致', res.n === 10 && res.raw === 10 && res.ids[0] === 'g5' && res.ids.filter((x) => x === 'g5').length === 1 && !res.ids.includes('g0') && res.ids.includes('g1') && res.inProg === null && res.same, JSON.stringify(res));
        } finally { try { rmSync(tmpB, { recursive: true, force: true }); } catch { /* */ } }
      }
    } finally { await browser.close(); srv.close(); try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
  }
}

console.log('\n【H】HEAD-FAIL');
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('v6560 H', '需要 v6.559 commit');
else {
  const tmp = mkdtempSync(join(tmpdir(), 'v6560b-'));
  try {
    execFileSync('sh', ['-c', `git -C "${ROOT}" archive ${BASE_SHA} src oracle-admin/admin.html | tar -x -C "${tmp}"`]);
    const B = await scenarios(await loadLib(tmp), tmp);
    for (const k of Object.keys(LABEL)) ok(`★★★[H] v6.559：${k} 紅`, B[k] === false || B[k] === undefined);
  } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}
console.log(`\n=== v6.560 一般對戰復盤：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
