// v6.246 守衛：獨立審查者對 v6.245 的三項複驗結果 —— 全部斷言到**行為層**（實跑，不是 grep 字串）
//
// ── 這一版在修什麼 ────────────────────────────────────────────────────────
// 【問題1】401 分支還留著一發**沒有任何上限**的 `oracleAuth()`（BASE:215）。
//          token 過期(401) ＋ auth 端點黑洞 ⇒ 整支 oracleApi 永遠不 settle
//          ⇒「按了沒反應」在這條路上原封不動存活。
//          順帶：room-oracle getMyUid()／auth-facade／game onMount 的**裸** oracleAuth() 同樣沒有上限。
// 【問題2】v6.245 的逾時訊息含 path；`oracleGetRoom(Delta)` 用 `String(err).includes('404')`
//          判「房間不存在」⇒ URL 裡剛好出現 `404`（logh 雜湊／since 版本／logSince 則數）時
//          逾時被誤判成「房間不存在」⇒ 回 null ⇒ 畫面顯示「房間不存在或連線中斷」並停止同步。
// 【問題3】慢上行玩家**修後比修前更糟**：nginx 實測 `86.954 0.007 409 … PUT 48285`
//          ⇒ 上行 ≈ 555 B/s，48KB 要 87 秒；v6.245 的 30 秒只送得出 34% ⇒ 兩發都被砍
//          ⇒ 永遠送不到伺服器（而 v6.244 那 87 秒是**送達**的）。
//
// ── 這支守衛怎麼證明 ──────────────────────────────────────────────────────
//  ① 掃描器自我驗證 + 同型缺陷枚舉（全站不得再有「用字串比對 HTTP 狀態碼」）
//  ② 【問題1】HEAD-FAIL：v6.245 的 401＋auth 黑洞掛住 10 分鐘；修後必須有界。含 401 重試正對照。
//  ③ 【問題2】HEAD-FAIL：logh 含 404 ＋ 逾時 ⇒ v6.245 回 null；修後丟逾時錯。
//             ⭐正對照：**真的** 404 修前修後都必須回 null。
//  ④ 【問題3】HEAD-FAIL：48KB／4.4 kbps ⇒ v6.245 送不到；修後必須送達。
//             ⭐正對照：正常玩家（快連線／小封包／真黑洞 1091B）一秒都不可以多等。
//  ⑤ 【問題5】故意讓 esbuild 壞掉 ⇒ v6.245 守衛的突變測試必須**報錯**而不是假 OK。
//  ⑥ 突變測試：把本版四個機制逐一改回去，對應斷言必須翻紅（且**基準線先綠、紅在預期那條**）。
//
// ⚠ 時間全部走**虛擬時鐘**（注入的 setTimeout/clearTimeout），所以「87 秒」是瞬間的。
// Run: node scripts/test-v6246-oracle-timeout-followups.mjs
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import assert from 'node:assert';
import { stripCommentsBlankChecked } from './lib/strip-comments.mjs';   // ⭐v6.323 等長留白版（本檔靠行號）

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OC = readFileSync(join(ROOT, 'src/lib/game/oracle-client.ts'), 'utf8');
const RO = readFileSync(join(ROOT, 'src/lib/game/room-oracle.ts'), 'utf8');
const GP = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
// v6.245 的 sha（只用來拿 BASE 對照；CI 是 fetch-depth:1 淺複製 ⇒ 拿不到就用等價突變版，不 fail-open）
const BASE_SHA = '3937a1e5e141c13977b03b38897f4e569a264905';

