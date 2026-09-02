#!/usr/bin/env node
/**
 * v6.189 收尾批次守衛：
 *   ① 賽事完賽公告的措辭必須對應**實際成因**（棄賽／未出賽／平手／勝方全部棄賽）。
 *   ② /checkin 收進 seed 序列鎖 ⇒ 「回 200」與「被排進賽程」不再可能互相矛盾，且不會卡死。
 *   ③ admin 的「留言數對帳」按鈕存在、真的打到 /api/admin/deck-posts/recount。
 *
 * ⚠⚠ 設計原則（v6.137/v6.154 教訓）：「有呼叫某函式」≠「那件事發生了」。
 *   ①②一律把 server_admin_patch.js 的函式／端點抽出來接上假 mongo **真的跑一遍**，
 *   斷言的是「聊天室裡最後那句話是什麼」「誰被排進了第 1 輪」；
 *   ③把 admin.html 的 handler 抽出來接上假 api() 跑，斷言「打到哪個 URL、用什麼方法」。
 *
 * HEAD-FAIL（對 v6.188 的 server_admin_patch.js / admin.html 跑本檔）：
 *   ①-b/c/d FAIL（公告一律是「最後一場雙方皆未進場」）
 *   ②-b FAIL（報到回 200 卻沒被排進賽程）
 *   ③ 全 FAIL（admin.html 根本沒有 runDeckPostRecount）
 */
import { build } from 'esbuild';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const P = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');
const AH = readFileSync(join(ROOT, 'oracle-admin/admin.html'), 'utf8');

let pass = 0, fail = 0;
const T = async (name, fn) => {
  try { await fn(); console.log('  PASS ' + name); pass++; }
  catch (e) { console.log('  FAIL ' + name + '\n        ' + (e && e.message)); fail++; }
};
const ok = (c, m) => { if (!c) throw new Error(m); };
const tick = () => new Promise((r) => setTimeout(r, 0));

