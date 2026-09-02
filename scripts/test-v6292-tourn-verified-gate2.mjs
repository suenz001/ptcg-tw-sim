#!/usr/bin/env node
// ⭐⭐⭐ v6.292 守衛：把 v6.291 的 verified 閘補到**同型的其他六支端點**
//   （/drop、/unregister、/cancel-proposal、/chat、/match/enter、/match/forfeit）
//
// 【漏洞（與 v6.291 完全同型）】`tournIdentity` 在沒有 Bearer token 時退回 `req.body.playerId`
//   並回 `verified:false`。玩家 uid 由 `/api/tournament/bracket` **公開回傳** ⇒ 抄一個 uid 就能：
//   ・`/drop` **讓別人棄賽**，而且**棄賽不可逆**（v6.188 明講「本檔刻意沒有任何取消棄賽端點」）
//   ・`/unregister` 刪掉別人的報名
//   ・`/cancel-proposal` 取消別人發起的社群賽 —— ⚠ v6.291 的紀錄把它判成「已被
//     `ev.proposerUid !== id.uid` 大幅限縮」，**那是判錯了**：playerId fallback 正是拿來
//     冒充發起者 uid 的，那道檢查一點都擋不住。
//   ・`/chat` 冒名發言（暱稱取自受害者的報名暱稱）＋吃掉他 1.2 秒的限流
//   ・`/match/enter` 替別人進場（建房、`status→playing`、寫 `gameStartedAt` ＝ 把別人的對局時鐘提前轉開）
//   ・`/match/forfeit` 替別人投降 ⇒ 即時判負
//
// 【⚠⚠⚠ 比漏洞更高的裁定】站長 v6.160：「本站是練習站，**可用性優先於版本一致性，寧可放一個
//   舊 client 進來也不要把人擋在賽外**」⇒ 這道閘擋到真玩家比漏洞本身更慘。
//   ⇒ 本檔最重要的一條不是 C1（擋得住冒名），而是 **C2（真玩家六支都照常成功）** 與
//     **E（client 從來不對這六支送 playerId ⇒ gate 在正常路徑是 no-op）**。
//   ⚠ 判準是「請求體有沒有帶 `playerId`」，**不是**「呼叫點一定帶得出 token」——
//     `tApi` 在 `getIdToken()` 逾時 6 秒時會刻意**不帶 Authorization**（v6.167），
//     所以後者不成立；沒帶 playerId 時 `tournIdentity` 本來就回 401「需要登入」。
//
// 【分組】
//   A 結構（六支各恰一行／緊接 id.error／在任何 DB 操作之前／helper 沒被重複定義）
//   B ⭐⭐⭐ revert-diff（逐字還原 6 行 ⇒ 回到 v6.291；再還原 3 行 ⇒ 回到 v6.290 BASE）＋ 14 把鎖重釘
//   C ⭐⭐ 行為端實跑（出貨碼本尊：真 tournIdentity ＋ 真 helper ＋ 真六支 handler 接假 mongo）
//   D 突變（10 個，各自必須紅在預期那一條）
//   E client 端證據（六處呼叫的 body 字面量無 playerId；tApi 不注入）
//   F v6.291 三支的 gate 仍然存在且有效（回歸保護）
//   G test chain ／ 三配套 ／ HEAD-FAIL（對真 BASE blob：BASE 的六支對冒名請求**不拒絕**）
//
// ⚠ 反安慰劑：只捕捉 assert.AssertionError（其餘往外炸）；行為斷言一律抽出貨碼本尊實跑；
//   每個突變都必須紅在**預期那一條**；revert 快照集中在 scripts/lib/tourn-revert-v6292.mjs。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import {
  TAIL_ANCHOR, TEV_ANCHOR,
  V6291_ENDPOINTS, V6291_GATE_LINES, V6291_HELPER_HEAD,
  revertV6291,
} from './lib/tourn-revert-v6291.mjs';
import {
  OLD_TAIL_SHA_V6291, OLD_TEV_SHA_V6291, OLD_TEV_LEN_V6291,
  NEW_TAIL_SHA_V6292, NEW_TEV_SHA_V6292, NEW_TEV_LEN_V6292,
  V6292_ENDPOINTS, V6292_GATE_LINES, revertV6292, revertToV6290,
} from './lib/tourn-revert-v6292.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = '410e21158c5780eda3fafadf875d7f0f4bd6db2a';   // v6.291
const PATCH_REL = 'oracle-admin/server_admin_patch.js';
const PATCH = readFileSync(join(ROOT, PATCH_REL), 'utf8');
const PAGE = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8').replace(/\r\n/g, '\n');
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const VERTS = readFileSync(join(ROOT, 'src/lib/version.ts'), 'utf8');
const ADMIN = readFileSync(join(ROOT, 'oracle-admin/admin.html'), 'utf8');

let pass = 0, fail = 0;
const T = async (n, fn) => {
  try { await fn(); console.log('  PASS ' + n); pass++; }
  catch (e) {
    if (!(e instanceof assert.AssertionError)) throw e;   // ⚠ 非斷言例外一律往外炸，不吞
    fail++; console.log('  FAIL ' + n + '\n        ' + String(e.message).split('\n')[0].slice(0, 400));
  }
};
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

// ══ 抽取器（Rule 25：掃描器自己要先驗，見 A0）════════════════════════════════
function fnSrc(src, name) {
  for (const head of ['    async function ' + name + '(', '    function ' + name + '(']) {
    const i = src.indexOf(head);
    if (i < 0) continue;
    const j = src.indexOf('\n    }\n', i);
    assert.ok(j > i, '抓不到 ' + name + ' 的結尾');
    return src.slice(i, j + 6);
  }
  return null;
}
function epSrc(src, route) {
  const head = "app.post('" + route + "', async (req, res) => {";
  const i = src.indexOf(head);
  assert.ok(i >= 0, '找不到端點 ' + route);
  const j = src.indexOf('\n    });\n', i);
  assert.ok(j > i, '抓不到端點 ' + route + ' 的結尾');
  return src.slice(i, j + 8);
}
const ROUTE = (ep) => '/api/tournament/' + ep;
const ID_ERR_LINE = "        if (id.error) return res.status(id.code || 401).json({ error: id.error });\n";

// ══════════════════════════════════════════════════════════════════════════
console.log('\n══ 【A】結構 ═══════════════════════════════════════════════════════════');

