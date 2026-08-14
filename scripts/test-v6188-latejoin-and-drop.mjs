#!/usr/bin/env node
/**
 * v6.188 守衛：①報到階段「補報名＋直接報到」 ②瑞士制／單淘汰「中途棄賽」。
 *
 * ⚠⚠ 本檔的設計原則（v6.137/v6.154 教訓）：**「有呼叫某函式」≠「那件事發生了」**。
 *   所以除了少數真的只能用結構斷言的地方（admin rematch 的相依太深），其餘一律
 *   **把 server_admin_patch.js 裡的函式與端點原始碼抽出來、接上假 mongo 真的跑一遍**，
 *   斷言的是「資料庫裡最後長什麼樣」「誰被排進了下一輪」，不是「有沒有出現某個字串」。
 *
 * ⚠ 否定型斷言（例如「沒有取消棄賽的端點」「沒有重用 doubleNoShow」）一律先剝掉註解再掃，
 *   否則註解裡提到該詞就會讓守衛自己騙自己。
 *
 * HEAD-FAIL：對 v6.187 的 server_admin_patch.js / +page.svelte 跑本檔，
 *   ①③⑤⑥⑦⑧ 全部會 FAIL（補報端點不存在、dropped 沒接線、seedTopCut 空陣列會 throw…）。
 */
import { build } from 'esbuild';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const P = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');
const PAGE = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');

let pass = 0, fail = 0;
const T = async (name, fn) => {
  try { await fn(); console.log('  PASS ' + name); pass++; }
  catch (e) { console.log('  FAIL ' + name + '\n        ' + (e && e.message)); fail++; }
};
const ok = (c, m) => { if (!c) throw new Error(m); };

// ════════ 0. 取真正的 swiss 純函式（TENG）════════
const E = join(ROOT, '.x6188.ts'), O = join(ROOT, '.x6188.mjs');
process.on('exit', () => { for (const f of [E, O]) { try { unlinkSync(f); } catch { /* */ } } });
writeFileSync(E, "export * from './src/lib/tournament/swiss';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', logLevel: 'error' });
const TENG = await import(pathToFileURL(O).href);

// ════════ 1. 抽取工具：從 patch 原始碼抽出「一整支函式 / 一整支端點」════════
function fnSrc(name) {
  for (const head of ['    async function ' + name + '(', '    function ' + name + '(']) {
    const i = P.indexOf(head);
    if (i < 0) continue;
    const j = P.indexOf('\n    }\n', i);
    ok(j > i, '抓不到 ' + name + ' 的結尾');
    return P.slice(i, j + 6);
  }
  throw new Error('server_admin_patch.js 找不到函式 ' + name);
}
function epSrc(route) {
  const head = "app.post('" + route + "'";
  const i = P.indexOf(head);
  ok(i >= 0, 'server_admin_patch.js 找不到端點 ' + route);
  const j = P.indexOf('\n    });\n', i);
  ok(j > i, '抓不到端點 ' + route + ' 的結尾');
  return P.slice(i, j + 8);
}
function seedChainSrc() {
  const i = P.indexOf('    let _seedChain = Promise.resolve();');
  ok(i >= 0, '找不到 _seedChain 宣告');
  const j = P.indexOf('\n    async function _seedEventBracketImpl(', i);
  ok(j > i, '找不到 _seedEventBracketImpl');
  return P.slice(i, j);
}
/** 剝掉行註解與區塊註解（否定型掃描前必做）。 */
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => {
    let inS = null, esc = false;
    for (let k = 0; k < l.length; k++) {
      const c = l[k];
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (inS) { if (c === inS) inS = null; continue; }
      if (c === "'" || c === '"' || c === '`') { inS = c; continue; }
      if (c === '/' && l[k + 1] === '/') return l.slice(0, k);
    }
    return l;
  }).join('\n');
}
const P_NC = stripComments(P);

// ════════ 2. 假 mongo（只實作被用到的查詢/更新運算子）════════
const clone = (o) => JSON.parse(JSON.stringify(o));
function matchOne(doc, q) {
  for (const k of Object.keys(q || {})) {
    const cond = q[k];
    if (k === '$or') { if (!cond.some((c) => matchOne(doc, c))) return false; continue; }
    const v = doc[k];
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      if ('$ne' in cond && v === cond.$ne) return false;
      if ('$in' in cond && !cond.$in.includes(v)) return false;
      if ('$nin' in cond && cond.$nin.includes(v)) return false;
      if ('$exists' in cond && (v !== undefined) !== cond.$exists) return false;
      const plain = Object.keys(cond).filter((x) => !x.startsWith('$'));
      if (plain.length && JSON.stringify(v) !== JSON.stringify(cond)) return false;
      continue;
    }
    if (v !== cond) return false;
  }
  return true;
}
function applyUpd(doc, u) {
  let changed = false;
  if (u.$set) for (const k of Object.keys(u.$set)) { if (JSON.stringify(doc[k]) !== JSON.stringify(u.$set[k])) changed = true; doc[k] = u.$set[k]; }
  if (u.$unset) for (const k of Object.keys(u.$unset)) { if (k in doc) { delete doc[k]; changed = true; } }
  return changed;
}
function Col(name) {
  const rows = [];
  const api = {
    _name: name, _rows: rows,
    async findOne(q) { const r = rows.find((d) => matchOne(d, q)); return r ? clone(r) : null; },
    find(q) {
      const sel = () => rows.filter((d) => matchOne(d, q || {})).map(clone);
      return { toArray: async () => sel(), sort: () => ({ toArray: async () => sel() }) };
    },
    async insertOne(d) { if (d._id != null && rows.some((r) => r._id === d._id)) { const e = new Error('E11000 duplicate key'); e.code = 11000; throw e; } rows.push(clone(d)); return { insertedId: d._id }; },
    async insertMany(arr) {
      // ⚠ 真 mongodb 對空陣列會 throw（Invalid BulkOperation, Batch cannot be empty）——
      //   這正是 v6.188 順手修掉的那個「賽事永久卡死」bug，假 mongo 必須忠實重現。
      if (!Array.isArray(arr) || arr.length === 0) throw new Error('Invalid BulkOperation, Batch cannot be empty');
      for (const d of arr) rows.push(clone(d));
      return { insertedCount: arr.length };
    },
    async updateOne(q, u, opts) {
      const i = rows.findIndex((d) => matchOne(d, q));
      if (i < 0) {
        if (opts && opts.upsert) {
          const d = {};
          for (const k of Object.keys(q)) { const c = q[k]; if (!(c && typeof c === 'object')) d[k] = c; }
          if (u.$setOnInsert) Object.assign(d, u.$setOnInsert);
          if (u.$set) Object.assign(d, u.$set);
          rows.push(clone(d));
          return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
        }
        return { matchedCount: 0, modifiedCount: 0 };
      }
      if (u.$setOnInsert) delete u.$setOnInsert;
      const ch = applyUpd(rows[i], u);
      return { matchedCount: 1, modifiedCount: ch ? 1 : 0 };
    },
    async updateMany(q, u) { let n = 0; for (const d of rows) if (matchOne(d, q)) { applyUpd(d, u); n++; } return { matchedCount: n, modifiedCount: n }; },
    async deleteOne(q) { const i = rows.findIndex((d) => matchOne(d, q)); if (i >= 0) rows.splice(i, 1); return { deletedCount: i >= 0 ? 1 : 0 }; },
    async deleteMany(q) { let n = 0; for (let i = rows.length - 1; i >= 0; i--) if (matchOne(rows[i], q)) { rows.splice(i, 1); n++; } return { deletedCount: n }; },
    async countDocuments(q) { return rows.filter((d) => matchOne(d, q || {})).length; },
  };
  return api;
}