// ════════ 0. 真正的 swiss 純函式（TENG）════════
const E = join(ROOT, '.x6189.ts'), O = join(ROOT, '.x6189.mjs');
process.on('exit', () => { for (const f of [E, O]) { try { unlinkSync(f); } catch { /* */ } } });
writeFileSync(E, "export * from './src/lib/tournament/swiss';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', logLevel: 'error' });
const TENG = await import(pathToFileURL(O).href);

// ════════ 1. 從 patch 原始碼抽「一整支函式 / 一整支端點」════════
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

// ════════ 2. 假 mongo ════════
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
  // ⚠ 每個操作都真的 await 一次 macrotask —— 併發測試要有真實的交錯點，
  //   全部同步 resolve 的假 mongo 會讓競態永遠不發生（等於測了個寂寞）。
  const yieldTick = () => new Promise((r) => setTimeout(r, 0));
  return {
    _name: name, _rows: rows,
    async findOne(q) { await yieldTick(); const r = rows.find((d) => matchOne(d, q)); return r ? clone(r) : null; },
    find(q) {
      const sel = async () => { await yieldTick(); return rows.filter((d) => matchOne(d, q || {})).map(clone); };
      return { toArray: sel, sort: () => ({ toArray: sel }) };
    },
    async insertOne(d) { await yieldTick(); if (d._id != null && rows.some((r) => r._id === d._id)) { const e = new Error('E11000 duplicate key'); e.code = 11000; throw e; } rows.push(clone(d)); return { insertedId: d._id }; },
    async insertMany(arr) { await yieldTick(); if (!Array.isArray(arr) || arr.length === 0) throw new Error('Invalid BulkOperation, Batch cannot be empty'); for (const d of arr) rows.push(clone(d)); return { insertedCount: arr.length }; },
    async updateOne(q, u, opts) {
      await yieldTick();
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
    async updateMany(q, u) { await yieldTick(); let n = 0; for (const d of rows) if (matchOne(d, q)) { applyUpd(d, u); n++; } return { matchedCount: n, modifiedCount: n }; },
    async deleteOne(q) { await yieldTick(); const i = rows.findIndex((d) => matchOne(d, q)); if (i >= 0) rows.splice(i, 1); return { deletedCount: i >= 0 ? 1 : 0 }; },
    async deleteMany(q) { await yieldTick(); let n = 0; for (let i = rows.length - 1; i >= 0; i--) if (matchOne(rows[i], q)) { rows.splice(i, 1); n++; } return { deletedCount: n }; },
    async countDocuments(q) { await yieldTick(); return rows.filter((d) => matchOne(d, q || {})).length; },
  };
}

// ════════ 3. 接上假 mongo 跑起來 ════════
function makeServer(uid, srcPatch) {
  const TEVENTS = Col('ev'), TREGS = Col('reg'), TMATCH = Col('match'), TROOMS = Col('room'),
        TCHAT = Col('chat'), TARCHIVE = Col('arch'), TCHAMPS = Col('champ');
  const handlers = {};
  const app = { post: (p, h) => { handlers[p] = h; }, get: () => {} };
  let ident = { uid, email: uid + '@t', name: uid, verified: true };   // ⭐v6.291 見下方 tournRequireVerified
  let identityCalls = 0;
  let identityGate = null;
  const env = {
    app, handlers, TEVENTS, TREGS, TMATCH, TROOMS, TCHAT, TARCHIVE, TCHAMPS, TENG, console,
    TMINVER_RE: /^\d+(\.\d+)?$/,
    deckCount: (entries) => { if (!Array.isArray(entries)) return -1; let n = 0; for (const e of entries) n += (e && e.count) || 0; return n; },
    tournIdentity: async () => { identityCalls++; if (identityGate) await identityGate; return ident; },
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
    fnSrc('noChampionReason'),
    fnSrc('checkRoundAdvance'),
    // ⭐v6.291：/checkin 多了一行 verified gate ⇒ 沙盒餵**真的** helper（不是 stub）；
    //   身分一律 verified:true（模擬已登入的真玩家）⇒ 本檔同時是「gate 沒有誤擋真玩家」的金絲雀。
    fnSrc('tournRequireVerified'),
    srcPatch ? srcPatch(epSrc('/api/tournament/checkin')) : epSrc('/api/tournament/checkin'),
    '\nreturn { checkRoundAdvance, noChampionReason, seedEventBracket, runInSeedChain, handlers };',
  ].join('\n');
  const names = Object.keys(env);
  const built = new Function(...names, code)(...names.map((n) => env[n]));
  const call = async (route, body) => {
    let code2 = 200, payload = null;
    const res = { status(c) { code2 = c; return res; }, json(o) { payload = o; return res; } };
    await built.handlers[route]({ body: body || {} }, res);
    return { code: code2, body: payload };
  };
  return { ...built, call, TEVENTS, TREGS, TMATCH, TROOMS, TCHAT, TARCHIVE, TCHAMPS,
    setIdent: (o) => { ident = { verified: true, ...o }; }, identity: () => identityCalls, setIdentityGate: (p) => { identityGate = p; } };
}

const lastChat = async (S) => { const rows = await S.TCHAT.find({}).toArray(); return rows.length ? rows[rows.length - 1].text : ''; };
const finalChat = async (S) => { const rows = await S.TCHAT.find({}).toArray(); return rows.filter((r) => r.text.includes('賽事結束')).map((r) => r.text).pop() || ''; };

/** 佈一場「單淘汰、最後一輪」的局面：第 1 輪 matches 由 caller 指定。 */
async function seedFinalRound(S, matches, regs) {
  await S.TEVENTS.insertOne({ _id: 'EV', name: '測試賽', status: 'running', format: 'single-elim', currentRound: 1, rounds: 1, roundCountdownMin: 3 });
  for (const m of matches) await S.TMATCH.insertOne({ _id: 'EV_r1_m' + m.idx, eventId: 'EV', round: 1, status: 'done', bye: false, ...m });
  for (const r of regs || []) await S.TREGS.insertOne({ _id: 'EV__' + r.uid, eventId: 'EV', name: r.uid, ...r });
}

console.log('\n① 完賽公告：措辭必須對應實際成因（行為端 —— 讀聊天室裡真的被貼出來的那句話）');

await T('①-a 雙方皆未進場（doubleNoShow）⇒ 說「未出賽」', async () => {
  const S = makeServer('x');
  await seedFinalRound(S, [{ idx: 0, p1uid: 'a', p2uid: 'b', winnerUid: null, doubleNoShow: true }]);
  await S.checkRoundAdvance('EV');
  const t = await finalChat(S);
  ok(t.includes('未出賽'), '公告應提到「未出賽」，實際：' + t);
  ok(t.includes('無冠軍'), '公告仍要說明無冠軍，實際：' + t);
});

await T('★★★①-b 兩人都棄賽（doubleDrop）⇒ 說「棄賽」，且**不可**說成「未進場」', async () => {
  const S = makeServer('x');
  await seedFinalRound(S, [{ idx: 0, p1uid: 'a', p2uid: 'b', winnerUid: null, doubleDrop: true }],
    [{ uid: 'a', dropped: true }, { uid: 'b', dropped: true }]);
  await S.checkRoundAdvance('EV');
  const t = await finalChat(S);
  ok(t.includes('棄賽'), '公告應提到「棄賽」，實際：' + t);
  ok(!t.includes('未進場'), '⚠ 棄賽情境**不可**寫成「未進場」（v6.188 遺留的失真文案），實際：' + t);
});

await T('★★★①-c 時限平手（draw）⇒ 說「平手」，不可說成未進場', async () => {
  const S = makeServer('x');
  await seedFinalRound(S, [{ idx: 0, p1uid: 'a', p2uid: 'b', winnerUid: null, draw: true, timeLimit: true }]);
  await S.checkRoundAdvance('EV');
  const t = await finalChat(S);
  ok(t.includes('平手'), '公告應提到「平手」，實際：' + t);
  ok(!t.includes('未進場'), '平手不可寫成未進場，實際：' + t);
});

await T('★★★①-d 本輪有勝方、但勝方全部棄賽 ⇒ 說「勝方已棄賽」（這一條連 winners 都不是 0 開始的）', async () => {
  const S = makeServer('x');
  await seedFinalRound(S, [{ idx: 0, p1uid: 'a', p2uid: 'b', winnerUid: 'a', winnerName: 'a' }],
    [{ uid: 'a', dropped: true }]);
  await S.checkRoundAdvance('EV');
  const t = await finalChat(S);
  ok(t.includes('棄賽'), '公告應提到「棄賽」，實際：' + t);
  ok(!t.includes('未進場'), '不可寫成未進場，實際：' + t);
});

await T('①-e 混合成因（一場棄賽、一場未出賽）⇒ 用涵蓋式措辭，不硬挑一種', async () => {
  const S = makeServer('x');
  await seedFinalRound(S, [
    { idx: 0, p1uid: 'a', p2uid: 'b', winnerUid: null, doubleDrop: true },
    { idx: 1, p1uid: 'c', p2uid: 'd', winnerUid: null, doubleNoShow: true },
  ]);
  await S.checkRoundAdvance('EV');
  const t = await finalChat(S);
  ok(t.includes('棄賽') && t.includes('平手') === false ? true : t.includes('棄賽'), '混合時至少要提到棄賽，實際：' + t);
  ok(!/最後一場雙方皆未進場/.test(t), '⚠ 混合成因不可退回舊的單一說法，實際：' + t);
});

await T('①-f 正常有冠軍時，一個字都沒被改到（回歸保護）', async () => {
  const S = makeServer('x');
  await seedFinalRound(S, [{ idx: 0, p1uid: 'a', p2uid: 'b', winnerUid: 'a', winnerName: '阿光' }]);
  await S.checkRoundAdvance('EV');
  const t = await lastChat(S);
  ok(t.includes('冠軍：阿光'), '應正常宣布冠軍，實際：' + t);
  const ev = await S.TEVENTS.findOne({ _id: 'EV' });
  ok(ev.status === 'finished' && ev.championUid === 'a', '賽事應正常結束並記冠軍，實際 ' + JSON.stringify(ev));
});

console.log('\n② /checkin 收進 seed 序列鎖');

await T('②-a 正常報到：200 + checkedIn/clientVer 都寫進去了', async () => {
  const S = makeServer('p1');
  await S.TEVENTS.insertOne({ _id: 'EV', name: 'T', status: 'checkin', format: 'single-elim' });
  await S.TREGS.insertOne({ _id: 'EV__p1', eventId: 'EV', uid: 'p1', name: 'p1', deckEntries: [{ cardId: '1', count: 60 }] });
  const r = await S.call('/api/tournament/checkin', { eventId: 'EV', ver: '6.189' });
  ok(r.code === 200, '應 200，實際 ' + r.code + ' ' + JSON.stringify(r.body));
  const reg = await S.TREGS.findOne({ _id: 'EV__p1' });
  ok(reg.checkedIn === true && reg.clientVer === '6.189', 'reg 應含 checkedIn/clientVer，實際 ' + JSON.stringify(reg));
});

await T('★★★②-b 核心不變式：報到「回 200」⇒ 那個人**一定**出現在第 1 輪賽程（在報到寫入前把 CAS+seed 插進去跑）', async () => {
  const S = makeServer('late');
  await S.TEVENTS.insertOne({ _id: 'EV', name: 'T', status: 'checkin', format: 'single-elim', roundCountdownMin: 3 });
  for (const u of ['a', 'b', 'c']) await S.TREGS.insertOne({ _id: 'EV__' + u, eventId: 'EV', uid: u, name: u, checkedIn: true, deckEntries: [] });
  await S.TREGS.insertOne({ _id: 'EV__late', eventId: 'EV', uid: 'late', name: 'late', deckEntries: [] });

  // 把報到卡在「已確認可以報到、還沒寫入」的瞬間（舊版：status 已讀完；新版：鎖已拿到）。
  let release; const gate = new Promise((r) => { release = r; });
  const realFindOne = S.TREGS.findOne.bind(S.TREGS);
  let hit = 0;
  S.TREGS.findOne = async (q) => { hit++; if (hit === 1) await gate; return realFindOne(q); };

  const pCheckin = S.call('/api/tournament/checkin', { eventId: 'EV', ver: '6.189' });
  await tick(); await tick();

  // 排程器：CAS 關窗 → seed（seed 讀 TREGS 在序列鎖內）
  const pSched = (async () => {
    const c = await S.TEVENTS.updateOne({ _id: 'EV', status: 'checkin' }, { $set: { status: 'bracket_ready' } });
    if (!c || c.matchedCount !== 1) return null;
    return await S.seedEventBracket({ _id: 'EV', name: 'T', format: 'single-elim', roundCountdownMin: 3 }, { checkedInOnly: true, immediateEnter: true });
  })();
  for (let i = 0; i < 12; i++) await tick();   // 舊版：seed 這時已經讀完 regs 了
  release();
  await pSched;
  const r = await pCheckin;
  S.TREGS.findOne = realFindOne;

  const ms = await S.TMATCH.find({ eventId: 'EV', round: 1 }).toArray();
  const inBracket = ms.some((m) => m.p1uid === 'late' || m.p2uid === 'late');
  ok(ms.length > 0, '前提：賽程要真的被產生出來，實際 ' + ms.length + ' 場');
  ok(r.code === 200 ? inBracket : true,
    '⚠⚠ 回了 200 就必須在賽程裡（否則玩家以為報到成功卻沒得玩）。實際 code=' + r.code
    + ' inBracket=' + inBracket + ' 賽程=' + JSON.stringify(ms.map((m) => [m.p1uid, m.p2uid])));
  ok(r.code === 200 || r.code === 409, '只允許「成功」或「明確被拒」兩種結局，實際 ' + r.code + ' ' + JSON.stringify(r.body));
});

await T('★★②-c 報到尖峰：20 人同時按不會卡死，全部都有明確結果，且 200 的人全在賽程裡', async () => {
  const S = makeServer('u0');
  await S.TEVENTS.insertOne({ _id: 'EV', name: 'T', status: 'checkin', format: 'single-elim', roundCountdownMin: 3 });
  const uids = Array.from({ length: 20 }, (_, i) => 'u' + i);
  for (const u of uids) await S.TREGS.insertOne({ _id: 'EV__' + u, eventId: 'EV', uid: u, name: u, deckEntries: [] });
  const results = await Promise.race([
    Promise.all(uids.map((u) => { S.setIdent({ uid: u, email: u + '@t', name: u }); return S.call('/api/tournament/checkin', { eventId: 'EV', ver: '6.189' }); })),
    new Promise((_, rej) => setTimeout(() => rej(new Error('⚠ 20 人同時報到在 8 秒內沒有全部完成 ⇒ 序列鎖把報到卡住了')), 8000)),
  ]);
  ok(results.every((r) => r.code === 200 || r.code === 409), '每個人都要有明確結果，實際 ' + JSON.stringify(results.map((r) => r.code)));
  ok(results.filter((r) => r.code === 200).length === 20, '沒有人被誤拒，實際 200 的有 ' + results.filter((r) => r.code === 200).length + ' 人');
  // 鎖沒有被卡住：後續的 seed 仍然拿得到鎖
  await S.TEVENTS.updateOne({ _id: 'EV', status: 'checkin' }, { $set: { status: 'bracket_ready' } });
  const sr = await Promise.race([
    S.seedEventBracket({ _id: 'EV', name: 'T', format: 'single-elim', roundCountdownMin: 3 }, { checkedInOnly: true, immediateEnter: true }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('⚠⚠ 報到之後 seed 再也拿不到序列鎖 ＝ 鎖被卡死')), 8000)),
  ]);
  ok(sr && sr.ok, 'seed 應成功：' + JSON.stringify(sr));
  const ms = await S.TMATCH.find({ eventId: 'EV', round: 1 }).toArray();
  const seated = new Set(ms.flatMap((m) => [m.p1uid, m.p2uid]).filter(Boolean));
  ok(uids.every((u) => seated.has(u)), '所有回 200 的人都要在賽程裡，缺少 ' + uids.filter((u) => !seated.has(u)).join(','));
});

