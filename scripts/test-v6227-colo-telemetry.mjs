#!/usr/bin/env node
/**
 * v6.227 守衛：診斷回報帶上 Cloudflare 邊緣節點（colo）
 *
 * 這一版在補什麼
 * ──────────────────────────────────────────────────────────────────────────
 *   台灣玩家實測被 Cloudflare 導去美西 SJC（8/8、connect 148~155ms ≒ 玩家 net p50），
 *   隧道端在新加坡。「偶發 3~4 秒尾巴」剩兩個競爭假說：
 *     (a) cloudflared 內部狀態隨 uptime 劣化（重啟可解）
 *     (b) 特定 CF 邊緣節點劣化（重啟只是碰巧換節點，治標）
 *   判準＝慢的人集不集中在特定 colo —— 而 payload 裡完全沒有 colo ⇒ 這一版補上：
 *   從**既有回應**的 `cf-ray` 標頭（同源，回應標頭全部讀得到）取 colo，零額外請求。
 *
 * 這支守衛怎麼避免「自己在說謊」
 * ──────────────────────────────────────────────────────────────────────────
 *   [HEAD-FAIL] 還原成 v6.226 會 FAIL（每一段抽取都有「抽得到」的前提斷言）。
 *   [行為]      tApi 的 cf-ray 解析段、_tRecordColoSample、payload 的 colo 欄位算式、
 *               dump 的 coloOf／coloSummary **全部抽出來實跑**：
 *               餵一個帶 cf-ray 的假回應 ⇒ 斷言 colo 真的被解析、計數、進到 payload；
 *               餵沒有 cf-ray 的 ⇒ 斷言安全記 miss、payload 不爆。
 *   [零額外請求] tApi 端點白名單（沿 v6.213 的手法）＋ 剝註解後不得出現 cdn-cgi 抓取，
 *               每條否定型都配正對照。
 *   [體積]      實算最壞情況的 colo 欄位字元數，斷言遠低於 8192 上限的餘裕。
 *
 * Run: node scripts/test-v6227-colo-telemetry.mjs
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { transform } from 'esbuild';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require_ = createRequire(import.meta.url);
const PAGE = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
const DUMPSRC = readFileSync(join(ROOT, 'oracle-admin/tournament/dump-client-monitor.cjs'), 'utf8');
const DUMP = require_(join(ROOT, 'oracle-admin/tournament/dump-client-monitor.cjs'));
const VERS = readFileSync(join(ROOT, 'src/lib/version.ts'), 'utf8');
const ADMIN = readFileSync(join(ROOT, 'oracle-admin/admin.html'), 'utf8');
const PKG = readFileSync(join(ROOT, 'package.json'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (extra ? ' — ' + extra : '')); } };

// 抽出一支函式的完整原始碼（大括號配對；與 v6.213 守衛同一支）。
function grabFn(src, name) {
  const re = new RegExp('function\\s+' + name.replace(/[$]/g, '\\$') + '\\s*\\(');
  const m = re.exec(src);
  if (!m) return null;
  let i = src.indexOf('{', m.index + m[0].length - 1);
  if (i < 0) return null;
  let d = 0;
  for (let k = i; k < src.length; k++) {
    const ch = src[k];
    if (ch === '{') d++;
    else if (ch === '}') { d--; if (d === 0) return src.slice(m.index, k + 1); }
  }
  return null;
}
// 剝註解（否定型斷言用；v6.157 教訓：說明文字自己就含關鍵字）。
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
}

console.log('0) 前提：抽得到東西（抽不到的話後面每一條都是假綠）');
const fnRecSeg = grabFn(PAGE, '_tRecordApiSegments');
const fnRecColo = grabFn(PAGE, '_tRecordColoSample');
ok('[前提/HEAD-FAIL] _tRecordColoSample 抽得出來（v6.226 沒有這支 ⇒ 這條就是 HEAD-FAIL 點）',
  !!fnRecSeg && !!fnRecColo);
// tApi 裡的 cf-ray 解析段：從 `let _colo` 到它自己的 catch（非貪婪 ⇒ 不會吃到後面）。
const mColo = /let _colo: string \| null = null;[\s\S]*?\} catch \{ \/\* 量測絕不影響對戰 \*\/ \}/.exec(PAGE);
ok('[前提/HEAD-FAIL] tApi 讀 cf-ray 那一段抽得出來', !!mColo);
// payload 的 colo 欄位：抽出整行的 RHS（後面會實跑）。
const mPay = /\n\s*colo: (\(_coloLast \|\| _coloMiss > 0\)[^\n]*?),\n/.exec(PAGE);
ok('[前提/HEAD-FAIL] 診斷 payload 的 colo 欄位抽得出來', !!mPay);

// ══════════════════════════════════════════════════════════════════════════
// 1. 行為端：cf-ray → colo 解析（餵假回應）
// ══════════════════════════════════════════════════════════════════════════
console.log('\n1) 行為端：cf-ray 解析（真的餵假回應進 tApi 那一段）');
if (mColo) {
  const js = (await transform(mColo[0], { loader: 'ts', target: 'node20' })).code;
  const run = new Function('res', js + '; return _colo;');
  ok('★★★行為：cf-ray "a2fb6ea96b799913-SJC" ⇒ 解析出 SJC',
    run({ headers: { get: (k) => (k === 'cf-ray' ? 'a2fb6ea96b799913-SJC' : null) } }) === 'SJC');
  ok('★★行為：多個 "-" 取最後一段（"8f0-ab-TPE" ⇒ TPE）',
    run({ headers: { get: () => '8f0-ab-TPE' } }) === 'TPE');
  ok('★★行為：小寫尾碼會被正規化成大寫（"abc-sjc" ⇒ SJC）',
    run({ headers: { get: () => 'abc-sjc' } }) === 'SJC');
  ok('★★★行為：沒有 cf-ray（SW 快取／不經 CF）⇒ null，不 throw',
    run({ headers: { get: () => null } }) === null);
  ok('★★行為：沒有 "-" 的垃圾字串 ⇒ null', run({ headers: { get: () => 'garbage' } }) === null);
  ok('★★行為："-" 之後是空的 ⇒ null', run({ headers: { get: () => 'abc-' } }) === null);
  ok('★★行為：尾碼太長（不是 3~4 碼機場碼）⇒ null', run({ headers: { get: () => 'abc-TOOLONG9' } }) === null);
  ok('★★★行為：res 完全沒有 headers ⇒ 不 throw、回 null',
    (() => { try { return run({}) === null; } catch { return false; } })());
  ok('★★行為：headers.get 自己 throw ⇒ 不 throw、回 null',
    (() => { try { return run({ headers: { get: () => { throw new Error('boom'); } } }) === null; } catch { return false; } })());
  // 零額外請求：這一段只准讀標頭，不准有任何 fetch / await。
  ok('★★★[零額外請求] 解析段裡沒有 fetch、沒有 await（只讀既有回應的標頭）',
    !/\bfetch\s*\(/.test(mColo[0]) && !/\bawait\b/.test(mColo[0]));
  ok('[正對照] 上一條不是恆真式：整個檔案裡 fetch/await 到處都是',
    /\bfetch\s*\(/.test(PAGE) && /\bawait\b/.test(PAGE));
}

// ══════════════════════════════════════════════════════════════════════════
// 2. 行為端：_tRecordColoSample（計數、範圍守衛、上限）
// ══════════════════════════════════════════════════════════════════════════
console.log('\n2) 行為端：_tRecordColoSample');
let H = null;
if (fnRecColo) {
  try {
    const PRELUDE = `
      let isTournament = true, isTournSpectator = false;
      let _coloCounts: Record<string, number> = {};
      let _coloLast: string | null = null;
      let _coloMiss = 0;
    `;
    const EXPORTS = `
      return {
        _tRecordColoSample,
        get: () => ({ counts: _coloCounts, last: _coloLast, miss: _coloMiss }),
        set: (k, v) => { if (k === 'isTournament') isTournament = v; else if (k === 'isTournSpectator') isTournSpectator = v; },
        reset: () => { _coloCounts = {}; _coloLast = null; _coloMiss = 0; },
      };
    `;
    const js = (await transform(PRELUDE + fnRecColo + EXPORTS, { loader: 'ts', target: 'node20' })).code;
    H = new Function(js)();
  } catch (e) { ok('行為端 harness 可建立', false, String((e && e.message) || e)); }
}
if (H) {
  H.reset();
  H._tRecordColoSample('/action', 'SJC');
  H._tRecordColoSample('/state?room=x&v=1', 'SJC');
  H._tRecordColoSample('/action', 'TPE');
  ok('★★★行為：colo 有被計數（SJC×2、TPE×1）、last 是最近一發',
    JSON.stringify(H.get().counts) === JSON.stringify({ SJC: 2, TPE: 1 }) && H.get().last === 'TPE',
    JSON.stringify(H.get()));
  H._tRecordColoSample('/action', null);
  ok('★★★行為：null（沒有 cf-ray）記進 miss，counts／last 不動',
    H.get().miss === 1 && H.get().last === 'TPE' && H.get().counts.SJC === 2);
  // 範圍守衛必須與 net/srv 同母體
  H.reset();
  H._tRecordColoSample('/state?room=x&v=1&wait=1', 'SJC');
  ok('★★★行為：長輪詢（wait=1）完全不記（母體要與 net/srv 一致）',
    Object.keys(H.get().counts).length === 0 && H.get().miss === 0);
  for (const pp of ['/chat?since=1', '/event', '/bracket?eventId=x', '/leaderboard']) H._tRecordColoSample(pp, 'SIN');
  ok('★★行為：大廳端點一律不記', Object.keys(H.get().counts).length === 0);
  H.set('isTournSpectator', true); H._tRecordColoSample('/action', 'SIN');
  ok('★行為：觀戰者不記', Object.keys(H.get().counts).length === 0);
  H.set('isTournSpectator', false); H.set('isTournament', false); H._tRecordColoSample('/action', 'SIN');
  ok('★行為：非錦標賽不記', Object.keys(H.get().counts).length === 0);
  H.set('isTournament', true);
  // 上限：相異 colo 鍵最多 8 個（防 payload 被灌爆），既有鍵仍照數
  H.reset();
  const colos = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF', 'GGG', 'HHH', 'III', 'JJJ'];
  for (const c of colos) H._tRecordColoSample('/action', c);
  ok('★★★行為：相異 colo 鍵數上限 8（第 9、10 個不再新增鍵）',
    Object.keys(H.get().counts).length === 8 && !('III' in H.get().counts), JSON.stringify(H.get().counts));
  H._tRecordColoSample('/action', 'AAA');
  ok('★★行為：頂到上限後，既有鍵仍照常累加', H.get().counts.AAA === 2);
}

// ══════════════════════════════════════════════════════════════════════════
// 3. 接線：tApi → 記錄 → payload（含母體一致與跨場清空）
// ══════════════════════════════════════════════════════════════════════════
console.log('\n3) 接線與母體');
{
  const iTApi = PAGE.indexOf('async function tApi(');
  const iSrvCall = PAGE.indexOf('_tRecordSrvSample(path, _srvMs);');
  const iColoCall = PAGE.indexOf('_tRecordColoSample(path, _colo);');
  ok('★★★[HEAD-FAIL] tApi 裡讀完 cf-ray 真的傳給記錄函式（有讀沒接＝白寫）',
    iColoCall > 0 && iSrvCall > 0 && iColoCall > iSrvCall && iColoCall - iSrvCall < 400,
    JSON.stringify([iSrvCall, iColoCall]));
  ok('[前提] tApi 本身抓得到', iTApi > 0 && iColoCall > iTApi);
  ok('[HEAD-FAIL] tApi 有讀 cf-ray 這個回應標頭', /res\.headers\.get\('cf-ray'\)/.test(PAGE));
}
{
  // 範圍守衛三行必須與 _tRecordApiSegments 逐字相同（colo 的母體＝net/srv 的母體）
  const gate = (fn) => (fn || '').split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('if (!isTournament') || l.startsWith("if (path.indexOf('wait=1')") || l.startsWith('if (!(path.indexOf('));
  const a = gate(fnRecSeg), b = gate(fnRecColo);
  ok('[前提] 兩支函式都抓得到三行範圍守衛', a.length === 3 && b.length === 3, JSON.stringify([a.length, b.length]));
  ok('★★★[母體一致] colo 與 net/srv 的範圍守衛**逐字相同**（母體不同就不能對照）',
    JSON.stringify(a) === JSON.stringify(b), JSON.stringify(a) + ' vs ' + JSON.stringify(b));
}
ok('★★[跨場殘留] 離場（tLeaveMatch）一定清 colo 三件（殘留會把上一場的節點掛到下一場）',
  /_coloCounts = \{\}; _coloLast = null; _coloMiss = 0;/.test(PAGE));
{
  // ⭐ 零額外請求（沿 v6.213 的白名單手法）：全檔 tApi 的端點字面量必須都在既有清單內。
  const KNOWN = ['/clientdiag', '/checkin', '/champions', '/leaderboard', '/profile', '/unregister',
    '/cancel-proposal', '/event', '/bracket', '/chat', '/register', '/register-and-checkin', '/drop',
    '/match/enter', '/match/forfeit', '/propose', '/replay', '/champion-bracket', '/spectate/list',
    '/action', '/state', '/spectate/state', '/still-here', '/forfeit', '/undo',
    '/join', '/reset', '/push/selftest'];
  const lits = [...new Set([...PAGE.matchAll(/tApi\(\s*'([^'`]+)'/g)].map((m) => m[1].split('?')[0]))];
  ok('[自我驗證] 抓得到 tApi 的端點字面量', lits.length >= 8, String(lits.length));
  const unknown = lits.filter((x) => !KNOWN.includes(x));
  ok('★★★[零額外請求] 沒有新增任何端點（tApi 端點字面量都在既有白名單內）',
    unknown.length === 0, JSON.stringify(unknown));
  // 剝註解後不得出現 cdn-cgi（註解裡本來就寫著「絕不去打 /cdn-cgi/trace」）。
  const noc = stripComments(PAGE);
  ok('★★★[零額外請求] 剝註解後全檔沒有 cdn-cgi 抓取', !/cdn-cgi/.test(noc));
  ok('[正對照] 上一條不是恆真式：未剝註解的原文裡確實有 cdn-cgi 這串字（說明文字）', /cdn-cgi/.test(PAGE));
}
// payload 欄位算式：實跑 RHS
console.log('\n3b) payload 的 colo 欄位（實跑算式）');
if (mPay) {
  const evalPay = new Function('_coloLast', '_coloCounts', '_coloMiss', 'return (' + mPay[1] + ');');
  const r1 = evalPay('SJC', { SJC: 18, TPE: 2 }, 1);
  ok('★★★行為：有資料 ⇒ payload.colo = { last, seen 計數, miss }',
    r1 && r1.last === 'SJC' && JSON.stringify(r1.seen) === JSON.stringify({ SJC: 18, TPE: 2 }) && r1.miss === 1,
    JSON.stringify(r1));
  ok('★★★行為：一發都沒有 ⇒ payload.colo = null（不是一堆 0 假裝有量到）',
    evalPay(null, {}, 0) === null);
  const r3 = evalPay(null, {}, 5);
  ok('★★行為：只有 miss（全部沒 cf-ray）⇒ 仍回報 { last:null, miss }（這本身就是 SW 快取的指紋）',
    r3 && r3.last === null && r3.miss === 5, JSON.stringify(r3));
  // 端到端：假回應 → 解析段 → 記錄函式 → payload 算式
  if (H && mColo) {
    const js = (await transform(mColo[0], { loader: 'ts', target: 'node20' })).code;
    const parse = new Function('res', js + '; return _colo;');
    H.reset();
    const fakeRes = (ray) => ({ headers: { get: (k) => (k === 'cf-ray' ? ray : null) } });
    H._tRecordColoSample('/action', parse(fakeRes('aaaa-SJC')));
    H._tRecordColoSample('/state?room=r&v=1', parse(fakeRes('bbbb-SJC')));
    H._tRecordColoSample('/action', parse(fakeRes('cccc-TPE')));
    H._tRecordColoSample('/action', parse(fakeRes(null)));
    const st = H.get();
    const pay = evalPay(st.last, st.counts, st.miss);
    ok('★★★[端到端] 假回應 ⇒ 解析 ⇒ 計數 ⇒ payload：{SJC:2,TPE:1}、last=TPE、miss=1',
      pay && pay.last === 'TPE' && JSON.stringify(pay.seen) === JSON.stringify({ SJC: 2, TPE: 1 }) && pay.miss === 1,
      JSON.stringify(pay));
  }
  // 體積：最壞情況（8 個 4 碼 colo、各 4 位數次數）
  const worstSeen = {}; for (let i = 0; i < 8; i++) worstSeen['C' + i + 'XX'] = 9999;
  const worst = JSON.stringify({ colo: evalPay('C0XX', worstSeen, 9999) }).length;
  console.log('  colo 欄位最壞情況 ' + worst + ' 字元（含鍵名；上限 8192、目前實測最長用到 42%）');
  ok('★[體積] colo 欄位最壞情況 < 200 字元（對 8192 上限九牛一毛）', worst < 200, worst + ' 字元');
}

// ══════════════════════════════════════════════════════════════════════════
// 4. dump 報表：coloOf / coloSummary 實跑
// ══════════════════════════════════════════════════════════════════════════
console.log('\n4) dump 報表：colo 分組（實跑，不是驗字串）');
ok('[HEAD-FAIL] dump 匯出了 coloOf / coloSummary（守衛要實跑）',
  typeof DUMP.coloOf === 'function' && typeof DUMP.coloSummary === 'function');
if (typeof DUMP.coloOf === 'function') {
  ok('★★★行為：舊 client（payload 沒有 colo 欄位）⇒ null＝「不知道」，不是 0 也不屬於任何 colo',
    DUMP.coloOf({ ver: '6.226' }) === null);
  ok('★★行為：新 client 但 colo:null ⇒ "none"（與舊 client 分得出來）',
    DUMP.coloOf({ colo: null }) === 'none');
  const c1 = DUMP.coloOf({ colo: { last: 'TPE', seen: { SJC: 18, TPE: 2 }, miss: 0 } });
  ok('★★★行為：主 colo ＝ seen 裡次數最多的那個（不是 last）、multi 旗標會亮',
    c1 && c1.main === 'SJC' && c1.multi === true, JSON.stringify(c1));
  const c2 = DUMP.coloOf({ colo: { last: 'SIN', seen: {}, miss: 3 } });
  ok('★★行為：seen 空但 last 有 ⇒ 用 last', c2 && c2.main === 'SIN' && c2.multi === false);
  ok('★★行為：seen 空、last 也空、只有 miss ⇒ "none"（安全，不爆）',
    DUMP.coloOf({ colo: { last: null, seen: {}, miss: 4 } }) === 'none');
  ok('★行為：colo 是垃圾型別 ⇒ "none"（不爆）', DUMP.coloOf({ colo: 'SJC' }) === 'none');
}
if (typeof DUMP.coloSummary === 'function') {
  const row = (uid, reason, payload) => ({ uid, reason, diag: JSON.stringify(payload) });
  const mk = (colo, netP50, netP95) => ({
    ver: '6.227', colo: { last: colo, seen: { [colo]: 10 }, miss: 0 },
    poll: { rtt: { n: 10, p50: 100, p95: netP95 || 500, max: 900 } },
    perf: { api: { net: { n: 10, p50: netP50, p95: netP95, max: netP95 } } },
  });
  const rows = [
    row('u1', 'slow-rtt', mk('SJC', 140, 3200)),
    row('u1', 'stale-version', mk('SJC', 150, 400)),
    row('u2', 'slow-rtt', mk('SJC', 160, 5000)),
    row('u3', 'manual-sync', mk('TPE', 40, 90)),
    row('u4', 'slow-rtt', { ver: '6.220' }),
    row('u5', 'slow-rtt', { ver: '6.227', colo: null }),
    { uid: 'u6', reason: 'slow-rtt', diag: '{"ver":"6.2' },
  ];
  let cs = null;
  try { cs = DUMP.coloSummary(rows); } catch (e) { /* 下一條會紅 */ }
  ok('★★★行為：coloSummary 對混合資料（含截斷列）不 throw', !!cs);
  if (cs) {
    const sjc = (cs.groups || []).find((g) => g.colo === 'SJC');
    const tpe = (cs.groups || []).find((g) => g.colo === 'TPE');
    ok('★★★行為：SJC 組 3 筆 / 2 人、TPE 組 1 筆', sjc && sjc.n === 3 && sjc.players === 2 && tpe && tpe.n === 1, JSON.stringify(cs.groups));
    ok('★★★行為：net 典型（各筆 p50 的中位數）真的算出來（SJC=150）',
      sjc && sjc.netTypP50 === 150, sjc && String(sjc.netTypP50));
    ok('★★★行為：slow-rtt 佔比按 colo 分組（SJC 2/3、TPE 0/1）',
      sjc && Math.abs(sjc.slowPct - 66.7) < 0.2 && tpe && tpe.slowPct === 0,
      JSON.stringify([sjc && sjc.slowPct, tpe && tpe.slowPct]));
    ok('★★★行為：舊 client＋截斷列進 unknown（＝「不知道」）、colo:null 進 noneColo，互不混',
      cs.unknown === 2 && cs.noneColo === 1 && cs.withColo === 4, JSON.stringify([cs.unknown, cs.noneColo, cs.withColo]));
  }
  let empty = null;
  try { empty = DUMP.coloSummary([]); } catch (e) { /* */ }
  ok('★行為：空資料不爆', !!empty && empty.groups.length === 0 && empty.withColo === 0);
}
{
  // 報表接線：main() 必須對**兩批**各跑一次（異常批＋健康取樣批），且摘要有 ②-e 段。
  const noc = stripComments(DUMPSRC);
  ok('★★★[HEAD-FAIL] main() 對異常批與取樣批**各**跑一次 coloSummary（沒有對照組就答不了問題）',
    /coloSummary\(raw\)/.test(noc) && /coloSummary\(rawSample\)/.test(noc));
  ok('[HEAD-FAIL] TXT 摘要有 ②-e colo 段（判讀說明＋兩批分開）', /②-e/.test(DUMPSRC) && /colo/.test(DUMPSRC));
  ok('[報表] 舊 client 缺值的顯示語義有寫清楚（「不知道」不是 0）', /沒有這一欄|無此欄|不知道/.test(DUMPSRC));
  ok('[報表] JSON 輸出帶 colo 區塊（anomaly／sample 分開）', /colo: \{ anomaly: coloAnom, sample: coloSamp \}/.test(DUMPSRC));
  ok('[報表] ms(null) 顯示為「—」（缺值不是 0）', typeof DUMP.parseRange === 'function' && /return '—';/.test(DUMPSRC));
}

// ══════════════════════════════════════════════════════════════════════════
// 5. 版本與自我註冊
// ══════════════════════════════════════════════════════════════════════════
console.log('\n5) 版本／自我註冊');
ok('[版本] version.ts 已 bump 到 6.227', /VERSION = '6\.227'/.test(VERS));
ok('[版本] admin.html 的 SITE_VERSION_HINT 同步 6.227', /SITE_VERSION_HINT = '6\.227'/.test(ADMIN));
ok('[版本] admin.html 維持 LF 行尾（CRLF 會讓部署流程炸）', !ADMIN.includes('\r'));
ok('[自我註冊] 本守衛已掛進 npm test', PKG.includes('test-v6227-colo-telemetry.mjs'));

console.log('\n═══ 結果：' + pass + ' PASS / ' + fail + ' FAIL ═══');
if (fail > 0) process.exit(1);