// ════════ 3. 把 patch 的函式＋端點接上假 mongo 跑起來 ════════
function makeServer(uid, email) {
  const TEVENTS = Col('ev'), TREGS = Col('reg'), TMATCH = Col('match'), TROOMS = Col('room'),
        TCHAT = Col('chat'), TARCHIVE = Col('arch'), TCHAMPS = Col('champ');
  const handlers = {};
  const app = { post: (p, h) => { handlers[p] = h; }, get: () => {} };
  let ident = { uid, email, name: uid };
  const env = {
    app, handlers, TEVENTS, TREGS, TMATCH, TROOMS, TCHAT, TARCHIVE, TCHAMPS, TENG, console,
    TMINVER_RE: /^\d+(\.\d+)?$/,
    deckCount: (entries) => { if (!Array.isArray(entries)) return -1; let n = 0; for (const e of entries) n += (e && e.count) || 0; return n; },
    tournIdentity: async () => ident,
    resolveEventFromReq: async (req) => {
      const eid = (req.body && req.body.eventId) || null;
      return eid ? await TEVENTS.findOne({ _id: String(eid) }) : (await TEVENTS.find({}).toArray())[0] || null;
    },
    isTournAdmin: () => false,
  };
  const code = [
    seedChainSrc(),
    fnSrc('_seedEventBracketImpl'),
    fnSrc('buildRoundMatches'),
    fnSrc('swissPhase'),
    fnSrc('postSystemChat'),
    fnSrc('recordChampion'),
    fnSrc('recordTournamentArchive'),
    fnSrc('advanceOrFinish'),
    fnSrc('pairingsToMatches'),
    fnSrc('_forceGameOver'),
    fnSrc('finishSwissWithSurvivor'),
    fnSrc('finishIfLastSurvivor'),
    fnSrc('advanceSwiss'),
    fnSrc('checkRoundAdvance'),
    epSrc('/api/tournament/register-and-checkin'),
    epSrc('/api/tournament/drop'),
    '\nreturn { advanceSwiss, checkRoundAdvance, finishIfLastSurvivor, seedEventBracket, runInSeedChain, handlers, pairingsToMatches };',
  ].join('\n');
  const names = Object.keys(env);
  const built = new Function(...names, code)(...names.map((n) => env[n]));
  const call = async (route, body) => {
    let code2 = 200, payload = null;
    const res = { status(c) { code2 = c; return res; }, json(o) { payload = o; return res; } };
    await built.handlers[route]({ body: body || {} }, res);
    return { code: code2, body: payload };
  };
  return { ...built, call, TEVENTS, TREGS, TMATCH, TROOMS, TCHAT, TARCHIVE, TCHAMPS, setIdent: (o) => { ident = o; } };
}

const deck60 = [{ cardId: '1', count: 60 }];
async function seedCheckinEvent(S, opts = {}) {
  await S.TEVENTS.insertOne({ _id: 'EV', name: '測試賽', status: 'checkin', format: opts.format || 'swiss-then-cut', maxPlayers: opts.maxPlayers ?? null, roundCountdownMin: 3, checkInDeadline: Date.now() + 60000 });
}

console.log('\n① 補報名：CAS 之前進來的必須被排進第 1 輪；CAS 之後進來的必須 409 且 TREGS 無殘留');

await T('⭐ CAS 之前補報 ⇒ 200，而且真的出現在第 1 輪 matches（行為端）', async () => {
  const S = makeServer('late1');
  await seedCheckinEvent(S);
  for (const u of ['a', 'b', 'c']) await S.TREGS.insertOne({ _id: 'EV__' + u, eventId: 'EV', uid: u, name: u, deckEntries: deck60, checkedIn: true });
  const r = await S.call('/api/tournament/register-and-checkin', { eventId: 'EV', name: '遲到俠', deckEntries: deck60, deckName: 'D' });
  ok(r.code === 200, '補報應成功，實際 ' + r.code + ' ' + JSON.stringify(r.body));
  const reg = await S.TREGS.findOne({ _id: 'EV__late1' });
  ok(reg && reg.checkedIn === true && reg.lateJoin === true, 'reg 必須一筆到位含 checkedIn:true + lateJoin:true，實際 ' + JSON.stringify(reg));
  // 走真正的 CAS + seed
  await S.TEVENTS.updateOne({ _id: 'EV', status: 'checkin' }, { $set: { status: 'bracket_ready' } });
  const sr = await S.seedEventBracket({ _id: 'EV', name: '測試賽', format: 'swiss-then-cut', roundCountdownMin: 3 }, { checkedInOnly: true, immediateEnter: true });
  ok(sr && sr.ok, 'seed 應成功：' + JSON.stringify(sr));
  const ms = await S.TMATCH.find({ eventId: 'EV', round: 1 }).toArray();
  ok(ms.some((m) => m.p1uid === 'late1' || m.p2uid === 'late1'), '補報者必須出現在第 1 輪賽程，實際 ' + JSON.stringify(ms.map((m) => [m.p1uid, m.p2uid])));
});

