// v6.646 守衛：自動配對畫面的牌組排序、先後攻選項、配對成功後直接進對戰（站長 2026-11-16）
//
// 站長要求：
//   ① 自選牌組的順序比照牌組編輯器與對戰房：玩家自建的牌組在上（📁 我的牌組），網站預設牌組在下（🎴 內建預組）
//   ② 配對完成後省略房間畫面，依玩家選的牌組與先後攻直接進入對戰
//   ③ 配對畫面要能選先後攻（參考對戰房／錦標賽），選牌組時依牌組預設的先後攻自動帶入（同對戰房、錦標賽）
//   ④ 拿掉配對說明那段文字
// 【N1】牌組選單：我的牌組在前、內建預組在後，分組標籤與對戰房的選單相同；不再用 allDecks（預組在前）
// 【N2】先後攻選項：四個值、順序與文字都與對戰房座位的先後攻相同；手動選會記成「上次選的偏好」
// 【N3】行為：預設帶入上次手動選的；選有預設先後攻的牌組 ⇒ 自動帶入；選沒設定的牌組 ⇒ 不動；牌組帶入不寫進「上次選的偏好」
// 【N4】端到端（兩位玩家＋真的伺服器區塊）：進房後送出的是配對畫面選的先後攻（手動改過的以手動為準）
// 【N5】直接進對戰：進房後立刻顯示「配對成功！正在進入對戰…」蓋住房間畫面；開局（game 出現）／房間開打／離開房間 ⇒ 拿掉；
//       60 秒沒開局或自動準備失敗 ⇒ 拿掉遮罩露出房間畫面並提示；房間不見了／建局出錯 ⇒ 立刻拿掉且不蓋掉原本的錯誤；先後攻寫不進 ⇒ 不自動準備；遮罩上可以離開
// 【N6】說明文字已移除（連樣式也不留）
// 【H】HEAD-FAIL：BASE（8fd5c54d＝v6.645）上 N1～N6 紅
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripCommentsBlankChecked } from './lib/strip-comments.mjs';
import { normEol } from './lib/eol-agnostic.mjs';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { makeClock, makeServer, pageBlockJs, makePlayer } from './lib/casual-match-harness.mjs';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { writeFileSync, unlinkSync } from 'node:fs';
// 真的 normalizeDeckCoinPref（唯一判準 src/lib/decks/coin-pref.ts）
const _CP_O = join(fileURLToPath(new URL('..', import.meta.url)), `.v6646-cp-${process.pid}.mjs`);
process.on('exit', () => { try { unlinkSync(_CP_O); } catch { /* noop */ } });
await build({ entryPoints: [join(fileURLToPath(new URL('..', import.meta.url)), 'src/lib/decks/coin-pref.ts')], outfile: _CP_O, bundle: true, format: 'esm', platform: 'node', logLevel: 'error' });
const { normalizeDeckCoinPref } = await import(pathToFileURL(_CP_O).href);

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = '8fd5c54d';
const PAGE = 'src/routes/game/+page.svelte', SAP = 'oracle-admin/server_admin_patch.js';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + String(x).slice(0, 400) : '')); } };

function cmFormOf(page) {
  const i = page.indexOf('<div class="cm-block"');
  const j = i >= 0 ? page.indexOf('{#if cmError}', i) : -1;   // ⚠ HTML 註解會被剝掉，不能拿註解當終點
  return i >= 0 && j > i ? page.slice(i, j) : '';
}
const spans = (s) => [...s.matchAll(/value="(random|first|second|opponent)"[^\n]*?<span>([^<]*)<\/span>/g)].map((m) => m[1] + ':' + m[2]);