await T('★★②-d 報到失敗（丟例外）不可以把整條序列鎖卡死 —— 後面的人照樣報得到', async () => {
  const S = makeServer('bad');
  await S.TEVENTS.insertOne({ _id: 'EV', name: 'T', status: 'checkin', format: 'single-elim' });
  await S.TREGS.insertOne({ _id: 'EV__good', eventId: 'EV', uid: 'good', name: 'good', deckEntries: [] });
  const realUpd = S.TREGS.updateOne.bind(S.TREGS);
  let n = 0;
  S.TREGS.updateOne = async (...a) => { n++; if (n === 1) throw new Error('boom'); return realUpd(...a); };
  const r1 = await S.call('/api/tournament/checkin', { eventId: 'EV' });  // uid=bad 沒有 reg，先讓它 409
  S.setIdent({ uid: 'good', email: 'g@t', name: 'good' });
  const r2 = await Promise.race([
    S.call('/api/tournament/checkin', { eventId: 'EV' }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('⚠⚠ 前一筆失敗之後鏈被卡住，後續報到永遠不回應')), 5000)),
  ]);
  S.TREGS.updateOne = realUpd;
  ok(r1.code === 409, '沒報名的人應 409，實際 ' + r1.code);
  ok(r2.code === 200 || r2.code === 500, '後續請求必須有回應（200 或 500 都行，重點是不卡死），實際 ' + r2.code);
});

