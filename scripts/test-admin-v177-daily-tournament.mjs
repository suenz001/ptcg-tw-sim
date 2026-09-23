// admin v1.77／server patch v1.50 守衛：每日固定網站賽「一鍵建立」
//
// 站長需求（逐字）：「我每日都會在admin賽事設定2個賽事…網站賽-150【19:00 單敗淘汰】和 網站賽-151【21:00 瑞士制】…
//   我想要你幫我設定成按紐，我只要在admin後台按下去就會建立，省去我每天key in的麻煩…數字是會一直累加的」
// 站長裁定（AskUserQuestion 三問）：報名開始「留空＝立即開放報名」／其他參數「沿用最近一場同賽制的網站賽」／
//   「先跳確認視窗列出兩場名稱與時間」。
//
// 驗法：伺服器端把 v150 哨兵區塊 ＋ /event/create 端點抽出來，注入假 Mongo **實跑真 handler**（不是比對字串）；
//   前端把純函式 tevDailyPanelHtml 抽出來注入最小替身實跑。
// 【HEAD-FAIL】BASE（admin v1.76／server v1.49）：A1～A12、B1～B6、C1～C5 全紅（那一版沒有這些東西）。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';
import { normEol } from './lib/eol-agnostic.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PATCH = normEol(readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8'));
const HTML = normEol(readFileSync(join(ROOT, 'oracle-admin/admin.html'), 'utf8'));
const PKG = normEol(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const V6303 = normEol(readFileSync(join(ROOT, 'scripts/test-v6303-ui-batch.mjs'), 'utf8'));

let pass = 0, fail = 0; const failed = [];
async function T(name, fn) {
  try { await fn(); pass++; console.log('  PASS ' + name); }
  catch (e) {
    if (!(e instanceof assert.AssertionError) && !/^找不到|抽不到/.test(String(e && e.message))) throw e;
    fail++; failed.push(name.split(' ')[0]); console.log('  FAIL ' + name + ' :: ' + String(e && e.message).slice(0, 400));
  }
}
const ok = (c, m) => { if (!c) throw new assert.AssertionError({ message: m }); };

// ── 抽取器（都有下限斷言：抽到的東西必須含該有的特徵，抽壞了要大聲紅）──────────
function braceEnd(src, start, what) {
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) { const c = src[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) return i; } }
  throw new assert.AssertionError({ message: what + ' 大括號配對失敗' });
}
function sentinelBlock(src, tag) {
  const a = src.indexOf('// >>> ' + tag);
  ok(a >= 0, '抽不到哨兵區塊 ' + tag + '（BASE 上本來就沒有）');
  const b = src.indexOf('// <<< ' + tag, a);
  ok(b > a, '哨兵區塊 ' + tag + ' 沒有收尾');
  const out = src.slice(a, b);
  ok(out.length > 2000 && out.length < 20000, '抽到的區塊長度不合理（' + out.length + '）⇒ 抽取器壞了');
  return out;
}
function appHandler(src, needle, what) {
  const g = src.indexOf(needle);
  ok(g >= 0, '抽不到 ' + what);
  const end = braceEnd(src, g, what);
  const close = src.indexOf(');', end);
  ok(close > 0, what + ' 收尾');
  return src.slice(g, close + 2);
}
function fnSrc(src, name) {
  for (const p of ['window.' + name + ' = async function', 'window.' + name + ' = function', 'function ' + name + '(']) {
    const s = src.indexOf(p);
    if (s < 0) continue;
    const end = braceEnd(src, s + p.length, name);
    return src.slice(s, end + 1) + (p.startsWith('window.') ? ';' : '');
  }
  throw new assert.AssertionError({ message: '找不到函式 ' + name + '（BASE 上本來就沒有）' });
}

// ── 假 Mongo（只支援本版真的用到的：find(filter, {projection}).sort().limit().toArray() ＋ insertOne）──
const condOk = (v, c) => (c && typeof c === 'object' && '$ne' in c ? v !== c.$ne : v === c);
const matchDoc = (d, f) => Object.keys(f || {}).every((k) => condOk(d[k], f[k]));
function makeColl(docs, spy, name) {
  return {
    find: (filter, opts) => {
      const cur = { _sort: null, _limit: Infinity };
      cur.sort = (o) => { cur._sort = o; return cur; };
      cur.limit = (n) => { cur._limit = n; return cur; };
      cur.toArray = async () => {
        let r = docs.filter((d) => matchDoc(d, filter || {}));
        if (cur._sort) { const k = Object.keys(cur._sort)[0], dir = cur._sort[k]; r = r.slice().sort((a, b) => ((a[k] || 0) - (b[k] || 0)) * dir); }
        spy.finds.push({ name, filter, opts, limit: cur._limit });
        return r.slice(0, cur._limit === Infinity ? undefined : cur._limit).map((d) => JSON.parse(JSON.stringify(d)));
      };
      return cur;
    },
    insertOne: async (doc) => {
      ok(!docs.some((d) => d._id === doc._id), '⚠ duplicate key：' + doc._id + '（同一毫秒建了兩場）');
      docs.push(JSON.parse(JSON.stringify(doc))); spy.inserts.push(doc); return { insertedId: doc._id };
    },
  };
}
/** 把伺服器端的 v150 區塊 ＋ /event/create 端點注入假環境實跑。 */
function buildServer(patchSrc, { events = [], champs = [], archives = [], admin = true, identity = null } = {}) {
  const block = sentinelBlock(patchSrc, 'v150-daily-tournament');
  const createEp = appHandler(patchSrc, "app.post('/api/tournament/admin/event/create',", 'create 端點');
  ok(/insertTournamentEvent\(b, id\)/.test(createEp), '⚠ /event/create 沒有走中央 insertTournamentEvent（判準寫了兩份）');
  const spy = { finds: [], inserts: [] };
  const handlers = {};
  const app = { get: (p, h) => { handlers['GET ' + p] = h; }, post: (p, h) => { handlers['POST ' + p] = h; } };
  const id = identity || { email: 'admin@x', uid: 'u1', verified: true };
  new Function('app', 'TEVENTS', 'TCHAMPS', 'TARCHIVE', 'tournIdentity', 'isTournAdmin', block + '\n' + createEp)(
    app, makeColl(events, spy, 'events'), makeColl(champs, spy, 'champs'), makeColl(archives, spy, 'archives'),
    async () => id, () => admin);
  ok(typeof handlers['GET /api/tournament/admin/daily-preset'] === 'function', 'daily-preset 端點沒註冊');
  ok(typeof handlers['POST /api/tournament/admin/event/create-daily'] === 'function', 'create-daily 端點沒註冊');
  return { handlers, spy, events };
}
async function call(h, req = {}) {
  let out = null, code = 200;
  const res = { json: (x) => { out = x; return res; }, status: (c) => { code = c; return res; } };
  await h({ body: {}, query: {}, ...req }, res);
  return { code, body: out };
}
// 台北時間 → epoch（測試自己算一份，不共用被測程式碼）
const tw = (y, m, d, hh, mm) => Date.UTC(y, m - 1, d, hh, mm, 0, 0) - 480 * 60000;
const ev = (name, extra = {}) => ({
  _id: 'evt_' + name, name, status: 'finished', format: 'single-elim', createdAt: 1, registrationCloseAt: 0,
  maxPlayers: null, roundLimitMin: 25, noShowMin: 5, roundCountdownMin: 3, ...extra });