await T('A0 抽取器自驗：六支端點都抽得到、長度合理、且抽到的是**完整** handler（有 tournIdentity 也有 catch 收尾）', () => {
  assert.strictEqual(V6292_ENDPOINTS.length, 6, '宣告清單長度變了：' + V6292_ENDPOINTS.join(','));
  for (const ep of V6292_ENDPOINTS) {
    const s = epSrc(PATCH, ROUTE(ep));
    assert.ok(s.length > 400, ep + ' 只抽到 ' + s.length + ' 字元 ⇒ 抽取器壞了，下面的斷言會變恆真');
    assert.ok(s.includes('await tournIdentity(req)'), ep + ' 抽到的片段沒有 tournIdentity');
    assert.ok(/catch \(e\) \{ res\.status\(500\)/.test(s), ep + ' 抽到的片段沒有收尾 catch ⇒ 抽早了');
  }
});

await T('A1 ⚠ helper 沒有被重複定義（沿用 v6.291 那一份，且仍在兩個區塊錨點之前 ⇒ 不進區塊 sha）', () => {
  assert.strictEqual(PATCH.split(V6291_HELPER_HEAD).length - 1, 1, 'tournRequireVerified 被重複定義了');
  const at = PATCH.indexOf(V6291_HELPER_HEAD);
  assert.ok(at > 0, 'HEAD-FAIL：找不到 helper');
  assert.ok(at < PATCH.indexOf(TAIL_ANCHOR), 'helper 落進了 tail 區塊');
  assert.ok(at < PATCH.indexOf(TEV_ANCHOR), 'helper 落進了 TEVENTS 區塊');
});

await T('A2 ⭐⭐ 六支各恰一行 gate、緊接在 `if (id.error) …` 之後、且在**任何** DB 操作之前', () => {
  for (const ep of V6292_ENDPOINTS) {
    const s = epSrc(PATCH, ROUTE(ep));
    const line = V6292_GATE_LINES[ep];
    assert.strictEqual(s.split(line).length - 1, 1, 'HEAD-FAIL：' + ep + ' 的 gate 行不是恰好 1 行');
    assert.ok(s.includes(ID_ERR_LINE + line), ep + '：gate 行沒有緊接在 id.error 那一行之後');
    const gateAt = s.indexOf(line);
    const dbAt = s.search(/\b(TREGS|TMATCH|TEVENTS|TCHAT|TROOMS|TARCHIVE)\.(findOne|find|insertOne|updateOne|deleteOne|countDocuments|updateMany|deleteMany|aggregate)\(/);
    assert.ok(dbAt < 0 || dbAt > gateAt, ep + '：gate 之前就碰了資料庫（檢查放在寫入之後＝沒用）');
    assert.ok(s.indexOf('await tournIdentity(req)') < gateAt, ep + '：gate 排在 tournIdentity 之前');
  }
  const expectCalls = 1 + V6291_ENDPOINTS.length + V6292_ENDPOINTS.length;
  assert.strictEqual(PATCH.split('tournRequireVerified(id, res, ').length - 1, expectCalls,
    'tournRequireVerified 的出現次數應為 ' + expectCalls + '（1 定義 ＋ 兩版宣告的呼叫）—— 有未宣告的插入？');
});

await T('A3 ⚠ 兩版宣告之外的端點一個都沒被順手加 gate（它們**需要** playerId fallback 或已有別的防線）', () => {
  for (const r of ['/api/tournament/join', '/api/tournament/still-here', '/api/tournament/action',
    '/api/tournament/reset', '/api/tournament/clientdiag', '/api/tournament/propose']) {
    assert.ok(!epSrc(PATCH, r).includes('tournRequireVerified'), r + ' 被加了 gate（不在兩版的宣告範圍）');
  }
  // 既有防線必須原封不動
  assert.ok(/if \(doc\.matchId && !_id\.verified\) return res\.status\(403\)/.test(epSrc(PATCH, '/api/tournament/join')), '/join 的既有 verified 條件不見了');
  assert.ok(/if \(doc\.matchId && !id\.verified\) return res\.status\(403\)/.test(epSrc(PATCH, '/api/tournament/still-here')), '/still-here 的既有 verified 條件不見了');
  assert.ok(/if \(!id\.email\) return res\.status\(403\)/.test(epSrc(PATCH, '/api/tournament/propose')), '/propose 的 !id.email 既有防線不見了');
});

await T('A4 ⚠⚠ 本版零刪除：TREGS/TEVENTS/TMATCH/TCHAT 的刪除與改寫路徑數量與 BASE(v6.291) 相同（只加判斷、不動資料）', () => {
  if (!hasBaseCommit(ROOT, BASE_SHA)) { shallowSkip('v6292 A4 與 BASE 比刪除路徑數', 'B 的 revert-diff 已逐位元涵蓋'); return; }
  const b = readBaseBlob(ROOT, BASE_SHA, PATCH_REL);
  assert.ok(b.ok, '讀不到 BASE blob');
  for (const pat2 of ['TREGS.deleteOne(', 'TREGS.deleteMany(', 'TREGS.updateOne(', 'TREGS.insertOne(',
    'TEVENTS.deleteOne(', 'TEVENTS.updateOne(', 'TEVENTS.insertOne(',
    'TMATCH.updateOne(', 'TMATCH.deleteMany(', 'TCHAT.insertOne(', 'TROOMS.updateOne(']) {
    assert.strictEqual(PATCH.split(pat2).length, b.out.split(pat2).length, pat2 + ' 的出現次數與 BASE 不同');
  }
});

// ══════════════════════════════════════════════════════════════════════════
console.log('\n══ 【B】⭐⭐⭐ revert-diff：區塊 ＝ BASE ＋ 恰好這 6 行 ═════════════════');

await T('B1 現行兩個區塊的指紋 ＝ 本版重釘的新值', () => {
  const tail = PATCH.slice(PATCH.indexOf(TAIL_ANCHOR));
  const tev = PATCH.slice(PATCH.indexOf(TEV_ANCHOR));
  assert.ok(tail.length > 200000 && tev.length > 200000, '區塊抽太短 ⇒ 比對會變恆真式');
  assert.strictEqual(sha256(tail), NEW_TAIL_SHA_V6292, 'tail sha=' + sha256(tail));
  assert.strictEqual(sha256(tev), NEW_TEV_SHA_V6292, 'tev sha=' + sha256(tev));
  assert.strictEqual(tev.length, NEW_TEV_LEN_V6292, 'tev 長度=' + tev.length);
});

await T('B2 ⭐⭐⭐ 逐字還原本版那 6 行後，兩個區塊 sha256 與 BASE(v6.291) **逐位元相同**', () => {
  const tail = revertV6292(PATCH.slice(PATCH.indexOf(TAIL_ANCHOR)));
  const tev = revertV6292(PATCH.slice(PATCH.indexOf(TEV_ANCHOR)));
  console.log('        revert-diff(v6.292) → tail sha256 = ' + sha256(tail) + '（BASE ' + OLD_TAIL_SHA_V6291 + '）');
  console.log('        revert-diff(v6.292) → tev  sha256 = ' + sha256(tev) + '  len=' + tev.length + '（BASE ' + OLD_TEV_SHA_V6291 + ' / ' + OLD_TEV_LEN_V6291 + '）');
  assert.strictEqual(sha256(tail), OLD_TAIL_SHA_V6291, '還原後 tail 與 BASE 不同 ⇒ 區塊有「宣告之外」的改動');
  assert.strictEqual(sha256(tev), OLD_TEV_SHA_V6291, '還原後 tev 與 BASE 不同');
  assert.strictEqual(tev.length, OLD_TEV_LEN_V6291, '還原後 tev 長度不符');
});

await T('B3 ⭐ 串接還原到 v6.290：再把 v6.291 的 3 行也還原掉 ⇒ 與 v6.290 逐位元相同（鏈沒有斷）', () => {
  const tail = revertToV6290(PATCH.slice(PATCH.indexOf(TAIL_ANCHOR)));
  const tev = revertToV6290(PATCH.slice(PATCH.indexOf(TEV_ANCHOR)));
  console.log('        revert-diff(→v6.290) → tail sha256 = ' + sha256(tail));
  console.log('        revert-diff(→v6.290) → tev  sha256 = ' + sha256(tev) + '  len=' + tev.length);
  assert.strictEqual(sha256(tail), '495221f1dbf51dea9020284147fcf9b271d2baeccdac8d3b4745110c409dca02', 'tail 沒回到 v6.290');
  assert.strictEqual(sha256(tev), '93d29a7d68b1508c9201b660ef38f06418fc5760606bb87798f8bdd5f5ed9fdd', 'tev 沒回到 v6.290');
  assert.strictEqual(tev.length, 219484, 'tev 長度沒回到 v6.290');
});

await T('B4 掃描器自驗：revert-diff 不是恆真（區塊裡改一個字元 ⇒ B2 必翻紅）', () => {
  const mutated = PATCH.slice(PATCH.indexOf(TAIL_ANCHOR)).replace('tournamentEvents', 'tournamentEventsX');
  assert.notStrictEqual(sha256(revertV6292(mutated)), OLD_TAIL_SHA_V6291, 'revert-diff 抓不到差異 ⇒ B2 是安慰劑');
});

const TAIL_LOCKS = [
  'scripts/test-v6265-phantom-start-race.mjs', 'scripts/test-v6272-firestore-read-reduction.mjs',
  'scripts/test-v6275-usersall-scan-guard.mjs', 'scripts/test-v6276-deck-tournament-stats.mjs',
  'scripts/test-v6286-friends-hardening.mjs', 'scripts/test-v6287-friends-dm.mjs',
  'scripts/test-v6288-friends-dm-ui.mjs', 'scripts/test-v6289-unblock-purge.mjs',
];
const TEV_LOCKS = [
  'scripts/test-v6266-deck-stats-server.mjs', 'scripts/test-v6268-delta-put-server.mjs',
  'scripts/test-v6276-deck-tournament-stats.mjs', 'scripts/test-v6278-delta-put-deep-path.mjs',
  'scripts/test-v6282-friends-p0.mjs', 'scripts/test-v6283-friends-p1a.mjs',
  'scripts/test-v6284-friends-p1b.mjs', 'scripts/test-v6286-friends-hardening.mjs',
  'scripts/test-v6287-friends-dm.mjs', 'scripts/test-v6288-friends-dm-ui.mjs',
  'scripts/test-v6289-unblock-purge.mjs',
];

await T('B5 ⭐⭐ 全站 14 把區塊鎖都重釘到新值，且**沒有一把被拿掉**（v6.290／v6.291 的舊值零殘留）', () => {
  for (const f of TAIL_LOCKS) {
    const s = readFileSync(join(ROOT, f), 'utf8');
    assert.ok(s.includes(NEW_TAIL_SHA_V6292), f + ' 沒重釘 tail sha（它現在守的是錯的值）');
    assert.ok(!s.includes(OLD_TAIL_SHA_V6291), f + ' 還留著 v6.291 的舊 tail sha');
  }
  for (const f of TEV_LOCKS) {
    const s = readFileSync(join(ROOT, f), 'utf8');
    assert.ok(s.includes(NEW_TEV_SHA_V6292), f + ' 沒重釘 TEVENTS sha');
    assert.ok(!s.includes(OLD_TEV_SHA_V6291), f + ' 還留著 v6.291 的舊 TEVENTS sha');
  }
  for (const f of ['scripts/test-v6266-deck-stats-server.mjs', 'scripts/test-v6268-delta-put-server.mjs', 'scripts/test-v6278-delta-put-deep-path.mjs']) {
    const s = readFileSync(join(ROOT, f), 'utf8');
    assert.ok(s.includes(String(NEW_TEV_LEN_V6292)), f + ' 的長度常數沒重釘');
    assert.ok(!s.includes(String(OLD_TEV_LEN_V6291)), f + ' 還留著 v6.291 的舊長度常數');
  }
});

await T('B6 ⚠⚠ 那 14 把鎖仍然「在守」：sha 比對式與自算 sha 都還在（沒被改成不驗／只比片段）；v6.276／v6.291 的還原鏈也還在', () => {
  const files = [...new Set([...TAIL_LOCKS, ...TEV_LOCKS])];
  assert.strictEqual(files.length, 14, '應涵蓋 14 支守衛，實際 ' + files.length);
  for (const f of files) {
    const s = readFileSync(join(ROOT, f), 'utf8');
    assert.ok(/assert\.(strictEqual|equal)\(/.test(s) && /sha256/.test(s), f + ' 已經沒有 sha256 比對式了');
    assert.ok(/createHash\('sha256'\)/.test(s), f + ' 不再自己算 sha ⇒ 可能被改成只比字串片段');
  }
  const v76 = readFileSync(join(ROOT, 'scripts/test-v6276-deck-tournament-stats.mjs'), 'utf8');
  assert.ok(v76.includes("from './lib/tourn-revert-v6292.mjs'") && v76.includes('revertV6292('),
    'test-v6276 沒有串接 v6.292 的還原器（它的 revert-diff 會被停用）');
  assert.ok(v76.includes('revertV6291('), 'test-v6276 掉了 v6.291 那一節（鏈斷了）');
  const v91 = readFileSync(join(ROOT, 'scripts/test-v6291-tourn-verified-gate.mjs'), 'utf8');
  assert.ok(v91.includes('revertV6292('), 'test-v6291 沒有串接 v6.292 的還原器');
});

// ══════════════════════════════════════════════════════════════════════════
console.log('\n══ 【C】⭐⭐ 行為端實跑（出貨碼本尊 ＋ 假 mongo）══════════════════════');

const VICTIM = 'victim-uid-0123456789';
const REAL_UID = 'realplayer-uid-abcdef';
const OPP_UID = 'opponent-uid-999';

/** 用**出貨碼本尊**組出可執行的六支端點。src 沒有 helper 時 ＝ BASE（用於 HEAD-FAIL）。 */
function buildRoutes(src, eps) {
  const idFn = fnSrc(src, 'tournIdentity');
  assert.ok(idFn, '抽不到 tournIdentity');
  const gateFn = fnSrc(src, 'tournRequireVerified') || '';
  const body = ''
    + '"use strict";\n'
    + 'const { TADMIN, TEVENTS, TREGS, TMATCH, TCHAT, TROOMS, evDoc, warns, app, hooks } = env;\n'
    + 'const console = { warn: (...a) => warns.push(a.map(String).join(" ")), log() {}, error() {} };\n'
    + 'const _chatRate = new Map();\n'
    + 'async function resolveEventFromReq(req) { return evDoc(); }\n'
    + 'async function listOpenEvents() { return [evDoc()]; }\n'
    + 'async function postSystemChat(t) { hooks.push(["postSystemChat", t]); }\n'
    + 'async function _forceGameOver() { hooks.push(["_forceGameOver"]); }\n'
    + 'async function checkRoundAdvance() { hooks.push(["checkRoundAdvance"]); }\n'
    + 'async function finishIfLastSurvivor() { hooks.push(["finishIfLastSurvivor"]); }\n'
    + 'async function advanceOrFinish() { hooks.push(["advanceOrFinish"]); }\n'
    + 'async function getLastRegisteredNick() { return null; }\n'
    + 'function isTournAdmin() { return false; }\n'
    + 'function currentActorSeat() { return 0; }\n'
    + 'function makeGame() { hooks.push(["makeGame"]); return { phase: "setup" }; }\n'
    + idFn + '\n' + gateFn + '\n' + eps.map((ep) => epSrc(src, ROUTE(ep))).join('\n') + '\n';
  const routes = Object.create(null);
  const env = {
    TADMIN: null, TEVENTS: null, TREGS: null, TMATCH: null, TCHAT: null, TROOMS: null,
    evDoc: null, warns: null, hooks: null,
    app: { post: (p, h) => { routes[p] = h; }, locals: {} },
  };
  return { routes, env, factory: new Function('env', body) };
}

/** 假 collection：把每一次讀寫都記下來（寫入計數是 C1 的核心斷言）。 */
function mkColl(name, state) {
  const st = state || {};
  return {
    name, writes: 0, reads: 0, updates: [], inserted: [], deleted: 0,
    async findOne(q) { this.reads++; return st.findOne ? st.findOne(q) : null; },
    find(q) { const self = this; self.reads++; return { async toArray() { return st.findArr ? st.findArr(q) : []; } }; },
    async insertOne(d) { this.writes++; this.inserted.push(d); return { insertedId: d && d._id }; },
    async updateOne(f, u) { this.writes++; this.updates.push({ filter: f, update: u }); return { modifiedCount: 1, matchedCount: 1 }; },
    async deleteOne() { this.writes++; this.deleted++; return { deletedCount: 1 }; },
    async deleteMany() { this.writes++; return { deletedCount: 1 }; },
    async countDocuments() { this.reads++; return st.count || 0; },
  };
}
function mkRes() {
  const r = { statusCode: 200, body: null, ended: false };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (o) => { r.body = o; r.ended = true; return r; };
  return r;
}
function mkTadmin() {
  return {
    apps: [1],
    auth: () => ({
      async verifyIdToken(tok) {
        if (tok === 'GOOD') return { uid: REAL_UID, email: 'real@example.com', name: '真玩家', firebase: { sign_in_provider: 'password' } };
        throw new Error('bad token');
      },
    }),
  };
}

/** 依端點準備一組「若沒有 gate 就會成功」的假資料；actorUid ＝ 這一發被伺服器認成誰。 */
function fixtureFor(ep, actorUid) {
  const ev = {
    _id: 'evt_test', name: '測試賽', status: 'running', currentRound: 1,
    createdByPlayer: true, proposerUid: actorUid, minPlayers: 4,
    roundStartedAt: 0, roundCountdownMin: 0, idleForfeitMin: 3,
  };
  if (ep === 'unregister' || ep === 'cancel-proposal') ev.status = 'registration';
  const match = {
    _id: 'm1', eventId: ev._id, round: 1, status: 'playing',
    p1uid: actorUid, p2uid: OPP_UID, p1name: '我', p2name: '對手',
    roomId: 'mr_m1', entered: [false, false],
  };
  return {
    ev,
    regs: mkColl('TREGS', { findOne: () => ({ _id: ev._id + '__' + actorUid, uid: actorUid, name: '受害者', dropped: false }), count: 0 }),
    events: mkColl('TEVENTS', { findOne: () => ev, findArr: () => [ev] }),
    match: mkColl('TMATCH', { findOne: () => (ep === 'drop' ? null : match), findArr: () => [match] }),
    chat: mkColl('TCHAT', {}),
    rooms: mkColl('TROOMS', { findOne: () => ({ _id: 'mr_m1', version: 1, gameState: { phase: 'playing' } }) }),
  };
}

/** 跑一支端點；回傳 { res, warns, hooks, colls, writes }。 */
async function run(src, ep, { auth, body, actorUid }) {
  const { routes, env, factory } = buildRoutes(src, [ep]);
  const warns = [], hooks = [];
  const fx = fixtureFor(ep, actorUid || REAL_UID);
  Object.assign(env, {
    TADMIN: mkTadmin(), TEVENTS: fx.events, TREGS: fx.regs, TMATCH: fx.match,
    TCHAT: fx.chat, TROOMS: fx.rooms, evDoc: () => fx.ev, warns, hooks,
  });
  factory(env);
  const route = ROUTE(ep);
  assert.ok(routes[route], '端點沒註冊：' + route);
  const req = { headers: auth ? { authorization: auth } : {}, body: body || {}, query: {} };
  const res = mkRes();
  await routes[route](req, res);
  const colls = [fx.regs, fx.events, fx.match, fx.chat, fx.rooms];
  return {
    res, warns, hooks, colls, fx,
    writes: colls.reduce((a, c) => a + c.writes, 0),
    reads: colls.reduce((a, c) => a + c.reads, 0),
  };
}
const ATTACK_BODY = { playerId: VICTIM, eventId: 'evt_test', room: 'mr_m1', text: '我是受害者說的話' };
const REAL_BODY = { eventId: 'evt_test', room: 'mr_m1', text: '哈囉' };

await T('C1 ⭐⭐⭐ 帶 playerId 但**無 Bearer** ⇒ 六支各自 403 + code:tourn-needs-verified，且 DB **一個位元都沒寫**', async () => {
  for (const ep of V6292_ENDPOINTS) {
    const r = await run(PATCH, ep, { auth: null, body: ATTACK_BODY, actorUid: VICTIM });
    assert.strictEqual(r.res.statusCode, 403, ep + ' 的狀態碼是 ' + r.res.statusCode + '（應 403）');
    assert.strictEqual(r.res.body && r.res.body.code, 'tourn-needs-verified', ep + ' 沒有回明確 code');
    assert.ok(/請先用 email 帳號登入/.test(String(r.res.body && r.res.body.error)), ep + ' 的錯誤訊息不可行動');
    assert.strictEqual(r.writes, 0, '⚠⚠ ' + ep + ' 竟然寫了 DB ' + r.writes + ' 次（冒名成功）');
    assert.strictEqual(r.reads, 0, ep + ' 在 gate 之前就讀了 DB');
    assert.strictEqual(r.hooks.length, 0, ep + ' 在 gate 之後還跑了副作用：' + JSON.stringify(r.hooks));
  }
});

await T('C2 ⭐⭐⭐【最重要】帶合法 Bearer（verified:true）⇒ 六支**全部照常成功**（證明沒擋到真玩家）', async () => {
  const expect = {
    'drop': (r) => assert.deepStrictEqual(r.res.body, { ok: true }, '/drop 沒成功：' + JSON.stringify(r.res.body)),
    'unregister': (r) => assert.deepStrictEqual(r.res.body, { ok: true }, '/unregister 沒成功：' + JSON.stringify(r.res.body)),
    'cancel-proposal': (r) => assert.deepStrictEqual(r.res.body, { ok: true }, '/cancel-proposal 沒成功：' + JSON.stringify(r.res.body)),
    'chat': (r) => assert.deepStrictEqual(r.res.body, { ok: true }, '/chat 沒成功：' + JSON.stringify(r.res.body)),
    'match/enter': (r) => assert.deepStrictEqual(r.res.body, { roomId: 'mr_m1', seat: 0 }, '/match/enter 沒成功：' + JSON.stringify(r.res.body)),
    'match/forfeit': (r) => assert.deepStrictEqual(r.res.body, { ok: true }, '/match/forfeit 沒成功：' + JSON.stringify(r.res.body)),
  };
  for (const ep of V6292_ENDPOINTS) {
    const r = await run(PATCH, ep, { auth: 'Bearer GOOD', body: REAL_BODY, actorUid: REAL_UID });
    assert.strictEqual(r.res.statusCode, 200, ep + ' 回了 ' + r.res.statusCode + '（真玩家被擋了）');
    expect[ep](r);
    assert.ok(r.writes > 0, ep + ' 對真玩家沒有做任何寫入 ⇒ 這條斷言變成恆真式，證明不了「照常成功」');
    assert.strictEqual(r.warns.length, 0, ep + ' 對真玩家也記了 warn ⇒ 站長會被雜訊淹沒');
  }
});

await T('C3 ⭐⭐ /drop 專驗：被擋下來時 TREGS 的 `dropped` 欄位**完全沒有被設**（棄賽不可逆，絕不能誤觸）', async () => {
  const blocked = await run(PATCH, 'drop', { auth: null, body: ATTACK_BODY, actorUid: VICTIM });
  const setDropped = blocked.fx.regs.updates.filter((u) => u.update && u.update.$set && 'dropped' in u.update.$set);
  assert.strictEqual(blocked.fx.regs.updates.length, 0, '⚠⚠ 被擋的 /drop 仍然對 TREGS 下了 updateOne：' + JSON.stringify(blocked.fx.regs.updates));
  assert.strictEqual(setDropped.length, 0, '⚠⚠⚠ 被擋的 /drop 竟然把 dropped 設起來了（棄賽不可逆！）');
  assert.strictEqual(blocked.hooks.length, 0, '被擋的 /drop 還發了公告／收場：' + JSON.stringify(blocked.hooks));
  // 正對照：真玩家的 /drop **確實**會設 dropped:true —— 沒有這一條，上面那三條可能只是「這條路徑本來就不寫」
  const ok = await run(PATCH, 'drop', { auth: 'Bearer GOOD', body: REAL_BODY, actorUid: REAL_UID });
  const okSet = ok.fx.regs.updates.filter((u) => u.update && u.update.$set && u.update.$set.dropped === true);
  assert.strictEqual(okSet.length, 1, '正對照失效：真玩家的 /drop 沒有設 dropped:true ⇒ 上面的「沒設」是恆真式');
});

await T('C4 沒 Bearer 也沒 playerId（＝取不到 token 的真玩家）⇒ 維持 BASE 既有的 401「需要登入」，不是新的 403', async () => {
  for (const ep of V6292_ENDPOINTS) {
    const r = await run(PATCH, ep, { auth: null, body: REAL_BODY });
    assert.strictEqual(r.res.statusCode, 401, ep + ' 回了 ' + r.res.statusCode + '（BASE 行為是 401）');
    assert.strictEqual(r.res.body.error, '需要登入', ep + ' 的訊息變了：' + JSON.stringify(r.res.body));
  }
});

await T('C5 log：被擋時 console.warn 帶端點名與 uid 前 8 碼，且**不含完整 uid、不含 email**', async () => {
  for (const ep of V6292_ENDPOINTS) {
    const { warns } = await run(PATCH, ep, { auth: null, body: ATTACK_BODY, actorUid: VICTIM });
    assert.strictEqual(warns.length, 1, ep + ' 的 warn 應恰 1 則，實際 ' + warns.length);
    const w = warns[0];
    assert.ok(w.includes('verified-gate'), ep + ' 的 log 沒有可 grep 的關鍵字：' + w);
    assert.ok(w.includes('ep=' + ep), ep + ' 的 log 沒有正確端點名：' + w);
    assert.ok(w.includes('uid8=' + VICTIM.slice(0, 8)), ep + ' 的 log 沒有 uid 前 8 碼：' + w);
    assert.ok(!w.includes(VICTIM), '⚠ ' + ep + ' 的 log 記了完整 uid');
    assert.ok(!w.includes('@'), '⚠ ' + ep + ' 的 log 記了 email');
  }
});

// ══════════════════════════════════════════════════════════════════════════
console.log('\n══ 【D】突變：每一個都必須紅在**預期那一條** ══════════════════════════');

async function reds(fn) {
  try { await fn(); return false; }
  catch (e) { if (e instanceof assert.AssertionError) return true; throw e; }
}
const MUT = [
  ['M1 只擋 /drop、其餘五支的 gate 拿掉',
    (s) => { let r = s; for (const ep of V6292_ENDPOINTS) if (ep !== 'drop') r = r.replace(V6292_GATE_LINES[ep], ''); return r; },
    async (s) => {
      for (const ep of V6292_ENDPOINTS) {
        const r = await run(s, ep, { auth: null, body: ATTACK_BODY, actorUid: VICTIM });
        assert.strictEqual(r.res.statusCode, 403, 'C1：' + ep);
      }
    }],
  ['M2 ⭐⭐ /drop 的 gate 移到 handler 尾巴（＝檢查放在「搶占 dropped」這個寫入之後）',
    (s) => {
      const ep = epSrc(s, ROUTE('drop'));
      const anchor = '        res.json({ ok: true });\n';
      const moved = ep.replace(V6292_GATE_LINES['drop'], '').replace(anchor, V6292_GATE_LINES['drop'] + anchor);
      return s.replace(ep, moved);
    },
    async (s) => {
      const r = await run(s, 'drop', { auth: null, body: ATTACK_BODY, actorUid: VICTIM });
      const setDropped = r.fx.regs.updates.filter((u) => u.update && u.update.$set && u.update.$set.dropped === true);
      assert.strictEqual(setDropped.length, 0, 'C3：dropped 被設起來了（棄賽不可逆）');
    }],
  ['M2b ⭐ /drop 的 gate 只往後挪一點點（挪到 TREGS.findOne 之後、寫入之前）—— 「在任何 DB 操作之前」這條紀律要抓得住',
    (s) => {
      const ep = epSrc(s, ROUTE('drop'));
      const anchor = '        const _claim = await TREGS.updateOne(';
      const moved = ep.replace(V6292_GATE_LINES['drop'], '').replace(anchor, V6292_GATE_LINES['drop'] + anchor);
      return s.replace(ep, moved);
    },
    async (s) => {
      const r = await run(s, 'drop', { auth: null, body: ATTACK_BODY, actorUid: VICTIM });
      assert.strictEqual(r.reads, 0, 'C1：gate 之前就讀了 DB（讀了 ' + r.reads + ' 次）');
      const st = epSrc(s, ROUTE('drop'));
      const gateAt = st.indexOf(V6292_GATE_LINES['drop']);
      const dbAt = st.search(/\b(TREGS|TMATCH|TEVENTS|TCHAT|TROOMS)\.(findOne|find|insertOne|updateOne|deleteOne|countDocuments)\(/);
      assert.ok(dbAt < 0 || dbAt > gateAt, 'A2：gate 之前就碰了資料庫');
    }],
  ['M3 /match/forfeit 的 gate 拿掉（替別人投降）',
    (s) => s.replace(V6292_GATE_LINES['match/forfeit'], ''),
    async (s) => {
      const r = await run(s, 'match/forfeit', { auth: null, body: ATTACK_BODY, actorUid: VICTIM });
      assert.strictEqual(r.writes, 0, 'C1：/match/forfeit 寫了 DB');
    }],
  ['M4 /cancel-proposal 的 gate 拿掉（取消別人發起的社群賽）',
    (s) => s.replace(V6292_GATE_LINES['cancel-proposal'], ''),
    async (s) => {
      const r = await run(s, 'cancel-proposal', { auth: null, body: ATTACK_BODY, actorUid: VICTIM });
      assert.strictEqual(r.res.statusCode, 403, 'C1：/cancel-proposal');
    }],
  ['M5 /chat 的 gate 拿掉（冒名發言）',
    (s) => s.replace(V6292_GATE_LINES['chat'], ''),
    async (s) => {
      const r = await run(s, 'chat', { auth: null, body: ATTACK_BODY, actorUid: VICTIM });
      assert.strictEqual(r.fx.chat.inserted.length, 0, 'C1：/chat 真的寫進去了');
    }],
  ['M6 gate 誤擋真玩家（helper 改成連 verified:true 也擋）',
    (s) => s.replace('if (id && id.verified === true) return false;', 'if (false) return false;'),
    async (s) => {
      for (const ep of V6292_ENDPOINTS) {
        const r = await run(s, ep, { auth: 'Bearer GOOD', body: REAL_BODY, actorUid: REAL_UID });
        assert.strictEqual(r.res.statusCode, 200, 'C2：' + ep + ' 的真玩家被擋');
      }
    }],
  ['M7 區塊被多動一處（revert 後 sha 對不上）',
    (s) => s.replace("if (reg.dropped) return res.status(409)", "if (reg.dropped) return res.status(410)"),
    async (s) => {
      assert.strictEqual(sha256(revertV6292(s.slice(s.indexOf(TAIL_ANCHOR)))), OLD_TAIL_SHA_V6291, 'B2');
    }],
  ['M8 gate 行的 ep 字串被抄錯（/unregister 的 log 印成 drop ⇒ 站長查 log 會找錯端點）',
    (s) => s.replace(V6292_GATE_LINES['unregister'],
      V6292_GATE_LINES['unregister'].replace("res, 'unregister'", "res, 'drop'")),
    async (s) => {
      const { warns } = await run(s, 'unregister', { auth: null, body: ATTACK_BODY, actorUid: VICTIM });
      assert.ok(warns[0].includes('ep=unregister'), 'C5：log 的端點名不對');
    }],
  ['M9 鎖的基準值被亂改（把某一把鎖釘到別的值）',
    null,
    async () => {
      const f = 'scripts/test-v6287-friends-dm.mjs';
      const s = readFileSync(join(ROOT, f), 'utf8').replace(NEW_TEV_SHA_V6292, '0'.repeat(64));
      assert.ok(s.includes(NEW_TEV_SHA_V6292), 'B5：' + f + ' 沒重釘');
    }],
];
for (const [name, mutate, check] of MUT) {
  await T('D ' + name + ' ⇒ 必須紅', async () => {
    const src = mutate ? mutate(PATCH) : PATCH;
    if (mutate) assert.notStrictEqual(src, PATCH, '突變沒生效（字面量對不上）⇒ 這條是安慰劑');
    assert.ok(await reds(() => check(src)), '⚠⚠ 這個突變沒有翻紅 —— 守衛有洞');
  });
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n══ 【E】client 端證據：gate 在正常路徑是 no-op ═════════════════════════');

await T('E1 ⭐⭐ 六支端點的 client 呼叫**都沒有**送 playerId（body 字面量逐一檢查）', () => {
  const calls = [
    ["tApi('/drop', {", '/drop'],
    ["tApi('/unregister', {", '/unregister'],
    ["tApi('/cancel-proposal', {", '/cancel-proposal'],
    ["tApi('/chat', {", '/chat'],
    ["tApi('/match/enter', {", '/match/enter'],
    ["tApi('/match/forfeit', {", '/match/forfeit'],
  ];
  assert.strictEqual(calls.length, V6292_ENDPOINTS.length, '呼叫點清單與宣告清單長度不一致');
  for (const [needle, label] of calls) {
    const i = PAGE.indexOf(needle);
    assert.ok(i > 0, '找不到 client 呼叫：' + label);
    assert.strictEqual(PAGE.split(needle).length - 1, 1, label + ' 的呼叫點不只一處（新增的那處也要檢查）');
    const seg = PAGE.slice(i, PAGE.indexOf('}', PAGE.indexOf('{', i)) + 1);
    assert.ok(!/playerId/.test(seg), '⚠⚠ ' + label + ' 的 body 帶了 playerId ⇒ 這道 gate 會擋到真玩家：' + seg.slice(0, 200));
  }
});

await T('E2 ⭐ 全站帶 playerId 的呼叫點仍然只有 /still-here /join /action /reset（多一支就要重新評估 gate 範圍）', () => {
  const A = '  async function tApi(path: string, body?: any, opts?: { timeoutMs?: number }) {';
  const i = PAGE.indexOf(A);
  assert.ok(i > 0, '找不到 tApi');
  const seg = PAGE.slice(i, PAGE.indexOf('\n  }\n', i) + 4);
  assert.ok(seg.length > 1000, 'tApi 抽太短');
  assert.ok(!/playerId\s*:/.test(seg), 'tApi 竟然注入了 playerId');
  // ⚠ 跨行：/action 的 body 寫在下一行（v6.170 冪等重試）⇒ 不可以用 [^\n]*
  const withPid = [...PAGE.matchAll(/tApi\('(\/[a-z/-]+)'[\s\S]{0,200}?playerId: tPlayerId\(\)/g)].map((m) => m[1]).sort();
  assert.deepStrictEqual(withPid, ['/action', '/join', '/reset', '/still-here'].sort(),
    '帶 playerId 的呼叫點清單變了：' + JSON.stringify(withPid) + ' ⇒ 要重新評估 gate 範圍');
  for (const ep of V6292_ENDPOINTS) {
    assert.ok(!withPid.includes('/' + ep), '⚠⚠ /' + ep + ' 開始送 playerId 了 ⇒ 這道 gate 會擋到真玩家，必須立刻拿掉');
  }
});

await T('E3 ⭐ tApi 取不到 token 時是**不帶 Authorization** 送出（6 秒上限，v6.167）—— 這正是判準只能是「playerId 缺席」的理由', () => {
  const A = '  async function tApi(path: string, body?: any, opts?: { timeoutMs?: number }) {';
  const seg = PAGE.slice(PAGE.indexOf(A), PAGE.indexOf('\n  }\n', PAGE.indexOf(A)) + 4);
  assert.ok(/setTimeout\(\(\) => r\(null\), 6000\)/.test(seg), 'tApi 的 6 秒 token 上限不見了（行為前提變了，要重驗 gate）');
  assert.ok(/if \(_tok\) headers\['Authorization'\] = 'Bearer ' \+ _tok;/.test(seg), 'tApi 帶 token 的方式變了');
});

// ══════════════════════════════════════════════════════════════════════════
console.log('\n══ 【F】回歸：v6.291 那三支的 gate 仍然存在且有效 ══════════════════════');

await T('F1 v6.291 的三行 gate 逐字都還在，位置也沒被挪（緊接 id.error）', () => {
  for (const ep of V6291_ENDPOINTS) {
    const s = epSrc(PATCH, ROUTE(ep));
    assert.strictEqual(s.split(V6291_GATE_LINES[ep]).length - 1, 1, 'HEAD-FAIL：v6.291 的 ' + ep + ' gate 不見了/重複了');
    assert.ok(s.includes(ID_ERR_LINE + V6291_GATE_LINES[ep]), ep + '：v6.291 的 gate 被挪走了');
  }
});

await T('F2 ⭐ v6.291 三支的**行為**仍然有效：冒名 403 且零寫入；真玩家照常成功', async () => {
  const bodies = {
    'register': { eventId: 'evt_test', name: 'n', deckName: 'd', deckEntries: [{ cardId: 'c', count: 60 }], coinPref: 'random' },
  };
  for (const ep of V6291_ENDPOINTS) {
    const attack = Object.assign({ playerId: VICTIM }, bodies['register']);
    const { routes, env, factory } = buildRoutes(PATCH, [ep]);
    const warns = [], hooks = [];
    const ev = { _id: 'evt_test', status: ep === 'register' ? 'registration' : 'checkin', maxPlayers: null };
    const regs = mkColl('TREGS', { findOne: () => ({ _id: 'evt_test__' + VICTIM }), count: 0 });
    Object.assign(env, {
      TADMIN: mkTadmin(), TEVENTS: mkColl('TEVENTS', { findOne: () => ev }), TREGS: regs,
      TMATCH: mkColl('TMATCH', {}), TCHAT: mkColl('TCHAT', {}), TROOMS: mkColl('TROOMS', {}),
      evDoc: () => ev, warns, hooks,
    });
    factory(env);
    const res = mkRes();
    await routes[ROUTE(ep)]({ headers: {}, body: attack, query: {} }, res);
    assert.strictEqual(res.statusCode, 403, 'v6.291 回歸：' + ep + ' 不再擋冒名（' + res.statusCode + '）');
    assert.strictEqual(regs.writes, 0, 'v6.291 回歸：' + ep + ' 竟然寫了 TREGS');
  }
});

// ══════════════════════════════════════════════════════════════════════════
console.log('\n══ 【G】test chain ／ 三配套 ／ HEAD-FAIL ══════════════════════════════');

await T('G1 本守衛在 package.json 的 test chain 裡（CI 的 iron-rules-audit 是 continue-on-error，不算數）', () => {
  assert.ok(String(PKG.scripts.test).includes('node scripts/test-v6292-tourn-verified-gate2.mjs'), '沒進 npm test chain');
  assert.ok(String(PKG.scripts.test).includes('node scripts/test-v6291-tourn-verified-gate.mjs'), 'v6.291 的守衛被移出 chain 了');
});

await T('G2 三配套：version.ts ＝ admin.html SITE_VERSION_HINT，且 ≥ 6.292；patch 檔頭已 bump 且舊紀錄還在', () => {
  const v = /export const VERSION = '([\d.]+)';/.exec(VERTS)[1];
  const h = /window\.SITE_VERSION_HINT = '([\d.]+)';/.exec(ADMIN)[1];
  assert.strictEqual(h, v, 'admin.html hint(' + h + ') ≠ version.ts(' + v + ')');
  assert.ok(Number(v.split('.')[1]) >= 292, 'version.ts 沒 bump：' + v);
  const mp = /^\/\/ === ORACLE ADMIN ENDPOINTS === v1\.(\d+) \(/.exec(PATCH);
  assert.ok(mp, 'patch 檔頭格式不對');
  assert.ok(Number(mp[1]) >= 42, 'patch 檔頭沒 bump：v1.' + mp[1]);
  assert.ok(PATCH.includes('← v1.41 ('), 'v1.41 的檔頭紀錄被洗掉了');
});

await T('G3 ⚠ 本守衛沒有 pin 死任何 v6.xxx 版本號當判準（第九種安慰劑）', () => {
  const self = readFileSync(join(ROOT, 'scripts/test-v6292-tourn-verified-gate2.mjs'), 'utf8');
  const body = self.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
  assert.ok(!/VERSION === '6\.29\d'/.test(body), '出現 pin 死版本號的判準');
});

await T('G4 ⭐⭐ HEAD-FAIL：對真 BASE blob(v6.291) 跑同一組行為斷言 ⇒ BASE 的六支對冒名請求**不拒絕**（漏洞真的存在）', async () => {
  if (!hasBaseCommit(ROOT, BASE_SHA)) { shallowSkip('v6292 G4 對 BASE blob 的行為端 HEAD-FAIL', 'C1/C2/C3 內嵌行為斷言＋B 的 revert-diff 仍在守'); return; }
  const b = readBaseBlob(ROOT, BASE_SHA, PATCH_REL);
  assert.ok(b.ok && b.out.length > 600000, '讀不到 BASE blob');
  assert.ok(b.out.includes('tournRequireVerified'), 'BASE(v6.291) 應該已經有 helper');
  for (const ep of V6292_ENDPOINTS) {
    assert.ok(!epSrc(b.out, ROUTE(ep)).includes('tournRequireVerified'), 'BASE 的 ' + ep + ' 竟然已有 gate？BASE_SHA 抓錯了');
    const r = await run(b.out, ep, { auth: null, body: ATTACK_BODY, actorUid: VICTIM });
    assert.notStrictEqual(r.res.statusCode, 403, 'BASE 的 ' + ep + ' 竟然拒絕了冒名請求 ⇒ 漏洞假設有誤');
    assert.ok(r.writes > 0, 'BASE 的 ' + ep + ' 沒有產生任何寫入 ⇒ 這條 HEAD-FAIL 證明不了漏洞');
  }
  // ⭐ 最嚴重的那一支：BASE 的 /drop 真的把**受害者**的 dropped 設成 true（而且不可逆）
  const d = await run(b.out, 'drop', { auth: null, body: ATTACK_BODY, actorUid: VICTIM });
  const setDropped = d.fx.regs.updates.filter((u) => u.update && u.update.$set && u.update.$set.dropped === true);
  assert.strictEqual(setDropped.length, 1, 'BASE 的 /drop 沒有把 dropped 設起來 ⇒ 「棄賽不可逆」的風險敘述要重寫');
  console.log('        HEAD-FAIL：BASE 的 /drop 對冒名請求下了 ' + JSON.stringify(setDropped[0].update) + '（受害者被棄賽）');
  // ⭐ /cancel-proposal：v6.291 判它「已被 proposerUid 限縮」是錯的 —— 冒名者就是把 uid 填成發起者
  const c = await run(b.out, 'cancel-proposal', { auth: null, body: ATTACK_BODY, actorUid: VICTIM });
  assert.deepStrictEqual(c.res.body, { ok: true }, 'BASE 的 /cancel-proposal 竟然擋住了冒名（那 v6.291 的判斷才是對的）');
  // BASE 的區塊 sha ＝ 還原後的 sha（再次確認基準值沒抓錯）
  assert.strictEqual(sha256(b.out.slice(b.out.indexOf(TAIL_ANCHOR))), OLD_TAIL_SHA_V6291, 'BASE tail sha 與內嵌基準不符');
  assert.strictEqual(sha256(b.out.slice(b.out.indexOf(TEV_ANCHOR))), OLD_TEV_SHA_V6291, 'BASE tev sha 與內嵌基準不符');
  // BASE 還原 v6.291 的 3 行 ⇒ 回到 v6.290（證明 revertV6291 這一節仍然對得上）
  assert.strictEqual(sha256(revertV6291(b.out.slice(b.out.indexOf(TAIL_ANCHOR)))),
    '495221f1dbf51dea9020284147fcf9b271d2baeccdac8d3b4745110c409dca02', 'BASE 還原 v6.291 後沒回到 v6.290');
});

await T('G5 ⚠⚠ src/routes/game/+page.svelte 相對 BASE **一個位元都沒動**（blob sha 對比）', () => {
  if (!hasBaseCommit(ROOT, BASE_SHA)) { shallowSkip('v6292 G5 +page.svelte blob 對比', 'test-v6272 ⑩ 的逐檔比對同守一件事'); return; }
  const b = readBaseBlob(ROOT, BASE_SHA, 'src/routes/game/+page.svelte');
  assert.ok(b.ok, '讀不到 BASE 的 +page.svelte');
  const cur = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
  assert.strictEqual(sha256(cur), sha256(b.out),
    '⚠⚠ +page.svelte 被動了：現行 ' + sha256(cur).slice(0, 16) + ' ≠ BASE ' + sha256(b.out).slice(0, 16));
});

await T('G6 內部 changelog 有本版（公平性／安全修正 ⇒ 依站長既有裁定**不寫首頁 changelog**）', () => {
  const ic = readFileSync(join(ROOT, 'docs/changelog-internal.md'), 'utf8');
  assert.ok(/v6\.292/.test(ic), 'docs/changelog-internal.md 沒有 v6.292');
  assert.ok(/tourn-needs-verified/.test(ic), 'internal changelog 沒寫下 code（站長查 log 要用）');
  for (const f of ['src/routes/+page.svelte', 'src/lib/changelog-data.ts', 'src/lib/changelog.ts']) {
    let s = null;
    try { s = readFileSync(join(ROOT, f), 'utf8'); } catch { continue; }
    assert.ok(!/6\.292/.test(s), '⚠ 公平性修正被寫進首頁 changelog（' + f + '）—— 站長裁定不寫');
  }
});

console.log('\n────────────────────────────────');
console.log('test-v6292-tourn-verified-gate2: ' + pass + ' pass, ' + fail + ' fail');
if (fail > 0) process.exit(1);
