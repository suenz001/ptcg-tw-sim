#!/usr/bin/env node
/**
 * v6.659 守衛：玩家名片五大升級（總勝場／點擊切換／下載圖檔／分享連結／Admin 專屬頭像外框）
 *
 *  【A】profile-api.ts 純邏輯、6 款外框圖鑑、分享連結與預覽隱藏切換
 *  【B】後端 v187-player-profile 實跑：
 *       ・一般線上勝場（具 roomCode 且排除第 1 回合無回應與單機 AI roomCode:null/''）＋錦標賽勝場（排除 bye/noShow）
 *       ・showTotalWins / showOfficialCrowns / showCommunityCrowns 寫入與 /view 隱藏、零 email 外洩
 *       ・玩家 /save 不可竄改或抹除 avatarFrame
 *       ・GET/POST /api/admin/player-profile/frame（非管理員 403、管理員指定/清除即時清快取、未知外框 400）
 *  【C】Playwright 真瀏覽器實測＋全站接線檢查：
 *       ・編輯器點擊 3 顆統計切換鈕（aria-pressed）、預覽同步與儲存 payload
 *       ・名片彈窗嚴格限定「自己 / 預覽」才顯示「📥 下載名片」「🔗 分享名片」（看他人絕不顯示）、未登入點＋加好友觸發登入接力
 *       ・iPhone Dynamic Island 393×852 三顆頂部徽章（總勝＋網站賽＋社群賽）單行對齊且不碰關閉鈕
 *       ・Canvas 2D 名片圖片繪製（780px PNG dataURL）與 AvatarCircle 6 款外框渲染
 *       ・game/+page.svelte（?card= 入口與 battleRegion 零 friend）、admin.html 與公開 changelog 隔離
 *  【D】Rule 40 精確還原鏈驗證＋突變測試（至少 6 個真實突變）＋ BASE 必紅檢查
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
import { revertV6659IfPresent, V6659_PAIRS } from './lib/revert-v6659-profile-upgrades.mjs';

const require_ = createRequire(import.meta.url);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = 'a41829bc9a11aef0c7b3405d70308623e5def469'; // v6.658
const SNAP_V6666 = '3075b04ce2e3de6fc55288452f03d8fa8fab488c'; // v6.666 還原鏈快照

const API_PATH = 'src/lib/profile/profile-api.ts';
const AV_PATH = 'src/lib/profile/AvatarCircle.svelte';
const MODAL_PATH = 'src/lib/profile/PlayerProfileModal.svelte';
const EDIT_PATH = 'src/lib/profile/PlayerProfileEditor.svelte';
const GAME_PATH = 'src/routes/game/+page.svelte';
const MPB_PATH = 'src/routes/game/MobilePortraitBattle.svelte';
const SRV_PATH = 'oracle-admin/server_admin_patch.js';
const ADMIN_PATH = 'oracle-admin/admin.html';
const CHLOG_PATH = 'static/changelog.html';

const read = (rel) => normEol(readFileSync(join(ROOT, rel), 'utf8'));

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

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【A】profile-api.ts 模組實跑（6 款外框圖鑑 / 分享連結 / 統計切換預覽）');

async function loadProfileApi(srcOverride) {
  const src = srcOverride ?? read(API_PATH);
  const marker = "((((import.meta as unknown) as { env?: { VITE_ORACLE_API_URL?: string } }).env?.VITE_ORACLE_API_URL) || '')";
  assert.ok(src.includes(marker), '找不到 import.meta env 替換錨點');
  const tmp = mkdtempSync(join(tmpdir(), 'v6659-api-'));
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
    return await import(pathToFileURL(out).href + '?v=' + Date.now() + Math.random());
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function assertProfileApiContract(srcOverride) {
  const api = await loadProfileApi(srcOverride);
  const expectedIds = [
    'admin_gold', 'champion_master', 'sponsor_diamond', 'premier_trophy', 'rainbow_rare',
    'flame_flare', 'emerald_leaf', 'aqua_wave', 'psychic_nebula', 'shadow_phantom',
    'cyber_neon', 'eevee_fluff', 'fairy_ribbon', 'gengar_grin', 'snorlax_cozy',
    'dragon_crest', 'frost_glacier', 'steel_gear', 'sakura_spring', 'moon_eclipse',
  ];
  assert.ok(Array.isArray(api.AVATAR_FRAMES) && api.AVATAR_FRAMES.length === 20, 'AVATAR_FRAMES 應包含完整 20 款立體裝飾外框');
  for (const fid of expectedIds) {
    const sp = api.getAvatarFrameSpec(fid);
    assert.ok(sp && sp.id === fid && sp.stops.length === 4 && sp.glow && sp.innerBorder && sp.badge, '外框規格缺欄位：' + fid);
    const art = api.getAvatarFrameArt(fid);
    assert.ok(art && Array.isArray(art.grads) && art.grads.length > 0 && Array.isArray(art.shapes) && art.shapes.length > 0, '外框 SVG 幾何缺欄位：' + fid);
    const dataUrl = api.buildAvatarFrameSvgDataUrl(fid);
    assert.ok(typeof dataUrl === 'string' && dataUrl.startsWith('data:image/svg+xml;charset=utf-8,'), 'SVG dataUrl 格式錯誤：' + fid);
    assert.ok(decodeURIComponent(dataUrl).includes('viewBox="0 0 140 140"'), 'SVG viewBox 應為 0 0 140 140：' + fid);
  }
  assert.strictEqual(api.clampAvatarFrame('  sponsor_diamond  '), 'sponsor_diamond');
  assert.strictEqual(api.clampAvatarFrame('moon_eclipse'), 'moon_eclipse');
  assert.strictEqual(api.clampAvatarFrame('fake_frame'), null, '無效外框 id 應回 null');
  assert.strictEqual(api.clampAvatarFrame(null), null);

  assert.strictEqual(api.buildProfileShareUrl('', 'https://ptcg.tw', ''), '', '空 profileKey 不可產生分享網址');
  assert.strictEqual(
    api.buildProfileShareUrl('abc123', 'https://suenz001.github.io/', 'ptcg-tw-sim/'),
    'https://suenz001.github.io/ptcg-tw-sim/game?card=abc123',
    '分享網址格式不符'
  );

  const pvAllOn = api.buildSelfProfilePreview({
    profileKey: 'pk_1',
    nick: '測試玩家',
    defaultNick: '測試玩家',
    bio: 'hi',
    avatar: null,
    googleVerified: true,
    champOfficial: 3,
    champCommunity: 2,
    totalWins: 18,
    showTotalWins: true,
    showOfficialCrowns: true,
    showCommunityCrowns: true,
    avatarFrame: 'admin_gold',
    pinnedHonorIds: [],
    availableHonors: [],
  });
  assert.strictEqual(pvAllOn.totalWins, 18);
  assert.strictEqual(pvAllOn.champOfficial, 3);
  assert.strictEqual(pvAllOn.champCommunity, 2);
  assert.strictEqual(pvAllOn.avatarFrame, 'admin_gold');

  const pvHidden = api.buildSelfProfilePreview({
    profileKey: 'pk_1',
    nick: '測試玩家',
    defaultNick: '測試玩家',
    bio: 'hi',
    avatar: null,
    googleVerified: true,
    champOfficial: 3,
    champCommunity: 2,
    totalWins: 18,
    showTotalWins: false,
    showOfficialCrowns: false,
    showCommunityCrowns: true,
    avatarFrame: 'admin_gold',
    pinnedHonorIds: [],
    availableHonors: [],
  });
  assert.strictEqual(pvHidden.totalWins, 0, '關閉總勝場顯示時預覽應歸 0');
  assert.strictEqual(pvHidden.champOfficial, 0, '關閉網站賽奪冠顯示時預覽應歸 0');
  assert.strictEqual(pvHidden.champCommunity, 2, '開啟的社群賽奪冠數應保留');
  assert.strictEqual(pvHidden.showTotalWins, false);
}

await T('A1 profile-api.ts 6 款外框圖鑑、clampAvatarFrame、分享連結與預覽隱藏旗標實跑', () => assertProfileApiContract());

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【B】後端 v187-player-profile 實跑（AI 排除 / 切換隱藏 / Admin 專屬外框權限）');

function extractProfileServerBlock(src) {
  const sMark = '// >>> v187-player-profile';
  const eMark = '// <<< v187-player-profile';
  const i = src.indexOf(sMark);
  const j = src.indexOf(eMark);
  assert.ok(i >= 0 && j > i, '找不到 v187-player-profile 區段標記');
  return src.slice(i, j + eMark.length);
}

function makeFakeDb() {
  const cols = new Map();
  const indexes = [];
  const getCol = (name) => {
    if (!cols.has(name)) cols.set(name, []);
    return cols.get(name);
  };
  const getPath = (obj, path) => path.split('.').reduce(
    (o, k) => (o == null ? undefined : (Array.isArray(o) ? o.map((x) => x?.[k]).filter((v) => v !== undefined) : o[k])),
    obj
  );
  const matchCond = (val, cond) => {
    if (cond instanceof RegExp) return typeof val === 'string' && cond.test(val);
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      if ('$in' in cond) {
        const arr = Array.isArray(val) ? val : [val];
        return arr.some((x) => cond.$in.includes(x));
      }
      if ('$nin' in cond) return !cond.$nin.includes(val);
      if ('$ne' in cond) return val !== cond.$ne;
      if ('$lt' in cond) return val < cond.$lt;
      if ('$gt' in cond) return val > cond.$gt;
      if ('$gte' in cond) return val >= cond.$gte;
      if ('$not' in cond) return !matchCond(val, cond.$not);
    }
    if (Array.isArray(val)) return val.includes(cond);
    return val === cond;
  };
  const matchSingle = (doc, q = {}) => {
    for (const [k, v] of Object.entries(q)) {
      if (k === '$or') {
        if (!v.some((sub) => matchSingle(doc, sub))) return false;
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
  return {
    cols,
    indexes,
    collection(name) {
      const arr = getCol(name);
      return {
        createIndex: async (spec, opts) => { indexes.push({ name, spec, opts }); return 'idx'; },
        indexes: async () => indexes.filter(index => index.name === name).map(({ spec }) => ({ key: spec })),
        findOne: async (q, opts) => {
          const hit = arr.find((d) => matchSingle(d, q));
          return hit ? project(hit, opts?.projection) : null;
        },
        find(q = {}, opts) {
          let rows = arr.filter((d) => matchSingle(d, q)).map((d) => project(d, opts?.projection));
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
        countDocuments: async (q = {}) => arr.filter((d) => matchSingle(d, q)).length,
        insertOne: async (d) => { arr.push(structuredClone(d)); return { insertedId: d._id }; },
        updateOne: async (q, upd, opts) => {
          let hit = arr.find((d) => matchSingle(d, q));
          if (!hit && opts?.upsert) {
            hit = { _id: q._id };
            if (upd.$setOnInsert) Object.assign(hit, structuredClone(upd.$setOnInsert));
            arr.push(hit);
          }
          if (!hit) return { matchedCount: 0 };
          if (upd.$set) Object.assign(hit, structuredClone(upd.$set));
          if (upd.$unset) for (const k of Object.keys(upd.$unset)) delete hit[k];
          return { matchedCount: 1 };
        },
      };
    },
  };
}

function buildBackendHarness(srcOverride, friendFeatureOn = true, clock = Date.now) {
  const srv = srcOverride ?? read(SRV_PATH);
  const block = extractProfileServerBlock(srv);
  assert.ok(!block.includes("app.get('/api/tournament"), '⚠ v187 內出現 app.get(/api/tournament 字面，會打亂 TAIL 錨點');
  assert.ok(!/require\(\s*['"]crypto['"]\s*\)/.test(block), 'oracle-admin 嚴禁 require("crypto")');
  const routes = new Map();
  const mws = [];
  const db = makeFakeDb();
  const tokens = new Map([
    ['tokA', { uid: 'uidA', email: 'Alice@Example.com', name: 'AliceOrig', firebase: { sign_in_provider: 'google.com' } }],
    ['tokB', { uid: 'uidB', email: 'bob@example.com', name: 'BobOrig', firebase: { sign_in_provider: 'password' } }],
    ['tokAdm', { uid: 'uidAdm', email: 'wilson.admin@example.com', name: 'Wilson', firebase: { sign_in_provider: 'google.com' } }],
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
        providerData: (u === 'uidA' || u === 'uidAdm') ? [{ providerId: 'google.com' }] : [{ providerId: 'password' }],
      }),
    }),
  };
  const TPOOL = new Map([
    ['19145', { id: '19145', supertype: 'Pokemon', name: '噴火龍ex' }],
  ]);
  const app = {
    locals: { _detectCutPlacements: () => ({ finals: new Set(), top4: new Set(), top8: new Set() }) },
    use: (fn) => mws.push(fn),
    get: (p, fn) => routes.set('GET ' + p, fn),
    post: (p, fn) => routes.set('POST ' + p, fn),
  };
  const normE = (v) => (typeof v === 'string' && v.includes('@') ? v.trim().toLowerCase() : null);
  const pairId = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const fidOf = (p) => createHash('sha256').update(p).digest('hex').slice(0, 16);
  const tournIdentity = async (req) => {
    const h = (req.headers && req.headers.authorization) || '';
    const m = /^Bearer\s+(.+)$/.exec(h);
    if (!m || !tokens.has(m[1])) return req.body?.playerId || req.query?.playerId
      ? { uid: 'unverified', verified: false } : { error: 'no auth', verified: false };
    const t = tokens.get(m[1]);
    return { uid: t.uid, email: normE(t.email), name: t.name, verified: true };
  };
  const isTournAdmin = (id) => !!(id && id.email === 'wilson.admin@example.com');
  const fn = new Function(
    'app', 'db', 'TADMIN', 'TPOOL',
    '_frNormEmail', '_frPairId', '_frFid', '_frNick',
    'FR_COLL', 'FR_REG_COLL', 'FR_ID_COLL', 'FR_MAX_FRIENDS', 'FR_REJECT_COOLDOWN_MS',
    'friendsEnabled', 'tournIdentity', 'isTournAdmin', '_chatRate', 'Date',
    block
  );
  fn(
    app, db, TADMIN, TPOOL,
    normE, pairId, fidOf, (s) => String(s || '').trim().slice(0, 16),
    'friendships', 'tournamentRegistrations', 'playerIdentity', 100, 86400000,
    async () => friendFeatureOn, tournIdentity, isTournAdmin, new Map(), class extends Date { static now() { return clock(); } }
  );

  const invoke = async (method, path, { token, query = {}, body = {} } = {}) => {
    const req = {
      method, path, query, body, ip: '127.0.0.1',
      headers: token ? { authorization: 'Bearer ' + token } : {},
    };
    let statusCode = 200;
    let resBody = null;
    const res = {
      status(c) { statusCode = c; return res; },
      json(d) { resBody = d; return res; },
    };
    const handler = routes.get(method + ' ' + path);
    if (!handler) throw new Error('Route not found: ' + method + ' ' + path);
    await handler(req, res);
    return { statusCode, body: resBody };
  };
  return { db, invoke };
}

async function assertBackendUpgrades(buildFn = buildBackendHarness) {
  const { db, invoke } = buildFn();

  // 1. Sparse indexes registered on matchRecords
  const mrIdxs = db.indexes.filter((x) => x.name === 'matchRecords').map((x) => JSON.stringify(x.spec));
  assert.deepStrictEqual(mrIdxs, ['{"profileVerifiedWinner":1}'], '名片只需要已核實勝方索引');

  // 2. Seed casual online matches, AI/local matches (no roomCode), AFK turn-1, and tournament matches (with bye/noShow)
  const row = { roomCode: 'AB1234', mode: 'online', vsAI: false, winner: 0,
    profileVerifiedWinner: 'alice@example.com', finalTurn: 6, winReason: '獎賞卡拿完' };
  for (const [i, patch] of [{}, { vsAI: true }, { mode: 'local' }, { roomCode: ' ' },
    { finalTurn: 1, winReason: '第 1 回合未進場無回應' }, { profileVerifiedWinner: 'bob@example.com' },
    { profileVerifiedWinner: undefined, p1: { email: 'alice@example.com' } }].entries()) {
    await db.collection('matchRecords').insertOne({ _id: 'm' + i, ...row, ...patch });
  }

  await db.collection('tournamentArchives').insertOne({
    _id: 'arch_ev1',
    eventId: 'ev1',
    eventName: '官網春季冠軍賽',
    finishedAt: 1760000000000,
    communityEvent: false,
    championUid: 'uidA',
    players: [
      { uid: 'uidA', name: 'Alice', email: 'alice@example.com' },
      { uid: 'uidB', name: 'Bob', email: 'bob@example.com' },
    ],
    matches: [
      { round: 1, idx: 0, p1uid: 'uidA', p2uid: 'uidB', winnerUid: 'uidA' },
      { round: 2, idx: 0, p1uid: 'uidA', p2uid: null, winnerUid: 'uidA', bye: true },
      { round: 3, idx: 0, p1uid: 'uidA', p2uid: 'uidB', winnerUid: 'uidA', noShow: true },
      { round: 4, idx: 0, p1uid: 'uidA', p2uid: 'uidB', winnerUid: 'uidA' },
    ],
  });
  await db.collection('tournamentArchives').insertOne({
    _id: 'arch_ev2',
    eventId: 'ev2',
    eventName: '社群週末盃',
    finishedAt: 1761000000000,
    communityEvent: true,
    championUid: 'uidA',
    players: [{ uid: 'uidA', name: 'Alice', email: 'alice@example.com' }],
    matches: [],
  });

  // 3. Check totalWins calculation (1 casual online + 2 non-bye/non-noShow tournament wins = 3)
  const me1 = await invoke('GET', '/api/player-profile/me', { token: 'tokA', query: { refresh: '1' } });
  assert.strictEqual(me1.statusCode, 200);
  assert.strictEqual(me1.body.profile.casualOnlineWins, 1, '只應計算 1 場有房號非 T1 AFK 的一般線上勝場（AI 必須排除）');
  assert.strictEqual(me1.body.profile.tournamentWins, 2, '應計算 2 場真實錦標賽勝場並排除 bye/noShow');
  assert.strictEqual(me1.body.profile.totalWins, 3, 'totalWins 應等於 casualOnlineWins + tournamentWins');
  assert.strictEqual(me1.body.profile.champOfficial, 1);
  assert.strictEqual(me1.body.profile.champCommunity, 1);

  // 4. Toggle visibility off & attempt player avatarFrame spoof on /save
  const sv1 = await invoke('POST', '/api/player-profile/save', {
    token: 'tokA',
    body: {
      nick: '愛麗絲',
      bio: '競技玩家',
      avatarFrame: 'admin_gold', // 嘗試自行竄改外框，後端必須忽略
      showTotalWins: false,
      showOfficialCrowns: true,
      showCommunityCrowns: false,
    },
  });
  assert.strictEqual(sv1.statusCode, 200);
  assert.strictEqual(sv1.body.profile.avatarFrame, null, '玩家 /save 絕不可自行設定 avatarFrame');
  const docAfterSv1 = await db.collection('playerProfiles').findOne({ _id: 'alice@example.com' });
  assert.strictEqual(docAfterSv1?.avatarFrame ?? null, null, '玩家 /save 絕不可將偽造 avatarFrame 寫入資料庫');
  const pKeyA = sv1.body.profile.profileKey;

  const vwHidden = await invoke('GET', '/api/player-profile/view', { token: 'tokB', query: { profileKey: pKeyA } });
  assert.strictEqual(vwHidden.statusCode, 200);
  assert.strictEqual('email' in vwHidden.body, false, '/view 不可外洩 email');
  assert.strictEqual(vwHidden.body.avatarFrame, null, '玩家 /save 偽造之 avatarFrame 絕不可在 /view 出現');
  assert.strictEqual(vwHidden.body.totalWins, 0, '關閉 showTotalWins 後公開 /view 必須為 0');
  assert.strictEqual(vwHidden.body.showTotalWins, false);
  assert.strictEqual(vwHidden.body.champOfficial, 1);
  assert.strictEqual(vwHidden.body.champCommunity, 0, '關閉 showCommunityCrowns 後公開 /view 必須為 0');

  // Re-enable all stats (respect 800ms /save rate limit)
  await new Promise((r) => setTimeout(r, 850));
  const sv2 = await invoke('POST', '/api/player-profile/save', {
    token: 'tokA',
    body: { nick: '愛麗絲', bio: '競技玩家', showTotalWins: true, showOfficialCrowns: false, showCommunityCrowns: true },
  });
  assert.strictEqual(sv2.statusCode, 200);
  const vwMixed = await invoke('GET', '/api/player-profile/view', { token: 'tokB', query: { profileKey: pKeyA } });
  assert.strictEqual(vwMixed.body.totalWins, 3);
  assert.strictEqual(vwMixed.body.champOfficial, 0);
  assert.strictEqual(vwMixed.body.champCommunity, 1);

  // 5. Admin-only frame assignment: unauthenticated -> 401, non-admin -> 403
  const unauthGet = await invoke('GET', '/api/admin/player-profile/frame', { query: { email: 'alice@example.com' } });
  assert.strictEqual(unauthGet.statusCode, 401, '未登入查詢 /frame 必須回 401');
  const unauthPost = await invoke('POST', '/api/admin/player-profile/frame', { body: { email: 'alice@example.com', avatarFrame: 'admin_gold' } });
  assert.strictEqual(unauthPost.statusCode, 401, '未登入指派 /frame 必須回 401');
  const nonAdmGet = await invoke('GET', '/api/admin/player-profile/frame', { token: 'tokA', query: { email: 'alice@example.com' } });
  assert.strictEqual(nonAdmGet.statusCode, 403, '非管理員查詢 /frame 必須回 403');
  const nonAdmPost = await invoke('POST', '/api/admin/player-profile/frame', { token: 'tokB', body: { email: 'alice@example.com', avatarFrame: 'admin_gold' } });
  assert.strictEqual(nonAdmPost.statusCode, 403, '非管理員指派 /frame 必須回 403');

  // Admin invalid frame returns 400
  const badFrame = await invoke('POST', '/api/admin/player-profile/frame', { token: 'tokAdm', body: { email: 'alice@example.com', avatarFrame: 'non_existent' } });
  assert.strictEqual(badFrame.statusCode, 400, '無效外框 id 應回 400');

  // Admin assigns new v6.663 frame (moon_eclipse) & verify frames catalog has 20 items
  const admNew = await invoke('POST', '/api/admin/player-profile/frame', { token: 'tokAdm', body: { email: 'alice@example.com', avatarFrame: 'moon_eclipse' } });
  assert.strictEqual(admNew.statusCode, 200);
  assert.strictEqual(admNew.body.avatarFrame, 'moon_eclipse');
  const admGetNew = await invoke('GET', '/api/admin/player-profile/frame', { token: 'tokAdm', query: { email: 'alice@example.com' } });
  assert.strictEqual(admGetNew.statusCode, 200);
  assert.strictEqual(admGetNew.body.avatarFrame, 'moon_eclipse');
  assert.ok(Array.isArray(admGetNew.body.frames) && admGetNew.body.frames.length === 20, '後端外框白名單應有 20 款');

  // Admin assigns admin_gold
  const admSet = await invoke('POST', '/api/admin/player-profile/frame', { token: 'tokAdm', body: { email: 'alice@example.com', avatarFrame: 'admin_gold' } });
  assert.strictEqual(admSet.statusCode, 200);
  assert.strictEqual(admSet.body.avatarFrame, 'admin_gold');

  const admGet = await invoke('GET', '/api/admin/player-profile/frame', { token: 'tokAdm', query: { email: 'alice@example.com' } });
  assert.strictEqual(admGet.statusCode, 200);
  assert.strictEqual(admGet.body.avatarFrame, 'admin_gold');

  // Immediately visible in /view, /me, /batch
  const vwFrame = await invoke('GET', '/api/player-profile/view', { token: 'tokB', query: { profileKey: pKeyA } });
  assert.strictEqual(vwFrame.body.avatarFrame, 'admin_gold');
  const batchFrame = await invoke('POST', '/api/player-profile/batch', { token: 'tokB', body: { items: [{ k: 'seat0', profileKey: pKeyA }] } });
  assert.strictEqual(batchFrame.body.profiles.seat0.avatarFrame, 'admin_gold');
  assert.strictEqual('email' in batchFrame.body.profiles.seat0, false, '/batch 不可外洩 email');

  // Wait > 800ms or overwrite rate map? Wait: let's bypass 800ms rate limit with another user? No, sleep 850ms to verify player /save preserves admin frame!
  await new Promise((r) => setTimeout(r, 850));
  const svKeepFrame = await invoke('POST', '/api/player-profile/save', {
    token: 'tokA',
    body: { nick: '愛麗絲2', bio: '更新簡介', avatarFrame: null },
  });
  assert.strictEqual(svKeepFrame.statusCode, 200);
  assert.strictEqual(svKeepFrame.body.profile.avatarFrame, 'admin_gold', '玩家重新存檔絕不能覆蓋或清除 Admin 指定之外框');

  // Admin removes frame
  const admClear = await invoke('POST', '/api/admin/player-profile/frame', { token: 'tokAdm', body: { email: 'alice@example.com', avatarFrame: null } });
  assert.strictEqual(admClear.statusCode, 200);
  assert.strictEqual(admClear.body.avatarFrame, null);
  const vwCleared = await invoke('GET', '/api/player-profile/view', { token: 'tokB', query: { profileKey: pKeyA } });
  assert.strictEqual(vwCleared.body.avatarFrame, null);
}

await T('B1 後端 v187 總勝場（排除 AI／T1 無回應／bye／noShow）、隱藏切換、零 email 與 Admin 專屬外框權限', () => assertBackendUpgrades());

async function assertFirstShare(src) {
  const { invoke } = buildBackendHarness(src);
  const me = await invoke('GET', '/api/player-profile/me', { token: 'tokA' });
  assert.equal(me.statusCode, 200);
  const profileKey = me.body.profile.profileKey;
  assert.match(profileKey, /^[0-9a-f]{20}$/);
  const shared = await invoke('GET', '/api/player-profile/view', { query: { profileKey } });
  assert.equal(shared.body.found, true, '首次讀取本人名片後，連結立即可公開解析');
}
await T('B2 尚未存過名片即可分享', () => assertFirstShare());

function deferredResolution() {
  let resolve;
  const promise = new Promise(settle => { resolve = settle; });
  return { promise, resolve };
}

async function assertVisibilityRace(src) {
  const { invoke, db } = buildBackendHarness(src);
  const me = await invoke('GET', '/api/player-profile/me', { token: 'tokA' });
  const profileKey = me.body.profile.profileKey;
  await db.collection('matchRecords').insertOne({ _id: 'normal', roomCode: 'ABCD', mode: 'online',
    winner: 0, finalTurn: 4, p1: { email: 'alice@example.com' }, profileVerifiedWinner: 'alice@example.com' });
  const held = deferredResolution();
  const arrived = deferredResolution();
  const collect = db.collection.bind(db);
  db.collection = (name) => {
    const col = collect(name);
    if (name === 'playerProfiles') {
      const update = col.updateOne;
      col.updateOne = async (...args) => {
        if (args[1]?.$set?.nick === '舊頁籤') {
          arrived.resolve();
          await held.promise;
        }
        return update(...args);
      };
    }
    return col;
  };
  const earlier = invoke('POST', '/api/player-profile/save', { token: 'tokA', body: { nick: '舊頁籤' } });
  await arrived.promise;
  try {
    await new Promise(resolve => setTimeout(resolve, 850));
    const hidden = await invoke('POST', '/api/player-profile/save', { token: 'tokA', body: { nick: '新頁籤',
      showTotalWins: false, showOfficialCrowns: false, showCommunityCrowns: false } });
    assert.equal(hidden.statusCode, 200);
  } finally { held.resolve(); }
  const finished = await earlier;
  assert.equal(finished.statusCode, 200);
  assert.equal(finished.body.profile.showTotalWins, false);
  const view = await invoke('GET', '/api/player-profile/view', { query: { profileKey } });
  assert.equal(view.body.totalWins, 0);
  for (const key of ['showTotalWins', 'showOfficialCrowns', 'showCommunityCrowns']) {
    assert.equal(view.body[key], false, key + ' 不得被舊頁籤恢復公開');
  }
}
await T('B3 舊存檔晚到不會恢復任一隱私旗標', () => assertVisibilityRace());

await T('B4 好友停用、管理員只有合法的認證及明確外框欄位可更新', async () => {
  const { invoke } = buildBackendHarness(undefined, false);
  const me = await invoke('GET', '/api/player-profile/me', { token: 'tokA' });
  const profileKey = me.body.profile.profileKey;
  const guest = await invoke('GET', '/api/player-profile/view', { query: { profileKey } });
  assert.equal(guest.body.friendStatus, 'unavailable');
  const adminPath = '/api/admin/player-profile/frame';
  assert.equal((await invoke('GET', adminPath, { query: { playerId: 'x', email: 'alice@example.com' } })).statusCode, 401);
  assert.equal((await invoke('POST', adminPath, { body: { playerId: 'x', email: 'alice@example.com' } })).statusCode, 401);
  await invoke('POST', adminPath, { token: 'tokAdm', body: { email: 'alice@example.com', avatarFrame: 'cyber_neon' } });
  assert.equal((await invoke('POST', adminPath, { token: 'tokAdm', body: { email: 'alice@example.com' } })).statusCode, 400);
  assert.equal((await invoke('GET', adminPath, { token: 'tokAdm', query: { email: 'alice@example.com' } })).body.avatarFrame, 'cyber_neon');
});

await T('B5 同帳號併發統計只查一次，查詢失敗不寫入快取', async () => {
  const { invoke, db } = buildBackendHarness();
  const wait = deferredResolution();
  const started = deferredResolution();
  const collect = db.collection.bind(db);
  let counts = 0;
  db.collection = (name) => {
    const col = collect(name);
    if (name === 'matchRecords') {
      col.countDocuments = async (_query, options) => {
        assert.deepStrictEqual(options?.hint, { profileVerifiedWinner: 1 }, '索引未完成時不得退整庫掃描');
        counts++;
        if (counts === 1) { started.resolve(); await wait.promise; throw new Error('模擬資料庫中斷'); }
        return 2;
      };
      col.find = () => { throw new Error('名片勝場不能讀回歷史列'); };
    }
    return col;
  };
  const run = () => invoke('GET', '/api/player-profile/me', { token: 'tokA' });
  const requests = [run(), run(), run()];
  await started.promise;
  await new Promise(resolve => setImmediate(resolve));
  const inFlightCount = counts;
  wait.resolve();
  assert.deepStrictEqual((await Promise.all(requests)).map(result => result.statusCode), [500, 500, 500]);
  assert.equal(inFlightCount, 1);
  assert.equal((await run()).body.profile.casualOnlineWins, 2);
  assert.equal((await run()).body.profile.casualOnlineWins, 2);
  assert.equal(counts, 2);
});

async function assertWinIndexRecovery(src) {
  let now = 100000;
  const { db, invoke } = buildBackendHarness(src, true, () => now);
  await new Promise(resolve => setImmediate(resolve));
  await db.collection('tournamentArchives').insertOne({ eventId: 'champion', championUid: 'uA',
    players: [{ uid: 'uA', email: 'alice@example.com' }], matches: [] });
  const collect = db.collection.bind(db);
  let indexed = false, checks = 0, builds = 0, counts = 0, scans = 0;
  let holdStaleFailures = false;
  const staleFailures = [];
  db.collection = (name) => {
    const col = collect(name);
    if (name !== 'matchRecords') return col;
    col.indexes = async (options) => {
      assert.deepEqual(options, { maxTimeMS: 3000 });
      checks++;
      return indexed ? [{ key: { profileVerifiedWinner: 1 } }] : [];
    };
    col.createIndex = async (key, options) => {
      assert.deepEqual(key, { profileVerifiedWinner: 1 });
      assert.equal(options.sparse, true);
      builds++;
      throw new Error('首次重建暫時失敗');
    };
    col.find = () => { scans++; throw new Error('不得讀整份歷史戰報'); };
    col.countDocuments = async (_query, options) => {
      counts++;
      assert.deepEqual(options, { hint: { profileVerifiedWinner: 1 }, maxTimeMS: 3000 });
      if (holdStaleFailures) await new Promise(resolve => staleFailures.push(resolve));
      if (!indexed) throw Object.assign(new Error('hint provided does not correspond to an existing index'), { code: 2 });
      return 3;
    };
    return col;
  };
  const me = () => invoke('GET', '/api/player-profile/me', { token: 'tokA' });
  const [own, other] = await Promise.all([me(), invoke('GET', '/api/player-profile/me', { token: 'tokB' })]);
  assert.equal(own.statusCode, 200, '索引缺席時本人名片可用');
  assert.equal(other.statusCode, 200);
  assert.equal(own.body.profile.casualOnlineWins, 0);
  assert.equal(own.body.profile.champOfficial, 1);
  const view = await invoke('GET', '/api/player-profile/view', { query: { profileKey: own.body.profile.profileKey } });
  assert.equal(view.statusCode, 200);
  assert.equal(view.body.found, true);
  assert.equal(view.body.champOfficial, 1);
  const save = await invoke('POST', '/api/player-profile/save', { token: 'tokA', body: { nick: '新暱稱' } });
  assert.equal(save.statusCode, 200);
  assert.deepEqual({ checks, builds, counts, scans }, { checks: 1, builds: 1, counts: 0, scans: 0 });
  now += 10001;
  assert.equal((await me()).statusCode, 200);
  assert.deepEqual({ checks, builds, counts }, { checks: 2, builds: 2, counts: 0 }, '暫時失敗後再次補建');
  indexed = true;
  now += 10001;
  assert.equal((await me()).body.profile.casualOnlineWins, 3, '降級的 0 勝未進 60 秒快取');
  assert.equal((await me()).body.profile.casualOnlineWins, 3);
  assert.deepEqual({ checks, builds, counts, scans }, { checks: 3, builds: 2, counts: 1, scans: 0 });

  // 兩個帳號已送出帶 hint 的計數，索引此時被移除，第二個錯誤在補建嘗試結束後才到。
  indexed = false;
  holdStaleFailures = true;
  const requests = ['tokA', 'tokB'].map(token => invoke('GET', '/api/player-profile/me', { token, query: { refresh: '1' } }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(staleFailures.length, 2, '兩個請求都已用原本的索引就緒狀態');
  for (let i = 0; i < requests.length; i++) {
    staleFailures[i]();
    const result = await requests[i];
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.profile.casualOnlineWins, 0);
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.deepEqual({ checks, builds, counts, scans }, { checks: 3, builds: 3, counts: 3, scans: 0 }, '遲到錯誤不可再次補建');
}

async function assertFirstShareDuplicate(src) {
  const { db, invoke } = buildBackendHarness(src);
  const collect = db.collection.bind(db);
  let duplicates = 0;
  db.collection = (name) => {
    const col = collect(name);
    if (name === 'playerProfiles') {
      const update = col.updateOne;
      col.updateOne = async (filter, fields, options) => {
        if (!options?.upsert) return update(filter, fields, options);
        if (filter._id === 'bob@example.com') throw Object.assign(new Error('其他寫入失敗'), { code: 7 });
        await update(filter, fields, options); // 模擬先到的請求已插入相同文件。
        duplicates++;
        throw Object.assign(new Error('duplicate key'), { code: 11000 });
      };
    }
    return col;
  };
  const first = await invoke('GET', '/api/player-profile/me', { token: 'tokA' });
  assert.equal(duplicates, 1);
  assert.equal(first.statusCode, 200, '同一文件的並行 E11000 應讀回名片');
  const shared = await invoke('GET', '/api/player-profile/view', { query: { profileKey: first.body.profile.profileKey } });
  assert.equal(shared.body.found, true);
  assert.equal((await invoke('GET', '/api/player-profile/me', { token: 'tokB' })).statusCode, 500);
}

await T('B6 勝場索引缺席保留名片與榮譽，重試後以 hint 恢復計數', async () => {
  const source = read(SRV_PATH);
  await assertWinIndexRecovery(source);
  for (const mutant of [source.replace('      if (!(await _profWinIndexReady())) return null;\n', ''),
    source.replace('if (!data.winIndexUnavailable)', 'if (true)'),
    source.replace('if (_profWinIndexStatus === ready)', 'if (true)')]) {
    assert.notEqual(mutant, source);
    await mutantMustBreak('M_v6661_match_index', () => assertWinIndexRecovery(mutant));
  }
});
await T('B7 初次分享並行插入只容錯 E11000', async () => {
  const source = read(SRV_PATH);
  await assertFirstShareDuplicate(source);
  const mutant = source.replace('              if (e?.code !== 11000) throw e;', '              throw e;');
  assert.notEqual(mutant, source);
  await mutantMustBreak('M_v6661_profile_upsert', () => assertFirstShareDuplicate(mutant));
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【C】Playwright 真瀏覽器實測＋全站接線檢查');

async function buildUiBundle(modalSrcOverride) {
  const dir = mkdtempSync(join(tmpdir(), 'v6659-ui-'));
  try {
    const rewriteRel = (code) => code
      .replace(/['"]\.\/AvatarCircle\.svelte['"]/g, "'./AvatarCircle.js'")
      .replace(/['"]\.\/PlayerProfileModal\.svelte['"]/g, "'./PlayerProfileModal.js'");
    writeFileSync(join(dir, 'profile-api.ts'), read(API_PATH));
    writeFileSync(join(dir, 'AvatarCircle.js'), compile(read(AV_PATH), { generate: 'client', filename: 'AvatarCircle.svelte', runes: true, css: 'injected' }).js.code);
    writeFileSync(join(dir, 'PlayerProfileModal.js'), rewriteRel(compile(modalSrcOverride ?? read(MODAL_PATH), { generate: 'client', filename: 'PlayerProfileModal.svelte', runes: true, css: 'injected' }).js.code));
    writeFileSync(join(dir, 'PlayerProfileEditor.js'), rewriteRel(compile(read(EDIT_PATH), { generate: 'client', filename: 'PlayerProfileEditor.svelte', runes: true, css: 'injected' }).js.code));
    const raceHarnessSvelte = `
<script lang="ts">
  import Modal from './PlayerProfileModal.svelte';
  let { target, getAuthCtx }: any = $props();
  let vUid = $state('');
  (globalThis as any).__setRaceViewerUid = (u: string) => { vUid = u; };
</script>
<Modal open={true} {target} viewerUid={vUid} {getAuthCtx} onRequestLogin={() => {}} onclose={() => {}} />
`;
    writeFileSync(join(dir, 'RaceHarness.js'), rewriteRel(compile(raceHarnessSvelte, { generate: 'client', filename: 'RaceHarness.svelte', runes: true, css: 'injected' }).js.code));
    writeFileSync(join(dir, 'entry.js'), [
      "import { mount } from 'svelte';",
      "import AvatarCircle from './AvatarCircle.js';",
      "import Modal from './PlayerProfileModal.js';",
      "import Editor from './PlayerProfileEditor.js';",
      "import RaceHarness from './RaceHarness.js';",
      "import { renderProfileCardToCanvas, AVATAR_FRAMES } from './profile-api.ts';",
      "globalThis.__mountAvatar = (t, p) => mount(AvatarCircle, { target: t, props: p });",
      "globalThis.__mountModal = (t, p) => mount(Modal, { target: t, props: p });",
      "globalThis.__mountEditor = (t, p) => mount(Editor, { target: t, props: p });",
      "globalThis.__mountRaceHarness = (t, p) => mount(RaceHarness, { target: t, props: p });",
      "globalThis.__renderCardCanvas = renderProfileCardToCanvas;",
      "globalThis.__AVATAR_FRAMES = AVATAR_FRAMES;",
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
    writeFileSync(stubPool, 'export async function loadIndex(){ return []; }\nexport async function loadSet(){ return []; }\nexport async function loadAllSets(){ return []; }\nexport async function loadCardSetMap(){ return {}; }\n');

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
    return readFileSync(join(dir, 'bundle.js'), 'utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const chromium = pwChromium('v6.659');
let defaultBundle = '';
if (chromium) {
  defaultBundle = await buildUiBundle();
}

async function assertModalSelfVsOtherUi(browser, bundle, { legacyBadges = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
  const pg = await ctx.newPage();
  const pageErrors = [];
  let authenticatedViews = 0;
  const delayedViewer = deferredResolution();
  pg.on('pageerror', (e) => pageErrors.push(e.message));
  try {
    await pg.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.endsWith('.png') || url.includes('.webp')) {
        return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="868" height="1212"><rect width="868" height="1212" fill="#2c5"/></svg>' });
      }
      if (url.includes('/api/player-profile/view?profileKey=pk_other')) {
        return route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            playerProfileApi: 1, found: true, profileKey: 'pk_other', nick: '對手選手', bio: '對手名片',
            avatar: null, googleVerified: true, avatarFrame: 'sponsor_diamond',
            totalWins: 1243, champOfficial: 12, champCommunity: 100,
            showTotalWins: true, showOfficialCrowns: true, showCommunityCrowns: true,
            pinnedHonors: [{ eventId: 'e1', eventName: '春季賽', date: 1760000000000, kind: 'site', placementLabel: '冠軍' }],
            canFriend: true, friendStatus: 'none',
          }),
        });
      }
      if (url.includes('/api/player-profile/view?profileKey=pk_self')) {
        const auth = route.request().headers()['authorization'] || '';
        const isAuth = auth.includes('t_self');
        if (isAuth) authenticatedViews++;
        if (auth.includes('t_next')) await delayedViewer.promise;
        return route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            playerProfileApi: 1, found: true, profileKey: 'pk_self', nick: '我自己的名字', bio: '自己名片',
            avatar: null, googleVerified: true, avatarFrame: 'admin_gold',
            totalWins: 25, champOfficial: 2, champCommunity: 1,
            showTotalWins: true, showOfficialCrowns: true, showCommunityCrowns: true,
            pinnedHonors: [], canFriend: false, friendStatus: isAuth ? 'self' : 'none',
          }),
        });
      }
      if (url.includes('/api/player-profile/view?profileKey=pk_disabled_fr')) {
        return route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            playerProfileApi: 1, found: true, profileKey: 'pk_disabled_fr', nick: '好友功能關閉對象', bio: '',
            avatar: null, googleVerified: false, avatarFrame: null,
            totalWins: 5, champOfficial: 0, champCommunity: 0,
            showTotalWins: true, showOfficialCrowns: true, showCommunityCrowns: true,
            pinnedHonors: [], canFriend: false, friendStatus: 'unavailable',
          }),
        });
      }
      return route.fulfill({ contentType: 'text/plain', body: 'ok' });
    });

    // 1. Check viewing OTHER player card on 393x852 iPhone viewport:
    //    - All 3 badges on 1 line, right <= closeLeft, top >= 59, NO download/share buttons!
    await pg.setContent(`<!DOCTYPE html><html><head><style>:root{--safe-top:59px;--safe-bottom:34px;}body{margin:0;}</style></head><body><div id="app"></div><script>${bundle}</script></body></html>`);
    await pg.evaluate(() => {
      window.__loginRequested = 0;
      window.__mountModal(document.getElementById('app'), {
        open: true,
        target: { profileKey: 'pk_other' },
        getAuthCtx: async () => null,
        onclose: () => {},
        onRequestLogin: () => { window.__loginRequested++; },
      });
    });
    await pg.waitForSelector('.ppm-nick');
    assert.strictEqual(await pg.locator('.ppm-self-actions').count(), 0, '看他人名片絕不可顯示下載或分享操作區');
    assert.strictEqual(await pg.getByRole('button', { name: /下載名片/ }).count(), 0, '看他人名片絕不可出現「📥 下載名片」');
    assert.strictEqual(await pg.getByRole('button', { name: /分享名片/ }).count(), 0, '看他人名片絕不可出現「🔗 分享名片」');

    const geo = await pg.evaluate(() => {
      const card = document.querySelector('.ppm-card');
      const badges = Array.from(document.querySelectorAll('.ppm-crown'));
      const closeBtn = document.querySelector('.ppm-close');
      const tops = badges.map((b) => b.getBoundingClientRect().top);
      const rights = badges.map((b) => b.getBoundingClientRect().right);
      return {
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        cardTop: card.getBoundingClientRect().top,
        badgeCount: badges.length,
        badgeTexts: badges.map((b) => b.textContent.trim()),
        badgeClipped: badges.some((b) => b.scrollWidth > b.clientWidth),
        maxTopDiff: Math.max(...tops) - Math.min(...tops),
        badgesRight: Math.max(...rights),
        closeLeft: closeBtn.getBoundingClientRect().left,
        framePillCount: document.querySelectorAll('.ppm-frame-pill').length,
        frameBadgeCount: document.querySelectorAll('.prof-av-frame-badge').length,
        frameSvgCount: document.querySelectorAll('.prof-av-frame-svg').length,
      };
    });
    assert.strictEqual(geo.overflow, false, '393px 名片不得有水平捲動');
    assert.ok(geo.cardTop >= 59, '名片上緣不可被動態島遮住：' + geo.cardTop);
    assert.strictEqual(geo.badgeCount, 3, '頂部應完整顯示 3 個統計徽章');
    if (legacyBadges) {
      assert.ok(geo.badgeTexts[0].startsWith('⚔️ 總勝'), '舊版總勝場應排在第一個');
    } else {
      assert.deepEqual(geo.badgeTexts, ['⚔️ 1243勝', '網站 12冠', '社群 100冠']);
      assert.equal(geo.badgeClipped, false, '戰績徽章需顯示完整數字');
      assert.strictEqual(geo.framePillCount, 0, '他人名片不可顯示外框名稱標籤（純粹顯示外框）');
      assert.strictEqual(geo.frameBadgeCount, 0, '頭像外框不可顯示右上角小圖示');
      assert.strictEqual(geo.frameSvgCount, 1, '他人名片應渲染立體 SVG 裝飾外框');
    }
    assert.ok(geo.maxTopDiff < 8, 'iPhone 393px 下 3 顆徽章應維持單行：diff=' + geo.maxTopDiff);
    assert.ok(geo.badgesRight <= geo.closeLeft + 0.5, '徽章列不可撞進 ✕ 關閉鈕');

    // Guest clicking '+ 加好友' triggers onRequestLogin
    await pg.locator('.ppm-fr-btn').click();
    assert.strictEqual(await pg.evaluate(() => window.__loginRequested), 1, '未登入訪客點 + 加好友應觸發 onRequestLogin');

    // 2. Check viewing SELF card ('self'): Download + Share MUST appear!
    await pg.setContent(`<!DOCTYPE html><html><head><style>:root{--safe-top:59px;--safe-bottom:34px;}body{margin:0;}</style></head><body><div id="app"></div><script>${bundle}</script></body></html>`);
    await pg.evaluate(() => {
      window.__mountModal(document.getElementById('app'), {
        open: true,
        target: { profileKey: 'pk_self' },
        viewerUid: 'u1',
        getAuthCtx: async () => ({ uid: 'u1', token: 't_self' }),
        onclose: () => {},
      });
    });
    await pg.waitForSelector('.ppm-self-actions');
    assert.strictEqual(await pg.getByRole('button', { name: /下載名片/ }).count(), 1, '查看自己名片時應顯示下載鈕');
    assert.strictEqual(await pg.getByRole('button', { name: /分享名片/ }).count(), 1, '查看自己名片時應顯示分享鈕');

    // 3. Check non-self previewCard (AI opponent / hotseat P2 / unresolved seat): MUST NOT show Download / Share!
    await pg.setContent(`<!DOCTYPE html><html><head><style>:root{--safe-top:59px;--safe-bottom:34px;}body{margin:0;}</style></head><body><div id="app"></div><script>${bundle}</script></body></html>`);
    await pg.evaluate(() => {
      window.__mountModal(document.getElementById('app'), {
        open: true,
        previewCard: {
          found: true, profileKey: '', nick: '🤖 AI 對戰對手', bio: '🤖 AI 對戰對手',
          avatar: null, googleVerified: false, champOfficial: 0, champCommunity: 0,
          pinnedHonors: [], canFriend: false, friendStatus: 'unavailable',
        },
        getAuthCtx: async () => null,
        onclose: () => {},
      });
    });
    await pg.waitForSelector('.ppm-nick');
    assert.strictEqual(await pg.locator('.ppm-self-actions').count(), 0, '非本人 previewCard（AI／P2／未解析座位）絕不可顯示下載或分享操作區');

    // 4. Check logged-in user when server returns canFriend:false with onRequestLogin set: '+ 加好友' MUST NOT appear
    await pg.setContent(`<!DOCTYPE html><html><head><style>:root{--safe-top:59px;--safe-bottom:34px;}body{margin:0;}</style></head><body><div id="app"></div><script>${bundle}</script></body></html>`);
    await pg.evaluate(() => {
      window.__mountModal(document.getElementById('app'), {
        open: true,
        target: { profileKey: 'pk_disabled_fr' },
        viewerUid: 'u_logged_in',
        getAuthCtx: async () => ({ uid: 'u_logged_in', token: 't_other' }),
        onRequestLogin: () => {},
        onclose: () => {},
      });
    });
    await pg.waitForSelector('.ppm-nick');
    assert.strictEqual(await pg.locator('.ppm-fr-btn').count(), 0, '已登入且後端回 canFriend=false 時不可誤顯示加好友鈕');
    await pg.setContent(`<div id="app"></div><script>${bundle}</script>`);
    await pg.evaluate(() => {
      window.__mountModal(document.getElementById('app'), {
        open: true, target: { profileKey: 'pk_disabled_fr' }, getAuthCtx: async () => null,
        onRequestLogin: () => {}, onclose: () => {},
      });
    });
    await pg.waitForSelector('.ppm-nick');
    assert.equal(await pg.locator('.ppm-fr-btn').count(), 0, '好友停用也不對訪客引導登入');

    // 5. Check ?card= startup auth race: viewerUid transitions '' -> 'u1' re-fetches authenticated & updates to self view
    await pg.setContent(`<!DOCTYPE html><html><head><style>:root{--safe-top:59px;--safe-bottom:34px;}body{margin:0;}</style></head><body><div id="app"></div><script>${bundle}</script></body></html>`);
    await pg.evaluate(() => {
      window.__curRaceToken = '';
      window.__mountRaceHarness(document.getElementById('app'), {
        target: { profileKey: 'pk_self' },
        getAuthCtx: async () => (window.__curRaceToken
          ? { uid: window.__curRaceToken === 't_next' ? 'u2' : 'u1', token: window.__curRaceToken } : null),
      });
    });
    await pg.waitForSelector('.ppm-fr-btn');
    assert.strictEqual(await pg.locator('.ppm-self-actions').count(), 0, '登入完成前暫為未認證狀態');
    authenticatedViews = 0;
    await pg.evaluate(() => {
      window.__curRaceToken = 't_self';
      window.__setRaceViewerUid('u1');
    });
    await pg.waitForTimeout(300);
    assert.strictEqual(await pg.locator('.ppm-self-actions').count(), 1, '登入完成後必須自動重抓並顯示自己名片操作區');
    assert.strictEqual(await pg.locator('.ppm-fr-btn').count(), 0, '登入完成後必須自動重抓為自己名片，不該殘留加好友鈕');
    assert.equal(authenticatedViews, 1, '登入切換只能送出一次名片查詢');
    await pg.evaluate(() => {
      window.__curRaceToken = 't_next';
      window.__setRaceViewerUid('u2');
    });
    await pg.waitForTimeout(35);
    assert.equal(await pg.locator('.ppm-self-actions').count(), 0, '新帳號查詢在途不可操作前一個帳號的名片');
    delayedViewer.resolve();
    await pg.waitForSelector('.ppm-nick');

    assert.deepStrictEqual(pageErrors, [], 'Playwright 不可有 pageerror：' + pageErrors.join('; '));
  } finally {
    delayedViewer.resolve();
    await ctx.close();
  }
}

if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.659');
  if (browser) {
    try {
      await T('C1 Playwright iPhone 393×852：嚴格本人下載/分享顯示、他人隱藏、3 徽章單行不重疊與訪客加好友登入接力', () => assertModalSelfVsOtherUi(browser, defaultBundle));

      await T('C2 Playwright 編輯器點擊切換 3 項統計徽章（aria-pressed）、Canvas 780px PNG 輸出（純外框無標籤）與 AvatarCircle 20 款立體 SVG 外框渲染', async () => {
        const ctx = await browser.newContext({ viewport: { width: 800, height: 900 } });
        const pg = await ctx.newPage();
        try {
          await pg.route('**/*', (route) => {
            const url = route.request().url();
            if (url.includes('/api/player-profile/me')) {
              return route.fulfill({
                contentType: 'application/json',
                body: JSON.stringify({
                  playerProfileApi: 1,
                  profile: {
                    profileKey: 'pk_me', nick: '站長', defaultNick: '站長', bio: 'hi',
                    avatar: null, googleVerified: true, avatarFrame: 'admin_gold',
                    champOfficial: 4, champCommunity: 1, totalWins: 30,
                    showTotalWins: true, showOfficialCrowns: true, showCommunityCrowns: true,
                    pinnedHonorIds: [], availableHonors: [],
                  },
                }),
              });
            }
            if (url.includes('/api/player-profile/save')) {
              const reqBody = JSON.parse(route.request().postData() || '{}');
              globalThis.__lastSavePayload = reqBody;
              return route.fulfill({
                contentType: 'application/json',
                body: JSON.stringify({
                  playerProfileApi: 1,
                  ok: true,
                  profile: {
                    profileKey: 'pk_me', nick: reqBody.nick, bio: reqBody.bio, avatar: null,
                    googleVerified: true, avatarFrame: 'admin_gold',
                    champOfficial: 4, champCommunity: 1, totalWins: 30,
                    showTotalWins: reqBody.showTotalWins,
                    showOfficialCrowns: reqBody.showOfficialCrowns,
                    showCommunityCrowns: reqBody.showCommunityCrowns,
                    pinnedHonorIds: [], availableHonors: [], pinnedHonors: [],
                  },
                }),
              });
            }
            return route.fulfill({ contentType: 'text/plain', body: 'ok' });
          });

          await pg.setContent(`<!DOCTYPE html><html><body><div id="ed"></div><div id="av"></div><script>${defaultBundle}</script></body></html>`);
          await pg.evaluate(() => {
            window.__savedObj = null;
            window.__mountEditor(document.getElementById('ed'), {
              getAuthCtx: async () => ({ uid: 'u', token: 'tok' }),
              onsaved: (p) => { window.__savedObj = p; },
            });
            const avHost = document.getElementById('av');
            for (const f of window.__AVATAR_FRAMES) {
              const box = document.createElement('div');
              box.setAttribute('data-frame-id', f.id);
              avHost.appendChild(box);
              window.__mountAvatar(box, { name: '測試', size: 56, frame: f.id, ring: true });
            }
          });
          await pg.waitForSelector('.ppe-stat-toggle');

          const btns = pg.locator('.ppe-stat-toggle');
          assert.strictEqual(await btns.count(), 3, '編輯器應有 3 顆可點擊切換的統計徽章');
          assert.strictEqual(await btns.nth(0).getAttribute('aria-pressed'), 'true');
          await btns.nth(0).click();
          assert.strictEqual(await btns.nth(0).getAttribute('aria-pressed'), 'false', '點一下應關閉總勝場顯示');
          await btns.nth(1).click();
          assert.strictEqual(await btns.nth(1).getAttribute('aria-pressed'), 'false', '點一下應關閉網站賽冠數顯示');
          await btns.nth(1).click();
          assert.strictEqual(await btns.nth(1).getAttribute('aria-pressed'), 'true', '再點一下應恢復網站賽冠數顯示');

          await pg.getByRole('button', { name: /儲存個人名片/ }).click();
          await pg.waitForFunction(() => !!window.__savedObj);
          const saved = await pg.evaluate(() => window.__savedObj);
          assert.strictEqual(saved.showTotalWins, false);
          assert.strictEqual(saved.showOfficialCrowns, true);
          assert.strictEqual(saved.showCommunityCrowns, true);

          // Editor preview bar must NOT display frame name tag or corner badge
          assert.strictEqual(await pg.locator('#ed .ppe-pv-frame-tag').count(), 0, '編輯器預覽列不可顯示外框名稱標籤');
          assert.strictEqual(await pg.locator('#ed .prof-av-frame-badge').count(), 0, '編輯器預覽頭像不可顯示角落小圖示');
          assert.strictEqual(await pg.locator('#ed .prof-av-frame-svg').count(), 2, '編輯器預覽列 56px 與 28px 皆應渲染 SVG 裝飾外框');

          // Check all 20 AvatarCircle decorative SVG frames rendered with unique gradient IDs & zero corner badges
          const avInfo = await pg.evaluate(() => {
            const gradIds = [];
            const items = Array.from(document.querySelectorAll('#av > div')).map((d) => {
              const svg = d.querySelector('.prof-av-frame-svg');
              const grads = svg ? Array.from(svg.querySelectorAll('linearGradient, radialGradient')).map((g) => g.getAttribute('id')) : [];
              gradIds.push(...grads);
              return {
                id: d.getAttribute('data-frame-id'),
                hasFrame: !!d.querySelector('.prof-av-wrap.has-frame'),
                hasSvg: !!svg,
                shapeCount: svg ? svg.querySelectorAll('circle, path, polygon, rect, ellipse, line').length : 0,
                badgeCount: d.querySelectorAll('.prof-av-frame-badge').length,
                rect: d.querySelector('.prof-av-wrap')?.getBoundingClientRect().width || 0,
              };
            });
            return { items, uniqueGrads: new Set(gradIds).size, totalGrads: gradIds.length };
          });
          assert.strictEqual(avInfo.items.length, 20, '應渲染全部 20 款立體裝飾外框');
          assert.strictEqual(avInfo.uniqueGrads, avInfo.totalGrads, '每個外框實例的 SVG 漸層 ID 不可碰撞');
          for (const a of avInfo.items) {
            assert.ok(a.hasFrame && a.hasSvg && a.shapeCount >= 5 && a.badgeCount === 0 && a.rect > 40, '立體 SVG 外框未正確渲染：' + JSON.stringify(a));
          }

          // Check Canvas 2D PNG export: draws SVG frame & ZERO frame name or corner icon text
          const pngCheck = await pg.evaluate(async () => {
            const drawnTexts = [];
            const origFillText = CanvasRenderingContext2D.prototype.fillText;
            CanvasRenderingContext2D.prototype.fillText = function (text, ...rest) {
              drawnTexts.push(String(text));
              return origFillText.call(this, text, ...rest);
            };
            const loadedUrls = [];
            try {
              const canvas = await window.__renderCardCanvas({
                found: true,
                profileKey: 'pk_me',
                nick: '站長Wilson',
                bio: 'PTCG 測試選手\n歡迎切磋！',
                avatar: null,
                googleVerified: true,
                avatarFrame: 'admin_gold',
                champOfficial: 2,
                champCommunity: 1,
                totalWins: 42,
                showTotalWins: true,
                showOfficialCrowns: true,
                showCommunityCrowns: true,
                pinnedHonors: [{ eventId: 'e1', eventName: '冬季大賽', date: 1760000000000, kind: 'site', placementLabel: '冠軍' }],
                canFriend: false,
                friendStatus: 'self',
              }, {
                loadImage: (u) => {
                  loadedUrls.push(u);
                  return new Promise((res) => {
                    const img = new Image();
                    img.onload = () => res(img);
                    img.onerror = () => res(null);
                    img.src = u;
                  });
                },
              });
              return { w: canvas.width, h: canvas.height, url: canvas.toDataURL('image/png'), drawnTexts, loadedUrls };
            } finally {
              CanvasRenderingContext2D.prototype.fillText = origFillText;
            }
          });
          assert.strictEqual(pngCheck.w, 780, '匯出名片寬度應為 780px');
          assert.ok(pngCheck.h >= 360, '匯出名片高度不應異常');
          assert.ok(pngCheck.url.startsWith('data:image/png;base64,') && pngCheck.url.length > 5000, 'Canvas PNG 資料無效');
          assert.ok(pngCheck.loadedUrls.some((u) => u.startsWith('data:image/svg+xml;charset=utf-8,')), 'PNG 匯出應以內嵌 SVG Data URL 繪製立體裝飾外框');
          assert.ok(!pngCheck.drawnTexts.some((t) => t.includes('聖金冠翼') || t.includes('皇家輝金框') || t === '👑'), 'PNG 匯出不可繪製外框名稱或角落小圖示：' + JSON.stringify(pngCheck.drawnTexts));
        } finally {
          await ctx.close();
        }
      });

      const assertAdminFrameLookup = async (adm) => {
        const sIdx = adm.indexOf('const PROF_FRAME_OPTIONS = [');
        const eIdx = adm.indexOf('\nfunction renderUsers(el)', sIdx);
        assert.ok(sIdx > 0 && eIdx > sIdx, 'admin.html 找不到 PROF_FRAME_OPTIONS 區段');
        const snippet = adm.slice(sIdx, eIdx);
        const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } });
        const pg = await ctx.newPage();
        const errs = [];
        pg.on('pageerror', (e) => errs.push(e.message));
        try {
          await pg.setContent(`<!DOCTYPE html><html><body><div id="tab-users"><div class="table-wrap"></div></div><script type="module">
            const escapeHtml=(s)=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
            const currentUser = {email:'new@example.test'};
            const api = async (url, opts) => {
              if (opts?.method === 'POST') {
                if (window.__savedFrame) return {ok:true,...JSON.parse(opts.body)};
                window.__savedFrame = JSON.parse(opts.body);
                return new Promise(resolve => { window.__finishSave = () => resolve({ok:true,...window.__savedFrame}); });
              }
              if (url.includes('old%40')) return new Promise(resolve => { window.__returnOld = resolve; });
              return {ok:true, email:currentUser.email, avatarFrame:'cyber_neon'};
            };
            ${snippet}\n
            window.__competingFrameSave = () => saveProfFrame(currentUser.email, null);
            mountProfFrameAdminBox(document.getElementById('tab-users'));
          </script></body></html>`);
          await pg.waitForSelector('#prof-frame-select');
          const email = pg.locator('#prof-frame-email');
          const save = pg.locator('#prof-frame-save-btn');
          assert.ok(await save.isDisabled(), '初次查詢前不能套用');
          await email.fill('old@example.test');
          await pg.locator('#prof-frame-lookup-btn').click();
          await pg.waitForFunction(() => !!window.__returnOld);
          assert.ok(await save.isDisabled(), '查詢中不能套用');
          await pg.evaluate(() => window.profAdminFillSelf());
          await pg.waitForFunction(() => !document.getElementById('prof-frame-save-btn').disabled);
          await pg.evaluate(() => window.__returnOld({ok:true,email:'old@example.test',avatarFrame:'admin_gold'}));
          assert.equal(await pg.locator('#prof-frame-select').inputValue(), 'cyber_neon', '遲到的帳號查詢不可覆蓋新目標');
          await save.click();
          assert.deepStrictEqual(await pg.evaluate(() => window.__savedFrame), {email:'new@example.test',avatarFrame:'cyber_neon'});
          assert.ok(await email.isDisabled() && await pg.locator('#prof-frame-lookup-btn').isDisabled(), '外框儲存期間鎖住同一帳號的重新查詢');
          assert.ok((await pg.evaluate(() => window.__competingFrameSave())).error, '另一個後台入口同時儲存同一帳號會被攔下');
          assert.equal(await pg.evaluate(() => window.__savedFrame.avatarFrame), 'cyber_neon');
          await pg.evaluate(() => window.__finishSave());
          await pg.waitForFunction(() => !document.getElementById('prof-frame-save-btn').disabled);
          await pg.selectOption('#prof-frame-select', 'cyber_neon');
          const bg = await pg.evaluate(() => getComputedStyle(document.getElementById('prof-frame-swatch')).backgroundColor);
          assert.strictEqual(bg, 'rgb(250, 204, 21)', 'cyber_neon 外框選取後色票應即時更新為 #facc15');
          assert.deepStrictEqual(errs, [], 'admin.html 外框切換不可拋出 ReferenceError：' + errs.join('; '));
        } finally {
          await ctx.close();
        }
      };
      const assertDetailFrameLookup = async (adm) => {
        const a = adm.lastIndexOf("    if (email && email.includes('@')) {", adm.indexOf("const fSel = box.querySelector('#modal-prof-frame-select');"));
        const end = adm.indexOf('\n  })();', a);
        assert.ok(a >= 0 && end > a);
        const select = adm.match(/<select id="modal-prof-frame-select"[^>]+>/)?.[0];
        const button = adm.match(/<button id="modal-prof-frame-save"[^>]+>/)?.[0];
        const saveHelper = adm.slice(adm.indexOf('const profFrameSavingEmails'), adm.indexOf('function resetProfFrameEditor'));
        assert.match(saveHelper, /async function saveProfFrame/);
        assert.ok(select && button, '缺玩家詳情的外框元素');
        const pg = await browser.newPage();
        try {
          await pg.setContent(`<div id="test">${select}<option value="">無</option><option value="emerald_leaf">葉</option></select>${button}套用</button><div id="modal-prof-frame-msg"></div></div><script>
            const box=document.getElementById('test'),email='player@example.test';
            const PROF_FRAME_OPTIONS=[{id:'',label:'無'},{id:'emerald_leaf',label:'葉'}];
            const profFrameSwatchUpdate=()=>{};
            const api=async (_url, opts)=>{
              if(opts?.method==='POST'){window.__detailSaved=JSON.parse(opts.body);return {ok:true,avatarFrame:window.__detailSaved.avatarFrame};}
              return new Promise(resolve=>{window.__detailLoaded=resolve;});
            };
            ${saveHelper}
            void (async()=>{${adm.slice(a,end)}})();
          </script>`);
          const save = pg.locator('#modal-prof-frame-save');
          const selectNode = pg.locator('#modal-prof-frame-select');
          await pg.waitForFunction(() => !!window.__detailLoaded);
          assert.ok(await save.isDisabled() && await selectNode.isDisabled(), '初次查詢未完成時，玩家詳情外框控制項必須鎖住');
          await save.evaluate((el) => el.click());
          assert.equal(await pg.evaluate(() => window.__detailSaved), undefined);
          await pg.evaluate(() => window.__detailLoaded({ok:true,avatarFrame:'emerald_leaf'}));
          await pg.waitForFunction(() => !document.getElementById('modal-prof-frame-save').disabled);
          assert.equal(await selectNode.inputValue(), 'emerald_leaf');
          await selectNode.selectOption('');
          await save.click();
          assert.deepStrictEqual(await pg.evaluate(() => window.__detailSaved), {email:'player@example.test',avatarFrame:null});
        } finally { await pg.close(); }
      };
      await T('C2b Playwright 驗證主表外框錯序、同帳號儲存互斥與色票', async () => {
        const adm = read(ADMIN_PATH);
        await assertAdminFrameLookup(adm);
        const race = adm.replace('    if (!stillCurrent()) return;\n    if (!r || r.error) { if (st) st.textContent = \'查詢失敗',
          '    if (!r || r.error) { if (st) st.textContent = \'查詢失敗');
        assert.notEqual(race, adm);
        await mutantMustBreak('M_admin_frame_late_lookup', () => assertAdminFrameLookup(race), '遲到的帳號查詢');
        const noLock = adm.replace('  if (profFrameSavingEmails.has(key)) return', '  if (false) return');
        assert.notEqual(noLock, adm);
        await mutantMustBreak('M_admin_frame_concurrent_save', () => assertAdminFrameLookup(noLock), '同時儲存同一帳號');
      });
      await T('C2c 玩家詳情外框在初次 GET 前維持鎖定，完成後才可清除', async () => {
        const adm = read(ADMIN_PATH);
        await assertDetailFrameLookup(adm);
        const unlocked = adm.replace(/(id="modal-prof-frame-(?:select|save)"[^>]+) disabled/g, '$1');
        assert.notEqual(unlocked, adm);
        await mutantMustBreak('M_admin_detail_frame_early_write', () => assertDetailFrameLookup(unlocked), '玩家詳情外框控制項必須鎖住');
      });
      await T('C2d 頭像及 PNG 降級保留完整 Emoji，兩條失敗圖片短期只查一次', async () => {
        const pg = await browser.newPage();
        let imgCalls = 0;
        await pg.route('**/*', route => { imgCalls++; return route.abort(); });
        try {
          await pg.setContent(`<div id="app"></div><script>${defaultBundle}</script>`);
          await pg.evaluate(() => window.__mountAvatar(document.getElementById('app'), { name: '😀測試', avatar: null }));
          assert.equal(await pg.locator('.prof-avatar-fallback').textContent(), '😀');
          const initials = await pg.evaluate(async () => {
            const values = [];
            const old = CanvasRenderingContext2D.prototype.fillText;
            CanvasRenderingContext2D.prototype.fillText = function (text, ...rest) {
              values.push(text);
              return old.call(this, text, ...rest);
            };
            try {
              const card = { found: true, nick: '😀測試', avatar: { cardId: '19145', x: .5, y: .5, zoom: 1.4 },
                totalWins: 100, showTotalWins: false, pinnedHonors: [] };
              await window.__renderCardCanvas(card);
              await window.__renderCardCanvas(card);
              return values;
            } finally { CanvasRenderingContext2D.prototype.fillText = old; }
          });
          assert.equal(initials.filter(t => t === '😀').length, 2);
          assert.ok(initials.every(t => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(t)));
          assert.equal(imgCalls, 2, '同一圖片兩路失敗後再次下載應短期略過');
        } finally { await pg.close(); }
      });
    } finally {
      await browser.close();
    }
  }
} else {
  console.log('  SKIP Chromium UI checks (no Playwright binary)');
}