await T('★★②-e 權杖驗證（tournIdentity）留在鎖外 —— 佔住鎖時它仍然先跑完', async () => {
  const S = makeServer('p1');
  await S.TEVENTS.insertOne({ _id: 'EV', name: 'T', status: 'checkin', format: 'single-elim' });
  await S.TREGS.insertOne({ _id: 'EV__p1', eventId: 'EV', uid: 'p1', name: 'p1', deckEntries: [] });
  let release; const hold = new Promise((r) => { release = r; });
  const held = S.runInSeedChain(() => hold);              // 佔住序列鎖
  const p = S.call('/api/tournament/checkin', { eventId: 'EV' });
  for (let i = 0; i < 6; i++) await tick();
  ok(S.identity() === 1, '⚠ 鎖被佔住時 tournIdentity 仍必須已經跑過（打 Firebase 的那段不可以排隊）');
  release(); await held;
  const r = await p;
  ok(r.code === 200, '鎖放開後報到應完成，實際 ' + r.code);
});

await T('★★②-g 臨界區有上限：掛住不回應的 mongo 不會把後面所有人的報到一起凍死', async () => {
  // ⚠ 只把上限的**數字**由 15000 換成 150（真跑 15 秒不切實際）；race/finally 的接線原封不動。
  const patch = (src) => {
    ok(/CHECKIN_LOCK_CAP_MS = 15000;/.test(src), '端點應有 CHECKIN_LOCK_CAP_MS = 15000（臨界區上限）');
    return src.replace('CHECKIN_LOCK_CAP_MS = 15000;', 'CHECKIN_LOCK_CAP_MS = 150;');
  };
  const S = makeServer('hang', patch);
  await S.TEVENTS.insertOne({ _id: 'EV', name: 'T', status: 'checkin', format: 'single-elim' });
  for (const u of ['hang', 'later']) await S.TREGS.insertOne({ _id: 'EV__' + u, eventId: 'EV', uid: u, name: u, deckEntries: [] });
  const realUpd = S.TREGS.updateOne.bind(S.TREGS);
  let n = 0;
  S.TREGS.updateOne = async (...a) => { n++; if (n === 1) return new Promise(() => {}); return realUpd(...a); };  // 第一筆永遠不 settle
  const r1 = await Promise.race([
    S.call('/api/tournament/checkin', { eventId: 'EV' }),
    new Promise((_, rj) => setTimeout(() => rj(new Error('⚠⚠ 掛住的臨界區沒有上限 ⇒ 這個請求永遠不回應')), 4000)),
  ]);
  ok(r1.code === 500, '掛住時應以錯誤收場（而不是永遠不回應），實際 ' + r1.code + ' ' + JSON.stringify(r1.body));
  ok(!(r1.body && r1.body.ok), '⚠ 絕不可以在寫入未確認的情況下回成功');
  S.setIdent({ uid: 'later', email: 'l@t', name: 'later' });
  const r2 = await Promise.race([
    S.call('/api/tournament/checkin', { eventId: 'EV' }),
    new Promise((_, rj) => setTimeout(() => rj(new Error('⚠⚠ 前一筆掛住之後整條序列鎖被凍結，後面的人永遠報不到')), 4000)),
  ]);
  S.TREGS.updateOne = realUpd;
  ok(r2.code === 200, '後續報到必須照常成功，實際 ' + r2.code + ' ' + JSON.stringify(r2.body));
  const reg = await S.TREGS.findOne({ _id: 'EV__later' });
  ok(reg.checkedIn === true, '後續報到要真的寫進去，實際 ' + JSON.stringify(reg));
});