// ⚠ 時鐘**凍結**（每次呼叫回同一個毫秒）：同一毫秒建兩場正是 _id 會撞的情境，A4 要驗它。
const withNow = async (ms, fn) => { const real = Date.now; Date.now = () => ms; try { return await fn(); } finally { Date.now = real; } };

// 基準資料：最近兩場（149 瑞士、148 單敗），各帶不同設定
const BASE_EVENTS = () => [
  ev('網站賽-148【19:00 單敗淘汰】', { createdAt: 100, format: 'single-elim', maxPlayers: 32, roundLimitMin: 30, noShowMin: 6, roundCountdownMin: 4, registrationCloseAt: tw(2026, 9, 22, 19, 0) }),
  ev('網站賽-149【21:00 瑞士制】', { createdAt: 101, format: 'swiss-then-cut', maxPlayers: 24, roundLimitMin: 28, noShowMin: 7, roundCountdownMin: 2, swissRounds: 4, topCut: 8, registrationCloseAt: tw(2026, 9, 22, 21, 0) }),
];
const NOON = tw(2026, 9, 23, 12, 0);   // 台北 9/23 中午（兩場都還沒到）

console.log('\n【A】伺服器端：自動接號／台北時區／沿用設定／重複與競態防護');
await T('A1 ⭐⭐⭐【HEAD-FAIL】預覽：接在最大號之後 ⇒ 網站賽-150【19:00 單敗淘汰】、網站賽-151【21:00 瑞士制】', async () => {
  const S = buildServer(PATCH, { events: BASE_EVENTS() });
  const r = await withNow(NOON, () => call(S.handlers['GET /api/tournament/admin/daily-preset']));
  ok(r.code === 200 && r.body && r.body.dailyApi === 1, JSON.stringify(r).slice(0, 200));
  ok(r.body.maxNo === 149, 'maxNo=' + r.body.maxNo);
  assert.deepStrictEqual(r.body.slots.map((s) => s.name), ['網站賽-150【19:00 單敗淘汰】', '網站賽-151【21:00 瑞士制】']);
});
await T('A2 ⭐⭐【HEAD-FAIL】編號三個來源都算：名人堂／歸檔比賽事新時也接得到（賽事被刪掉也不會重號）', async () => {
  const S = buildServer(PATCH, { events: BASE_EVENTS(), champs: [{ eventName: '網站賽-151【21:00 瑞士制】', communityEvent: false, finishedAt: 9 }] });
  const r = await withNow(NOON, () => call(S.handlers['GET /api/tournament/admin/daily-preset']));
  ok(r.body.maxNo === 151 && r.body.slots[0].name === '網站賽-152【19:00 單敗淘汰】', JSON.stringify(r.body.slots.map((s) => s.name)));
  const S2 = buildServer(PATCH, { events: BASE_EVENTS(), archives: [{ eventName: '網站賽-160【19:00 單敗淘汰】', communityEvent: false, finishedAt: 9 }] });
  const r2 = await withNow(NOON, () => call(S2.handlers['GET /api/tournament/admin/daily-preset']));
  ok(r2.body.maxNo === 160, 'maxNo=' + r2.body.maxNo);
});
await T('A3 ⭐⭐【HEAD-FAIL】社群自辦賽不汙染編號（玩家可自訂賽名）', async () => {
  const S = buildServer(PATCH, {
    events: [...BASE_EVENTS(), ev('網站賽-999【19:00 單敗淘汰】', { createdAt: 200, createdByPlayer: true })],
    champs: [{ eventName: '網站賽-998【21:00 瑞士制】', communityEvent: true, finishedAt: 9 }],
    archives: [{ eventName: '網站賽-997【19:00 單敗淘汰】', communityEvent: true, finishedAt: 9 }],
  });
  const r = await withNow(NOON, () => call(S.handlers['GET /api/tournament/admin/daily-preset']));
  ok(r.body.maxNo === 149, 'maxNo=' + r.body.maxNo + '（社群賽被算進去了）');
});
await T('A4 ⭐⭐⭐【HEAD-FAIL】建立：兩場逐字名稱、報名截止＝台北 19:00／21:00、報名立即開放、賽制正確', async () => {
  const S = buildServer(PATCH, { events: BASE_EVENTS() });
  const r = await withNow(NOON, () => call(S.handlers['POST /api/tournament/admin/event/create-daily'], { body: {} }));
  ok(r.code === 200, JSON.stringify(r).slice(0, 300));
  const made = S.spy.inserts;
  ok(made.length === 2, '建了 ' + made.length + ' 場');
  assert.deepStrictEqual(made.map((e) => e.name), ['網站賽-150【19:00 單敗淘汰】', '網站賽-151【21:00 瑞士制】']);
  assert.deepStrictEqual(made.map((e) => e.registrationCloseAt), [tw(2026, 9, 23, 19, 0), tw(2026, 9, 23, 21, 0)]);
  ok(made.every((e) => e.registrationOpenAt === null && e.status === 'registration'), '報名沒有立即開放：' + JSON.stringify(made.map((e) => [e.registrationOpenAt, e.status])));
  assert.deepStrictEqual(made.map((e) => e.format), ['single-elim', 'swiss-then-cut']);
  ok(made[0]._id !== made[1]._id, '⚠ 兩場撞同一個 _id（同一毫秒建立）');
});
await T('A5 ⭐⭐【HEAD-FAIL】參數沿用「最近一場同賽制的網站賽」（單敗沿用 148、瑞士沿用 149）', async () => {
  const S = buildServer(PATCH, { events: BASE_EVENTS() });
  await withNow(NOON, () => call(S.handlers['POST /api/tournament/admin/event/create-daily'], { body: {} }));
  const [a, b] = S.spy.inserts;
  assert.deepStrictEqual([a.maxPlayers, a.roundLimitMin, a.noShowMin, a.roundCountdownMin], [32, 30, 6, 4]);
  assert.deepStrictEqual([b.maxPlayers, b.roundLimitMin, b.noShowMin, b.roundCountdownMin, b.swissRounds, b.topCut], [24, 28, 7, 2, 4, 8]);
});
await T('A6 ⭐⭐【HEAD-FAIL】台北時區：伺服器 TZ 是 UTC 也要對（19:00 台北 ＝ 11:00 UTC；台北 00:30 算「今天」）', async () => {
  const S = buildServer(PATCH, { events: BASE_EVENTS() });
  const r = await withNow(tw(2026, 9, 23, 0, 30), () => call(S.handlers['GET /api/tournament/admin/daily-preset']));
  const d = new Date(r.body.slots[0].closeAt);
  ok(d.getUTCHours() === 11 && d.getUTCDate() === 23 && d.getUTCMonth() === 8, 'UTC=' + d.toISOString());
  ok(r.body.slots[1].closeAt - r.body.slots[0].closeAt === 2 * 3600000, '兩場相差不是 2 小時');
});
await T('A7 ⭐⭐【HEAD-FAIL】已建立過的時段不重建，而且**不吃編號**（另一場仍拿 150）', async () => {
  const dup = ev('網站賽-150【19:00 單敗淘汰】', { createdAt: 300, status: 'registration', registrationCloseAt: tw(2026, 9, 23, 19, 0) });
  const S = buildServer(PATCH, { events: [...BASE_EVENTS(), dup] });
  const r = await withNow(NOON, () => call(S.handlers['POST /api/tournament/admin/event/create-daily'], { body: {} }));
  ok(r.code === 200, JSON.stringify(r).slice(0, 200));
  assert.deepStrictEqual(S.spy.inserts.map((e) => e.name), ['網站賽-151【21:00 瑞士制】']);
  ok((r.body.skipped || []).some((s) => s.hhmm === '19:00' && /已經建過/.test(s.reason)), JSON.stringify(r.body.skipped));
});
await T('A8 ⭐⭐【HEAD-FAIL】時段已過不自動建（報名截止在過去＝一建立就開賽）；另一場照建', async () => {
  const S = buildServer(PATCH, { events: BASE_EVENTS() });
  const r = await withNow(tw(2026, 9, 23, 20, 0), () => call(S.handlers['POST /api/tournament/admin/event/create-daily'], { body: {} }));
  assert.deepStrictEqual(S.spy.inserts.map((e) => e.name), ['網站賽-150【21:00 瑞士制】']);
  ok((r.body.skipped || []).some((s) => s.hhmm === '19:00' && /已經過/.test(s.reason)), JSON.stringify(r.body.skipped));
});
await T('A9 ⭐⭐【HEAD-FAIL】樂觀鎖：expectedNames 對不上 ⇒ 409 且**一場都沒建**', async () => {
  const S = buildServer(PATCH, { events: BASE_EVENTS() });
  const r = await withNow(NOON, () => call(S.handlers['POST /api/tournament/admin/event/create-daily'],
    { body: { expectedNames: ['網站賽-140【19:00 單敗淘汰】'] } }));
  ok(r.code === 409, 'code=' + r.code);
  ok(S.spy.inserts.length === 0, '竟然建了 ' + S.spy.inserts.length + ' 場');
});
await T('A10 ⭐⭐【HEAD-FAIL】掃不到任何「網站賽-N」⇒ 409 不亂接號（不會建出網站賽-1）', async () => {
  const S = buildServer(PATCH, { events: [ev('某某盃', { createdAt: 5 })] });
  const r = await withNow(NOON, () => call(S.handlers['POST /api/tournament/admin/event/create-daily'], { body: {} }));
  ok(r.code === 409 && S.spy.inserts.length === 0, JSON.stringify(r).slice(0, 200));
});
await T('A11 ⭐【HEAD-FAIL】權限：非管理員 403、未登入 401，兩支端點都擋', async () => {
  const S = buildServer(PATCH, { events: BASE_EVENTS(), admin: false });
  for (const k of ['GET /api/tournament/admin/daily-preset', 'POST /api/tournament/admin/event/create-daily']) {
    const r = await withNow(NOON, () => call(S.handlers[k]));
    ok(r.code === 403, k + ' code=' + r.code);
  }
  const S2 = buildServer(PATCH, { events: BASE_EVENTS(), identity: { error: '需要登入', code: 401 } });
  const r2 = await withNow(NOON, () => call(S2.handlers['POST /api/tournament/admin/event/create-daily']));
  ok(r2.code === 401 && S2.spy.inserts.length === 0, 'code=' + r2.code);
});
await T('A12 ⭐⭐【HEAD-FAIL】查詢有上限、有 projection（不做全集合掃描、不撈整包賽事）', async () => {
  const S = buildServer(PATCH, { events: BASE_EVENTS() });
  await withNow(NOON, () => call(S.handlers['GET /api/tournament/admin/daily-preset']));
  ok(S.spy.finds.length > 0 && S.spy.finds.length <= 4, '查詢發數 ' + S.spy.finds.length);
  ok(S.spy.finds.every((f) => Number.isFinite(f.limit) && f.limit > 0 && f.limit <= 1000), '有查詢沒有 limit：' + JSON.stringify(S.spy.finds.map((f) => f.limit)));
  ok(S.spy.finds.every((f) => f.opts && f.opts.projection), '有查詢沒有 projection');
});
await T('A13 ⭐⭐ 零回歸：舊的 /event/create 端點產出的賽事文件與 BASE 逐欄位相同', async () => {
  const body = { name: '手動賽', maxPlayers: '16', roundLimitMin: '22', noShowMin: '4', roundCountdownMin: '2', format: 'swiss', swissRounds: '5', topCut: '4', registrationOpenAt: '', registrationCloseAt: String(tw(2026, 9, 23, 19, 0)) };
  const S = buildServer(PATCH, { events: [] });
  const r = await withNow(NOON, () => call(S.handlers['POST /api/tournament/admin/event/create'], { body }));
  ok(r.code === 200 && r.body && r.body.ok, JSON.stringify(r).slice(0, 200));
  const got = S.spy.inserts[0];
  assert.deepStrictEqual(
    [got.name, got.format, got.swissRounds, got.topCut, got.phase, got.status, got.maxPlayers, got.roundLimitMin, got.noShowMin, got.roundCountdownMin, got.registrationOpenAt, got.registrationCloseAt, got.checkInEnabled, got.currentRound, got.createdBy],
    ['手動賽', 'swiss-then-cut', 5, 4, 'swiss', 'registration', 16, 22, 4, 2, null, tw(2026, 9, 23, 19, 0), true, 0, 'admin@x']);
});