await T('C3 全站接線與公開／內部紀錄隔離（game ?card=／viewerUid／關閉清除、MobilePortraitBattle 零 friend、admin UI 執行與公開 changelog 分離）', () => {
  const gp = read(GAME_PATH);
  assert.ok(gp.includes("searchParams.get('card')"), 'game/+page.svelte 應支援 ?card=<profileKey> 分享入口');
  assert.ok(gp.includes('pendingSharedCardTarget') && gp.includes('requestLoginFromProfile'), '應有未登入名片＋加好友登入接力機制');
  assert.ok(gp.includes('dismissAuthModal') && gp.includes('viewerUid={firebaseUser && !firebaseUser.isAnonymous ? firebaseUser.uid : \'\'}'), '應有取消登入清除 pending 與 viewerUid 重抓接線');
  assert.ok(gp.includes('battleSeatFrames') && gp.includes('onRequestLogin={requestLoginFromProfile}'), '應傳遞對戰頭像外框與登入接力回呼');
  assert.ok(gp.includes('fetchProfileBatch(items, ctx)') && !gp.includes('fetchPlayerProfileView'), '進房頭像只走輕量批次');
  assert.match(gp, /history\.replaceState\(window\.history\.state, '', cardUrl\.toString\(\)\)/);
  assert.equal(gp.match(/avatarFrame: seatFrameFor\(seatIdx\)/g)?.length, 2, '兩個 fallback 都需使用同席位外框');
  assert.ok(gp.includes('buildLobbyHostProfileTarget(r)') && gp.includes('buildLobbySeatProfileTarget(r, 0)') && gp.includes('buildLobbySeatProfileTarget(r, 1)'), '線上大廳等待中與對戰中房間玩家名稱必須以正規化查詢目標開啟名片');
  assert.match(read('src/routes/friends/+page.svelte'), /viewerUid=\{profileViewerUid\}/);
  assert.match(read('src/routes/deck-posts/+page.svelte'), /viewerUid=\{firebaseUser && !firebaseUser.isAnonymous/);

  const mpb = read(MPB_PATH);
  assert.ok(!/friend/i.test(mpb), 'MobilePortraitBattle.svelte 不可出現 friend 字樣');
  assert.ok(mpb.includes('oppFrame') && mpb.includes('myFrame'), 'MobilePortraitBattle 應接受 oppFrame / myFrame');

  const adm = read(ADMIN_PATH);
  assert.ok(adm.includes('admin-prof-frame-box') && adm.includes('modal-prof-frame-row'), 'admin.html 應有帳號分頁與玩家總覽之外框指派 UI');
  assert.ok(adm.includes("ver:'v6.659'") && adm.includes("ver:'v6.663'"), 'admin.html CL_ADMIN_ONLY_ENTRIES 應記錄 v6.659 與 v6.663 內部外框功能');
  assert.ok(adm.includes('/api/admin/player-profile/frame'), 'admin.html 應呼叫管理員外框端點');
  assert.ok(!adm.includes('onchange="profFrameSwatchUpdate') && adm.includes('window.profFrameSwatchUpdate = profFrameSwatchUpdate'), 'admin.html <script type="module"> 不可依賴未掛 window 的行內 onchange');
  for (const fid of ['premier_trophy', 'rainbow_rare', 'aqua_wave', 'psychic_nebula', 'shadow_phantom', 'eevee_fluff', 'fairy_ribbon', 'gengar_grin', 'snorlax_cozy', 'dragon_crest', 'frost_glacier', 'steel_gear', 'sakura_spring', 'moon_eclipse']) {
    assert.ok(adm.includes(`id: '${fid}'`), 'admin.html PROF_FRAME_OPTIONS 缺少新外框：' + fid);
  }

  const ch = read(CHLOG_PATH);
  assert.ok(ch.includes('v6.659') && ch.includes('v6.663'), '首頁公開 changelog 應包含 v6.659 與 v6.663 玩家可見升級');
  assert.ok(!ch.includes('admin-prof-frame-box') && !ch.includes('/api/admin/player-profile/frame') && !ch.includes('後台玩家帳號') && !ch.includes('PROF_FRAME_OPTIONS'), 'Admin 後台功能不可寫入首頁公開 changelog');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【D】Rule 40 精確還原鏈＋真實突變測試＋BASE 必紅檢查');

await T('D1 revertV6659IfPresent 逐字還原回 v6.658 (a41829bc) 且對 BASE 為 no-op', () => {
  if (!hasBaseCommit(ROOT, BASE_SHA) || !hasBaseCommit(ROOT, SNAP_V6666)) { shallowSkip('v6659 逐檔 blob 比對', '需要歷史 commit'); return; }
  for (const rel of Object.keys(V6659_PAIRS)) {
    const snap = readBaseBlob(ROOT, SNAP_V6666, rel);
    const base = readBaseBlob(ROOT, BASE_SHA, rel);
    assert.ok(snap.ok && base.ok, '缺少 SNAP 或 BASE blob ' + rel);
    const bNorm = normEol(base.out);
    assert.strictEqual(revertV6659IfPresent(rel, normEol(snap.out)), bNorm, '無法精確還原：' + rel);
    assert.strictEqual(revertV6659IfPresent(rel, bNorm), bNorm, '對 BASE 必須是 no-op：' + rel);
  }
});

await T('D2 BASE (a41829bc) 無法通過 v6.659 新斷言（證明非恆真）', async () => {
  if (!hasBaseCommit(ROOT, BASE_SHA)) { shallowSkip('BASE fail 驗證', '需要歷史 commit'); return; }
  const apiBase = readBaseBlob(ROOT, BASE_SHA, API_PATH);
  const srvBase = readBaseBlob(ROOT, BASE_SHA, SRV_PATH);
  assert.ok(apiBase.ok && srvBase.ok);
  await mutantMustBreak('BASE_profileApi', () => assertProfileApiContract(normEol(apiBase.out)));
  await mutantMustBreak('BASE_backend', () => assertBackendUpgrades(() => buildBackendHarness(normEol(srvBase.out))));
  const checks = [
    ['外框圖鑑', apiBase.out, /export const AVATAR_FRAMES/],
    ['PNG 匯出', apiBase.out, /export async function downloadProfileCardPng/],
    ['分享連結', apiBase.out, /export function buildProfileShareUrl/],
    ['勝場索引', srvBase.out, /profileVerifiedWinner/],
    ['獨立統計旗標', srvBase.out, /showTotalWins/],
    ['外框管理路由', srvBase.out, /app\.post\('\/api\/admin\/player-profile\/frame'/],
  ];
  for (const [label, src, re] of checks) await mutantMustBreak('BASE_' + label, () => assert.match(src, re));
});

await T('D3 真實突變覆蓋勝場、外框權限、隱私與登入重抓', async () => {
  const srv = read(SRV_PATH);
  const api = read(API_PATH);

  // M1: 後端一般勝場忘記排除無房號的單機/AI場
  const srvM1 = srv.replace(
    "mode: 'online', vsAI: { $ne: true }, roomCode: /\\S/,",
    "mode: 'online', roomCode: /\\S/,",
  );
  assert.notStrictEqual(srvM1, srv, 'M1 anchor');
  await mutantMustBreak('M1_allow_ai_roomCode', () => assertBackendUpgrades(() => buildBackendHarness(srvM1)), 'AI');

  // M2: 後端 /save 允許玩家自行把 avatarFrame 寫進 DB
  const srvM2 = srv.replace(
    "          googleVerified: !!me.googleVerified,\n          updatedAt: now,",
    "          googleVerified: !!me.googleVerified,\n          avatarFrame: b.avatarFrame || null,\n          updatedAt: now,",
  );
  assert.notStrictEqual(srvM2, srv, 'M2 anchor');
  await mutantMustBreak('M2_player_spoof_frame', () => assertBackendUpgrades(() => buildBackendHarness(srvM2)), 'avatarFrame');

  // M3: Admin 設定與查詢外框忘記檢查 isTournAdmin 權限
  const srvM3 = srv.replace(
    "        if (!isTournAdmin(id)) {\n          return res.status(403).json({ error: '只有管理員可設定頭像特殊外框', playerProfileApi: 1 });\n        }",
    "",
  );
  assert.notStrictEqual(srvM3, srv, 'M3 anchor');
  await mutantMustBreak('M3_non_admin_set_frame', () => assertBackendUpgrades(() => buildBackendHarness(srvM3)), '403');
  const srvM3Get = srv.replace(
    "        if (!isTournAdmin(id)) {\n          return res.status(403).json({ error: '只有管理員可管理頭像特殊外框', playerProfileApi: 1 });\n        }",
    "",
  );
  assert.notStrictEqual(srvM3Get, srv, 'M3Get anchor');
  await mutantMustBreak('M3b_non_admin_get_frame', () => assertBackendUpgrades(() => buildBackendHarness(srvM3Get)), '403');

  // M4: /view 公開端點忘記根據 showTotalWins 歸零 totalWins
  const srvM4 = srv.replace(
    "const showTotalWins = !(doc && doc.showTotalWins === false);",
    "const showTotalWins = true;",
  );
  assert.notStrictEqual(srvM4, srv, 'M4 anchor');
  await mutantMustBreak('M4_ignore_showTotalWins', () => assertBackendUpgrades(() => buildBackendHarness(srvM4)), 'showTotalWins');

  // M5: clampAvatarFrame 放寬回傳未知外框字串
  const apiM5 = api.replace(
    "  return AVATAR_FRAME_MAP.has(id) ? (id as AvatarFrameId) : null;",
    "  return (id || null) as AvatarFrameId | null;",
  );
  assert.notStrictEqual(apiM5, api, 'M5 anchor');
  await mutantMustBreak('M5_clampAvatarFrame_unvalidated', () => assertProfileApiContract(apiM5), '無效外框');

  // M6: Playwright 突變 — 名片彈窗對他人或 AI previewCard 誤顯示「📥 下載名片／🔗 分享名片」
  if (chromium) {
    const browser = await pwLaunchWith(chromium, 'v6.659-mut');
    if (browser) {
      try {
        const modal = read(MODAL_PATH);
        const modalM6 = modal.replace(
          "previewCard ? previewCard.friendStatus === 'self'",
          "previewCard ? true",
        ).replace("open && card?.friendStatus === 'self' && (", "open && !!card && (");
        assert.notStrictEqual(modalM6, modal, 'M6 anchor');
        const badBundle = await buildUiBundle(modalM6);
        await mutantMustBreak('M6_preview_ai_card_shows_download', () => assertModalSelfVsOtherUi(browser, badBundle), '非本人 previewCard');

        // M7: 拿掉 viewerUid 追蹤 ⇒ 啟動登入接力重抓必須翻紅
        const modalM7 = modal.replace(
          't === prevTargetRef && authKey === prevAuthKey',
          't === prevTargetRef',
        );
        assert.notStrictEqual(modalM7, modal, 'M7 anchor');
        const badRaceBundle = await buildUiBundle(modalM7);
        await mutantMustBreak('M7_auth_race_stale', () => assertModalSelfVsOtherUi(browser, badRaceBundle), '登入完成後必須自動重抓');
      } finally {
        await browser.close();
      }
    }
  }
});

const v6659Sha = '9b7494b3269bd2369795a8bdb2d31e72e4ef3a60';
await T('D4 v6.659 的分享無文件與隱私交錯逐項必紅', async () => {
  if (!hasBaseCommit(ROOT, v6659Sha)) { shallowSkip('v6659 個別競態反證', '需要歷史 commit'); return; }
  const previous = readBaseBlob(ROOT, v6659Sha, SRV_PATH);
  assert.ok(previous.ok);
  await mutantMustBreak('v6659_first_share', () => assertFirstShare(normEol(previous.out)), '立即可公開解析');
  await mutantMustBreak('v6659_visibility_race', () => assertVisibilityRace(normEol(previous.out)));
  if (chromium) {
    const original = readBaseBlob(ROOT, v6659Sha, MODAL_PATH);
    assert.ok(original.ok);
    const browser = await pwLaunchWith(chromium, 'v6.659-race-base');
    if (browser) try {
      const bundle = await buildUiBundle(normEol(original.out));
      await mutantMustBreak('v6659_repeat_request', () => assertModalSelfVsOtherUi(browser, bundle, { legacyBadges: true }), '只能送出一次');
    } finally { await browser.close(); }
  }
});

console.log(`\n══ v6.659 玩家名片五大升級守衛：${pass} PASS / ${fail} FAIL ══`);
if (fail) process.exit(1);