await T('⭐⭐ 窗口在寫入當下關上 ⇒ 409 且 TREGS **無殘留**（寫入後重讀 status → 刪除）', async () => {
  const S = makeServer('late2');
  await seedCheckinEvent(S);
  await S.TREGS.insertOne({ _id: 'EV__a', eventId: 'EV', uid: 'a', name: 'a', deckEntries: deck60, checkedIn: true });
  // ⚠⚠ 這裡的數字踩過雷（Fable 審查抓到假綠）：端點對 TEVENTS.findOne 的呼叫序是
  //   ①resolveEventFromReq ②臨界區內的 _fresh0 ③insertOne 之後的 _fresh1。
  //   用 n>=2 會讓 _fresh0 就早退 ⇒ **根本沒 insert 過**，「無殘留」等於空過。
  //   必須用 n>=3，才真的走到「寫進去了、才發現窗口關了 → 自己刪掉」這條新分支。
  const realFindOne = S.TEVENTS.findOne.bind(S.TEVENTS);
  const realInsert = S.TREGS.insertOne.bind(S.TREGS);
  let n = 0, inserted = 0;
  S.TEVENTS.findOne = async (q, o) => { n++; const d = await realFindOne(q, o); if (d && n >= 3) d.status = 'bracket_ready'; return d; };
  S.TREGS.insertOne = async (d) => { inserted++; return await realInsert(d); };
  const r = await S.call('/api/tournament/register-and-checkin', { eventId: 'EV', name: '太遲了', deckEntries: deck60 });
  S.TEVENTS.findOne = realFindOne; S.TREGS.insertOne = realInsert;
  ok(inserted === 1, '⚠ 這條測的是「寫進去之後才發現窗口關了」，必須真的 insert 過一次，實際 ' + inserted + ' 次（＝走的是早退分支，斷言空過）');
  ok(r.code === 409, '窗口已關必須回 409，實際 ' + r.code + ' ' + JSON.stringify(r.body));
  const reg = await S.TREGS.findOne({ _id: 'EV__late2' });
  ok(reg === null, '⚠⚠ 被拒絕就**不可以留下 reg 殘留**（否則下一次 seed 會把幽靈玩家排進賽程），實際 ' + JSON.stringify(reg));
});

