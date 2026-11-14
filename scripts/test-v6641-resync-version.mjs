// v6.641 守衛：錦標賽「重新同步」（tForceResync）改帶目前版本，不再一律 v=-1 全量（2026-11-14 擴容審查 P2-1）
//
// 為什麼行為不變：tForceResync 只在 fr.version !== tVersion 時才採納盤面；版本相同時伺服器回的精簡 unchanged
//   也帶 lastActionAt／actorSeat／playerClock／longPoll／serverNow ⇒ 改帶目前版本，只是伺服器少讀、少序列化一份盤面。
//
// 【A】行為（把 +page.svelte 裡真正的 tForceResync 抽出來，接假的 tApi 實跑）
//   A1 有版本、身分正常 ⇒ 請求帶 v=<目前版本>（不是 -1），心跳 s= 照帶
//   A2 還沒有版本（tVersion = -1）⇒ 仍帶 v=-1；A2b 版本 undefined 也帶 -1
//   A6 拿到同版本的完整盤面 ⇒ 不採納
//   A3 身分失效橫幅亮著（tAuthLost）⇒ 仍帶 v=-1（完整回應才會驗身分）
//   A4 伺服器回精簡 unchanged（同版本）⇒ 不採納盤面，但 lastActionAt／actorSeat／serverNow 照更新
//   A5 伺服器回較新版本的完整盤面 ⇒ 照舊採納（expectV＝送出時的版本）
// 【B】靜態：tForceResync 本體（剝註解後）不再出現 v=-1 字面；其他救援路徑（輪詢停擺）維持 v=-1 不動
// 【H】HEAD-FAIL：BASE（v6.640）上 A1／B1 紅，A2～A5 綠（正對照：抽取器與替身沒壞）
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripCommentsBlankChecked } from './lib/strip-comments.mjs';
import { normEol } from './lib/eol-agnostic.mjs';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = '9c67d521';   // v6.640＋server v1.81
const PAGE = 'src/routes/game/+page.svelte';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + String(x).slice(0, 400) : '')); } };

function sliceFn(src, head) {
  const i = src.indexOf(head);
  if (i < 0) return '';
  let d = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (d === 0) return src.slice(i, k + 1); } }
  return '';
}

async function runResync(fnSrc, st, resp) {
  const calls = [], adopts = [];
  const js = fnSrc.replace(/catch \(e: any\)/g, 'catch (e)');
  const env = { ...st };
  const body = `
    let { isTournament, isTournSpectator, tActiveRoom, tVersion, tPollGen, mySeatIdx, tAuthLost } = __st;
    let _tLastPollOkAt = 0, tLastActionAt = null, tServerActorSeat = 'unset', tLongPollReady = null, tClockOffset = 0, tNow = 0;
    const tApi = async (u) => { __calls.push(u); return __resp; };
    const tAdopt = (g, v, o) => { __adopts.push({ v, o }); };
    const adoptPlayerClock = () => {};
    ${js}
    return (async () => { await tForceResync(); return { tLastActionAt, tServerActorSeat, tClockOffset, tAuthLost, _tLastPollOkAt }; })();`;
  try {
    const out = await new Function('__st', '__calls', '__adopts', '__resp', body)(env, calls, adopts, resp);
    return { calls, adopts, out };
  } catch (e) { return { calls, adopts, err: e.message }; }
}