await T('A14 ⭐⭐ 掃描窗口夠大且由新到舊：最大號在第 250 筆舊賽事上也要接得到（limit 太小／排序反了就漏）', async () => {
  const many = [];
  for (let i = 0; i < 250; i++) many.push(ev('網站賽-' + (100 + i) + '【19:00 單敗淘汰】', { createdAt: 1000 + i, format: 'single-elim' }));
  const S = buildServer(PATCH, { events: many });
  const r = await withNow(NOON, () => call(S.handlers['GET /api/tournament/admin/daily-preset']));
  ok(r.body.maxNo === 349, 'maxNo=' + r.body.maxNo + '（掃描窗口或排序有問題）');
});
await T('A15 ⭐⭐ 名人堂／歸檔也是由新到舊掃：最大號在最新那一筆（排序反了就抓到舊的）', async () => {
  const chs = [];
  for (let i = 0; i < 250; i++) chs.push({ eventName: '網站賽-' + (200 + i) + '【21:00 瑞士制】', communityEvent: false, finishedAt: 1000 + i });
  const S = buildServer(PATCH, { events: BASE_EVENTS(), champs: chs });
  const r = await withNow(NOON, () => call(S.handlers['GET /api/tournament/admin/daily-preset']));
  ok(r.body.maxNo === 449, 'maxNo=' + r.body.maxNo);
});
await T('A16 ⭐⭐ 只認「網站賽-N」：同時段的無編號賽事不算已建立、沿用設定也要跳過它', async () => {
  const other = ev('某某盃【19:00 單敗淘汰】', { createdAt: 500, format: 'single-elim', registrationCloseAt: tw(2026, 9, 23, 19, 0),
    maxPlayers: 8, roundLimitMin: 99, noShowMin: 9, roundCountdownMin: 9 });
  const S = buildServer(PATCH, { events: [...BASE_EVENTS(), other] });
  const r = await withNow(NOON, () => call(S.handlers['POST /api/tournament/admin/event/create-daily'], { body: {} }));
  ok(r.code === 200, JSON.stringify(r).slice(0, 200));
  const made = S.spy.inserts;
  assert.deepStrictEqual(made.map((e) => e.name), ['網站賽-150【19:00 單敗淘汰】', '網站賽-151【21:00 瑞士制】']);
  assert.deepStrictEqual([made[0].maxPlayers, made[0].roundLimitMin, made[0].noShowMin, made[0].roundCountdownMin], [32, 30, 6, 4]);
});
await T('A17 ⭐ 全形－的舊名稱也算編號（接號不會因為一個全形字就重號）', async () => {
  const S = buildServer(PATCH, { events: [...BASE_EVENTS(), ev('網站賽－151【21:00 瑞士制】', { createdAt: 400, format: 'swiss-then-cut' })] });
  const r = await withNow(NOON, () => call(S.handlers['GET /api/tournament/admin/daily-preset']));
  ok(r.body.maxNo === 151, 'maxNo=' + r.body.maxNo);
});
await T('A18 ⭐⭐ _id 格式：第一場與手動建立逐字同款（沒有序號後綴），只有第二場才加', async () => {
  const S = buildServer(PATCH, { events: BASE_EVENTS() });
  await withNow(NOON, () => call(S.handlers['POST /api/tournament/admin/event/create-daily'], { body: {} }));
  const [a, b] = S.spy.inserts;
  ok(/^evt_[0-9a-z]+$/.test(a._id), '第一場 _id 格式變了：' + a._id);
  ok(/^evt_[0-9a-z]+_1$/.test(b._id), '第二場 _id 沒有序號後綴：' + b._id);
});
await T('A19 ⭐⭐ 同時只跑一個一鍵建立：第二發併發請求回 409 且一場都不建', async () => {
  const S = buildServer(PATCH, { events: BASE_EVENTS() });
  const h = S.handlers['POST /api/tournament/admin/event/create-daily'];
  // ⚠ 兩發**同時**進入（模擬兩個 admin 分頁同時按）：第一發設下 in-flight 旗標後才 await 查詢，
  //   第二發在那個讓出點看到旗標 ⇒ 必須 409，而且不可以再建一次。
  const [r1, r2] = await withNow(NOON, () => Promise.all([call(h, { body: {} }), call(h, { body: {} })]));
  const codes = [r1.code, r2.code].sort();
  ok(codes[0] === 200 && codes[1] === 409, 'codes=' + JSON.stringify([r1.code, r2.code]));
  ok(S.spy.inserts.length === 2, '建了 ' + S.spy.inserts.length + ' 場（應為 2）');
  ok(String((r1.code === 409 ? r1 : r2).body.error).includes('還在處理中'), '409 訊息不對');
});
await T('A20 ⭐ 409 只回人話（admin 的 api() 會把整包 body 當 error 字串 alert 出來）', async () => {
  const S = buildServer(PATCH, { events: BASE_EVENTS() });
  const r = await withNow(NOON, () => call(S.handlers['POST /api/tournament/admin/event/create-daily'],
    { body: { expectedNames: ['網站賽-140【19:00 單敗淘汰】'] } }));
  ok(r.code === 409 && Object.keys(r.body).join(',') === 'error', '409 body 夾帶了別的欄位：' + Object.keys(r.body).join(','));
});
await T('A21 ⭐⭐ 零回歸（邊界）：maxPlayers 上限 64、roundCountdownMin 可為 0、單敗不帶瑞士欄位', async () => {
  const S = buildServer(PATCH, { events: [] });
  const r = await withNow(NOON, () => call(S.handlers['POST /api/tournament/admin/event/create'],
    { body: { name: 'X', maxPlayers: '99', roundLimitMin: '', noShowMin: '', roundCountdownMin: '0', format: 'single-elim', registrationCloseAt: '' } }));
  ok(r.code === 200, JSON.stringify(r).slice(0, 150));
  const got = S.spy.inserts[0];
  assert.deepStrictEqual([got.maxPlayers, got.roundLimitMin, got.noShowMin, got.roundCountdownMin], [64, 25, 5, 0]);
  ok(got.swissRounds === undefined && got.topCut === undefined && got.phase === undefined, '單敗不該帶瑞士欄位');
  ok(got.bestOf === 1 && got.registrationCloseAt === null && got.status === 'registration', JSON.stringify([got.bestOf, got.registrationCloseAt, got.status]));
  ok(/^evt_[0-9a-z]+$/.test(got._id), '手動建立的 _id 格式變了：' + got._id);
});

