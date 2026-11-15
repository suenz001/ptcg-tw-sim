// v6.648 守衛：自動配對成功後不露出房間畫面（站長 2026-11-16：
//   「配對成功後，還是會先跳到房間的畫面…不要顯示這個畫面，避免玩家誤按到房間中的按鈕…按接受後，就直接進入對戰的擲硬幣決定先後攻、set up 階段的對戰畫面」）
//
// 【D】行為（共用 casual-match-harness：真的伺服器配對區塊＋真的對戰頁腳本區塊）
//   D1 雙方都按接受、還沒進房（伺服器 wait-host）⇒ 立刻顯示「正在進入對戰」遮罩
//   D2 房間已開打、盤面還沒出來 ⇒ 遮罩留著；盤面出來 ⇒ 拿掉
//   D3 還沒進房時對手取消 ⇒ 配對回到搜尋 ⇒ 遮罩拿掉（不會卡住）
//   D4 還沒進房時按遮罩上的「離開」⇒ 取消配對（不呼叫離開房間）
//   D5 進過房又離開房間（onlineStep 不是 room）⇒ 遮罩拿掉（即使伺服器狀態仍是 join／hosting）
//   D1b 房主建房途中也蓋著；D1c 對手進房途中也蓋著；D2b 房間已結束 ⇒ 拿掉；D6 暫時性 cmError 不拿掉；D7 開打後 60 秒盤面沒出來 ⇒ 拿掉並提示重新整理；D7b 還沒進房時保險絲到點 ⇒ 結束配對（審查 P3-1～P3-3、複審 P3-A）
// 【C】樣式：進入對戰的遮罩不透明（深色／淺色都是實色），底下的房間畫面看不到
// 【H】HEAD-FAIL：BASE（3bb8e7e8＝v6.647）上 D1／D2／C1 紅
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeFileSync, unlinkSync } from 'node:fs';
import { build } from 'esbuild';
import { normEol } from './lib/eol-agnostic.mjs';
import { stripCommentsBlankChecked } from './lib/strip-comments.mjs';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { makeClock, makeServer, pageBlockJs, makePlayer } from './lib/casual-match-harness.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = '3bb8e7e8';
const PAGE = 'src/routes/game/+page.svelte', SAP = 'oracle-admin/server_admin_patch.js';
const _CP_O = join(ROOT, `.v6648am-cp-${process.pid}.mjs`);
process.on('exit', () => { try { unlinkSync(_CP_O); } catch { /* noop */ } });
await build({ entryPoints: [join(ROOT, 'src/lib/decks/coin-pref.ts')], outfile: _CP_O, bundle: true, format: 'esm', platform: 'node', logLevel: 'error' });
const { normalizeDeckCoinPref } = await import(pathToFileURL(_CP_O).href);
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + String(x).slice(0, 400) : '')); } };