async function checkAll(pageRaw, tag) {
  const page = stripCommentsBlankChecked(normEol(pageRaw), 'svelte');
  const fn = sliceFn(page, 'async function tForceResync()');
  ok(`前提${tag} 抓得到 tForceResync 本體`, fn.length > 400 && fn.length < 8000, fn.length);
  const base = { isTournament: true, isTournSpectator: false, tActiveRoom: 'R1', tVersion: 42, tPollGen: 1, mySeatIdx: 0, tAuthLost: false };
  const light = { version: 42, unchanged: true, lastActionAt: 777, actorSeat: 1, serverNow: Date.now() + 5000, longPoll: false };
  const a1 = await runResync(fn, base, light);
  ok(`★★★ A1${tag} 有版本、身分正常 ⇒ 帶 v=42（不是 -1），心跳 s=0 照帶`, !a1.err && a1.calls.length === 1 && /[?&]v=42&s=0$/.test(a1.calls[0]), JSON.stringify(a1));
  const a2 = await runResync(fn, { ...base, tVersion: -1 }, light);
  ok(`★★ A2${tag} 還沒有版本 ⇒ 仍帶 v=-1`, !a2.err && /[?&]v=-1&s=0$/.test(a2.calls[0] || ''), JSON.stringify(a2.calls));
  const a2b = await runResync(fn, { ...base, tVersion: undefined }, light);
  ok(`★ A2b${tag} 版本是 undefined（還沒採納過任何盤面）⇒ 帶 v=-1，不會送出 v=undefined`, !a2b.err && /[?&]v=-1&s=0$/.test(a2b.calls[0] || ''), JSON.stringify(a2b.calls));
  const a6 = await runResync(fn, { ...base, tAuthLost: true }, { version: 42, gameState: { phase: 'main' } });
  ok(`★★ A6${tag} 拿到同版本的完整盤面（身分失效時走 v=-1）⇒ 仍不採納（只有版本不同才採納）`, !a6.err && a6.adopts.length === 0, JSON.stringify(a6.adopts));
  const a3 = await runResync(fn, { ...base, tAuthLost: true }, light);
  ok(`★★ A3${tag} 身分失效橫幅亮著 ⇒ 仍帶 v=-1`, !a3.err && /[?&]v=-1&s=0$/.test(a3.calls[0] || ''), JSON.stringify(a3.calls));
  ok(`★★ A4${tag} 精簡 unchanged ⇒ 不採納盤面，但 lastActionAt／actorSeat／時鐘照更新`, !a1.err && a1.adopts.length === 0 && a1.out.tLastActionAt === 777 && a1.out.tServerActorSeat === 1 && a1.out.tClockOffset > 1000 && a1.out._tLastPollOkAt > 0, JSON.stringify(a1.out));
  const a5 = await runResync(fn, base, { version: 43, gameState: { phase: 'main' }, lastActionAt: 1 });
  ok(`★★ A5${tag} 較新版本的完整盤面 ⇒ 照舊採納（expectV＝42）`, !a5.err && a5.adopts.length === 1 && a5.adopts[0].v === 43 && a5.adopts[0].o.expectV === 42 && a5.adopts[0].o.reason === 'resync', JSON.stringify(a5.adopts));
  // 【B】靜態
  const stallBlk = (() => { const i = page.indexOf("tAdopt(fr.gameState, fr.version, { expectV: _rv, reason: 'poll-stall' })"); return i > 0 ? page.slice(Math.max(0, i - 1500), i) : ''; })();
  ok(`★★ B1${tag} tForceResync 不再出現 v=-1 字面（例外走 _rsV 變數）；輪詢停擺救援維持 v=-1 不動`, fn.length > 0 && !/v=-1/.test(fn) && /&v=-1`\)/.test(stallBlk), JSON.stringify({ inFn: /v=-1/.test(fn), stall: /&v=-1`\)/.test(stallBlk) }));
}

const HEAD = readFileSync(join(ROOT, PAGE), 'utf8');
console.log('【A／B】現行版');
await checkAll(HEAD, '');
console.log('【H】HEAD-FAIL');
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('H（缺 BASE ' + BASE_SHA + '）');
else {
  const b = readBaseBlob(ROOT, BASE_SHA, PAGE);
  const before = pass, fb = fail; const log = console.log; const lines = []; console.log = (s) => lines.push(String(s));
  await checkAll(b.ok ? b.out : '', '@BASE');
  console.log = log;
  const reds = lines.filter((l) => /FAIL/.test(l)).map((l) => l.trim().slice(5, 30));
  const bp = pass - before; pass = before; fail = fb;
  console.log('    BASE 紅：' + reds.join('｜'));
  ok('★★★ H1 BASE 上 A1、B1 紅', ['A1@BASE', 'B1@BASE'].every((k) => reds.some((r) => r.includes(k))), reds.join(','));
  ok('★★ H2 BASE 上「前提」與 A2～A5 綠（正對照：抽取器與替身沒壞，v=-1 本來就會走這些路徑）', !reds.some((r) => /前提|A2b?@|A3|A4|A5|A6/.test(r)) && bp >= 5, reds.join(',') + ' ' + bp);
}
console.log(`=== v6.641 重新同步帶目前版本：${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