console.log('\n【B】admin 前端：面板純函式');
const panelFn = () => {
  const src = fnSrc(HTML, 'tevDailyPanelHtml');
  // ⚠ 狀態中文對照表是模組層級的 var（面板函式會讀它）⇒ 連同宣告一起抽，不要在守衛裡自己抄一份（抄一份＝判準有兩份）
  const labels = /var TEV_ST_LABELS = \{[^}]*\};/.exec(HTML);
  ok(labels, '抽不到 TEV_ST_LABELS（BASE 上本來就沒有）');
  return new Function('escapeHtml', 'twDateStr', labels[0] + '\n' + src + '\nreturn tevDailyPanelHtml;')(
    (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    (ms) => new Date(Number(ms) + 8 * 3600000).toISOString().slice(0, 10).replace(/-/g, '/'));
};
const SLOT = (o) => ({ hhmm: '19:00', label: '單敗淘汰', format: 'single-elim', closeAt: tw(2026, 9, 23, 19, 0), name: null, exists: null, existsStatus: null, past: false, willCreate: false, settings: null, ...o });
await T('B1 ⭐⭐【HEAD-FAIL】兩場都要建 ⇒ 列出名稱與報名截止、按鈕可按（onclick 走 tevCreateDaily）', () => {
  const f = panelFn();
  const html = f({ maxNo: 149, slots: [
    SLOT({ willCreate: true, name: '網站賽-150【19:00 單敗淘汰】', settings: { from: '網站賽-148【19:00 單敗淘汰】' } }),
    SLOT({ hhmm: '21:00', label: '瑞士制', closeAt: tw(2026, 9, 23, 21, 0), willCreate: true, name: '網站賽-151【21:00 瑞士制】', settings: { from: '網站賽-149【21:00 瑞士制】' } }),
  ] }, 'X:1;');
  ok(html.includes('網站賽-150【19:00 單敗淘汰】') && html.includes('網站賽-151【21:00 瑞士制】'), '名稱沒列出來');
  ok(/報名截止 2026\/09\/23 19:00/.test(html), '沒有報名截止時間：' + html.slice(0, 300));
  ok(html.includes('onclick="tevCreateDaily(this)"') && !/disabled/.test(html), '按鈕不可按');
  ok(html.includes('網站賽-148【19:00 單敗淘汰】'), '沒有說明設定沿用哪一場');
});
await T('B2 ⭐【HEAD-FAIL】已建立／時段已過 ⇒ 各自講明原因，且沒有可按的按鈕', () => {
  const f = panelFn();
  const html = f({ maxNo: 149, slots: [
    SLOT({ exists: '網站賽-150【19:00 單敗淘汰】', existsStatus: 'registration' }),
    SLOT({ hhmm: '21:00', past: true }),
  ] }, 'X:1;');
  ok(/已經建立/.test(html) && html.includes('網站賽-150【19:00 單敗淘汰】') && /報名中/.test(html), '已建立那一列不對：' + html);
  ok(/已經過了/.test(html), '時段已過那一列不對');
  ok(/disabled/.test(html) && !html.includes('onclick="tevCreateDaily(this)"'), '不該有可按的按鈕');
});
await T('B3 ⭐【HEAD-FAIL】舊伺服器（preset 缺席）⇒ 整塊不顯示（不顯示一個按了會錯的鈕）', () => {
  const f = panelFn();
  ok(f(null, 'X:1;') === '' && f({}, 'X:1;') === '' && f({ slots: [] }, 'X:1;') === '', '應該回空字串');
});
await T('B4 ⭐【HEAD-FAIL】maxNo=0（接不到號）⇒ 按鈕不可按並講明原因', () => {
  const f = panelFn();
  const html = f({ maxNo: 0, slots: [SLOT({ willCreate: true, name: '網站賽-1【19:00 單敗淘汰】' })] }, 'X:1;');
  ok(/disabled/.test(html) && /無法自動接號/.test(html), html.slice(0, 300));
});
await T('B5 ⭐ 賽事名稱一律 escapeHtml（名稱是資料，不可以直接當 HTML）', () => {
  const f = panelFn();
  const html = f({ maxNo: 9, slots: [SLOT({ exists: '<img src=x onerror=alert(1)>', existsStatus: 'running' })] }, 'X:1;');
  ok(!html.includes('<img src=x') && html.includes('&lt;img'), html.slice(0, 300));
});
await T('B5b ⭐ 要建立的場次名稱與「設定沿用」來源名稱同樣要 escape', () => {
  const f = panelFn();
  const html = f({ maxNo: 9, slots: [SLOT({ willCreate: true, name: '<b>X</b>', settings: { from: '<i>Y</i>' } })] }, 'X:1;');
  ok(!/<b>X<\/b>/.test(html) && html.includes('&lt;b&gt;X'), '場次名稱沒 escape');
  ok(!/<i>Y<\/i>/.test(html) && html.includes('&lt;i&gt;Y'), '沿用來源名稱沒 escape');
});
await T('B6 ⭐ 沒有可沿用的設定時要明講（不能讓站長以為沿用了）', () => {
  const f = panelFn();
  const html = f({ maxNo: 149, slots: [SLOT({ willCreate: true, name: '網站賽-150【19:00 單敗淘汰】', settings: null })] }, 'X:1;');
  ok(/系統預設/.test(html), html.slice(0, 300));
});