async function checkD(pageSrc, sapSrc, tag) {
  const js = await pageBlockJs(pageSrc).catch(() => null);
  if (!js) { for (const k of ['D1', 'D1b', 'D1c', 'D2', 'D2b', 'D3', 'D4', 'D5', 'D6', 'D7', 'D7b']) ok(`${k}${tag}（腳本區塊不存在）`, false); return; }
  const pollMs = (s) => (s === 'found' || s === 'host' || s === 'wait-host') ? 1000 : s === 'searching' ? 3000 : 0;
  const roomName = (a, b) => `⚡ 自動配對：${a} vs ${b}`;
  let shared0 = null;
  async function accepted(gate = false) {
    const clock = makeClock();
    const server = makeServer(sapSrc, clock);
    const shared = { rooms: {}, seq: 0, pollMs, roomName, lastPref: 'random', normalizeDeckCoinPref };
    if (gate === true) { let release; shared.createGate = new Promise((r) => { release = r; }); shared.release = release; }
    if (gate === 'join') { let release; shared.joinGate = new Promise((r) => { release = r; }); shared.release = release; }
    shared0 = shared;
    const A = await makePlayer(js, server, clock, { token: 'tA', email: 'a@x.com', name: '小明' }, shared);
    const B = await makePlayer(js, server, clock, { token: 'tB', email: 'b@x.com', name: '小華' }, shared);
    A.api.setDeck('d1'); B.api.setDeck('d1');
    await A.api.cmStart(); await clock.advance(1000); await B.api.cmStart(); await clock.advance(3100);
    await A.api.cmAnswer(true); await B.api.cmAnswer(true);
    return { clock, A, B };
  }
  {
    const { B } = await accepted();
    const p = B.peek();
    ok(`★★★ D1${tag} 雙方都按接受、還沒進房 ⇒ 立刻顯示「正在進入對戰」遮罩（不經過大廳或房間畫面）`, !!p.overlay && p.overlay.opp === '小明' && p.onlineStep !== 'room', JSON.stringify(p));
  }
  {
    // D1b（審查 P3-1）：房主在建房那段時間（伺服器 host、房間還沒回來）也要蓋著，不露出大廳
    const { clock, A, B } = await accepted(true);
    await clock.advance(1100); A.api.runEffects(); B.api.runEffects();
    const mid = A.peek();
    // D6（審查 P3-3）：還沒進房時輪詢偶爾失敗（cmError）不拿掉遮罩（B 此時一定還在等房號）
    const bPre = B.peek().onlineStep !== 'room' && !!B.peek().overlay;
    B.api.setCmError('網路連線不穩，請稍後再試'); B.api.runEffects();
    const bAfter = B.peek();
    shared0.release(); await clock.advance(50);
    ok(`★★★ D1b${tag} 房主建房途中（伺服器 host、房間還沒回來）⇒ 遮罩已經蓋著；建好進房後仍蓋著`, !!mid.overlay && mid.onlineStep !== 'room' && mid.view?.state === 'host' && !!A.peek().overlay && A.peek().onlineStep === 'room', JSON.stringify({ mid, after: A.peek() }));
    ok(`★★ D6${tag} 還沒進房時出現暫時性錯誤訊息（cmError）⇒ 遮罩不拿掉（不會閃出大廳）`, bPre && !!bAfter.overlay && bAfter.onlineStep !== 'room', JSON.stringify({ bPre, bAfter }));
  }
  {
    // D7b（複審 P3-A）：還沒進房時保險絲到點（例如建房一直沒回來）⇒ 結束配對、提示重新開始；之後的輪詢不會把遮罩蓋回去
    //   （刻意不跑 effects：直接驗保險絲本身這一支，不讓伺服器 25 秒逾時先把遮罩拿掉）
    const { clock, A } = await accepted(true);
    await clock.advance(1100);
    const had = !!A.peek().overlay && A.peek().onlineStep !== 'room';
    await clock.advance(61000);
    const p1 = A.peek();
    await clock.advance(3000); A.api.runEffects();
    const p2 = A.peek();
    ok(`★★ D7b${tag} 還沒進房時 60 秒保險絲到點 ⇒ 遮罩拿掉、結束配對、提示「進入對戰逾時」；之後不會再被蓋回去`,
      had && p1.overlay === null && p1.view === null && /進入對戰逾時/.test(p1.err) && p2.overlay === null && p2.onlineStep !== 'room', JSON.stringify({ had, p1, p2 }));
  }
  {
    // D1c：對手拿到房號、正在進房（伺服器 join、joinRoom 還沒回來）⇒ 遮罩蓋著
    const { clock, B } = await accepted('join');
    await clock.advance(3000); B.api.runEffects();
    const mid = B.peek();
    shared0.release(); await clock.advance(50);
    ok(`★★★ D1c${tag} 對手進房途中（伺服器 join、房間還沒進去）⇒ 遮罩已經蓋著；進房後仍蓋著`, !!mid.overlay && mid.onlineStep !== 'room' && mid.view?.state === 'join' && !!B.peek().overlay && B.peek().onlineStep === 'room', JSON.stringify({ mid, after: B.peek() }));
  }
  {
    const { clock, A, B } = await accepted();
    await clock.advance(5000);
    const inRoom = A.peek().onlineStep === 'room' && B.peek().onlineStep === 'room';
    A.api.setRoomData({ status: 'playing', seats: [] }); A.api.runEffects();
    const mid = A.peek().overlay;
    A.api.setGame({ phase: 'setup' }); A.api.runEffects();
    ok(`★★★ D2${tag} 房間已開打、盤面還沒出來 ⇒ 遮罩留著（房間畫面不會閃出來）；盤面出來 ⇒ 拿掉`, inRoom && !!mid && A.peek().overlay === null, JSON.stringify({ inRoom, mid, after: A.peek().overlay }));
  }
  {
    const { clock, A, B } = await accepted();
    await clock.advance(5000);
    B.api.setRoomData({ status: 'ended', seats: [] }); B.api.runEffects();
    ok(`★★ D2b${tag} 在房間裡、房間變成已結束（不是等待中也不是對戰中）⇒ 遮罩拿掉`, B.peek().onlineStep === 'room' && B.peek().overlay === null, JSON.stringify(B.peek()));
    A.api.setRoomData({ status: 'playing', seats: [] }); A.api.runEffects();
    await clock.advance(61000);
    ok(`★★ D7${tag} 房間已開打但盤面 60 秒都沒出來 ⇒ 遮罩拿掉、提示重新整理（不再叫玩家去按準備）`, A.peek().overlay === null && /對戰畫面載入逾時/.test(A.peek().onlineError), JSON.stringify(A.peek()));
  }
  {
    const { clock, A, B } = await accepted();
    const had = !!B.peek().overlay;
    A.api.cmStop(); await clock.advance(2500); B.api.runEffects();
    ok(`★★ D3${tag} 還沒進房時對手取消 ⇒ 遮罩拿掉（不會卡在「正在進入對戰」）`, had && B.peek().overlay === null && B.peek().onlineStep !== 'room', JSON.stringify(B.peek()));
  }
  {
    const { clock, B } = await accepted();
    const had = !!B.peek().overlay;
    B.api.leaveOverlay(); await clock.advance(10);
    ok(`★★ D4${tag} 還沒進房時按遮罩上的「離開」⇒ 取消配對、遮罩拿掉，不呼叫離開房間`, had && B.peek().overlay === null && !B.st.calls.includes('leaveOnlineGame') && B.peek().view === null, JSON.stringify({ p: B.peek(), calls: B.st.calls.slice(-4) }));
  }
  {
    const { clock, B } = await accepted();
    await clock.advance(5000);
    const had = !!B.peek().overlay && B.peek().onlineStep === 'room';
    B.api.setOnlineStep('join'); B.api.runEffects();
    ok(`★★ D5${tag} 進過房又離開房間 ⇒ 遮罩拿掉（伺服器狀態還停在 join 也一樣）`, had && B.peek().overlay === null);
  }
}