function checkStatic(pageRaw, tag) {
  const page = stripCommentsBlankChecked(normEol(pageRaw), 'svelte');
  const form = cmFormOf(page);
  ok(`前提${tag} 抓得到自動配對表單`, form.length > 500, form.length);
  const iMy = form.indexOf('<optgroup label="📁 我的牌組">{#each decks as d (d.id)}'), iPre = form.indexOf('<optgroup label="🎴 內建預組">{#each PRESET_DECKS as d (d.id)}');
  ok(`★★★ N1${tag} 牌組選單：📁 我的牌組在前、🎴 內建預組在後（同對戰房），不再用 allDecks（預組在前）`, iMy > 0 && iPre > iMy && !/\{#each allDecks/.test(form), JSON.stringify({ iMy, iPre }));
  const room = page.slice(page.indexOf('<div class="first-pref-group lobby">'), page.indexOf('<div class="first-pref-group lobby">') + 2000);
  const roomSpans = spans(room), cmSpans = spans(form);
  ok(`★★★ N2${tag} 先後攻選項：四個值、順序與文字都和對戰房座位相同；手動選會記成上次的偏好`, roomSpans.length === 4 && JSON.stringify(cmSpans) === JSON.stringify(roomSpans)
    && ['random', 'first', 'second', 'opponent'].every((v) => form.includes(`onchange={() => { cmFirstPref = '${v}'; _saveFirstPref('${v}'); }}`)) && /贏得擲硬幣時/.test(form), JSON.stringify({ roomSpans, cmSpans }));
  ok(`★★ N6${tag} 配對說明文字已移除（連 .cm-hint 樣式也不留）`, !/cm-hint/.test(pageRaw) && !/配對中請保持這個頁面開著/.test(pageRaw) && !/只開放標準賽合法的牌組。找到對手後/.test(pageRaw));
  ok(`★★ N5a${tag} 「配對成功！正在進入對戰…」遮罩與房間畫面在同一個線上區塊裡、早於房間畫面`, /\{#if cmRoomOverlay\}\s*<div class="cm-found-backdrop cm-enter-backdrop"/.test(page) && page.indexOf('{#if cmRoomOverlay}') < page.indexOf("{:else if onlineStep === 'room'}") && /正在進入對戰…/.test(page));
}

async function checkBehavior(pageSrc, sapSrc, tag) {
  const js = await pageBlockJs(pageSrc).catch(() => null);
  const pollMs = (s) => (s === 'found' || s === 'host' || s === 'wait-host') ? 1000 : s === 'searching' ? 3000 : 0;
  const roomName = (a, b) => `⚡ 自動配對：${a} vs ${b}`;
  async function scenario(lastPref) {
    const clock = makeClock();
    const server = makeServer(sapSrc, clock);
    const shared = { rooms: {}, seq: 0, pollMs, roomName, lastPref, normalizeDeckCoinPref };
    const A = await makePlayer(js || '', server, clock, { token: 'tA', email: 'a@x.com', name: '小明' }, shared);
    const B = await makePlayer(js || '', server, clock, { token: 'tB', email: 'b@x.com', name: '小華' }, shared);
    return { clock, server, shared, A, B };
  }
  if (!js) { for (const k of ['N3', 'N4', 'N5', 'N5f', 'N5g', 'N5i', 'N5j']) ok(`${k}${tag} （腳本區塊不存在）`, false); return; }
  // N3
  {
    const { A } = await scenario('opponent');
    const p0 = A.peek().firstPref;
    A.api.setDeck('d3'); const p1 = A.peek().firstPref;
    A.api.setDeck('d2'); const p2 = A.peek().firstPref;
    A.api.setDeck('d1'); const p3 = A.peek().firstPref;
    A.api.setDeck('d4'); const p4 = A.peek().firstPref;   // 牌組存的是不合法的值（'opponent' 不是牌組可設的值）⇒ 不動
    ok(`★★★ N3${tag} 預設＝上次手動選的（對手決定）；選偏好後攻的牌組 ⇒ 後攻；選沒設定的 ⇒ 不動；選偏好先攻的 ⇒ 先攻；牌組帶入不記成上次偏好`,
      p0 === 'opponent' && p1 === 'second' && p2 === 'second' && p3 === 'first' && p4 === 'first' && !A.st.calls.some((c) => c.startsWith('save:')), JSON.stringify({ p0, p1, p2, p3, p4, calls: A.st.calls }));
  }
  // N4 + N5
  {
    const { clock, shared, A, B } = await scenario('random');
    A.api.setDeck('d1'); A.api.setFirstPref('second');   // 牌組帶入先攻，玩家手動改成後攻
    B.api.setDeck('d2');                                   // 沒設定 ⇒ 上次的偏好（隨機）
    await A.api.cmStart(); await clock.advance(1000); await B.api.cmStart(); await clock.advance(3100);
    await A.api.cmAnswer(true); await B.api.cmAnswer(true);
    await clock.advance(5000);
    const fa = A.st.calls.filter((c) => c.startsWith('first:')), fb = B.st.calls.filter((c) => c.startsWith('first:'));
    ok(`★★★ N4${tag} 進房後送出的是配對畫面選的先後攻（A 手動改成後攻、B 隨機），而且是在按準備之前`, JSON.stringify(fa) === '["first:second"]' && JSON.stringify(fb) === '["first:random"]'
      && A.st.calls.indexOf('first:second') < A.st.calls.findIndex((c) => c.startsWith('ready:')), JSON.stringify({ A: A.st.calls, B: B.st.calls }));
    const oa = A.peek().overlay, ob = B.peek().overlay;
    ok(`★★★ N5${tag} 進房後雙方立刻顯示「配對成功、正在進入對戰」遮罩（帶對手暱稱），不露出房間畫面`, oa?.opp === '小華' && ob?.opp === '小明' && A.peek().onlineStep === 'room', JSON.stringify({ oa, ob }));
    A.api.setGame({ phase: 'setup' }); A.api.runEffects();
    B.api.setRoomData({ status: 'playing', seats: [] }); B.api.runEffects();
    ok(`★★ N5b${tag} 開局（game 出現）或房間開打 ⇒ 遮罩拿掉`, A.peek().overlay === null && B.peek().overlay === null, JSON.stringify([A.peek().overlay, B.peek().overlay]));
  }
  {
    const { clock, A, B } = await scenario('random');
    A.api.setDeck('d1'); B.api.setDeck('d1');
    await A.api.cmStart(); await B.api.cmStart(); await clock.advance(3100);
    await A.api.cmAnswer(true); await B.api.cmAnswer(true);
    await clock.advance(5000);
    const before = A.peek().overlay;
    await clock.advance(61000);
    ok(`★★ N5c${tag} 60 秒還沒開局 ⇒ 遮罩拿掉、提示到房間裡手動準備`, !!before && A.peek().overlay === null && /自動開局逾時/.test(A.peek().onlineError), JSON.stringify({ before, after: A.peek() }));
  }
  // N5e～N5i（審查）：遮罩在各種異常都會拿掉、不蓋掉原本的錯誤、遮罩上可以離開
  async function entered(opts = {}) {
    const sc = await scenario('random');
    Object.assign(sc.shared, opts.shared || {});
    if (opts.deckFail) sc.A.st.deckFail = true;
    sc.A.api.setDeck('d1'); sc.B.api.setDeck('d1');
    await sc.A.api.cmStart(); await sc.B.api.cmStart(); await sc.clock.advance(3100);
    await sc.A.api.cmAnswer(true); await sc.B.api.cmAnswer(true);
    await sc.clock.advance(5000);
    return sc;
  }
  {
    const sc = await entered();
    const had = !!sc.A.peek().overlay;
    sc.A.api.setOnlineStep('join'); sc.A.api.runEffects();
    ok(`★★ N5e${tag} 離開房間（onlineStep 不是 room）⇒ 遮罩拿掉`, had && sc.A.peek().overlay === null);
    const s2 = await entered();
    s2.A.api.setRoomGone(true); s2.A.api.runEffects();
    ok(`★★ N5f${tag} 房間不見了／連線中斷（roomGone）⇒ 遮罩拿掉（審查 P2-2）`, s2.A.peek().overlay === null);
    const s3 = await entered();
    s3.A.api.setOnlineError('建局卡住：缺少卡片 id'); s3.A.api.runEffects();
    const g1 = s3.A.peek().overlay;
    ok(`★★★ N5g${tag} 建局出錯 ⇒ 遮罩立刻拿掉、露出房間畫面與錯誤（審查 P2-1）`, g1 === null && s3.A.peek().onlineError === '建局卡住：缺少卡片 id', JSON.stringify(s3.A.peek()));
    // 逾時保險絲本身也不可以蓋掉已有的錯誤（假設 effect 沒來得及跑）
    const s3b = await entered();
    s3b.A.api.setOnlineError('建局卡住：缺少卡片 id');
    await s3b.clock.advance(61000);
    ok(`★★ N5g2${tag} 60 秒逾時時已經有錯誤 ⇒ 保留原本的錯誤，不用逾時訊息覆寫`, s3b.A.peek().overlay === null && s3b.A.peek().onlineError === '建局卡住：缺少卡片 id', JSON.stringify(s3b.A.peek()));
    const s4 = await entered({ deckFail: true });
    ok(`★★ N5h${tag} 牌組沒套上座位 ⇒ 遮罩拿掉、不按準備`, s4.A.peek().overlay === null && s4.A.st.ready === false, JSON.stringify(s4.A.peek()));
    const s5 = await entered({ shared: { firstFail: true } });
    ok(`★★★ N5i${tag} 先後攻寫不進座位（重試一次仍失敗）⇒ 不自動準備、遮罩拿掉並提示（不悄悄用隨機開局，審查 P3-3）`, s5.A.peek().overlay === null && s5.A.st.ready === false && /先後攻設定失敗/.test(s5.A.peek().onlineError), JSON.stringify(s5.A.peek()));
    const s6 = await entered();
    s6.A.api.leaveOverlay(); await s6.clock.advance(10);
    ok(`★★ N5j${tag} 遮罩上的「離開」⇒ 拿掉遮罩並離開房間回大廳（審查 P3-4）`, s6.A.peek().overlay === null && s6.A.st.calls.includes('leaveOnlineGame'), JSON.stringify(s6.A.st.calls.slice(-3)));
    const s7 = await entered();
    s7.A.api.cmStop(); 
    ok(`★★ N5k${tag} 結束配對（cmStop）⇒ 遮罩一起拿掉（審查 P3-1）`, s7.A.peek().overlay === null);
  }
  {
    const { clock, shared, A, B } = await scenario('random');
    shared.readyFail = true;
    A.api.setDeck('d1'); B.api.setDeck('d1');
    await A.api.cmStart(); await B.api.cmStart(); await clock.advance(3100);
    await A.api.cmAnswer(true); await B.api.cmAnswer(true);
    await clock.advance(5000);
    ok(`★★ N5d${tag} 自動準備失敗 ⇒ 遮罩拿掉、露出房間畫面並提示`, A.peek().overlay === null && /寫入失敗|自動準備失敗/.test(A.peek().onlineError) && A.peek().onlineStep === 'room', JSON.stringify(A.peek()));
  }
}

const pageSrc = readFileSync(join(ROOT, PAGE), 'utf8'), sapSrc = readFileSync(join(ROOT, SAP), 'utf8').replace(/\r\n/g, '\n');
console.log('【N】靜態'); checkStatic(pageSrc, '');
console.log('【N】行為'); await checkBehavior(normEol(pageSrc), sapSrc, '');
console.log('【H】HEAD-FAIL');
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('H（缺 BASE ' + BASE_SHA + '）');
else {
  const b = readBaseBlob(ROOT, BASE_SHA, PAGE);
  const before = pass, fb = fail; const log = console.log; const lines = []; console.log = (s) => lines.push(String(s));
  checkStatic(b.ok ? b.out : '', '@BASE');
  await checkBehavior(normEol(b.ok ? b.out : ''), sapSrc, '@BASE');
  console.log = log;
  const reds = lines.filter((l) => /FAIL/.test(l)).map((l) => l.trim().slice(5, 30));
  pass = before; fail = fb;
  console.log('    BASE 紅：' + reds.join('｜'));
  ok('★★★ H1 BASE 上 N1～N6 都紅（前提＝抓得到表單在 BASE 也綠）', ['N1@', 'N2@', 'N3@', 'N4@', 'N5@', 'N5a@', 'N5b@', 'N5c@', 'N5f@', 'N5g@', 'N5i@', 'N5j@', 'N6@'].every((k) => reds.some((r) => r.includes(k))) && !reds.some((r) => r.includes('前提')), reds.join(','));
}
console.log(`=== v6.646 自動配對先後攻與直接進對戰：${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