await T('②-f 結構：/checkin 真的用了 runInSeedChain，且鎖內沒有再呼叫 seedEventBracket（不可重入）', async () => {
  const ci = epSrc('/api/tournament/checkin');
  ok(/runInSeedChain\(/.test(ci), '/checkin 應排進 runInSeedChain');
  ok(!/seedEventBracket\(/.test(ci), '⚠ 鎖內不可呼叫 seedEventBracket（會自己等自己）');
  const chainBody = ci.slice(ci.indexOf('runInSeedChain('));
  ok(!/tournIdentity\(/.test(chainBody), '⚠ tournIdentity 必須留在鎖外');
});

console.log('\n③ admin「留言數對帳」按鈕');

function handlerSrc(name) {
  const head = 'window.' + name + ' = async function';
  const i = AH.indexOf(head);
  ok(i >= 0, 'admin.html 找不到 ' + name);
  const j = AH.indexOf('\n};\n', i);
  ok(j > i, '抓不到 ' + name + ' 的結尾');
  return AH.slice(i, j + 3);
}

await T('★★★③-a 模板層：總覽頁有一顆按鈕呼叫 runDeckPostRecount', async () => {
  ok(/onclick="runDeckPostRecount\(this\)"/.test(AH), 'admin.html 應有 onclick="runDeckPostRecount(this)" 的按鈕');
  ok(/id="dp-recount-result"/.test(AH), '應有顯示結果的容器 dp-recount-result（v6.154 教訓：分頁/按鈕沒有內容容器＝按了沒反應）');
  ok(/class="btn btn-primary"[^>]*onclick="runDeckPostRecount/.test(AH), '應沿用既有的 btn btn-primary 樣式');
});

await T('★★★③-b 行為層：按下去真的 POST 到 /api/admin/deck-posts/recount（不是「有出現這個字串」）', async () => {
  const calls = [];
  const el = { innerHTML: '' };
  const btn = { disabled: false, textContent: '🔢 重算按讚／下載／留言數' };
  const fn = new Function('confirm', 'document', 'api', 'escapeHtml', 'window',
    handlerSrc('runDeckPostRecount') + '\nreturn window.runDeckPostRecount;')(
    () => true,
    { getElementById: (id) => (id === 'dp-recount-result' ? el : null) },
    async (url, opt) => { calls.push({ url, opt }); return { ok: true, checked: 12, fixed: 3 }; },
    (s) => String(s), {});
  await fn(btn);
  ok(calls.length === 1, '應剛好打一次 API，實際 ' + calls.length + ' 次');
  ok(calls[0].url === '/api/admin/deck-posts/recount', 'URL 應為 /api/admin/deck-posts/recount，實際 ' + calls[0].url);
  ok(calls[0].opt && calls[0].opt.method === 'POST', '應為 POST，實際 ' + JSON.stringify(calls[0].opt));
  ok(calls[0].opt.headers && calls[0].opt.headers['Content-Type'] === 'application/json',
    '⚠ 必須帶 Content-Type: application/json（v1.02 事故：漏帶會讓 express.json() 不解析 body）');
  ok(/12/.test(el.innerHTML) && /3/.test(el.innerHTML), '結果應顯示 checked/fixed，實際 ' + el.innerHTML);
  ok(btn.disabled === false, '跑完要把按鈕放開，實際 disabled=' + btn.disabled);
});

await T('③-c 取消確認 ⇒ 一個 API 都不打', async () => {
  const calls = [];
  const fn = new Function('confirm', 'document', 'api', 'escapeHtml', 'window',
    handlerSrc('runDeckPostRecount') + '\nreturn window.runDeckPostRecount;')(
    () => false, { getElementById: () => null },
    async (url) => { calls.push(url); return {}; }, (s) => String(s), {});
  await fn({ disabled: false, textContent: 'x' });
  ok(calls.length === 0, '按取消不可以送出請求，實際 ' + calls.length + ' 次');
});

await T('★★③-d 失敗要看得出來（api() 從不 reject ⇒ 只能看 error 欄）', async () => {
  const el = { innerHTML: '' };
  const btn = { disabled: false, textContent: 'x' };
  const fn = new Function('confirm', 'document', 'api', 'escapeHtml', 'window',
    handlerSrc('runDeckPostRecount') + '\nreturn window.runDeckPostRecount;')(
    () => true, { getElementById: () => el },
    async () => ({ error: '需要管理員權限' }), (s) => String(s), {});
  await fn(btn);
  ok(/需要管理員權限/.test(el.innerHTML), '應把錯誤顯示出來，實際 ' + el.innerHTML);
  ok(btn.disabled === false, '失敗後也要把按鈕放開（否則按一次就永遠不能再按）');
});

await T('③-e 後端端點存在（按鈕不可以接到不存在的路徑）', async () => {
  ok(P.includes("app.post('/api/admin/deck-posts/recount'"), 'server_admin_patch.js 應註冊 /api/admin/deck-posts/recount');
});

console.log('\n' + (fail === 0 ? '✅ 全部通過' : '❌ 有失敗') + `（PASS ${pass} / FAIL ${fail}）`);
process.exit(fail === 0 ? 0 : 1);