await T('⭐ 社群賽「報到不足自動取消」也必須排進同一條鎖（否則補報回 200 下一秒賽事被取消）', () => {
  const i = P.indexOf('// v0.53 社群賽：報到截止先檢查');
  ok(i >= 0, '找不到社群賽報到不足檢查');
  const seg = P.slice(i, i + 2000);
  ok(/runInSeedChain\(async \(\) => \{[\s\S]{0,800}countDocuments\(\{ eventId: ev\._id, checkedIn: true \}\)/.test(seg),
    '⚠ 數人數＋取消必須跑在 seed 序列鎖內，否則與補報名有真實競態（Fable 審查）');
  ok(/updateOne\(\{ _id: ev\._id, status: 'checkin' \}, \{ \$set: \{ status: 'finished', cancelled: true/.test(seg),
    '取消的寫入要帶 status:checkin 條件，避免與下方 checkin→bracket_ready 的 CAS 互踩');
});

await T('⭐⭐ 補報與 seed 互斥：補報跑在同一條 seed 序列鎖內（runInSeedChain）', async () => {
  ok(/function runInSeedChain\(/.test(P), 'runInSeedChain 中央鎖必須存在');
  const ep = epSrc('/api/tournament/register-and-checkin');
  ok(/runInSeedChain\(/.test(ep), '補報端點必須把臨界區排進 seed 序列鎖，否則 seed 讀 regs 與補報 insertOne 會交錯');
  ok(/return await runInSeedChain\(\(\) => _seedEventBracketImpl/.test(P), 'seedEventBracket 必須仍走同一條鎖（兩者不同鎖＝等於沒鎖）');
  // 行為端：鎖真的序列化（同時丟兩件工作，第二件不會在第一件完成前開始）
  const S = makeServer('x');
  const order = [];
  const p1 = S.runInSeedChain(async () => { order.push('a-in'); await new Promise((r) => setTimeout(r, 20)); order.push('a-out'); });
  const p2 = S.runInSeedChain(async () => { order.push('b-in'); });
  await Promise.all([p1, p2]);
  ok(order.join(',') === 'a-in,a-out,b-in', '序列鎖沒有真的序列化：' + order.join(','));
});

console.log('\n② 補報名三條分支：maxPlayers／autoRemovedConflict／既有報名者');

await T('人數已滿 ⇒ 409（與 /register 同一條規則）', async () => {
  const S = makeServer('late3');
  await seedCheckinEvent(S, { maxPlayers: 2 });
  for (const u of ['a', 'b']) await S.TREGS.insertOne({ _id: 'EV__' + u, eventId: 'EV', uid: u, name: u, deckEntries: deck60, checkedIn: true });
  const r = await S.call('/api/tournament/register-and-checkin', { eventId: 'EV', name: 'N', deckEntries: deck60 });
  ok(r.code === 409 && /已滿/.test(r.body.error || ''), '應回 409 人數已滿，實際 ' + r.code + ' ' + JSON.stringify(r.body));
  ok((await S.TREGS.findOne({ _id: 'EV__late3' })) === null, '被拒絕不可留下 reg');
});

await T('被 autoRemovedConflict 剔除者 ⇒ 409（不給他從補報這道側門回來）', async () => {
  const S = makeServer('conf');
  await seedCheckinEvent(S);
  await S.TREGS.insertOne({ _id: 'EV__conf', eventId: 'EV', uid: 'conf', name: 'conf', deckEntries: deck60, checkedIn: false, autoRemovedConflict: true });
  const r = await S.call('/api/tournament/register-and-checkin', { eventId: 'EV', name: 'N', deckEntries: deck60 });
  ok(r.code === 409 && /其他進行中的賽事/.test(r.body.error || ''), '應回 409 衝突，實際 ' + r.code + ' ' + JSON.stringify(r.body));
  const reg = await S.TREGS.findOne({ _id: 'EV__conf' });
  ok(reg.checkedIn === false && reg.autoRemovedConflict === true, '⚠ 不可以被補報覆寫成已報到，實際 ' + JSON.stringify(reg));
});

await T('既有報名者 ⇒ 409（走既有 /checkin，且**不得覆蓋已鎖定的牌組**）', async () => {
  const S = makeServer('old');
  await seedCheckinEvent(S);
  await S.TREGS.insertOne({ _id: 'EV__old', eventId: 'EV', uid: 'old', name: '原名', deckName: '原牌組', deckEntries: deck60, checkedIn: false });
  const r = await S.call('/api/tournament/register-and-checkin', { eventId: 'EV', name: '新名', deckName: '新牌組', deckEntries: deck60 });
  ok(r.code === 409, '應回 409，實際 ' + r.code);
  const reg = await S.TREGS.findOne({ _id: 'EV__old' });
  ok(reg.deckName === '原牌組' && reg.name === '原名', '⚠ 補報**絕不可**蓋掉既有報名的暱稱/牌組，實際 ' + JSON.stringify(reg));
});

await T('報名階段／已開賽的賽事一律不開放補報（gate 只認 checkin）', async () => {
  for (const st of ['registration', 'running', 'finished', 'bracket_ready']) {
    const S = makeServer('u');
    await S.TEVENTS.insertOne({ _id: 'EV', name: 'E', status: st, format: 'swiss-then-cut', maxPlayers: null });
    const r = await S.call('/api/tournament/register-and-checkin', { eventId: 'EV', name: 'N', deckEntries: deck60 });
    ok(r.code === 409, st + ' 應回 409，實際 ' + r.code);
  }
});

await T('牌組非 60 張 / 沒填暱稱 ⇒ 400（驗證與 /register 逐條相同）', async () => {
  const S = makeServer('u');
  await seedCheckinEvent(S);
  const r1 = await S.call('/api/tournament/register-and-checkin', { eventId: 'EV', name: 'N', deckEntries: [{ cardId: '1', count: 59 }] });
  ok(r1.code === 400, '59 張應 400，實際 ' + r1.code);
  const r2 = await S.call('/api/tournament/register-and-checkin', { eventId: 'EV', name: '   ', deckEntries: deck60 });
  ok(r2.code === 400, '空暱稱應 400，實際 ' + r2.code);
});

console.log('\n③ 棄賽者不再被配對（行為端跑 pairSwissRound / advanceSwiss）');

await T('pairSwissRound 本來就會過濾 dropped（swiss.ts 端）', () => {
  const mk = (uid, mp, dropped) => ({ uid, name: uid, matchPoints: mp, opponents: [], results: [], byes: 0, dropped });
  const pr = TENG.pairSwissRound([mk('A', 3), mk('B', 3), mk('C', 0, true), mk('D', 0)], 2, () => 0);
  const inPair = new Set(); for (const p of pr) { inPair.add(p.p1); if (p.p2) inPair.add(p.p2); }
  ok(!inPair.has('C'), '棄賽者不得被排入配對');
});

await T('⭐⭐⭐ advanceSwiss 必須把 dropped 從 TREGS 傳進去（HEAD 沒接線 ⇒ 棄賽者照樣被配對）', async () => {
  const S = makeServer('x');
  const ev = { _id: 'EV', name: 'E', format: 'swiss-then-cut', swissRounds: 3, topCut: 4, roundCountdownMin: 3 };
  await S.TEVENTS.insertOne({ ...ev, status: 'running', currentRound: 1, phase: 'swiss' });
  const us = ['A', 'B', 'C', 'D'];
  for (const u of us) await S.TREGS.insertOne({ _id: 'EV__' + u, eventId: 'EV', uid: u, name: u, checkedIn: true, dropped: u === 'C' });
  await S.TMATCH.insertMany([
    { _id: 'm0', eventId: 'EV', round: 1, idx: 0, phase: 'swiss', p1uid: 'A', p2uid: 'B', winnerUid: 'A', status: 'done' },
    { _id: 'm1', eventId: 'EV', round: 1, idx: 1, phase: 'swiss', p1uid: 'C', p2uid: 'D', winnerUid: 'C', status: 'done' },
  ]);
  await S.advanceSwiss(ev, 1);
  const r2 = await S.TMATCH.find({ eventId: 'EV', round: 2 }).toArray();
  ok(r2.length > 0, '第 2 輪應該有配對');
  const uids = new Set(); for (const m of r2) { uids.add(m.p1uid); if (m.p2uid) uids.add(m.p2uid); }
  ok(!uids.has('C'), '⚠⚠ 棄賽者 C 仍被排進第 2 輪 ⇒ dropped 沒有被傳進 buildSwissPlayersFromMatches。實際：' + JSON.stringify([...uids]));
  ok(uids.has('A') && uids.has('B') && uids.has('D'), '其餘三人都要被排進去（其中一人輪空），實際 ' + JSON.stringify([...uids]));
});

console.log('\n④ 棄賽者既有戰績保留、對手 OWP 不受影響');

await T('⭐ 棄賽者的勝率不被打到 0.25 地板，且對手 OWP 與「他沒棄賽」時完全相同', () => {
  const matches = [
    { round: 1, p1uid: 'A', p2uid: 'C', winnerUid: 'C', status: 'done' },
    { round: 1, p1uid: 'B', p2uid: 'D', winnerUid: 'B', status: 'done' },
    { round: 2, p1uid: 'C', p2uid: 'B', winnerUid: 'C', status: 'done' },
    { round: 2, p1uid: 'A', p2uid: 'D', winnerUid: 'A', status: 'done' },
  ];
  const regs = (drop) => ['A', 'B', 'C', 'D'].map((u) => ({ uid: u, name: u, dropped: drop && u === 'C' }));
  const base = TENG.computeStandings(TENG.buildSwissPlayersFromMatches(matches, regs(false)));
  const after = TENG.computeStandings(TENG.buildSwissPlayersFromMatches(matches, regs(true)));
  const g = (arr, u) => arr.find((s) => s.uid === u);
  ok(g(after, 'C').matchPoints === 6, '棄賽者既有 6 分必須保留，實際 ' + g(after, 'C').matchPoints);
  ok(Math.abs(TENG.winPct(g(after, 'C')) - 1) < 1e-9, '棄賽者勝率不該被壓到地板，實際 ' + TENG.winPct(g(after, 'C')));
  for (const u of ['A', 'B', 'D']) {
    ok(Math.abs(g(after, u).owp - g(base, u).owp) < 1e-9, u + ' 的 OWP 因為對手棄賽而改變了（' + g(base, u).owp + ' → ' + g(after, u).owp + '）');
    ok(Math.abs(g(after, u).oowp - g(base, u).oowp) < 1e-9, u + ' 的 OOWP 改變了');
    ok(g(after, u).matchPoints === g(base, u).matchPoints, u + ' 的積分改變了');
  }
});

console.log('\n⑤ 兩人都棄賽 ⇒ 雙敗，且用 doubleDrop **不是** doubleNoShow');

await T('⭐⭐ /drop：對手也已棄賽 ⇒ done + winnerUid:null + doubleDrop:true（且不得寫 doubleNoShow）', async () => {
  const S = makeServer('B');
  await S.TEVENTS.insertOne({ _id: 'EV', name: 'E', status: 'running', format: 'swiss-then-cut', swissRounds: 3, phase: 'swiss', currentRound: 1, roundCountdownMin: 3 });
  for (const u of ['A', 'B', 'C', 'D']) await S.TREGS.insertOne({ _id: 'EV__' + u, eventId: 'EV', uid: u, name: u, checkedIn: true, dropped: u === 'A' });
  await S.TMATCH.insertMany([
    { _id: 'm0', eventId: 'EV', round: 1, idx: 0, phase: 'swiss', p1uid: 'A', p2uid: 'B', winnerUid: null, status: 'playing', roomId: null },
    { _id: 'm1', eventId: 'EV', round: 1, idx: 1, phase: 'swiss', p1uid: 'C', p2uid: 'D', winnerUid: null, status: 'playing', roomId: null },
  ]);
  const r = await S.call('/api/tournament/drop', { eventId: 'EV' });
  ok(r.code === 200, '棄賽應成功，實際 ' + r.code + ' ' + JSON.stringify(r.body));
  const m = await S.TMATCH.findOne({ _id: 'm0' });
  ok(m.status === 'done' && m.winnerUid === null, '雙棄賽場應 done 且無勝方，實際 ' + JSON.stringify(m));
  ok(m.doubleDrop === true, '必須標 doubleDrop:true，實際 ' + JSON.stringify(m));
  ok(m.doubleNoShow === undefined, '⚠⚠ 絕不可重用 doubleNoShow（語意是「兩人都沒出現」，混用會讓事後對帳分不出掛機與棄賽）');
  // 計分：swiss.ts 對 done+無 winner 記雙敗
  const ps = TENG.buildSwissPlayersFromMatches([{ round: 1, p1uid: 'A', p2uid: 'B', winnerUid: null, status: 'done' }], [{ uid: 'A', name: 'A' }, { uid: 'B', name: 'B' }]);
  ok(ps.every((p) => p.matchPoints === 0 && p.results[0] === 'L'), '雙棄賽必須雙方各記一敗且不得分');
});

await T('⭐ /drop：對戰中棄賽 ⇒ 對手勝（沿用 forfeit 收場），且房間盤面被推成 game-over', async () => {
  const S = makeServer('A');
  await S.TEVENTS.insertOne({ _id: 'EV', name: 'E', status: 'running', format: 'swiss-then-cut', swissRounds: 3, phase: 'swiss', currentRound: 1, roundCountdownMin: 3 });
  for (const u of ['A', 'B', 'C', 'D']) await S.TREGS.insertOne({ _id: 'EV__' + u, eventId: 'EV', uid: u, name: u, checkedIn: true });
  await S.TROOMS.insertOne({ _id: 'r0', version: 3, gameState: { phase: 'playing', log: [] } });
  await S.TMATCH.insertMany([
    { _id: 'm0', eventId: 'EV', round: 1, idx: 0, phase: 'swiss', p1uid: 'A', p1name: 'A', p2uid: 'B', p2name: 'B', winnerUid: null, status: 'playing', roomId: 'r0' },
    { _id: 'm1', eventId: 'EV', round: 1, idx: 1, phase: 'swiss', p1uid: 'C', p2uid: 'D', winnerUid: null, status: 'playing', roomId: null },
  ]);
  const r = await S.call('/api/tournament/drop', { eventId: 'EV' });
  ok(r.code === 200, '應成功，實際 ' + r.code + ' ' + JSON.stringify(r.body));
  const m = await S.TMATCH.findOne({ _id: 'm0' });
  ok(m.status === 'done' && m.winnerUid === 'B' && m.forfeit === true, '對手應獲勝，實際 ' + JSON.stringify(m));
  const room = await S.TROOMS.findOne({ _id: 'r0' });
  ok(room.gameState.phase === 'game-over' && room.gameState.winner === 1 && room.version === 4, '房間盤面必須被推成 game-over，實際 ' + JSON.stringify(room.gameState));
  ok((await S.TREGS.findOne({ _id: 'EV__A' })).dropped === true, 'reg 必須標 dropped');
});

await T('⭐⭐ /drop：該場在同一瞬間已被別的路徑收掉 ⇒ **不得覆寫**既有結果（Fable 審查）', async () => {
  const S = makeServer('A');
  await S.TEVENTS.insertOne({ _id: 'EV', name: 'E', status: 'running', format: 'swiss-then-cut', swissRounds: 3, phase: 'swiss', currentRound: 1, roundCountdownMin: 3 });
  for (const u of ['A', 'B', 'C', 'D']) await S.TREGS.insertOne({ _id: 'EV__' + u, eventId: 'EV', uid: u, name: u, checkedIn: true });
  await S.TMATCH.insertMany([
    { _id: 'm0', eventId: 'EV', round: 1, idx: 0, phase: 'swiss', p1uid: 'A', p1name: 'A', p2uid: 'B', p2name: 'B', winnerUid: null, status: 'playing', roomId: null },
    { _id: 'm1', eventId: 'EV', round: 1, idx: 1, phase: 'swiss', p1uid: 'C', p2uid: 'D', winnerUid: null, status: 'playing', roomId: null },
  ]);
  // 模擬競態：findOne 讀到「還在打」的那一瞬間，這場其實剛被正常打完判 A 勝
  const realFind = S.TMATCH.findOne.bind(S.TMATCH);
  S.TMATCH.findOne = async (q) => {
    const d = await realFind(q);
    if (d && d._id === 'm0') { const row = S.TMATCH._rows.find((x) => x._id === 'm0'); row.status = 'done'; row.winnerUid = 'A'; row.winnerName = 'A'; }
    return d;
  };
  const r = await S.call('/api/tournament/drop', { eventId: 'EV' });
  S.TMATCH.findOne = realFind;
  ok(r.code === 200, '棄賽本身仍應成功，實際 ' + r.code);
  const m = await S.TMATCH.findOne({ _id: 'm0' });
  ok(m.winnerUid === 'A' && !m.forfeit && !m.dropForfeit, '⚠⚠ 已判定的勝場被棄賽收場覆寫了（我正贏卻被改成對手 forfeit 勝），實際 ' + JSON.stringify(m));
  ok((await S.TREGS.findOne({ _id: 'EV__A' })).dropped === true, 'reg 仍應標 dropped（棄賽本身有效）');
});

await T('/drop：連按第二次 ⇒ 409（棄賽不可逆、也不重複公告）', async () => {
  const S = makeServer('A');
  await S.TEVENTS.insertOne({ _id: 'EV', name: 'E', status: 'running', format: 'swiss-then-cut', swissRounds: 3, phase: 'swiss', currentRound: 1, roundCountdownMin: 3 });
  for (const u of ['A', 'B', 'C']) await S.TREGS.insertOne({ _id: 'EV__' + u, eventId: 'EV', uid: u, name: u, checkedIn: true });
  await S.TMATCH.insertMany([{ _id: 'm0', eventId: 'EV', round: 1, idx: 0, phase: 'swiss', p1uid: 'B', p2uid: 'C', winnerUid: 'B', status: 'done' }]);
  const r1 = await S.call('/api/tournament/drop', { eventId: 'EV' });
  ok(r1.code === 200, '第一次應成功，實際 ' + r1.code + ' ' + JSON.stringify(r1.body));
  const r2 = await S.call('/api/tournament/drop', { eventId: 'EV' });
  ok(r2.code === 409, '第二次應 409，實際 ' + r2.code);
});

await T('/drop：賽事已 finished ⇒ 409', async () => {
  const S = makeServer('A');
  await S.TEVENTS.insertOne({ _id: 'EV', name: 'E', status: 'finished', format: 'swiss-then-cut' });
  await S.TREGS.insertOne({ _id: 'EV__A', eventId: 'EV', uid: 'A', name: 'A', checkedIn: true });
  const r = await S.call('/api/tournament/drop', { eventId: 'EV' });
  ok(r.code === 409, '應 409，實際 ' + r.code);
  ok((await S.TREGS.findOne({ _id: 'EV__A' })).dropped !== true, '已結束的賽事不該被標 dropped');
});

console.log('\n⑥ 存活 <= 1 ⇒ 不 throw、直接完賽判冠軍（順手修的既有 bug）');

await T('⭐⭐⭐ 最後一輪瑞士打完、只剩 1 人未棄賽 ⇒ advanceSwiss **不得 throw**，直接判冠軍', async () => {
  const S = makeServer('x');
  const ev = { _id: 'EV', name: 'E', format: 'swiss-then-cut', swissRounds: 1, topCut: 4, roundCountdownMin: 3 };
  await S.TEVENTS.insertOne({ ...ev, status: 'running', currentRound: 1, phase: 'swiss' });
  for (const u of ['A', 'B']) await S.TREGS.insertOne({ _id: 'EV__' + u, eventId: 'EV', uid: u, name: u, checkedIn: true, dropped: u === 'B' });
  await S.TMATCH.insertMany([{ _id: 'm0', eventId: 'EV', round: 1, idx: 0, phase: 'swiss', p1uid: 'A', p2uid: 'B', winnerUid: 'A', status: 'done' }]);
  await S.advanceSwiss(ev, 1);   // HEAD：seedTopCut 回 [] → insertMany([]) throw → 賽事永久卡死
  const e = await S.TEVENTS.findOne({ _id: 'EV' });
  ok(e.status === 'finished', '應直接完賽，實際 status=' + e.status);
  ok(e.championUid === 'A', '冠軍應為唯一存活者 A，實際 ' + e.championUid);
  ok((await S.TCHAMPS.find({}).toArray()).length === 1, '名人堂應留下紀錄');
  ok((await S.TARCHIVE.find({}).toArray()).length === 1, '應寫入歸檔');
});

await T('⭐ 瑞士中途輪只剩 1 人未棄賽 ⇒ 也直接完賽（不會配出空的下一輪）', async () => {
  const S = makeServer('x');
  const ev = { _id: 'EV', name: 'E', format: 'swiss-then-cut', swissRounds: 3, topCut: 4, roundCountdownMin: 3 };
  await S.TEVENTS.insertOne({ ...ev, status: 'running', currentRound: 1, phase: 'swiss' });
  for (const u of ['A', 'B']) await S.TREGS.insertOne({ _id: 'EV__' + u, eventId: 'EV', uid: u, name: u, checkedIn: true, dropped: u === 'B' });
  await S.TMATCH.insertMany([{ _id: 'm0', eventId: 'EV', round: 1, idx: 0, phase: 'swiss', p1uid: 'A', p2uid: 'B', winnerUid: 'B', status: 'done' }]);
  await S.advanceSwiss(ev, 1);
  const e = await S.TEVENTS.findOne({ _id: 'EV' });
  ok(e.status === 'finished' && e.championUid === 'A', '應直接判 A 冠軍（即使他上一輪輸了——只剩他沒棄賽），實際 ' + JSON.stringify([e.status, e.championUid]));
});

await T('⭐ 棄賽當下就只剩 1 人 ⇒ /drop 自己就會完賽（輪次之間棄賽沒有任何一輪會結束）', async () => {
  const S = makeServer('B');
  await S.TEVENTS.insertOne({ _id: 'EV', name: 'E', status: 'running', format: 'swiss-then-cut', swissRounds: 3, phase: 'swiss', currentRound: 1, roundCountdownMin: 3 });
  for (const u of ['A', 'B']) await S.TREGS.insertOne({ _id: 'EV__' + u, eventId: 'EV', uid: u, name: u, checkedIn: true });
  await S.TMATCH.insertMany([{ _id: 'm0', eventId: 'EV', round: 1, idx: 0, phase: 'swiss', p1uid: 'A', p2uid: 'B', winnerUid: 'A', status: 'done' }]);
  const r = await S.call('/api/tournament/drop', { eventId: 'EV' });
  ok(r.code === 200, '應成功，實際 ' + r.code + ' ' + JSON.stringify(r.body));
  const e = await S.TEVENTS.findOne({ _id: 'EV' });
  ok(e.status === 'finished' && e.championUid === 'A', '應判 A 冠軍完賽，實際 ' + JSON.stringify([e.status, e.championUid]));
});

await T('⭐ 單淘汰／Top Cut：棄賽者即使本輪贏了也不再被排進下一輪', async () => {
  const S = makeServer('x');
  await S.TEVENTS.insertOne({ _id: 'EV', name: 'E', status: 'running', format: 'single-elim', currentRound: 1, rounds: 2, roundCountdownMin: 3 });
  for (const u of ['A', 'B', 'C', 'D']) await S.TREGS.insertOne({ _id: 'EV__' + u, eventId: 'EV', uid: u, name: u, checkedIn: true, dropped: u === 'A' });
  await S.TMATCH.insertMany([
    { _id: 'm0', eventId: 'EV', round: 1, idx: 0, p1uid: 'A', p1name: 'A', p2uid: 'B', p2name: 'B', winnerUid: 'A', winnerName: 'A', status: 'done' },
    { _id: 'm1', eventId: 'EV', round: 1, idx: 1, p1uid: 'C', p1name: 'C', p2uid: 'D', p2name: 'D', winnerUid: 'C', winnerName: 'C', status: 'done' },
  ]);
  await S.checkRoundAdvance('EV');
  const e = await S.TEVENTS.findOne({ _id: 'EV' });
  ok(e.status === 'finished' && e.championUid === 'C', '棄賽者 A 不得晉級 ⇒ 只剩 C ⇒ C 冠軍，實際 ' + JSON.stringify([e.status, e.championUid]));
});

console.log('\n⑦ Top Cut 種子必須濾掉 dropped');

await T('⭐⭐ 積分最高者棄賽 ⇒ Top Cut 名單裡不得有他，其餘人照排', async () => {
  const S = makeServer('x');
  const ev = { _id: 'EV', name: 'E', format: 'swiss-then-cut', swissRounds: 1, topCut: 4, roundCountdownMin: 3 };
  await S.TEVENTS.insertOne({ ...ev, status: 'running', currentRound: 1, phase: 'swiss' });
  const us = ['A', 'B', 'C', 'D', 'E', 'F'];
  for (const u of us) await S.TREGS.insertOne({ _id: 'EV__' + u, eventId: 'EV', uid: u, name: u, checkedIn: true, dropped: u === 'A' });
  await S.TMATCH.insertMany([
    { _id: 'm0', eventId: 'EV', round: 1, idx: 0, phase: 'swiss', p1uid: 'A', p2uid: 'B', winnerUid: 'A', status: 'done' },
    { _id: 'm1', eventId: 'EV', round: 1, idx: 1, phase: 'swiss', p1uid: 'C', p2uid: 'D', winnerUid: 'C', status: 'done' },
    { _id: 'm2', eventId: 'EV', round: 1, idx: 2, phase: 'swiss', p1uid: 'E', p2uid: 'F', winnerUid: 'E', status: 'done' },
  ]);
  await S.advanceSwiss(ev, 1);
  const cut = await S.TMATCH.find({ eventId: 'EV', round: 2 }).toArray();
  ok(cut.length > 0, 'Top Cut 應該有配對');
  const uids = new Set(); for (const m of cut) { uids.add(m.p1uid); if (m.p2uid) uids.add(m.p2uid); }
  ok(!uids.has('A'), '⚠ 棄賽者 A 被排進 Top Cut 了，實際 ' + JSON.stringify([...uids]));
  ok(uids.has('C') && uids.has('E'), '其餘勝者仍應進 Top Cut，實際 ' + JSON.stringify([...uids]));
});

console.log('\n⑧ 棄賽不可逆：沒有取消端點；前端確認框存在且「按鈕 ≠ 送出」');

await T('⭐⭐ 伺服器端**沒有任何**取消棄賽的路徑（剝註解後掃）', () => {
  ok(!/undrop|un-drop|cancel-?drop|drop\/cancel/i.test(P_NC), '出現了取消棄賽的端點字樣');
  const setsFalse = P_NC.match(/dropped:\s*false/g) || [];
  ok(setsFalse.length === 0, '有把 dropped 寫回 false 的地方（棄賽必須不可逆），共 ' + setsFalse.length + ' 處');
  ok(!/\$unset:[^}]*dropped/.test(P_NC), 'rematch 之類的 $unset 不得清掉 dropped');
});

await T('⭐⭐ 前端：棄賽鈕只開確認框、**不會送出任何請求**；只有確認鈕會真的打 /drop', async () => {
  // 把 +page.svelte 裡那兩支函式抽出來真的跑（不是掃字串）
  const grab = (sig) => {
    const i = PAGE.indexOf(sig);
    ok(i >= 0, '+page.svelte 找不到 ' + sig);
    const j = PAGE.indexOf('\n  }\n', i);
    return PAGE.slice(i, (j > i ? j + 5 : PAGE.indexOf('\n', i) + 1));
  };
  let src = grab('function tDropRequest(') + '\n' + grab('async function tDropCommit(');
  src = src.replace(/: string/g, '').replace(/: any/g, '');
  const calls = [];
  const env = {
    tApi: async (p) => { calls.push(p); return { ok: true }; },
    tournLoadEvent: async () => {}, tBracketLoad: () => {},
    __set: (v) => { state.tDropConfirmEventId = v; },
  };
  const state = { tDropConfirmEventId: '', tError: '', tBusy: false };
  const body = 'let tDropConfirmEventId = "", tError = "", tBusy = false;\n' + src
    + '\nreturn { tDropRequest, tDropCommit, peek: () => tDropConfirmEventId };';
  const api = new Function('tApi', 'tournLoadEvent', 'tBracketLoad', body)(env.tApi, env.tournLoadEvent, env.tBracketLoad);
  api.tDropRequest('EV');
  ok(calls.length === 0, '⚠⚠ 按棄賽鈕就直接送出了（棄賽不可逆，必須先跳確認框）。實際送出：' + JSON.stringify(calls));
  ok(api.peek() === 'EV', '按下後應該打開確認框（tDropConfirmEventId 被設起來）');
  await api.tDropCommit();
  ok(calls.length === 1 && calls[0] === '/drop', '確認鈕才應該打 /drop，實際 ' + JSON.stringify(calls));
  ok(api.peek() === '', '送出後確認框應關閉');
});

await T('⭐ 確認框文案逐字存在，且視窗放在所有版面分支之外（v6.167 教訓）', () => {
  ok(PAGE.includes('確定要棄賽嗎？棄賽後<b>無法復原</b>，你將不再被排入後續對戰。'),
    '確認框文案必須逐字為「確定要棄賽嗎？棄賽後**無法復原**，你將不再被排入後續對戰。」');
  const iModal = PAGE.indexOf('{#if isTournament && !isTournSpectator && tDropConfirmEventId}');
  ok(iModal >= 0, '確認框必須由 tDropConfirmEventId 控制顯示');
  const iLayout = PAGE.indexOf("{#if isTournament && tStep !== 'playing'}");
  ok(iLayout >= 0 && iModal < iLayout, '⚠ 確認框必須放在「大廳／對戰」兩個版面分支之外（否則某個分支永遠畫不出來）');
  ok(/onclick=\{\(\) => tDropRequest\(ev\._id\)\}/.test(PAGE), '棄賽鈕的 onclick 必須是 tDropRequest（開框），不可以直接呼叫送出');
});

console.log('\n⑨ 其他收尾：歸檔欄位、admin rematch 擋 dropped、前端補報表單');

await T('歸檔補上 dropped/lateJoin 與 doubleDrop（少了對帳會斷鏈）', async () => {
  const S = makeServer('x');
  const ev = { _id: 'EV', name: 'E', format: 'swiss-then-cut' };
  await S.TEVENTS.insertOne({ ...ev, status: 'running' });
  await S.TREGS.insertOne({ _id: 'EV__A', eventId: 'EV', uid: 'A', name: 'A', checkedIn: true, dropped: true, droppedAt: 123, lateJoin: true, deckEntries: [] });
  await S.TMATCH.insertOne({ _id: 'm0', eventId: 'EV', round: 1, idx: 0, p1uid: 'A', p2uid: 'B', winnerUid: null, status: 'done', doubleDrop: true });
  // recordTournamentArchive 是內部函式：透過 finishIfLastSurvivor 這條真實路徑觸發
  await S.finishIfLastSurvivor('EV');
  const a = (await S.TARCHIVE.find({}).toArray())[0];
  ok(a, '應該有歸檔');
  ok(a.players[0].dropped === true && a.players[0].lateJoin === true && a.players[0].droppedAt === 123, '歸檔 players 必須帶 dropped/droppedAt/lateJoin，實際 ' + JSON.stringify(a.players[0]));
  ok(a.matches[0].doubleDrop === true, '歸檔 matches 必須帶 doubleDrop，實際 ' + JSON.stringify(a.matches[0]));
});

await T('admin rematch 遇到已棄賽的玩家必須擋下（結構斷言：相依太深不便實跑）', () => {
  const i = P.indexOf("app.post('/api/tournament/admin/match/restart'");
  ok(i >= 0, '找不到 rematch 端點');
  const seg = P.slice(i, P.indexOf('\n    });\n', i));
  const iGuard = seg.indexOf('reg1.dropped || reg2.dropped');
  const iGame = seg.indexOf('makeGame(');
  ok(iGuard >= 0, 'rematch 沒有擋 dropped 玩家');
  ok(iGuard < iGame, 'dropped 守衛必須在真的建局之前');
  ok(/status\(409\)/.test(seg.slice(iGuard, iGuard + 200)), 'rematch 遇 dropped 應回 409');
});

await T('前端：報到階段對未報名者顯示報名表單（重用同一份 snippet，不是複製一份）', () => {
  ok(/\{#snippet regForm\(ev, lateJoin\)\}/.test(PAGE), '報名表單必須抽成 regForm snippet');
  ok(PAGE.match(/\{@render regForm\(/g).length === 2, '報名階段與報到階段必須 render 同一份 regForm，實際 ' + JSON.stringify(PAGE.match(/\{@render regForm\(/g)));
  ok(!PAGE.includes('未報名者無法參加；報到結束後依「已報到者」產生賽程。'), '報到階段的「未報名者無法參加」舊文案應已移除');
  ok(/tLateJoin\(ev\._id\)/.test(PAGE), '補報路徑必須呼叫 tLateJoin');
  ok(/tApi\('\/register-and-checkin'/.test(PAGE), '補報必須打 /register-and-checkin 這支端點');
  // 表單只有一份：舊的 tourn-reg-form 區塊不得還留在 eventCard 裡
  ok((PAGE.match(/<div class="tourn-reg-form">/g) || []).length === 1, '報名表單 markup 只能有一份');
});

await T('/event 與 /bracket 必須把 dropped 回傳給前端（否則棄賽鈕與排名標記都畫不出來）', () => {
  ok(/dropped: !!\(_reg && _reg\.dropped\)/.test(P), '/event 的 events[] 沒有回傳 dropped');
  ok(/dropped: !!reg\.dropped/.test(P), '/event 的 me 沒有回傳 dropped');
  ok(/dropped: !!s\.dropped/.test(P), '/bracket 的 standings 沒有回傳 dropped');
});

console.log('\n' + (fail ? '❌' : '✅') + ` v6.188 補報名＋棄賽守衛：PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
