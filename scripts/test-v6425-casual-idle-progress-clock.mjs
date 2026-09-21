/**
 * v6.425 守衛：休閒閒置判負改用「盤面進度時鐘」（server_admin_patch.js v1.47）
 *
 * 玩家回報（房號 EU3Y）：對手不動很久了，卻沒有跳結束。
 * admin 診斷的 gameState 實錄：YT 最後一個動作 18:45:32，盤面之後完全沒變，諺爸 等到 18:56:50
 * 自己離開 ⇒ 閒置 11 分 18 秒（門檻上限 5 分 15 秒），伺服器從沒判；同時段 pm2 log 裡其他房照常被判。
 *
 * v1.03 舊掃描的三個結構性盲點（本檔各用一個情境釘住，並在**同一份檔案還原出的 v1.46 舊碼**上證明會紅）：
 *   S1 閒置時鐘＝updatedAt，而「沒有進度的 PUT」（client oracleTx 盤面沒變也照送）會把它蓋成現在。
 *   S4 `updatedAt < now-60s` + `.limit(200)` 沒排序：走 {status, updatedAt:-1} 索引時最久沒動的排在名額外。
 *   S5 重入鎖沒有逾時：一輪查詢卡死 ⇒ 之後永遠不再判。
 * 另外釘住安全面（S2／S6／S7）：有真實動作的人**絕不能**被判負；競態寫入不能被蓋掉；-1／null 不判。
 *
 * 做法：把 server_admin_patch.js 裡**真正的** IIFE 與 currentActorSeat 抽出來，餵一個假的 Mongo
 * （只實作本段用到的 find/findOne/updateOne 語意），用假時鐘一 tick 一 tick 地跑。
 * ⚠ S4 的「索引回傳順序＝updatedAt 由新到舊」是**對 Mongo 行為的建模**（repo 內確有
 *   createIndex({ status: 1, updatedAt: -1 })），不是線上實測；它只用來證明新版不再依賴任何回傳順序。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import assert from 'node:assert';
import { revertCasualIdleV147 } from './lib/sap-revert-casual-idle-v147.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CUR = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8').replace(/\r\n/g, '\n');
// 同一份檔案還原出的 v1.46（history-free 的 HEAD-FAIL 對照組）。
// ⚠ Rule 41：在 BASE 上沒有 v147 哨兵 ⇒ 不整支 throw，改拿 CUR 當 OLD，讓每一條各自誠實翻紅。
const HAS_V147 = CUR.includes('// >>> v147-casual-idle-progress');
const OLD = HAS_V147 ? revertCasualIdleV147(CUR) : CUR;

let pass = 0, fail = 0;
const T = async (n, f) => {
  try { await f(); console.log('  ✓', n); pass++; }
  catch (e) { console.log('  ✗', n, '→', (e && e.message) || e); fail++; }
};

// ── 抽函式（brace-match；字串內的大括號在本段不存在，另以下限斷言防呆）──────────────
function braceEnd(src, from) {
  let i = src.indexOf('{', from), d = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') d++;
    else if (src[i] === '}') { d--; if (d === 0) return i + 1; }
  }
  return -1;
}
function fnSrc(src, name) {
  const s = src.indexOf('function ' + name + '(');
  if (s < 0) return null;
  return src.slice(s, braceEnd(src, s));
}
function iifeSrc(src) {
  const s = src.indexOf('(function startCasualIdleForfeit() {');
  assert.ok(s >= 0, '找不到 (function startCasualIdleForfeit() {');
  const e = braceEnd(src, s);
  const tail = src.slice(e, e + 4);
  assert.strictEqual(tail, ')();', 'IIFE 結尾不是 })();（brace-match 失準）');
  const out = src.slice(s, e + 4);
  assert.ok(out.length > 1500, 'IIFE 只抽到 ' + out.length + ' 字元（掃描器壞了？）');
  return out;
}

// ── 假 Mongo ───────────────────────────────────────────────────────────────────
const clone = (x) => JSON.parse(JSON.stringify(x));
function matchOne(doc, f) {
  for (const [k, v] of Object.entries(f)) {
    const dv = doc[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$lt' in v && !(typeof dv === 'number' && dv < v.$lt)) return false;
      if ('$gte' in v && !(typeof dv === 'number' && dv >= v.$gte)) return false;
      if ('$in' in v && !v.$in.includes(dv)) return false;
    } else if (dv !== v) return false;
  }
  return true;
}
function makeDb(clock) {
  const rooms = new Map();
  const hooks = { hangNextFind: false, beforeFindOne: null, finds: 0 };
  const col = {
    find(filter) {
      const cur = { _lim: Infinity,
        limit(n) { this._lim = n; return this; },
        sort() { return this; },
        toArray: async () => {
          hooks.finds++;
          if (hooks.hangNextFind) { hooks.hangNextFind = false; return new Promise(() => {}); }
          let docs = [...rooms.values()].filter((d) => matchOne(d, filter));
          // 建模：帶 status + updatedAt 條件時走 {status:1, updatedAt:-1} 索引 ⇒ 由新到舊
          if (filter.status !== undefined && filter.updatedAt !== undefined) docs.sort((a, b) => b.updatedAt - a.updatedAt);
          return docs.slice(0, cur._lim).map(clone);
        } };
      return cur;
    },
    async findOne(filter) {
      if (hooks.beforeFindOne) { const h = hooks.beforeFindOne; hooks.beforeFindOne = null; h(); }
      const d = [...rooms.values()].find((x) => matchOne(x, filter));
      return d ? clone(d) : null;
    },
    async updateOne(filter, upd) {
      const d = [...rooms.values()].find((x) => matchOne(x, filter));
      if (!d) return { matchedCount: 0, modifiedCount: 0 };
      Object.assign(d, clone(upd.$set));
      return { matchedCount: 1, modifiedCount: 1 };
    },
  };
  // 模擬 server.js 的 PUT：無條件 bump _version 與 updatedAt（這正是盲點 ①）
  const put = (id, gs) => {
    const d = rooms.get(id);
    d.gameState = clone(gs); d._version += 1; d.updatedAt = clock.t;
  };
  const add = (id, gs, extra = {}) => rooms.set(id, { _id: id, status: 'playing', _version: 1, updatedAt: clock.t, idleTimeoutSec: 180, gameState: clone(gs), ...extra });
  return { db: { collection: () => col }, rooms, put, add, hooks };
}

// ── 把抽出來的 IIFE 跑起來 ────────────────────────────────────────────────────────
const flush = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };
async function boot(src, env) {
  const helpers = ['casualIdleFingerprint', 'casualIdleTrack', 'casualIdleDue'].map((n) => fnSrc(src, n)).filter(Boolean).join('\n');
  const body = fnSrc(src, 'currentActorSeat') + '\n' + helpers + '\n' + iifeSrc(src);
  let startCb = null, sweep = null;
  const quiet = { log: (m) => { if (env.logs) env.logs.push(String(m)); }, warn: (m) => { if (env.logs) env.logs.push(String(m)); } };
  new Function('db', 'Date', 'setTimeout', 'setInterval', 'console', body)(
    env.db, { now: () => env.clock.t }, (cb) => { startCb = cb; }, (fn) => { sweep = fn; }, quiet);
  assert.ok(startCb, 'IIFE 沒有排啟動 setTimeout');
  startCb();                       // 第一輪（此時房間還沒建，空跑）＋登記 setInterval
  await flush();
  assert.ok(sweep, 'IIFE 沒有登記 setInterval');
  return async () => { sweep(); await flush(); };
}

// ── 盤面 ───────────────────────────────────────────────────────────────────────
const inst = (id) => ({ iid: id, cardId: '19181', damage: 0, energyAttached: [] });
const playingGs = (over = {}) => ({
  id: 'g1', phase: 'playing', turn: 1, turnPhase: 'main', activePlayerIndex: 0,
  pendingPrizes: [0, 0], setupDone: [true, true],
  players: [{ name: 'YT', active: inst('a0'), bench: [inst('b0')], hand: [], deck: [], discard: [] },
            { name: '諺爸', active: inst('a1'), bench: [], hand: [], deck: [], discard: [] }],
  log: [{ turn: 1, playerIndex: 0, message: '放到備戰區：破破舵輪、破破舵輪' }],
  _clientVerP0: '6.421', _clientVerP1: '6.421',
  ...over,
});

// 情境執行器：每 30 秒一 tick，dur 秒；every(t) 在每個 tick 前可做事。回傳判負時間（秒）或 null。
async function scenario(src, { dur, setup, every }) {
  const clock = { t: 1_000_000 };
  const env = makeDb(clock);
  env.clock = clock;
  env.logs = [];
  const tick = await boot(src, env);
  const t0 = clock.t;
  setup(env);
  for (let s = 0; s <= dur; s += 30) {
    clock.t = t0 + s * 1000;
    if (every) every(env, s);
    await tick();
    const d = env.rooms.get('EU3Y');
    if (d && d.status === 'ended') return { at: s, doc: d, env };
  }
  return { at: null, doc: env.rooms.get('EU3Y'), env };
}

// ════════════════════════════════════════════════════════════════════════════
console.log('① 抽取與下限');
await T('v1.47 哨兵在（BASE 上這一條必紅）', () => { assert.ok(HAS_V147, '找不到 // >>> v147-casual-idle-progress'); });
await T('新舊兩份都抽得出 IIFE 與 currentActorSeat；新版三支純函式都在、舊版一支都不在', () => {
  iifeSrc(CUR); iifeSrc(OLD);
  assert.ok(fnSrc(CUR, 'currentActorSeat') && fnSrc(OLD, 'currentActorSeat'));
  for (const n of ['casualIdleFingerprint', 'casualIdleTrack', 'casualIdleDue']) {
    assert.ok(fnSrc(CUR, n), '新版缺 ' + n);
    assert.ok(!fnSrc(OLD, n), '還原器沒還原乾淨：舊版仍有 ' + n);
  }
});

console.log('② S1 EU3Y 實錄：盤面不動，但等待方每 60 秒送一發「沒有進度的 PUT」');
const S1 = {
  dur: 12 * 60,
  setup: (env) => env.add('EU3Y', playingGs()),
  every: (env, s) => { if (s > 0 && s % 60 === 0 && env.rooms.get('EU3Y').status === 'playing') env.put('EU3Y', env.rooms.get('EU3Y').gameState); },
};
await T('⭐ 新版：門檻 180s＋15s 緩衝後的第一個 tick 判 YT 敗（≤ 240 秒）', async () => {
  const r = await scenario(CUR, S1);
  assert.ok(r.at !== null, '12 分鐘都沒判 —— 沒有進度的 PUT 仍在歸零閒置時鐘');
  assert.ok(r.at >= 195 && r.at <= 240, '判負時間 ' + r.at + ' 秒不在 (195, 240]');
  const g = r.doc.gameState;
  assert.strictEqual(g.phase, 'game-over'); assert.strictEqual(g.winner, 1);
  assert.strictEqual(g.log[g.log.length - 1].message, '⏰ YT 閒置逾 3 分鐘無動作，諺爸 獲勝');
  assert.strictEqual(r.doc.status, 'ended');
});
await T('HEAD-FAIL 對照：還原出的 v1.46 舊碼 12 分鐘都判不到（＝玩家回報的症狀）', async () => {
  const r = await scenario(OLD, S1);
  assert.strictEqual(r.at, null, '舊碼竟然判到了 ⇒ 本情境沒有重現 bug，S1 是安慰劑');
});

console.log('③ S2 安全面：有真實動作的人絕不能被判負');
await T('⭐ 每 150 秒動一步（門檻 180）連續 15 分鐘 ⇒ 新版一次都不判', async () => {
  let n = 1;
  const r = await scenario(CUR, {
    dur: 15 * 60,
    setup: (env) => env.add('EU3Y', playingGs()),
    every: (env, s) => {
      if (s > 0 && s % 150 === 0) {
        const g = clone(env.rooms.get('EU3Y').gameState);
        g.log.push({ turn: 1, playerIndex: 0, message: 'move ' + (n++) });
        env.put('EU3Y', g);
      }
      if (s > 0 && s % 60 === 0) env.put('EU3Y', env.rooms.get('EU3Y').gameState);   // 夾雜沒有進度的 PUT
    },
  });
  assert.strictEqual(r.at, null, '正在動作的玩家在 ' + r.at + ' 秒被判負了');
});
await T('只改盤面某一格（沒有新 log）也算進度 ⇒ 不判', async () => {
  const r = await scenario(CUR, {
    dur: 10 * 60,
    setup: (env) => env.add('EU3Y', playingGs()),
    every: (env, s) => {
      if (s > 0 && s % 120 === 0) {
        const g = clone(env.rooms.get('EU3Y').gameState);
        g.players[0].bench.push(inst('x' + s));
        env.put('EU3Y', g);
      }
    },
  });
  assert.strictEqual(r.at, null, '盤面有變卻在 ' + r.at + ' 秒被判負');
});

console.log('④ S3 只改中繼欄位（版本戳記）不算進度');
await T('⭐ 每 60 秒只改 _clientVerP1 ⇒ 新版仍在門檻後判負', async () => {
  const r = await scenario(CUR, {
    dur: 10 * 60,
    setup: (env) => env.add('EU3Y', playingGs()),
    every: (env, s) => {
      if (s > 0 && s % 60 === 0 && env.rooms.get('EU3Y').status === 'playing') {
        const g = clone(env.rooms.get('EU3Y').gameState); g._clientVerP1 = '6.' + (400 + s); env.put('EU3Y', g);
      }
    },
  });
  assert.ok(r.at !== null && r.at <= 240, '版本戳記被當成進度（' + r.at + '）');
});

console.log('⑤ S4 大量「判不出來」的房塞滿名額');
const S4 = {
  dur: 6 * 60,
  setup: (env) => {
    env.add('EU3Y', playingGs(), { updatedAt: 1_000_000 - 600_000 });   // 已閒置 10 分鐘
    for (let i = 0; i < 250; i++) {                                         // 雙方都還沒放場的 setup 房（actor = -1）
      env.add('Z' + i, { phase: 'setup', setupDone: [false, false], mulliganCounts: [0, 0], players: [{}, {}], log: [] },
        { updatedAt: 1_000_000 - 120_000 - i });
    }
  },
};
await T('⭐ 新版：名額與回傳順序無關，第一個 tick 就判到 EU3Y', async () => {
  const r = await scenario(CUR, S4);
  assert.strictEqual(r.at, 0, '判負時間 ' + r.at);
});
await T('HEAD-FAIL 對照：v1.46 舊碼（limit 200、由新到舊）永遠輪不到 EU3Y', async () => {
  const r = await scenario(OLD, S4);
  assert.strictEqual(r.at, null, '舊碼竟然判到了 ⇒ S4 沒重現名額問題');
});
await T('-1 的房一間都沒被判（新版）', async () => {
  const r = await scenario(CUR, S4);
  const ended = [...r.env.rooms.values()].filter((d) => d._id !== 'EU3Y' && d.status === 'ended');
  assert.strictEqual(ended.length, 0);
});

console.log('⑥ S5 某一輪查詢卡死');
const S5 = {
  dur: 12 * 60,
  setup: (env) => { env.add('EU3Y', playingGs()); env.hooks.hangNextFind = true; },
};
await T('⭐ 新版：5 分鐘後解除重入鎖，之後照常判負', async () => {
  const r = await scenario(CUR, S5);
  assert.ok(r.at !== null, '卡死的一輪永久封鎖了判負');
  assert.ok(r.at >= 300 && r.at <= 360, '判負時間 ' + r.at);
});
await T('HEAD-FAIL 對照：v1.46 舊碼從此不再判任何人', async () => {
  const r = await scenario(OLD, S5);
  assert.strictEqual(r.at, null, '舊碼竟然判到了 ⇒ S5 沒重現卡鎖');
});

console.log('⑦ S6 判負前一刻對手剛好動作（競態）');
await T('⭐ 最後一次讀房前插入一個真實動作 ⇒ 不判；之後重新計時', async () => {
  let raced = false;
  const r = await scenario(CUR, {
    dur: 240,
    setup: (env) => env.add('EU3Y', playingGs()),
    every: (env, s) => {
      if (s === 210 && !raced) {
        raced = true;
        env.hooks.beforeFindOne = () => {
          const g = clone(env.rooms.get('EU3Y').gameState); g.log.push({ turn: 1, playerIndex: 0, message: '剛好動了' }); env.put('EU3Y', g);
        };
      }
    },
  });
  assert.ok(raced, '情境沒有觸發');
  assert.strictEqual(r.at, null, '競態寫入被蓋掉，在 ' + r.at + ' 秒判負');
  assert.strictEqual(r.doc.gameState.log[r.doc.gameState.log.length - 1].message, '剛好動了');
});

console.log('⑧ S7 不判的情形');
await T('雙方都該動作（-1）／已 game-over 的房不判', async () => {
  const r1 = await scenario(CUR, { dur: 600, setup: (env) => env.add('EU3Y', { phase: 'setup', setupDone: [false, false], mulliganCounts: [0, 0], players: [{}, {}], log: [] }) });
  assert.strictEqual(r1.at, null);
  const r2 = await scenario(CUR, { dur: 600, setup: (env) => env.add('EU3Y', playingGs({ phase: 'game-over', winner: 0 })) });
  assert.strictEqual(r2.at, null);
  assert.strictEqual(r2.doc.status, 'playing', 'game-over 的房被改寫了');
});
await T('房主門檻 60 秒 ⇒ 75 秒後的第一個 tick（90 秒）判負', async () => {
  const r = await scenario(CUR, { dur: 300, setup: (env) => env.add('EU3Y', playingGs(), { idleTimeoutSec: 60 }) });
  assert.strictEqual(r.at, 90);
});

console.log('⑧b updatedAt 缺席／可觀測性（fable 審查補強）');
const S8 = { dur: 300, setup: (env) => { env.add('EU3Y', playingGs()); delete env.rooms.get('EU3Y').updatedAt; } };
await T('⭐ updatedAt 缺席 ⇒ 從第一次看到起算（195 秒後的 tick 才判），絕不「一看到就判」', async () => {
  const r = await scenario(CUR, S8);
  assert.ok(r.at !== null && r.at >= 210, '判負時間 ' + r.at + '（updatedAt 缺席被當成 0 ⇒ 立刻判）');
});
await T('每 20 輪印一行統計（rooms／changed／due／judged／casMiss／lockSkip）', async () => {
  const r = await scenario(CUR, { dur: 20 * 30, setup: (env) => env.add('EU3Y', playingGs({ phase: 'game-over', winner: 0 })) });
  const st = r.env.logs.filter((l) => l.includes('[casual-idle] stat rooms='));
  assert.ok(st.length >= 1, '沒有統計行：' + JSON.stringify(r.env.logs.slice(-3)));
  assert.ok(/judged=\d+ casMiss=\d+ lockSkip=\d+/.test(st[0]), st[0]);
});

console.log('⑨ 突變（每個都必須紅在預期那一條）');
const mut = (src, from, to) => { assert.strictEqual(src.split(from).length - 1, 1, '突變錨點命中次數 ≠ 1：' + from); return src.split(from).join(to); };
await T('M1 「沒有進度的 PUT」也歸零 ⇒ S1 紅', async () => {
  const m = mut(CUR, 'return { ver: cur.ver, fp: cur.fp, progressAt: prev.progressAt };', 'return { ver: cur.ver, fp: cur.fp, progressAt: Number(cur.updatedAt) || 0 };');
  assert.strictEqual((await scenario(m, S1)).at, null, '突變存活');
});
await T('M2 拿掉重入鎖逾時 ⇒ S5 紅', async () => {
  const m = mut(CUR, 'if (runningSince && startedAt - runningSince < STALE_LOCK_MS) { statLockSkip++; return; }', 'if (runningSince) { statLockSkip++; return; }');
  assert.strictEqual((await scenario(m, S5)).at, null, '突變存活');
});
await T('M3 指紋把版本戳記算進去 ⇒ S3 紅', async () => {
  const m = mut(CUR, "if (k === 'log' || k === '_clientVerP0' || k === '_clientVerP1') continue;", "if (k === 'log') continue;");
  const r = await scenario(m, {
    dur: 10 * 60, setup: (env) => env.add('EU3Y', playingGs()),
    every: (env, s) => { if (s > 0 && s % 60 === 0 && env.rooms.get('EU3Y').status === 'playing') { const g = clone(env.rooms.get('EU3Y').gameState); g._clientVerP1 = '6.' + (400 + s); env.put('EU3Y', g); } },
  });
  assert.strictEqual(r.at, null, '突變存活');
});
await T('M4 判負前不再複驗版本／指紋、寫入不帶版本鎖 ⇒ S6 紅', async () => {
  let m = mut(CUR, "if (!room || room.status !== 'playing' || room._version !== ent.ver) continue;", "if (!room || room.status !== 'playing') continue;");
  m = mut(m, 'if (casualIdleFingerprint(gs) !== ent.fp) continue;', '');
  m = mut(m, "{ _id: r._id, _version: ent.ver, status: 'playing' },", "{ _id: r._id, status: 'playing' },");
  let raced = false;
  const r = await scenario(m, {
    dur: 240, setup: (env) => env.add('EU3Y', playingGs()),
    every: (env, s) => { if (s === 210 && !raced) { raced = true; env.hooks.beforeFindOne = () => { const g = clone(env.rooms.get('EU3Y').gameState); g.log.push({ turn: 1, playerIndex: 0, message: '剛好動了' }); env.put('EU3Y', g); }; } },
  });
  assert.ok(r.at !== null, '突變存活（競態寫入仍被保住）');
});
await T('M6 updatedAt 缺席時退回 0 ⇒ ⑧b 紅', async () => {
  const m = mut(CUR, "isFinite(cur.updatedAt)) ? cur.updatedAt : now;", "isFinite(cur.updatedAt)) ? cur.updatedAt : 0;");
  const r = await scenario(m, S8);
  assert.ok(r.at !== null && r.at < 210, '突變存活（判負時間 ' + r.at + '）');
});
await T('正對照：v1.46 舊碼只把名額放大到 5000 ⇒ S4 就判得到（證明 S4 的紅確實來自名額＋順序）', async () => {
  // 正對照：證明 S4 的舊碼紅是「名額＋順序」造成，而不是 fake 的其他差異
  const m = mut(OLD, ").limit(200).toArray();\n          for (const room of rooms) {", ").limit(5000).toArray();\n          for (const room of rooms) {");
  assert.strictEqual((await scenario(m, S4)).at, 0, '舊碼放大名額後仍判不到 ⇒ S4 的紅另有原因');
});

console.log(`\n=== v6.425 休閒閒置判負：盤面進度時鐘 PASS ${pass} / FAIL ${fail} ===`);
if (fail > 0) process.exit(1);