let pass = 0, fail = 0;
const T = async (n, f) => { try { await f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };
const ok = (c, m) => assert.ok(c, m);
const esbuild = await import('esbuild');   // 抓不到就直接紅（fail-open 會變成假綠）

// ══════════════════════════════════════════════════════════════════════════
// 共用：把 oracle-client.ts 變成可在 new Function 內實跑的 CJS 模組（同 v6.245 守衛）
// ══════════════════════════════════════════════════════════════════════════
function prepModule(src) {
  const out = src
    .replace(/^import \{ noteServerTime, getServerClockOffsetMs \} from '\.\/server-clock';$/m,
      'const noteServerTime = (): boolean => false; const getServerClockOffsetMs = (): number | null => null;')
    .replace("((import.meta as any).env?.VITE_ORACLE_API_URL as string) || ''", "'http://t.local'")
    .replace("((import.meta as any).env?.VITE_BACKEND_MODE as string) === 'oracle'", 'true');
  assert.ok(!out.includes('server-clock'), 'prepModule 沒換掉 server-clock import');
  assert.ok(!out.includes('import.meta'), 'prepModule 沒換掉 import.meta.env');
  assert.ok(out.length > 15000, 'prepModule 產出只有 ' + out.length + ' 字元，抽取器壞了？');
  return out;
}
const compile = (src) => esbuild.transformSync(prepModule(src), { loader: 'ts', format: 'cjs' }).code;

const realSetImmediate = setImmediate;
function makeClock() {
  let now = 0, seq = 0;
  const timers = new Map();
  const cleared = [];
  const vSetTimeout = (fn, ms) => { const id = ++seq; timers.set(id, { at: now + (ms || 0), fn }); return id; };
  const vClearTimeout = (id) => { cleared.push(id); timers.delete(id); };
  const drain = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => realSetImmediate(r)); };
  async function advance(ms) {
    const target = now + ms;
    for (;;) {
      await drain();
      let best = null, bestId = -1;
      for (const [id, t] of timers) if (t.at <= target && (!best || t.at < best.at)) { best = t; bestId = id; }
      if (!best) break;
      now = best.at; timers.delete(bestId); best.fn();
    }
    now = target; await drain();
  }
  return { vSetTimeout, vClearTimeout, advance, drain, cleared, timers, nowRef: () => now };
}
function mkRes(r) {
  return {
    status: r.status, ok: r.status >= 200 && r.status < 300,
    headers: { get: () => null },
    json: async () => (typeof r.body === 'string' ? JSON.parse(r.body) : r.body),
    text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)),
  };
}
function makeFetch(clock, plan) {
  const calls = [];
  const fn = (url, init) => new Promise((resolve, reject) => {
    const rec = { url, init: init || {}, signal: init && init.signal, abortedAt: null, doneAt: null };
    calls.push(rec);
    const p = plan(rec, calls.length);
    if (p.delayMs !== Infinity) clock.vSetTimeout(() => { rec.doneAt = clock.nowRef(); resolve(mkRes(p)); }, p.delayMs);
    if (rec.signal) {
      rec.signal.addEventListener('abort', () => {
        rec.abortedAt = clock.nowRef();
        const e = new Error('The operation was aborted.'); e.name = 'AbortError';
        reject(e);
      });
    }
  });
  fn.calls = calls;
  return fn;
}
function loadModule(srcText, clock, fetchImpl, opts = {}) {
  const code = compile(srcText);
  const mod = { exports: {} };
  const store = opts.noCache ? {} : { ptcg_oracle_token: 'T0', ptcg_oracle_uid: 'U0' };
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  const f = new Function('module', 'exports', 'fetch', 'AbortController', 'setTimeout',
    'clearTimeout', 'localStorage', 'console', 'Symbol', code);
  f(mod, mod.exports, fetchImpl, AbortController, clock.vSetTimeout, clock.vClearTimeout,
    localStorage, { warn() {}, error() {}, log() {} }, Symbol);
  return mod.exports;
}
function watch(p) {
  const st = { done: false, value: undefined, err: undefined };
  p.then((v) => { st.done = true; st.value = v; }, (e) => { st.done = true; st.err = e; });
  return st;
}
// ⭐v6.323：區塊註解改走中央行級狀態機的**等長留白版**（本檔用行號回報；原本的區塊正則會把 game 頁
//   :208～:384 整段吃掉 ⇒ 洞內的 includes('404') 掃不到）。行尾 // 仍在本檔剝（單行、不跨行 ⇒ 不會形成洞）。
function stripComments(s, opt = {}) {
  return stripCommentsBlankChecked(s, { label: 'probe', minRatio: 0.2, ...opt })
          .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

// ── BASE(v6.245) 對照：拿得到就用真 blob；CI 淺複製拿不到就用等價突變版 ───────
let baseOC = null;
try {
  baseOC = execFileSync('git', ['-C', ROOT, 'cat-file', '-p', BASE_SHA + ':src/lib/game/oracle-client.ts'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
} catch { baseOC = null; }
/** 把 v6.246 的三個機制逐一改回 v6.245 的樣子（＝ CI 淺複製時的等價 BASE，也是突變測試的素材）。 */
function revert401NakedAuth(s) {
  // 把「已刪掉的那發沒有上限的 oracleAuth()」加回去
  return s.replace('      oracleSignOut();\n', '      oracleSignOut();\n      await oracleAuth();\n');
}
function revertAuthTimeout(s) {
  // 讓 oracleAuth 不再自己開計時器（＝裸呼叫又變成無限等待）
  return s.replace('  let _sig = signal;\n  if (!_sig) {', '  let _sig = signal;\n  if (false) {');
}
function revertStatusCheck(s) {
  // 把兩處 404 判斷改回 v6.245 的字串比對
  return s.replace(/    if \(isOracleTimeout\(err\)\) throw err;\n    if \(oracleErrorStatus\(err\) === 404\) return null;/g,
    "    if (String((err as Error)?.message ?? err).includes('404')) return null;");
}
function revertSizeBudget(s) {
  // 逾時預算不再跟著 body 大小走（＝ v6.245 的固定 30 秒 / 逃生口 60 秒）
  return s.replace('const _toMs = Math.max(options.timeoutMs ?? ORACLE_API_TIMEOUT_MS, _budgetMs);',
    'const _toMs = options.timeoutMs ?? ORACLE_API_TIMEOUT_MS;');
}
function toV6245(s) { return revertSizeBudget(revertStatusCheck(revertAuthTimeout(revert401NakedAuth(s)))); }
const BASE_OC = baseOC || toV6245(OC);
const BASE_KIND = baseOC ? '真 BASE blob' : '等價突變版（CI 淺複製）';

// ══════════════════════════════════════════════════════════════════════════
console.log('① 掃描器自我驗證 + 同型缺陷枚舉（全站不得再有「用字串比對 HTTP 狀態碼」）');
// ══════════════════════════════════════════════════════════════════════════
await T('⭐⭐⭐ 全站枚舉：src/ 下不得再有 String(err).includes(\'<3 位狀態碼>\') 這種判法', () => {
  const files = [['oracle-client.ts', OC], ['room-oracle.ts', RO], ['game/+page.svelte', GP]];
  // 掃描器下限斷言（Rule 25）：先證明它抓得到「已知的樣本」——拿 v6.245 的原文當正對照
  const probe = "if (String((err as Error)?.message ?? err).includes('404')) return null;";
  const RE = /includes\(\s*(['"])[1-5]\d{2}\1\s*\)/g;
  ok((probe.match(RE) || []).length === 1, '掃描器連 v6.245 的原文都抓不到 —— 掃描器壞了');
  ok((stripComments(BASE_OC).match(RE) || []).length >= 2,
    '掃描器在 BASE(' + BASE_KIND + ') 上抓不到那兩處已知缺陷 —— 掃描器壞了');
  const hits = [];
  for (const [name, src] of files) {
    const body = stripComments(src, name === 'game/+page.svelte' ? { label: name, minRatio: 0.5, mustKeep: ['async function tApi(path: string'] } : { label: name });
    let m; const re = new RegExp(RE.source, 'g');
    while ((m = re.exec(body))) hits.push(name + ' @' + body.slice(0, m.index).split('\n').length);
  }
  ok(hits.length === 0, '還有 ' + hits.length + ' 處用字串比對 HTTP 狀態碼：' + JSON.stringify(hits));
});
await T('⭐⭐ oracleErrorStatus 是**唯一**判準：兩支 room getter 都改用它（不是只有一支）', () => {
  const b = stripComments(OC);
  const n = (b.match(/oracleErrorStatus\(err\) === 404/g) || []).length;
  ok(n === 2, 'oracleGetRoom / oracleGetRoomDelta 只有 ' + n + ' 支改用結構化狀態碼（應為 2）');
  const g = (b.match(/if \(isOracleTimeout\(err\)\) throw err;/g) || []).length;
  ok(g === 2, '只有 ' + g + ' 處在 404 判斷前先擋掉逾時（應為 2）');
});
await T('⭐ 逾時預算常數齊備且數量級合理（Rule 37：上界 > 實測最慢成功案例 86.954 秒）', () => {
  const num = (name) => {
    const m = OC.match(new RegExp('export const ' + name + ' = (\\d+);'));
    ok(!!m, '抽不到常數 ' + name);
    return Number(m[1]);
  };
  ok(num('ORACLE_API_TIMEOUT_MS') === 30000, '基底逾時不是 30000');
  ok(num('ORACLE_SIDEEFFECT_TIMEOUT_MS') === 60000, '副作用型逾時不是 60000');
  ok(num('ORACLE_MIN_UPLINK_BPS') === 500, '保底上行速率不是 500 B/s');
  ok(num('ORACLE_UPLOAD_FREE_BYTES') === 4096, '免加預算的封包大小不是 4096');
  ok(num('ORACLE_API_TIMEOUT_MAX_MS') === 120000, '預算上界不是 120000');
  ok(num('ORACLE_API_TIMEOUT_MAX_MS') > 86954, '預算上界沒有大於實測最慢成功案例 86.954 秒');
});

// ══════════════════════════════════════════════════════════════════════════
console.log('② 【問題1】401 分支那一發沒有上限的 oracleAuth()');
// ══════════════════════════════════════════════════════════════════════════
function plan401AuthBlackhole(rec, n) {
  if (String(rec.url).includes('/api/auth/anonymous')) return { delayMs: Infinity };
  return n === 1 ? { delayMs: 5, status: 401, body: 'jwt expired' }
                 : { delayMs: 5, status: 200, body: { room: { _id: 'AAAA' } } };
}
await T('⭐⭐⭐ HEAD-FAIL：BASE(v6.245) 在「401 ＋ auth 端點黑洞」下推進 10 分鐘仍**未 settle**', async () => {
  const clock = makeClock();
  const f = makeFetch(clock, plan401AuthBlackhole);
  const m = loadModule(BASE_OC, clock, f);
  const st = watch(m.oracleApi('/api/rooms/AAAA', { method: 'PUT', body: { x: 1 } }));
  await clock.advance(600000);
  ok(!st.done, 'BASE(' + BASE_KIND + ') 竟然 settle 了 —— 對照組失效，這條在測空氣');
  const auth = f.calls.filter((c) => String(c.url).includes('/api/auth/anonymous'));
  ok(auth.length === 1, 'BASE 的 auth 請求數不是 1：' + auth.length);
  ok(!auth[0].signal, 'BASE 那一發 auth 竟然帶了 signal —— 對照組跟描述不符');
});
await T('⭐⭐⭐ 現行版：同一情境必須**有界**（30 秒逾時），且那一發 auth 帶著受保護的 signal', async () => {
  const clock = makeClock();
  const f = makeFetch(clock, plan401AuthBlackhole);
  const m = loadModule(OC, clock, f);
  const st = watch(m.oracleApi('/api/rooms/AAAA', { method: 'PUT', body: { x: 1 } }));
  await clock.advance(600000);
  ok(st.done && st.err, '修後仍然掛住 —— 401 那條路還是沒有上限');
  ok(m.isOracleTimeout(st.err) === true, '丟出來的不是逾時錯誤：' + st.err.message);
  const auth = f.calls.filter((c) => String(c.url).includes('/api/auth/anonymous'));
  ok(auth.length === 1, '修後 auth 被發了 ' + auth.length + ' 次（預期 1）—— 多餘那發沒刪乾淨？');
  ok(!!auth[0].signal, '重新登入那一發沒有帶 signal ⇒ 黑洞時仍會無限等待');
  ok(auth[0].abortedAt !== null, '那一發 auth 沒有被 abort');
});
// auth 端點 40 秒才回（慢網路，不是黑洞）：只有「遞迴那發吃呼叫端預算」才救得回來
function plan401SlowAuth(rec, n) {
  if (String(rec.url).includes('/api/auth/anonymous')) return { delayMs: 40000, status: 200, body: { uid: 'U9', token: 'T9' } };
  return n === 1 ? { delayMs: 5, status: 401, body: 'jwt expired' }
                 : { delayMs: 5, status: 200, body: { room: { _id: 'AAAA' } } };
}
await T('⭐⭐⭐ 正對照：401 ＋ auth 端點 40 秒才回 ＋ 60 秒逃生口 ⇒ 必須成功（預算歸呼叫端，不是硬寫 30 秒）', async () => {
  const clock = makeClock();
  const f = makeFetch(clock, plan401SlowAuth);
  const m = loadModule(OC, clock, f);
  const st = watch(m.oracleApi('/api/rooms/AAAA', { method: 'PUT', body: { x: 1 }, timeoutMs: 60000 }));
  await clock.advance(90000);
  ok(st.done && !st.err, '建房／進場／入座／開局的 60 秒逃生口沒有蓋到重新登入那一發：' + (st.err && st.err.message));
  assert.deepStrictEqual(st.value, { room: { _id: 'AAAA' } }, '回傳值不對');
});
await T('⭐⭐⭐ 終止條件仍在：連續兩次 401 只會重試一次（_retry=false），不可能無窮遞迴', async () => {
  const clock = makeClock();
  const f = makeFetch(clock, (rec) => {
    if (String(rec.url).includes('/api/auth/anonymous')) return { delayMs: 1, status: 200, body: { uid: 'U9', token: 'T9' } };
    return { delayMs: 1, status: 401, body: 'jwt expired' };   // 永遠 401
  });
  const m = loadModule(OC, clock, f);
  const st = watch(m.oracleApi('/api/rooms/AAAA'));
  await clock.advance(60000);
  ok(st.done && st.err, '連續 401 竟然沒有把錯誤丟出來');
  const api = f.calls.filter((c) => String(c.url).includes('/api/rooms/'));
  ok(api.length === 2, '/api/rooms 被打了 ' + api.length + ' 次（上限應為 2）—— 終止條件壞了');
  ok(/401/.test(st.err.message), '第二次 401 的錯誤訊息不對：' + st.err.message);
});
await T('⭐⭐⭐ 正對照：401 重試**沒有沿用舊 token**（oracleSignOut 之後遞迴那發會重新登入）', async () => {
  const clock = makeClock();
  const tokens = [];
  const f = makeFetch(clock, (rec, n) => {
    if (String(rec.url).includes('/api/auth/anonymous')) return { delayMs: 5, status: 200, body: { uid: 'U9', token: 'T9' } };
    tokens.push(rec.init.headers && rec.init.headers['Authorization']);
    return n === 1 ? { delayMs: 5, status: 401, body: 'jwt expired' }
                   : { delayMs: 5, status: 200, body: { room: { _id: 'AAAA' } } };
  });
  const m = loadModule(OC, clock, f);
  const st = watch(m.oracleApi('/api/rooms/AAAA'));
  await clock.advance(200);
  ok(st.done && !st.err, '401 重試路徑壞了：' + (st.err && st.err.message));
  assert.deepStrictEqual(st.value, { room: { _id: 'AAAA' } }, '401 重試後的回傳值變了');
  assert.deepStrictEqual(tokens, ['Bearer T0', 'Bearer T9'],
    '重試沒有換成新 token（實際：' + JSON.stringify(tokens) + '）—— 會 401 → 401 打轉');
});
await T('⭐⭐⭐ 順帶收斂：**裸** oracleAuth()（getMyUid／auth-facade／onMount）也必須有界', async () => {
  const mk = async (src) => {
    const clock = makeClock();
    const f = makeFetch(clock, () => ({ delayMs: Infinity }));
    const m = loadModule(src, clock, f, { noCache: true });   // 冷快取：一定會發 auth 請求
    const st = watch(m.oracleAuth());
    await clock.advance(600000);
    return { st, f, m };
  };
  const a = await mk(BASE_OC);
  ok(!a.st.done, 'BASE(' + BASE_KIND + ') 的裸 oracleAuth() 竟然 settle 了 —— 對照組失效');
  const b = await mk(OC);
  ok(b.st.done && b.st.err, '修後裸 oracleAuth() 仍然掛住 —— 冷快取玩家會永久卡住');
  ok(b.m.isOracleTimeout(b.st.err) === true, '裸 oracleAuth() 逾時沒有標記成逾時：' + b.st.err.message);
  ok(b.f.calls[0].abortedAt === 30000, '裸 oracleAuth() 的 abort 時刻是 ' + b.f.calls[0].abortedAt + '（預期 30000）');
});
await T('⭐⭐ 正對照：快取命中時 oracleAuth() **零 fetch、零計時器**（熱路徑一點成本都不能加）', async () => {
  const clock = makeClock();
  const f = makeFetch(clock, () => ({ delayMs: 5, status: 200, body: { uid: 'U1', token: 'T1' } }));
  const m = loadModule(OC, clock, f);
  const st = watch(m.oracleAuth());
  await clock.advance(10);
  ok(st.done && !st.err, '快取命中路徑壞了：' + (st.err && st.err.message));
  assert.deepStrictEqual(st.value, { uid: 'U0', token: 'T0' }, '快取命中的回傳值變了');
  ok(f.calls.length === 0, '快取命中卻發了 ' + f.calls.length + ' 次請求');
  ok(clock.timers.size === 0 && clock.cleared.length === 0, '快取命中卻建了計時器（熱路徑成本）');
});
await T('⭐⭐ 正對照：冷快取但 auth 正常 ⇒ 只發 1 次、回傳值不變、計時器清乾淨（無洩漏）', async () => {
  const clock = makeClock();
  const f = makeFetch(clock, () => ({ delayMs: 20, status: 200, body: { uid: 'U1', token: 'T1' } }));
  const m = loadModule(OC, clock, f, { noCache: true });
  const st = watch(m.oracleAuth());
  await clock.advance(100);
  ok(st.done && !st.err, '冷快取正常登入壞了：' + (st.err && st.err.message));
  assert.deepStrictEqual(st.value, { uid: 'U1', token: 'T1' }, '匿名登入回傳值變了');
  ok(f.calls.length === 1, '冷快取登入發了 ' + f.calls.length + ' 次請求（預期 1）');
  ok(clock.timers.size === 0, '登入成功後還留著 ' + clock.timers.size + ' 顆計時器 —— clearTimeout 沒放在 finally');
});

// ══════════════════════════════════════════════════════════════════════════
console.log('③ 【問題2】逾時訊息含 path ⇒ 被誤判成「房間不存在」');
// ══════════════════════════════════════════════════════════════════════════
// 兩種真實會發生的觸發源：logh 是雜湊（實測含 404 的機率約 0.26%）、since 是房間版本（打久了會走到 404）
const CASES = [
  ['oracleGetRoomDelta（logh 雜湊含 404）', (m) => m.oracleGetRoomDelta('XTCT', 5, { len: 12, h: '4042abc-9f1-12' })],
  ['oracleGetRoom（since=404，房間版本剛好 404）', (m) => m.oracleGetRoom('AAAA', 404)],
  ['oracleGetRoomDelta（logSince=404，log 剛好 404 則）', (m) => m.oracleGetRoomDelta('AAAA', 7, { len: 404, h: 'ab-cd-404' })],
];
for (const [label, call] of CASES) {
  await T('⭐⭐⭐ HEAD-FAIL：' + label + ' ＋ 逾時 ⇒ BASE 回 null（誤判）／修後必須丟逾時錯', async () => {
    const run = async (src) => {
      const clock = makeClock();
      const f = makeFetch(clock, () => ({ delayMs: Infinity }));
      const m = loadModule(src, clock, f);
      const st = watch(call(m));
      await clock.advance(31000);
      return { st, m };
    };
    const a = await run(BASE_OC);
    ok(a.st.done && a.st.value === null && !a.st.err,
      'BASE(' + BASE_KIND + ') 沒有回 null —— 對照組失效（value=' + String(a.st.value) + '）');
    const b = await run(OC);
    ok(b.st.err, '修後仍然把逾時吞成 null（value=' + String(b.st.value) + '）—— 玩家會看到「房間不存在或連線中斷」');
    ok(b.m.isOracleTimeout(b.st.err) === true, '修後丟出來的不是逾時錯誤：' + b.st.err.message);
  });
}
await T('⭐⭐⭐ 正對照：**真的** 404（房間確實不存在）修前修後都必須回 null', async () => {
  const run = async (src, call) => {
    const clock = makeClock();
    const f = makeFetch(clock, () => ({ delayMs: 5, status: 404, body: 'room not found' }));
    const m = loadModule(src, clock, f);
    const st = watch(call(m));
    await clock.advance(200);
    return st;
  };
  for (const [label, call] of [['oracleGetRoom', (m) => m.oracleGetRoom('ZZZZ')],
                               ['oracleGetRoom(since)', (m) => m.oracleGetRoom('ZZZZ', 3)],
                               ['oracleGetRoomDelta', (m) => m.oracleGetRoomDelta('ZZZZ', 3, { len: 2, h: 'aa-bb-2' })]]) {
    const a = await run(BASE_OC, call);
    const b = await run(OC, call);
    ok(a.done && a.value === null && !a.err, label + '：BASE 的真 404 對照組壞了');
    ok(b.done && b.value === null && !b.err,
      label + '：修後真的 404 不再回 null（value=' + String(b.value) + ' err=' + (b.err && b.err.message) + '）—— 把真 404 也改壞了');
  }
});
await T('⭐⭐ 正對照：非 404 的錯誤（500）修前修後都必須**往上拋**，不可被吞成 null', async () => {
  const run = async (src) => {
    const clock = makeClock();
    const f = makeFetch(clock, () => ({ delayMs: 5, status: 500, body: 'boom' }));
    const m = loadModule(src, clock, f);
    const st = watch(m.oracleGetRoom('AAAA'));
    await clock.advance(200);
    return st;
  };
  ok((await run(BASE_OC)).err, 'BASE 的 500 對照組壞了');
  const b = await run(OC);
  ok(b.err && /500/.test(b.err.message), '修後 500 沒有原樣往上拋：' + (b.err && b.err.message));
});
await T('⭐⭐ oracleErrorStatus 是純函式且**不吃字串**：只認結構化的 err.status', async () => {
  const clock = makeClock();
  const f = makeFetch(clock, () => ({ delayMs: 5, status: 404, body: 'x' }));
  const m = loadModule(OC, clock, f);
  ok(m.oracleErrorStatus(Object.assign(new Error('x'), { status: 404 })) === 404, '結構化狀態碼讀不到');
  ok(m.oracleErrorStatus(new Error('oracleApi /api/rooms/AAAA → 404: nope')) === null,
    '竟然從訊息字串猜出狀態碼 —— 又回到字串比對');
  ok(m.oracleErrorStatus(null) === null && m.oracleErrorStatus(undefined) === null, 'null/undefined 沒有安全回 null');
  ok(m.oracleErrorStatus(Object.assign(new Error('x'), { status: '404' })) === null, '字串型 status 不該被採信');
});
await T('⭐⭐ oracleApi 丟錯時真的把 res.status 掛上去了（訊息本身**逐字不變**）', async () => {
  const clock = makeClock();
  const f = makeFetch(clock, () => ({ delayMs: 5, status: 404, body: 'room not found' }));
  const m = loadModule(OC, clock, f);
  const st = watch(m.oracleApi('/api/rooms/ZZZZ'));
  await clock.advance(100);
  ok(st.err, '沒有丟錯');
  ok(m.oracleErrorStatus(st.err) === 404, 'err.status 沒掛上：' + JSON.stringify(st.err.status));
  ok(st.err.message === 'oracleApi /api/rooms/ZZZZ → 404: room not found',
    '錯誤訊息被改了（UI 與內部診斷有在讀）：' + st.err.message);
});

// ── oracleTx 實跑載入器（與 v6.245 守衛同款：從出貨碼抽出區塊，不重寫一份）──────────
function extractBlock(src, startAnchor, endAnchor, minLen, label) {
  const i = src.indexOf(startAnchor);
  assert.ok(i >= 0, '抽不到 ' + label + ' 的起點（錨點：' + startAnchor.slice(0, 48) + '）');
  const j = src.indexOf(endAnchor, i + startAnchor.length);
  assert.ok(j > i, '抽不到 ' + label + ' 的終點');
  const out = src.slice(i, j + endAnchor.length);
  assert.ok(out.length >= minLen, label + ' 只抽到 ' + out.length + ' 字元（下限 ' + minLen + '）—— 抽取器壞了？');
  return out;
}
function loadTx(roSrc, clock) {
  const block = extractBlock(roSrc, 'const TX_TIMEOUT_RETRY_MAX', "\n  throw new Error('oracleTx: max retries exhausted');\n}", 700, 'oracleTx');
  const js = esbuild.transformSync(block, { loader: 'ts' }).code;
  const gets = [], puts = [];
  const state = { room: { _id: 'AAAA', _version: 1, gameState: { log: [1] } } };
  const ctx = {
    oracleGetRoom: async (code) => { gets.push({ code, v: state.room._version }); return JSON.parse(JSON.stringify(state.room)); },
    oracleUpsertRoom: null,
    isOracleTimeout: (e) => !!(e && e.oracleTimeout === true),
    isOracleUploadBudgetTimeout: (e) => !!(e && e.oracleUploadBudget === true),
  };
  const make = (upsert) => {
    ctx.oracleUpsertRoom = async (code, data, ver, opts) => { puts.push({ code, data, ver, opts }); return upsert(puts.length, data, ver, opts); };
    return new Function('oracleGetRoom', 'oracleUpsertRoom', 'isOracleTimeout', 'isOracleUploadBudgetTimeout', 'setTimeout',
      js + '\n;return oracleTx;')(
      (c) => ctx.oracleGetRoom(c), (a, b, c, d) => ctx.oracleUpsertRoom(a, b, c, d), ctx.isOracleTimeout,
      ctx.isOracleUploadBudgetTimeout, clock.vSetTimeout);
  };
  return { make, gets, puts, state };
}

// ══════════════════════════════════════════════════════════════════════════
console.log('④ 【問題3】慢上行玩家修後不可以比修前更糟');
// ══════════════════════════════════════════════════════════════════════════
// nginx 實測那筆：request_length=48285、request_time=86.954 ⇒ 上行 ≈ 555 B/s
const UPLINK_BPS = 48285 / 86.954;                      // ≈ 555.3
const zh = '招式傷害寶可夢能量指示物備戰戰鬥場獎賞卡棄牌區牌庫手牌進化道具特殊狀態';
function makeBigGameState(targetBytes) {
  const o = { gameState: { log: [] } };
  const enc = new TextEncoder();
  for (let i = 0; enc.encode(JSON.stringify(o)).length < targetBytes; i++) {
    for (let k = 0; k < 8; k++) o.gameState.log.push({ t: i * 8 + k, m: zh.slice((i + k) % 25) + '#' + (i * 8 + k), d: [1, 2, 3, i], p: k % 2 });
  }
  return o;
}
const BIG = makeBigGameState(48285);
const BIG_BYTES = new TextEncoder().encode(JSON.stringify(BIG)).length;
const BIG_UPLOAD_MS = Math.round(BIG_BYTES / UPLINK_BPS * 1000);
await T('⭐ 樣本自我驗證：造出來的盤面確實≈48KB，且 555 B/s 下確實要 ~87 秒（下限斷言）', () => {
  ok(BIG_BYTES >= 45000 && BIG_BYTES <= 56000, '樣本大小 ' + BIG_BYTES + ' B 不在 45~56KB —— 造樣本的程式壞了');
  ok(BIG_UPLOAD_MS > 60000 && BIG_UPLOAD_MS < 110000,
    '樣本上傳時間 ' + BIG_UPLOAD_MS + 'ms 不在 60~110 秒 —— 對照不成立（nginx 實測是 86954ms）');
});
/** 依 body 位元組數模擬「上行 555 B/s」的 fetch。 */
function slowUplinkPlan(bps) {
  const enc = new TextEncoder();
  return (rec) => {
    const b = rec.init && rec.init.body;
    const bytes = b === undefined || b === null ? 0 : enc.encode(String(b)).length;
    return { delayMs: Math.max(1, Math.round(bytes / bps * 1000)) + 7, status: 200, body: { ok: true, version: 2, room: { _id: 'XTCT', updatedAt: 1 } } };
  };
}
await T('⭐⭐⭐ HEAD-FAIL：48KB／4.4 kbps ⇒ BASE(v6.245) **永遠送不到**（30 秒被砍）', async () => {
  const clock = makeClock();
  const f = makeFetch(clock, slowUplinkPlan(UPLINK_BPS));
  const m = loadModule(BASE_OC, clock, f);
  const st = watch(m.oracleApi('/api/rooms/XTCT', { method: 'PUT', body: BIG }));
  await clock.advance(200000);
  ok(st.err && m.isOracleTimeout(st.err), 'BASE(' + BASE_KIND + ') 竟然送到了 —— 對照組失效');
  ok(f.calls[0].abortedAt === 30000, 'BASE 的 abort 時刻是 ' + f.calls[0].abortedAt + '（預期 30000）');
  ok(f.calls[0].abortedAt < BIG_UPLOAD_MS,
    'BASE 是在上傳完成（' + BIG_UPLOAD_MS + 'ms）之後才 abort 的 —— 對照組不成立');
  ok(Math.round(f.calls[0].abortedAt / BIG_UPLOAD_MS * 100) <= 40,
    'BASE 在被砍之前送出了 ' + Math.round(f.calls[0].abortedAt / BIG_UPLOAD_MS * 100) + '%（實測是 34%）');
});
await T('⭐⭐⭐ 現行版：同一個 48KB／4.4 kbps ⇒ 必須**送達**（~87 秒 < 120 秒預算）', async () => {
  const clock = makeClock();
  const f = makeFetch(clock, slowUplinkPlan(UPLINK_BPS));
  const m = loadModule(OC, clock, f);
  const st = watch(m.oracleApi('/api/rooms/XTCT', { method: 'PUT', body: BIG }));
  await clock.advance(200000);
  ok(st.done && !st.err, '修後仍然送不到：' + (st.err && st.err.message));
  ok(f.calls[0].abortedAt === null, '修後仍然被 abort 了（' + f.calls[0].abortedAt + 'ms）');
  ok(f.calls[0].doneAt !== null && f.calls[0].doneAt < 120000,
    '送達時刻 ' + f.calls[0].doneAt + 'ms 不在預算內');
  ok(f.calls.length === 1, '為了送達竟然多發了請求：' + f.calls.length);
});
await T('⭐⭐⭐ 對稱性：pushGameState / pushUndoRollback 與 startGame 對同一份盤面拿到**相同**預算', async () => {
  const clock = makeClock();
  const f = makeFetch(clock, () => ({ delayMs: Infinity }));
  const m = loadModule(OC, clock, f);
  // 一般推送（不帶 opts）
  const a = watch(m.oracleUpsertRoom('XTCT', BIG, 3));
  // 開局（帶 60 秒逃生口）
  const b = watch(m.oracleUpsertRoom('XTCT', BIG, 3, { timeoutMs: 60000 }));
  await clock.advance(130000);
  ok(a.err && b.err, '兩邊都應該逾時（黑洞）');
  ok(f.calls[0].abortedAt === f.calls[1].abortedAt,
    '一般推送 ' + f.calls[0].abortedAt + 'ms vs 開局 ' + f.calls[1].abortedAt + 'ms —— v6.245 的 30/60 秒不對稱還在');
  ok(f.calls[0].abortedAt === 120000, '大封包的預算不是上界 120000（實際 ' + f.calls[0].abortedAt + '）');
});
await T('⭐⭐⭐ 正對照：正常玩家一秒都不可以多等（快連線 + 大／小封包，修前修後完成時刻相同）', async () => {
  const run = async (src, body) => {
    const clock = makeClock();
    const f = makeFetch(clock, () => ({ delayMs: 273, status: 200, body: { room: { _id: 'AAAA', _version: 7 } } }));
    const m = loadModule(src, clock, f);
    const st = watch(m.oracleApi('/api/rooms/AAAA', body === undefined ? {} : { method: 'PUT', body }));
    let at = null;
    for (let t = 0; t < 2000 && at === null; t += 25) { await clock.advance(25); if (st.done) at = clock.nowRef(); }
    return { st, at, n: f.calls.length, live: clock.timers.size };
  };
  for (const [label, body] of [['輪詢 GET', undefined], ['小型寫入', { data: { seat: 1 } }], ['48KB 盤面推送', BIG]]) {
    const a = await run(BASE_OC, body);
    const b = await run(OC, body);
    ok(!a.st.err && !b.st.err, label + '：正常路徑竟然出錯：' + (a.st.err || b.st.err));
    assert.deepStrictEqual(b.st.value, a.st.value, label + '：回傳值變了');
    ok(a.n === 1 && b.n === 1, label + '：請求數變了 BASE=' + a.n + ' 新=' + b.n);
    ok(a.at === b.at, label + '：變慢了 BASE ' + a.at + 'ms → 新版 ' + b.at + 'ms —— 絕不可多等');
    ok(b.live === 0, label + '：成功後還留著 ' + b.live + ' 顆計時器（洩漏）');
  }
});
await T('⭐⭐⭐ 正對照：nginx log 那 45 筆真黑洞（PUT body 1091 B）等待時間**一秒都沒變長**', async () => {
  // request_length=1091 ⇒ body 遠小於 4096 ⇒ 預算仍是基底 30 秒
  const small = { data: { pad: 'x'.repeat(900) } };
  const run = async (src) => {
    const clock = makeClock();
    const f = makeFetch(clock, () => ({ delayMs: Infinity }));
    const m = loadModule(src, clock, f);
    const st = watch(m.oracleApi('/api/rooms/W6JC', { method: 'PUT', body: small }));
    await clock.advance(150000);
    return { st, f };
  };
  const a = await run(BASE_OC);
  const b = await run(OC);
  ok(a.f.calls[0].abortedAt === 30000, 'BASE 的 abort 時刻不是 30000：' + a.f.calls[0].abortedAt);
  ok(b.f.calls[0].abortedAt === 30000,
    '修後小封包黑洞被拖長到 ' + b.f.calls[0].abortedAt + 'ms —— 這正是「不可讓玩家端變差」的紅線');
});
await T('⭐⭐ 預算純函式的行為表（含上下界與 4KB 免加額）', async () => {
  const clock = makeClock();
  const m = loadModule(OC, clock, makeFetch(clock, () => ({ delayMs: 1, status: 200, body: {} })));
  const B = m.oracleTimeoutBudgetMs;
  ok(B(0) === 30000, 'GET（0 位元組）的預算不是 30000：' + B(0));
  ok(B(4096) === 30000, '4096 B 的預算不是 30000：' + B(4096));
  ok(B(4596) === 31000, '4096+500 B 的預算不是 31000：' + B(4596));
  ok(B(1e9) === 120000, '超大封包沒有被夾在上界：' + B(1e9));
  ok(B(-5) === 30000 && B(NaN) === 30000, '負數／NaN 沒有安全回基底：' + B(-5) + '/' + B(NaN));
  // 單調性（下限斷言：不可以出現「越大反而越短」）
  let prev = 0;
  for (let bytes = 0; bytes <= 200000; bytes += 997) { const v = B(bytes); ok(v >= prev, '預算不單調 @' + bytes); prev = v; }
  ok(prev === 120000, '掃到 200KB 竟然沒到上界 —— 掃描器壞了？');
});
await T('⭐⭐⭐ oracleTx：**大預算**逾時不吃重試額度（不讓玩家再等一輪 87~120 秒）', async () => {
  const clock = makeClock();
  const tx = loadTx(RO, clock);
  const oracleTx = tx.make(() => { const e = new Error('連線逾時（120 秒沒有回應）'); e.oracleTimeout = true; e.oracleUploadBudget = true; throw e; });
  const st = watch(oracleTx('XTCT', (d) => ({ ...d, touched: true })));
  await clock.advance(60000);
  ok(st.done && st.err && st.err.oracleTimeout === true, '大預算逾時沒有把錯誤丟給呼叫端');
  ok(tx.puts.length === 1, '大預算逾時仍重送了 ' + tx.puts.length + ' 次 —— UI 會被鎖到 241 秒');
});
await T('⭐⭐⭐ 正對照：**基底預算**的逾時（輪詢/小型寫入/逃生口）行為與 v6.245 逐字相同（仍吃 1 次重試）', async () => {
  const clock = makeClock();
  const tx = loadTx(RO, clock);
  const oracleTx = tx.make(() => { const e = new Error('連線逾時（30 秒沒有回應）'); e.oracleTimeout = true; e.oracleUploadBudget = false; throw e; });
  const st = watch(oracleTx('AAAA', (d) => d));
  await clock.advance(60000);
  ok(st.done && st.err, '基底預算逾時沒有丟錯');
  ok(tx.puts.length === 2, '基底預算的重試次數變了：' + tx.puts.length + '（v6.245 起是 2）');
  ok(tx.gets.length === 2, '重試前沒有重新拉盤面：GET ' + tx.gets.length + ' 次');
});

// ══════════════════════════════════════════════════════════════════════════
console.log('⑤ 【問題5】守衛自身：工具鏈壞掉時突變測試必須報錯，不可假 OK');
// ══════════════════════════════════════════════════════════════════════════
await T('⭐⭐⭐ 故意讓 esbuild 壞掉 ⇒ test-v6245 的 M1~M5 必須全部 FAIL（不可出現假 OK）', () => {
  // ⚠⚠ v6.246 第一版用 `ESBUILD_BINARY_PATH=<不存在的路徑>` 來弄壞工具鏈 —— **那個手法不可靠**：
  //   在 esbuild 能原生解析平台套件的環境（GitHub Actions 就是）它會忽略壞路徑照樣跑起來，
  //   於是「M1~M5 必須全部 FAIL」這條反而自己翻紅（實測：CI 紅、沙盒綠）。
  //   ⇒ 改成**確定性**做法：把 test-v6245 原封不動複製一份，只把它的 esbuild 換成
  //     「transformSync 一定丟平台不符錯誤」的替身，其餘逐字不動（測的還是出貨的守衛碼）。
  //     替身讓副本完全不需要解析 esbuild 模組 ⇒ 可以放在 os.tmpdir() 執行，不污染 repo。
  const v6245Path = join(ROOT, 'scripts/test-v6245-oracle-api-timeout.mjs');
  const orig = readFileSync(v6245Path, 'utf8');
  const IMPORT_LINE = "const esbuild = await import('esbuild');";
  const ROOT_LINE = "const ROOT = fileURLToPath(new URL('..', import.meta.url));";
  ok(orig.includes(IMPORT_LINE), 'test-v6245 的 esbuild import 那一行變了 —— 這個模擬器壞了');
  ok(orig.includes(ROOT_LINE), 'test-v6245 的 ROOT 那一行變了 —— 這個模擬器壞了');
  const broken = orig
    .replace(IMPORT_LINE,
      "const esbuild = { transformSync() { throw new Error('You installed esbuild for another platform than the one you\\'re currently using.'); } };")
    .replace(ROOT_LINE, 'const ROOT = ' + JSON.stringify(ROOT) + ';');
  ok(broken !== orig, '替身沒有真的換進去 —— 這條在測空氣');
  const tmpFile = join(tmpdir(), 'ptcg-v6246-toolchain-broken-' + process.pid + '.mjs');
  let out = '';
  let status = null;
  try {
    writeFileSync(tmpFile, broken, 'utf8');
    const r = spawnSync(process.execPath, [tmpFile], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
    ok(r.error === undefined || r.error === null, '子行程起不來：' + (r.error && r.error.message));
    out = String(r.stdout || '') + String(r.stderr || '');
    status = r.status;
  } finally {
    try { unlinkSync(tmpFile); } catch { /* ignore */ }
  }
  // 先證明「工具鏈真的壞了」（否則下面的斷言會變成空談 —— Rule 33 的正對照）
  ok(/another platform/.test(out), '替身沒有真的讓 esbuild 壞掉 —— 這條在測空氣：' + out.slice(-400));
  ok(status !== 0, '工具鏈壞掉時 test-v6245 竟然回 0 —— 整支守衛是安慰劑');
  const lines = out.split('\n').filter((l) => / M[1-5] /.test(l));
  ok(lines.length >= 5, '只抓到 ' + lines.length + ' 行突變測試結果 —— 掃描器壞了？輸出：' + out.slice(-600));
  const fakeOk = lines.filter((l) => l.trim().startsWith('OK'));
  ok(fakeOk.length === 0, '工具鏈壞掉時仍有 ' + fakeOk.length + ' 條突變測試假 OK：\n' + fakeOk.join('\n'));
  ok(/基準線/.test(out), '沒有看到「基準線就紅了」的診斷 —— 修法沒生效？');
});
await T('⭐⭐ 正對照：工具鏈正常時 test-v6245 必須全綠（否則上一條在測「本來就紅」）', () => {
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts/test-v6245-oracle-api-timeout.mjs')], {
    cwd: ROOT, encoding: 'utf8', timeout: 120000,
  });
  const out = String(r.stdout || '') + String(r.stderr || '');
  ok(r.status === 0, 'v6.245 守衛（金絲雀）變紅了 —— 通常代表 base 抓錯或行為真的被改壞：\n' + out.slice(-1500));
});

// ══════════════════════════════════════════════════════════════════════════
console.log('⑥ [突變測試] 把本版四個機制逐一改回去，對應斷言必須翻紅');
// ══════════════════════════════════════════════════════════════════════════
const TOOLCHAIN_RE = /Transform failed|esbuild|is not defined|is not a function|Cannot read|ENOENT|another platform/i;
async function mutantMustBreak(label, mutate, probe, expectRe) {
  const src = mutate(OC);
  ok(src !== OC, '突變「' + label + '」沒有真的改到原始碼 —— 突變測試在測空氣');
  // (1) 基準線：未突變的原始碼跑同一個 probe 必須通過（工具鏈壞掉時這裡先紅，不會假 OK）
  try { await probe(OC); } catch (e) {
    throw new Error('突變「' + label + '」的**基準線**就紅了（' + e.message + '）—— 在測空氣，不是在測突變');
  }
  // (2) 突變後必須紅，且紅在預期的那一條
  let broke = false, why = '';
  try { await probe(src); } catch (e) { broke = true; why = e.message; }
  ok(broke, '突變「' + label + '」竟然通過了 —— 對應的守衛是安慰劑');
  ok(!TOOLCHAIN_RE.test(why), '突變「' + label + '」紅的是工具鏈錯誤而不是被測行為：' + why);
  ok(expectRe.test(why), '突變「' + label + '」紅在別條斷言上（預期 ' + expectRe + '）：' + why);
}
await T('⭐⭐⭐ MU1 把 401 那發沒有上限的 oracleAuth() 加回來 ⇒「遞迴吃呼叫端預算」斷言必須翻紅', async () => {
  // ⚠ 為什麼不是用「黑洞會不會掛住」當 probe：本版已經給 oracleAuth 自己的 30 秒，
  //   加回那一行仍然是**有界**的 ⇒ 那個 probe 殺不掉這個突變（實測過，會假 OK）。
  //   真正的差別是**預算歸誰**：刪掉之後，重新登入那一發吃的是遞迴 oracleApi 的預算
  //   （建房／進場／入座／開局的 60 秒逃生口）；加回去就變成硬寫的 30 秒 ⇒ 慢網路被誤殺。
  await mutantMustBreak('restore naked oracleAuth() in 401 branch', revert401NakedAuth, async (src) => {
    const clock = makeClock();
    const f = makeFetch(clock, plan401SlowAuth);
    const m = loadModule(src, clock, f);
    const st = watch(m.oracleApi('/api/rooms/AAAA', { method: 'PUT', body: { x: 1 }, timeoutMs: 60000 }));
    await clock.advance(90000);
    ok(st.done && !st.err, '60 秒逃生口沒有蓋到重新登入那一發：' + (st.err && st.err.message));
  }, /60 秒逃生口沒有蓋到重新登入那一發/);
});
await T('⭐⭐⭐ MU2 拿掉 oracleAuth 自己的計時器 ⇒ 裸呼叫有界斷言必須翻紅', async () => {
  await mutantMustBreak('drop oracleAuth own timeout', revertAuthTimeout, async (src) => {
    const clock = makeClock();
    const f = makeFetch(clock, () => ({ delayMs: Infinity }));
    const m = loadModule(src, clock, f, { noCache: true });
    const st = watch(m.oracleAuth());
    await clock.advance(600000);
    ok(st.done && st.err, '裸 oracleAuth() 又變回無限等待了');
  }, /裸 oracleAuth\(\) 又變回無限等待了/);
});
await T('⭐⭐⭐ MU3 把 404 判斷改回字串比對 ⇒【問題2】誤判斷言必須翻紅', async () => {
  await mutantMustBreak('revert to String(err).includes(\'404\')', revertStatusCheck, async (src) => {
    const clock = makeClock();
    const f = makeFetch(clock, () => ({ delayMs: Infinity }));
    const m = loadModule(src, clock, f);
    const st = watch(m.oracleGetRoomDelta('XTCT', 5, { len: 12, h: '4042abc-9f1-12' }));
    await clock.advance(31000);
    ok(st.err && m.isOracleTimeout(st.err), '逾時又被誤判成「房間不存在」了（value=' + String(st.value) + '）');
  }, /逾時又被誤判成/);
});
await T('⭐⭐⭐ MU4 把逾時預算改回固定值 ⇒【問題3】「48KB 必須送達」斷言必須翻紅', async () => {
  await mutantMustBreak('drop size-based budget', revertSizeBudget, async (src) => {
    const clock = makeClock();
    const f = makeFetch(clock, slowUplinkPlan(UPLINK_BPS));
    const m = loadModule(src, clock, f);
    const st = watch(m.oracleApi('/api/rooms/XTCT', { method: 'PUT', body: BIG }));
    await clock.advance(200000);
    ok(st.done && !st.err, '48KB 的推送又送不到了：' + (st.err && st.err.message));
  }, /48KB 的推送又送不到了/);
});
await T('⭐⭐ MU5 oracleTx 拿掉「大預算不重試」的判別 ⇒ 對應斷言必須翻紅', async () => {
  const src = RO.replace('|| isOracleUploadBudgetTimeout(err)\n', '');
  ok(src !== RO, '突變沒改到東西');
  const clock = makeClock();
  const tx = loadTx(src, clock);
  const oracleTx = tx.make(() => { const e = new Error('to'); e.oracleTimeout = true; e.oracleUploadBudget = true; throw e; });
  const st = watch(oracleTx('XTCT', (d) => d));
  await clock.advance(60000);
  void st;
  ok(tx.puts.length !== 1, '突變後仍只送 1 次 —— 那條斷言是安慰劑');
});

// ══════════════════════════════════════════════════════════════════════════
console.log('⑦b 【問題4】UI 到底被鎖住多久 —— 首頁公告的數字必須跟實跑一致');
// ══════════════════════════════════════════════════════════════════════════
// 把 oracle-client 的 oracleGetRoom/oracleUpsertRoom 接到 room-oracle 的**真** oracleTx 上，
// 用「GET 走得通、PUT 是黑洞」（＝ nginx log 那個情境）推進虛擬時鐘，量 UI 何時解鎖。
function buildRealTx(m, clock) {
  const block = extractBlock(RO, 'const TX_TIMEOUT_RETRY_MAX', "\n  throw new Error('oracleTx: max retries exhausted');\n}", 700, 'oracleTx');
  const js = esbuild.transformSync(block, { loader: 'ts' }).code;
  return new Function('oracleGetRoom', 'oracleUpsertRoom', 'isOracleTimeout', 'isOracleUploadBudgetTimeout', 'setTimeout',
    js + '\n;return oracleTx;')(m.oracleGetRoom, m.oracleUpsertRoom, m.isOracleTimeout, m.isOracleUploadBudgetTimeout, clock.vSetTimeout);
}
async function uiLockMs(body, opts, getOk) {
  const clock = makeClock();
  const f = makeFetch(clock, (rec) => {
    if ((rec.init.method ?? 'GET') === 'GET') {
      return getOk ? { delayMs: 200, status: 200, body: { room: { _id: 'AAAA', _version: 1, gameState: { log: [] } } } }
                   : { delayMs: Infinity };
    }
    return { delayMs: Infinity };
  });
  const m = loadModule(OC, clock, f);
  const tx = buildRealTx(m, clock);
  const st = watch(tx('AAAA', () => body, opts));
  let at = null;
  for (let t = 0; t < 400000 && at === null; t += 500) { await clock.advance(500); if (st.done) at = clock.nowRef(); }
  return { at, puts: f.calls.filter((c) => (c.init.method ?? 'GET') !== 'GET').length, st };
}
const SMALL_BODY = { seats: [{ uid: 'u1' }] };
await T('⭐⭐⭐ 首頁公告的四個數字都是實跑量到的（30／61／120／121 秒）', async () => {
  const a = await uiLockMs(SMALL_BODY, undefined, false);
  ok(a.at === 30000, '輪詢/讀盤面黑洞的解鎖時刻是 ' + a.at + 'ms（公告寫三十秒）');
  const b = await uiLockMs(SMALL_BODY, undefined, true);
  ok(b.at >= 61000 && b.at <= 62000, '小型寫入的解鎖時刻是 ' + b.at + 'ms（公告寫六十一秒）');
  ok(b.puts === 2, '小型寫入的 PUT 次數是 ' + b.puts + '（基底預算仍吃 1 次重試）');
  const c = await uiLockMs(BIG, undefined, true);
  ok(c.at >= 120000 && c.at <= 121000, '盤面同步的解鎖時刻是 ' + c.at + 'ms（公告寫一百二十秒）');
  ok(c.puts === 1, '盤面同步的 PUT 次數是 ' + c.puts + '（大預算不吃重試）');
  const d = await uiLockMs(SMALL_BODY, { timeoutMs: 60000 }, true);
  ok(d.at >= 121000 && d.at <= 122000, '逃生口四動作的解鎖時刻是 ' + d.at + 'ms（公告寫一百二十一秒）');
  const e = await uiLockMs(BIG, { timeoutMs: 60000 }, true);
  ok(e.at >= 120000 && e.at <= 121000, '開局（逃生口＋大封包）的解鎖時刻是 ' + e.at + 'ms');
  // ⚠ 上界斷言：任何一條都不可以超過首頁寫的「約兩分鐘」
  for (const [lbl, r] of [['輪詢', a], ['小型寫入', b], ['盤面同步', c], ['逃生口', d], ['開局', e]]) {
    ok(r.at <= 122000, lbl + ' 的 UI 鎖住 ' + r.at + 'ms，超過公告的「約兩分鐘」—— 公告變成過度宣稱');
    ok(r.st.done && r.st.err, lbl + ' 竟然沒 settle —— UI 永遠解不開');
  }
});
await T('⭐⭐ 首頁公告逐字檢查：不得再宣稱「最多等三十秒」，且必須是 50 則、無裸大括號', () => {
  const html = readFileSync(join(ROOT, 'static/changelog.html'), 'utf8');
  // ⚠v6.247 修這支守衛自己的缺陷：原本寫死「首頁第一則必須是 v6.246」，
  //   下一版公告一發布就必紅，而那不是行為壞掉。改成「找到 v6.246 那一則再逐字檢查」，
  //   檢查的內容一字未變，只是不再綁在最上面。
  const _i246 = html.indexOf('<span class="ver-badge">v6.246</span>');
  ok(_i246 > 0, '首頁找不到 v6.246 那一則（那則公告的逐字檢查就失去對象了）');
  const _b246 = html.lastIndexOf('<details', _i246);
  ok(_b246 >= 0, 'v6.246 那則的 <details> 起點找不到');
  const head = html.slice(_b246, html.indexOf('</details>', _i246) + 10);
  // ⚠ 只擋 v6.245 那句**宣稱**（「現在最多等三十秒」）；新公告在回顧舊行為時仍會提到三十秒，
  //   所以不能用「三十秒」當關鍵字（否則會誤殺正確的敘述）。
  ok(!/現在最多等三十秒/.test(html), 'v6.245 那句過度宣稱還在首頁');
  ok(!/v6\.245/.test(html), 'v6.245 那則沒有被改寫掉');
  // 正對照：確認這條斷言抓得到 v6.245 的原文（否則它就是安慰劑）
  ok(/現在最多等三十秒/.test('現在最多等三十秒，逾時就自動取回最新盤面讓對局繼續。'), '關鍵字比對本身壞了');
  ok((html.match(/<details/g) || []).length === 50, '首頁 changelog 則數不是 50');
  ok((html.match(/<details open>/g) || []).length === 1, '不只一則展開');
  for (const kw of ['你', '您']) ok(!head.includes(kw), '公告出現第二人稱：' + kw);
  ok(!/[{}]/.test(head), '公告出現裸大括號（Rule 1）');
  const sum = head.slice(head.indexOf('</b><br>') + 8, head.indexOf('</summary>'));
  ok(sum.length >= 40 && sum.length <= 80, '公告摘要 ' + sum.length + ' 字，不在 40~80 之間');
});

// ══════════════════════════════════════════════════════════════════════════
console.log('⑦ [不在本版範圍，但必須留下證據] v6.212 自癒被 isWaitingOnOpponent 擋住');
// ══════════════════════════════════════════════════════════════════════════
await T('⭐⭐ pushWithRetry 的註解已更正（不再宣稱「交給既有的卡住自癒」）', () => {
  const i = GP.indexOf('const PUSH_RETRY_MAX = 3;');
  ok(i > 0, '抽不到 pushWithRetry —— 抽取器壞了？');
  const block = GP.slice(i, GP.indexOf('\n    return false;\n  }', i));
  ok(block.length > 500, 'pushWithRetry 只抽到 ' + block.length + ' 字元');
  ok(/isWaitingOnOpponent/.test(block),
    'pushWithRetry 的註解沒有點出「自癒被 isWaitingOnOpponent 擋著」這個既有缺口');
  ok(!/⇒ 交給既有的卡住自癒/.test(block), 'v6.245 那句過度樂觀的說明還在');
});
await T('⭐⭐ 該缺口確實存在（正對照）：自癒程式碼真的排在 isWaitingOnOpponent 的 early-return 之後', () => {
  const g = stripComments(GP, { label: 'game/+page.svelte', minRatio: 0.5, mustKeep: ['decideStuckSelfHeal({'] });
  const gate = g.indexOf('if (!isWaitingOnOpponent(game, mySeatIdx))');
  ok(gate > 0, '抓不到 isWaitingOnOpponent 的 gate —— 掃描器壞了？');
  const heal = g.indexOf('decideStuckSelfHeal({', gate);
  ok(heal > gate, 'decideStuckSelfHeal 不在那個 gate 之後 —— 結論要重驗（Rule 25.8）');
  const between = g.slice(gate, heal);
  ok(/return;/.test(between), 'gate 與自癒之間沒有 early-return —— 結論要重驗');
  ok(between.length < 4000, 'gate 與自癒相距 ' + between.length + ' 字元，可能抓錯配對');
});

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' v6.246 逾時複驗守衛（BASE 對照＝' + BASE_KIND + '）：' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail === 0 ? 0 : 1);
