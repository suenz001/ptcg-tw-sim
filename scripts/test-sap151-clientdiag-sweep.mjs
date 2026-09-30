#!/usr/bin/env node
/**
 * server patch v1.51 守衛：tournamentClientDiag 真正的 7 天保留
 *
 * 事實：錦標賽區塊的 `TCDIAG.createIndex({ ts: 1 }, { expireAfterSeconds: 604800 })` 從來沒刪過任何一筆——
 *   MongoDB TTL 只認 BSON Date，而寫入端存 `ts: Date.now()`（數字）⇒ 表只增不減（v6.287 查證時記下、另案待修）。
 * 修法：錦標賽區塊**外**（零把 sha 鎖要動）新增哨兵區塊 v6459-clientdiag-sweep：每小時分批刪 ts 早於 7 天前的列。
 *
 * 【A】靜態：哨兵區塊存在、放在 TAIL_ANCHOR 之前（不動錦標賽區塊）、寫入端仍是數字 ts（前提仍成立）
 * 【B】行為：抽出哨兵區塊，餵假 db／app／計時器實跑
 *   B1 只刪 7 天前的、7 天內的一筆不動（邊界兩側各一筆）
 *   B2 分批：每批 ≤ 2000、批間有讓路（用假 setTimeout 記錄）
 *   B3 同時只跑一輪（in-flight 旗標）
 *   B4 mongo 丟錯 ⇒ 只 warn、不 throw、旗標會釋放（下一輪還能跑）
 *   B5 計時器：啟動 60 秒後一次、之後每小時；兩個都 unref（不擋 process 結束）
 * 【C】全檔 TTL 索引型別審查：除了 TCDIAG 之外，每一支 expireAfterSeconds 都掛在 expireAt（Date）上
 * 【D】HEAD-FAIL：v6.458 沒有這個區塊
 *
 * Run: node scripts/test-sap151-clientdiag-sweep.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REL = 'oracle-admin/server_admin_patch.js';
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.458。
const BASE_SHA = 'eb493b80f35dac2e7058c2ac5f6e88f72822ee1e';
const SRC = readFileSync(join(ROOT, REL), 'utf8').replace(/\r\n/g, '\n');
const TAIL_ANCHOR = "app.get('/api/tournament";

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

function sentinel(src) {
  const a = src.indexOf('    // >>> v6459-clientdiag-sweep\n'); const b = src.indexOf('    // <<< v6459-clientdiag-sweep\n');
  return a >= 0 && b > a ? src.slice(a, b) : '';
}
const BLOCK = sentinel(SRC);

console.log('【A】靜態');
ok('[前提] 抽得到哨兵區塊（長度正常）', BLOCK.length > 1500, 'len=' + BLOCK.length);
ok('★★★[A1] 區塊在錦標賽區塊（TAIL_ANCHOR）之前 ⇒ 28 把 sha 鎖一把都不用動', BLOCK && SRC.indexOf(BLOCK) < SRC.indexOf(TAIL_ANCHOR));
ok('★★[A2] 前提仍成立：寫入端存的是數字 ts（Date.now()），所以 TTL 索引真的無效', /const uid = _id\.uid, now = Date\.now\(\);/.test(SRC) && /await TCDIAG\.insertOne\(\{ ts: now,/.test(SRC));
ok('★★[A3] 讀取端上限都是 168 小時（刪 7 天前的列不改變任何報表）',
  /Math\.min\(168, Number\(req\.query\.hours\) \|\| 24\)/.test(SRC) && /Math\.min\(168, Math\.round\(h\)\)/.test(readFileSync(join(ROOT, 'oracle-admin/tournament/dump-client-monitor.cjs'), 'utf8')));

console.log('\n【B】行為（實跑哨兵區塊）');
const DAY = 24 * 3600 * 1000, NOW = 1_800_000_000_000;
function harness({ rows, failOn = null }) {
  const data = rows.map((r) => ({ ...r }));
  const log = { finds: [], deletes: [], timeouts: [], intervals: [], warns: [], unref: 0 };
  const coll = {
    find(filter, opt) {
      let lim = Infinity;
      return {
        limit(n) { lim = n; return this; },
        async toArray() {
          if (failOn === 'find') throw new Error('模擬 mongo 錯誤');
          log.finds.push({ filter, opt, lim });
          return data.filter((d) => d.ts < filter.ts.$lt).slice(0, lim).map((d) => (opt && opt.projection ? { _id: d._id } : d));
        },
      };
    },
    async deleteMany(f) {
      const set = new Set(f._id.$in); log.deletes.push(f._id.$in.length);
      let n = 0; for (let i = data.length - 1; i >= 0; i--) if (set.has(data[i]._id)) { data.splice(i, 1); n++; }
      return { deletedCount: n };
    },
  };
  const db = { collection: (name) => { if (name !== 'tournamentClientDiag') throw new Error('錯的表 ' + name); return coll; } };
  const app = {};
  const mkT = (arr) => (fn, ms) => { arr.push(ms); if (arr === log.timeouts && ms === 200) Promise.resolve().then(fn); return { unref() { log.unref++; } }; };
  const fakeDate = { now: () => NOW };
  const cons = { log() {}, warn: (...a) => log.warns.push(a.join(' ')) };
  new Function('db', 'app', 'setTimeout', 'setInterval', 'Date', 'console', BLOCK)(db, app, mkT(log.timeouts), mkT(log.intervals), fakeDate, cons);
  return { data, log, sweep: app.locals && app.locals._clientDiagSweep };
}
{
  const rows = [];
  for (let i = 0; i < 4500; i++) rows.push({ _id: 'o' + i, ts: NOW - 30 * DAY + i });
  rows.push({ _id: 'edge-old', ts: NOW - 7 * DAY - 1 }, { _id: 'edge-new', ts: NOW - 7 * DAY + 1 });
  for (let i = 0; i < 50; i++) rows.push({ _id: 'n' + i, ts: NOW - DAY });
  const h = harness({ rows });
  ok('[前提] 區塊把清掃函式掛上 app.locals（守衛與手動觸發用）', typeof h.sweep === 'function');
  await h.sweep();
  const left = h.data.map((d) => d._id);
  ok('★★★[B1] 7 天前的全部刪掉、7 天內的一筆不動（含邊界兩側）', h.data.length === 51 && left.includes('edge-new') && !left.includes('edge-old') && !left.some((x) => x.startsWith('o')), 'left=' + h.data.length);
  ok('★★[B2] 分批：每批 ≤ 2000、共 3 批、批間讓路 200ms、查詢只取 _id', h.log.deletes.length === 3 && Math.max(...h.log.deletes) <= 2000 && h.log.timeouts.filter((t) => t === 200).length >= 2
    && h.log.finds.every((f) => f.opt && f.opt.projection && f.opt.projection._id === 1), JSON.stringify({ d: h.log.deletes, t: h.log.timeouts }));
  ok('★★[B5] 計時器：啟動 60 秒後一次、之後每小時；兩個都 unref', h.log.timeouts[0] === 60000 && h.log.intervals.length === 1 && h.log.intervals[0] === 3600000 && h.log.unref >= 2, JSON.stringify(h.log));
}
{
  const rows = []; for (let i = 0; i < 3000; i++) rows.push({ _id: 'o' + i, ts: NOW - 10 * DAY });
  const h = harness({ rows });
  const p1 = h.sweep(); const p2 = h.sweep(); await Promise.all([p1, p2]);
  ok('★★[B3] 同時只跑一輪（第二次呼叫在第一輪結束前直接返回）', h.log.deletes.length === 2 && h.data.length === 0, JSON.stringify(h.log.deletes));
}
{
  const h = harness({ rows: [{ _id: 'x', ts: 0 }], failOn: 'find' });
  let threw = false; try { await h.sweep(); } catch { threw = true; }
  ok('★★[B4] mongo 丟錯 ⇒ 只 warn、不 throw', !threw && h.log.warns.length === 1, JSON.stringify(h.log.warns));
  let threw2 = false; try { await h.sweep(); } catch { threw2 = true; }
  ok('★[B4] 旗標會釋放（下一輪還會再試，而不是永遠卡住）', !threw2 && h.log.warns.length === 2);
}

console.log('\n【C】全檔 TTL 索引型別審查');
{
  const CODE = SRC.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');   // 只看程式，不看整行註解
  const ttl = [...CODE.matchAll(/createIndex\(\{ (\w+): 1 \}, \{ expireAfterSeconds: (\d+) \}\)/g)].map((m) => m[1]);
  const bad = ttl.filter((f) => f !== 'expireAt');
  ok('★★[C1] 除了 TCDIAG 的 ts（已由本版清掃取代）之外，每一支 TTL 索引都掛在 expireAt（Date）上', ttl.length >= 3 && bad.length === 1 && bad[0] === 'ts', JSON.stringify(ttl));
  const writes = [...CODE.matchAll(/expireAt: ([^,}\n]+)/g)].map((m) => m[1].trim()).filter((v) => !/^1$/.test(v) && !/instanceof Date/.test(v));
  ok('★[C2] 寫 expireAt 的地方都是 new Date(...)', writes.length >= 2 && writes.every((v) => /^new Date\(/.test(v)), JSON.stringify(writes));
}

console.log('\n【D】HEAD-FAIL');
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('v6459 HEAD-FAIL', '需要 v6.458 commit');
else {
  const r = readBaseBlob(ROOT, BASE_SHA, REL);
  ok('★★★[HEAD-FAIL] v6.458 沒有清掃區塊', r.ok && !sentinel(r.out.replace(/\r\n/g, '\n')) && !r.out.includes('_clientDiagSweep'));
}

console.log(`\n=== server patch v1.51 clientdiag 清掃: ${pass} PASS / ${fail} FAIL ===`);
console.log('=== SCRIPT-END sap151-clientdiag-sweep ===');
process.exit(fail ? 1 : 0);