console.log('\n【C】接線（少接一條，功能就是死碼）');
await T('C1 ⭐【HEAD-FAIL】loadTournamentAdmin 會抓 daily-preset，且用 dailyApi 哨兵判斷舊伺服器', () => {
  const src = fnSrc(HTML, 'loadTournamentAdmin');
  ok(src.includes("/api/tournament/admin/daily-preset"), '沒有抓 daily-preset');
  ok(/dailyApi === 1/.test(src), '沒有用 dailyApi 哨兵');
  ok(/tevDailyPanelHtml\(tevDailyPreset, btnS\)/.test(src), '面板沒有掛進畫面');
});
/** ⚠ 行為端（不是只看原始碼有沒有出現 confirm）：注入假 confirm／api 實跑 tevCreateDaily。 */
function runCreateDaily(preset, { confirmYes = true, apiResult = null } = {}) {
  const src = fnSrc(HTML, 'tevCreateDaily');
  ok(src.startsWith('window.tevCreateDaily'), '沒有掛 window（inline onclick 會找不到）');
  const calls = { api: [], alerts: [], confirms: [], reloaded: 0 };
  const win = {};
  const fn = new Function('window', 'tevDailyPreset', 'twDateStr', 'confirm', 'alert', 'api', 'loadTournamentAdmin', 'calls',
    src + '\nreturn window.tevCreateDaily;')(
    win, preset, (ms) => new Date(Number(ms) + 8 * 3600000).toISOString().slice(0, 10),
    (msg) => { calls.confirms.push(String(msg)); return confirmYes; },
    (msg) => { calls.alerts.push(String(msg)); },
    async (path, opts) => { calls.api.push({ path, opts }); return apiResult || { ok: true, created: [{ name: '網站賽-150【19:00 單敗淘汰】' }], skipped: [{ hhmm: '21:00', reason: '已經建過：網站賽-151【21:00 瑞士制】' }] }; },
    () => { calls.reloaded++; }, calls);
  const btn = { disabled: false };
  return { run: fn(btn), calls, btn };
}
const PRESET2 = { maxNo: 149, slots: [
  { hhmm: '19:00', closeAt: tw(2026, 9, 23, 19, 0), willCreate: true, name: '網站賽-150【19:00 單敗淘汰】', settings: { from: '網站賽-148【19:00 單敗淘汰】' } },
  { hhmm: '21:00', closeAt: tw(2026, 9, 23, 21, 0), willCreate: true, name: '網站賽-151【21:00 瑞士制】', settings: { from: '網站賽-149【21:00 瑞士制】' } },
] };
await T('C2 ⭐⭐【HEAD-FAIL】tevCreateDaily 行為：確認視窗列出兩場名稱與報名截止，按確定才送出且帶 expectedNames', async () => {
  const { run, calls } = runCreateDaily(PRESET2);
  await run;
  ok(calls.confirms.length === 1, '沒有跳確認視窗');
  // ⚠ 不可以用 /19:00/ 當「有列出時間」的判準 —— 賽事名稱本身就含 19:00 ⇒ 那條恆真（安慰劑型態 12）。
  //   用「報名截止」字樣＋twDateStr 產出的**日期**（名稱裡沒有日期）才分辨得出來。
  ok(calls.confirms[0].includes('網站賽-150【19:00 單敗淘汰】') && calls.confirms[0].includes('網站賽-151【21:00 瑞士制】'),
    '確認視窗沒列出兩場名稱：' + calls.confirms[0]);
  ok(/報名截止/.test(calls.confirms[0]) && calls.confirms[0].includes('2026-09-23'),
    '確認視窗沒列出報名截止（日期＋時間）：' + calls.confirms[0]);
  ok(calls.api.length === 1 && /create-daily$/.test(calls.api[0].path), '沒有打 create-daily：' + JSON.stringify(calls.api.map((c) => c.path)));
  const sent = JSON.parse(calls.api[0].opts.body);
  assert.deepStrictEqual(sent.expectedNames, ['網站賽-150【19:00 單敗淘汰】', '網站賽-151【21:00 瑞士制】']);
  ok(calls.reloaded === 1, '沒有重新整理列表');
});
await T('C2b ⭐⭐【HEAD-FAIL】按「取消」⇒ 一發請求都不送；沒有可建場次 ⇒ 只提示不送出', async () => {
  const a = runCreateDaily(PRESET2, { confirmYes: false });
  await a.run;
  ok(a.calls.api.length === 0, '按取消還是送出了');
  const b = runCreateDaily({ maxNo: 149, slots: [{ hhmm: '19:00', willCreate: false, exists: 'X', closeAt: 0 }] });
  await b.run;
  ok(b.calls.api.length === 0 && b.calls.alerts.length === 1 && b.calls.confirms.length === 0, JSON.stringify(b.calls));
});
await T('C3 ⭐⭐ 賽事文件只有一份組裝（Rule 38：不可以兩邊各寫一份）', () => {
  const hits = (PATCH.match(/_id: 'evt_' \+ Date\.now\(\)\.toString\(36\)/g) || []).length;
  ok(hits === 1, "組賽事文件的地方有 " + hits + " 處（必須只有 insertTournamentEvent 一處）");
  ok((PATCH.match(/async function insertTournamentEvent\(/g) || []).length === 1, 'insertTournamentEvent 不是唯一');
});
await T('C4 ⭐⭐ 行內改動有 revert 宣告，而且 test-v6303 真的接上了（否則 H3 逐位元比對會靜默變寬）', () => {
  // ⚠ Rule 41：BASE 上這個檔根本不存在 ⇒ 讀檔例外要收斂成**這一條**紅，不可以讓整支 throw（後面幾條就永遠跑不到）
  let rev = '';
  try { rev = normEol(readFileSync(join(ROOT, 'scripts/lib/sap-revert-admin-v150.mjs'), 'utf8')); }
  catch (e) { ok(false, '找不到 scripts/lib/sap-revert-admin-v150.mjs（BASE 上本來就沒有）'); }
  ok(/ADMIN_V150_INLINE_PAIRS/.test(rev) && /insertTournamentEvent\(b, id\)/.test(rev), 'revert 宣告內容不對');
  ok(/revertAdminV150\(SAP_RAW\)/.test(V6303), 'test-v6303 沒有接上 revertAdminV150');
});
await T('C5 ⭐ 本守衛進了 package.json 的 test chain；admin 版本標示前後一致（不比對字面版本號）', () => {
  ok(PKG.includes('scripts/test-admin-v177-daily-tournament.mjs'), '沒有進 npm test chain');
  const t = /<title>PTCG Oracle Admin v([\d.]+)<\/title>/.exec(HTML);
  const h = /PTCG Oracle Admin <span class="small">v([\d.]+)<\/span>/.exec(HTML);
  ok(t && h && t[1] === h[1], 'title 與 h1 的 admin 版本不一致：' + (t && t[1]) + ' vs ' + (h && h[1]));
});

await T('C2c ⭐⭐ 只有一場要建時：expectedNames 只帶那一場（不可以把 null 或整份 slots 送出去）', async () => {
  const preset = { maxNo: 149, slots: [
    { hhmm: '19:00', closeAt: tw(2026, 9, 23, 19, 0), willCreate: false, exists: '網站賽-150【19:00 單敗淘汰】', name: null },
    { hhmm: '21:00', closeAt: tw(2026, 9, 23, 21, 0), willCreate: true, name: '網站賽-151【21:00 瑞士制】', settings: { from: '網站賽-149【21:00 瑞士制】' } },
  ] };
  const { run, calls } = runCreateDaily(preset);
  await run;
  const sent = JSON.parse(calls.api[0].opts.body);
  assert.deepStrictEqual(sent.expectedNames, ['網站賽-151【21:00 瑞士制】']);
  ok(!calls.confirms[0].includes('網站賽-150'), '確認視窗不該列出不會建立的那一場：' + calls.confirms[0]);
});
await T('C2d ⭐⭐ 送出時鎖住按鈕；結果與錯誤都要讓站長看得到（建了什麼／略過什麼／伺服器的錯誤）', async () => {
  const a = runCreateDaily(PRESET2);
  await a.run;
  ok(a.btn.disabled === true, '送出時沒有鎖住按鈕（連點會重複送）');
  ok(a.calls.alerts.length === 1 && a.calls.alerts[0].includes('網站賽-150【19:00 單敗淘汰】')
    && /略過/.test(a.calls.alerts[0]) && a.calls.alerts[0].includes('網站賽-151【21:00 瑞士制】'),
    '結果沒有列出建了什麼／略過什麼：' + a.calls.alerts.join(' | '));
  const b = runCreateDaily(PRESET2, { apiResult: { error: '按下按鈕之前編號或時段變了' } });
  await b.run;
  ok(b.calls.alerts.length === 1 && b.calls.alerts[0] === '按下按鈕之前編號或時段變了', '伺服器的錯誤沒有原文轉達：' + b.calls.alerts.join(' | '));
});
await T('C2e ⭐ 確認視窗要寫明每一場的設定沿用哪一場（站長才知道會帶什麼參數）', async () => {
  const { run, calls } = runCreateDaily(PRESET2);
  await run;
  ok(calls.confirms[0].includes('網站賽-148【19:00 單敗淘汰】') && calls.confirms[0].includes('網站賽-149【21:00 瑞士制】'),
    '確認視窗沒寫沿用來源：' + calls.confirms[0]);
});

console.log('\n【D】錦標賽區塊的 revert-diff 與 28 把鎖重釘（動到區塊就必須做完這一整套）');
{
  const { createHash } = await import('node:crypto');
  const RV = await import('./lib/tourn-revert-v150.mjs');
  const RV84 = await import('./lib/tourn-revert-v6384.mjs');
  const sha = (x) => createHash('sha256').update(x, 'utf8').digest('hex');
  const tail = PATCH.slice(PATCH.indexOf(RV.TAIL_ANCHOR));
  const tev = PATCH.slice(PATCH.indexOf(RV.TEV_ANCHOR));
  await T('D1 ⭐⭐ 現行區塊指紋 ＝ v1.50 的新值（tail／tev／長度）', () => {
    ok(sha(tail) === RV.NEW_TAIL_SHA_V150 && sha(tev) === RV.NEW_TEV_SHA_V150 && tev.length === RV.NEW_TEV_LEN_V150,
      'tail=' + sha(tail) + ' tev=' + sha(tev) + ' len=' + tev.length);
  });
  await T('D2 ⭐⭐⭐ 還原 v1.50（哨兵區塊＋create 端點的行內收斂）後**逐位元**回到 v6.384', () => {
    ok(sha(RV.revertV150(tail)) === RV.OLD_TAIL_SHA_V6384, 'tail 還原後 ' + sha(RV.revertV150(tail)));
    ok(sha(RV.revertV150(tev)) === RV.OLD_TEV_SHA_V6384 && RV.revertV150(tev).length === RV.OLD_TEV_LEN_V6384,
      'tev 還原後 ' + sha(RV.revertV150(tev)) + ' len=' + RV.revertV150(tev).length);
  });
  await T('D3 ⭐⭐ [自驗] 把本版一處改動抹掉 ⇒ D1 的指紋必須對不上（不是恆真式）', () => {
    const mutated = tev.replace("const TDAILY_TZ_MIN = 480;", "const TDAILY_TZ_MIN = 481;");
    ok(mutated !== tev && sha(mutated) !== RV.NEW_TEV_SHA_V150, '改了一個字元指紋卻沒變 ⇒ D1 是安慰劑');
  });
  await T('D4 ⭐⭐ v6.384 的舊指紋零殘留：28 把區塊鎖全部重釘（漏一把這裡就紅）', async () => {
    const { readdirSync, statSync } = await import('node:fs');
    const stale = [];
    const EXEMPT = new Set(['scripts/lib/tourn-revert-v6384.mjs', 'scripts/lib/tourn-revert-v150.mjs']);
    const walk = (dir) => { for (const n of readdirSync(dir)) { const fp = join(dir, n);
      if (statSync(fp).isDirectory()) { walk(fp); continue; }
      if (!n.endsWith('.mjs')) continue;
      const rel = fp.slice(ROOT.length).replace(/\\/g, '/').replace(/^\//, '');
      if (EXEMPT.has(rel)) continue;
      const src = normEol(readFileSync(fp, 'utf8'));
      for (const [tag, v] of [['tail', RV84.NEW_TAIL_SHA_V6384], ['tev', RV84.NEW_TEV_SHA_V6384]]) {
        if (src.includes(v)) stale.push(rel + ' :: v6.384 ' + tag);
      } } };
    walk(join(ROOT, 'scripts'));
    ok(RV84.NEW_TAIL_SHA_V6384 !== RV.NEW_TAIL_SHA_V150, '前提：新舊值必須不同，否則這一條恆真');
    ok(stale.length === 0, '還釘著 v6.384 舊指紋：' + stale.join(' | '));
  });
  await T('D5 ⭐⭐ 五支 revert-diff 消費者都串上了 v1.50 那一節（少接一支，它的鎖就會靜默停用）', () => {
    for (const f of ['test-v6276-deck-tournament-stats', 'test-v6291-tourn-verified-gate',
      'test-v6292-tourn-verified-gate2', 'test-v6303-ui-batch', 'test-v6381-archive-gamedraw-and-swiss-note']) {
      const src = normEol(readFileSync(join(ROOT, 'scripts/' + f + '.mjs'), 'utf8'));
      ok(src.includes("from './lib/tourn-revert-v150.mjs'") && /revertV150\(/.test(src), f + ' 沒有串上 v1.50');
    }
  });
}

console.log('\n=== admin v1.77／server v1.50 每日固定賽事：PASS ' + pass + ' / FAIL ' + fail + ' ===' + (fail ? '（紅：' + failed.join('、') + '）' : ''));
if (fail) process.exit(1);