function checkC(pageRaw, tag) {
  const page = stripCommentsBlankChecked(normEol(pageRaw), 'svelte');
  const dark = (page.match(/\n\s*\.cm-found-backdrop\.cm-enter-backdrop\{ background:(#[0-9a-f]{6}); \}/) || [])[1];
  const light = (page.match(/\.cm-found-backdrop\.cm-enter-backdrop \{ background: (#[0-9a-f]{6}); \}/) || [])[1];
  ok(`★★ C1${tag} 進入對戰的遮罩是實色（深色 ${dark}／淺色 ${light}），底下的房間畫面看不到`, !!dark && !!light, JSON.stringify({ dark, light }));
}

const pageSrc = readFileSync(join(ROOT, PAGE), 'utf8'), sapSrc = readFileSync(join(ROOT, SAP), 'utf8').replace(/\r\n/g, '\n');
console.log('【D】行為'); await checkD(normEol(pageSrc), sapSrc, '');
console.log('【C】樣式'); checkC(pageSrc, '');
console.log('【H】HEAD-FAIL');
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('H（缺 BASE ' + BASE_SHA + '）');
else {
  const b = readBaseBlob(ROOT, BASE_SHA, PAGE);
  const before = pass, fb = fail; const log = console.log; const lines = []; console.log = (s) => lines.push(String(s));
  await checkD(normEol(b.ok ? b.out : ''), sapSrc, '@BASE'); checkC(b.ok ? b.out : '', '@BASE');
  console.log = log;
  const reds = lines.filter((l) => /FAIL/.test(l)).map((l) => l.trim().slice(5, 18));
  pass = before; fail = fb;
  console.log('    BASE 紅：' + reds.join('｜'));
  ok('★★★ H1 BASE 上 D1／D1b／D1c／D2／C1 紅', ['D1@', 'D1b@', 'D1c@', 'D2@', 'C1@'].every((k) => reds.some((r) => r.includes(k))), reds.join(','));
}
console.log(`=== v6.648 自動配對不露出房間畫面：${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
