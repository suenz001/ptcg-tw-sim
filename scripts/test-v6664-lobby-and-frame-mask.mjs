/**
 * v6.664 / v6.665 / v6.666 回歸守衛：
 *   1. 大廳點擊玩家名稱嚴格以 UID 優先（座位換人絕不開成他人、換座仍在房命中、刪房退回 UID、查無 UID 明確未找到、缺／空白 UID 不猜人且維持純文字、對戰純 seatIdx 維持相容），含 v6.663 (0329ee55) 反證、v6.664 (b390744e) 空白 UID 反證與真實突變。
 *   2. 20 款立體 SVG 外框逐款實際像素檢查（瀏覽器 DOM SVG、16px DPR 1/2/3 與 28/56/72px 含奇偶數容器實際瀏覽器合成截圖＋光暈存在差值、780px Canvas PNG 與 20 款強制 Canvas PNG 備援內圓皆為 0 像素干擾、外圈具可見裝飾、超能星環外弧去遮罩含描邊 r>=49、40 實例多實例 ID 唯一），含 v6.664/v6.665 HEAD-FAIL 與移除遮罩／恢復光暈滲透／移除備援裁切／恢復小尺寸裁切／移除瀏覽器光暈突變。
 *   3. 桌機 1280px 與手機 393px 深／淺色大廳房間連結高對比（>=4.5:1）、鍵盤 Enter/Space 與不誤觸加入／觀戰按鈕。
 *   4. Rule 40 精確歷史還原鏈（D1 以固定歷史 Git blob 驗證 4fed8ee3 → b390744e → 0329ee55 與 no-op，不隨未來升版誤紅；D2 動態驗證現行版本與公開 changelog 隔離）。
 *
 * Run: node scripts/test-v6664-lobby-and-frame-mask.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build as esbuildBuild } from 'esbuild';
import { compile as svelteCompile } from 'svelte/compiler';
import { normEol } from './lib/eol-agnostic.mjs';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';
import { cssOf } from './lib/svelte-style-block.mjs';
import { V6664_PAIRS, revertV6664IfPresent } from './lib/revert-v6664-lobby-frame-fix.mjs';
import { V6665_PAIRS, revertV6665IfPresent } from './lib/revert-v6665-glow-and-blank-uid.mjs';
import { V6666_PAIRS, revertV6666IfPresent } from './lib/revert-v6666-small-avatar-clip.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_V6663 = '0329ee552aa25ca84fc7875a7ab3146a2b104900';
const BASE_V6664 = 'b390744eb59dbda885b7b93fe40654c4664809b9';
const COMMIT_V6665 = '4fed8ee34616c0b9299de02686dcf9c575b9031e';
const COMMIT_V6666 = '3075b04ce2e3de6fc55288452f03d8fa8fab488c';

const API_PATH = 'src/lib/profile/profile-api.ts';
const AV_PATH = 'src/lib/profile/AvatarCircle.svelte';
const SRV_PATH = 'oracle-admin/server_admin_patch.js';
const GAME_PATH = 'src/routes/game/+page.svelte';
const ADMIN_PATH = 'oracle-admin/admin.html';
const CHLOG_PATH = 'static/changelog.html';

const read = (rel) => normEol(readFileSync(join(ROOT, rel), 'utf8'));

let pass = 0;
let fail = 0;
async function T(name, fn) {
  try {
    await fn();
    console.log('  PASS', name);
    pass++;
  } catch (e) {
    if (e instanceof assert.AssertionError) {
      console.log('  FAIL', name, '::', e.message);
      fail++;
    } else {
      throw e;
    }
  }
}

async function mutantMustBreak(label, fn, expectedHint) {
  try {
    await fn();
  } catch (e) {
    if (e instanceof assert.AssertionError) {
      if (expectedHint && !String(e.message).includes(expectedHint)) {
        assert.fail(`突變 ${label} 紅錯地方：預期含「${expectedHint}」，實得「${e.message}」`);
      }
      return;
    }
    throw e;
  }
  assert.fail(`突變 ${label} 竟然沒有紅（守衛為安慰劑）`);
}

function loadProfileApi(srcOverride) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6664-api-'));
  const entry = join(tmp, 'entry.ts');
  const out = join(tmp, 'out.mjs');
  writeFileSync(entry, srcOverride ?? read(API_PATH));
  return esbuildBuild({
    entryPoints: [entry],
    outfile: out,
    bundle: true,
    format: 'esm',
    platform: 'node',
    plugins: [{
      name: 'stub-lib',
      setup(b) {
        b.onResolve({ filter: /^\$lib\// }, (a) => ({ path: a.path, namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
          contents: 'export const loadIndex=async()=>null;export const loadSet=async()=>[];export const loadAllSets=async()=>[];export const loadCardSetMap=async()=>({});',
        }));
      },
    }],
  }).then(async () => {
    const mod = await import(pathToFileURL(out).href + '?v=' + Date.now() + Math.random());
    rmSync(tmp, { recursive: true, force: true });
    return mod;
  }, (err) => {
    rmSync(tmp, { recursive: true, force: true });
    throw err;
  });
}

function extractProfBlock(srvSrc) {
  const sMark = '// >>> v187-player-profile';
  const eMark = '// <<< v187-player-profile';
  const start = srvSrc.indexOf(sMark);
  const end = srvSrc.indexOf(eMark);
  assert.ok(start >= 0 && end > start, 'server_admin_patch.js 找不到 v187-player-profile 區塊');
  return srvSrc.slice(start, end + eMark.length);
}

function buildBackendHarness(srvSrcOverride) {
  const block = extractProfBlock(srvSrcOverride ?? read(SRV_PATH));
  const collections = new Map();
  const colOf = (name) => {
    if (!collections.has(name)) collections.set(name, []);
    return collections.get(name);
  };
  const matchFilter = (doc, filter) => {
    if (!filter || typeof filter !== 'object') return true;
    for (const [k, v] of Object.entries(filter)) {
      if (k === '$or') {
        if (!Array.isArray(v) || !v.some((sub) => matchFilter(doc, sub))) return false;
        continue;
      }
      const val = k.includes('.') ? k.split('.').reduce((acc, part) => (acc == null ? undefined : (Array.isArray(acc) ? acc.map((x) => x?.[part]) : acc[part])), doc) : doc[k];
      if (v && typeof v === 'object' && !(v instanceof RegExp)) {
        if ('$ne' in v) { if (val === v.$ne) return false; continue; }
        if ('$in' in v) {
          const arr = Array.isArray(val) ? val : [val];
          if (!arr.some((x) => v.$in.includes(x))) return false;
          continue;
        }
      }
      if (Array.isArray(val)) {
        if (!val.includes(v)) return false;
      } else if (val !== v) {
        return false;
      }
    }
    return true;
  };
  const makeDb = () => ({
    collection(name) {
      const rows = colOf(name);
      return {
        async findOne(filter) {
          const hit = rows.find((r) => matchFilter(r, filter));
          return hit ? structuredClone(hit) : null;
        },
        find(filter) {
          const list = rows.filter((r) => matchFilter(r, filter)).map((r) => structuredClone(r));
          const cursor = {
            _list: list,
            sort(spec) {
              const [[fk, dir]] = Object.entries(spec);
              cursor._list.sort((a, b) => ((a[fk] ?? 0) - (b[fk] ?? 0)) * (dir >= 0 ? 1 : -1));
              return cursor;
            },
            limit(n) { cursor._list = cursor._list.slice(0, n); return cursor; },
            async toArray() { return cursor._list; },
          };
          return cursor;
        },
        async countDocuments() { return 0; },
        async indexes() { return [{ key: { profileVerifiedWinner: 1 } }]; },
        async createIndex() { return 'ok'; },
        async updateOne() { return { matchedCount: 0 }; },
        async insertOne(doc) { rows.push(structuredClone(doc)); return { insertedId: doc._id }; },
      };
    },
  });

  const routes = [];
  const app = {
    locals: { _detectCutPlacements: () => ({ finals: new Set(), top4: new Set(), top8: new Set() }) },
    use() {},
    get(p, h) { routes.push({ method: 'GET', path: p, h }); },
    post(p, h) { routes.push({ method: 'POST', path: p, h }); },
  };
  const normE = (v) => (typeof v === 'string' && v.includes('@') ? v.trim().toLowerCase() : null);
  const pairId = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const fn = new Function(
    'app', 'db', 'TADMIN', 'TPOOL',
    '_frNormEmail', '_frPairId', '_frFid', '_frNick',
    'FR_COLL', 'FR_REG_COLL', 'FR_ID_COLL', 'FR_MAX_FRIENDS', 'FR_REJECT_COOLDOWN_MS',
    'friendsEnabled', 'tournIdentity', 'isTournAdmin', '_chatRate', 'Date',
    block,
  );
  fn(
    app, makeDb(), { apps: [] }, new Map(),
    normE, pairId, (p) => String(p), (v) => String(v || '').trim(),
    'friends', 'tournamentRegistrations', 'playerIdentities', 100, 86400000,
    () => true, async () => null, () => false, new Map(), Date,
  );

  async function viewProfile(query) {
    const route = routes.find((r) => r.method === 'GET' && r.path === '/api/player-profile/view');
    assert.ok(route, '找不到 /api/player-profile/view 路由');
    let statusCode = 200;
    let body = null;
    const res = {
      status(c) { statusCode = c; return res; },
      json(b) { body = b; return res; },
      setHeader() {},
    };
    await route.h({ method: 'GET', headers: {}, query: query || {}, body: {} }, res);
    return { statusCode, body };
  }

  return { colOf, viewProfile };
}

async function assertLobbyResolutionContract(apiSrc, srvSrc) {
  const api = await loadProfileApi(apiSrc);
  const { colOf, viewProfile } = buildBackendHarness(srvSrc);

  colOf('playerProfiles').push(
    { _id: 'alice@example.test', uid: 'uid_a', nick: 'Alice原玩家', profileKey: 'pk_a', bio: 'A簡介' },
    { _id: 'bob@example.test', uid: 'uid_b', nick: 'Bob新入座', profileKey: 'pk_b', bio: 'B簡介' },
    { _id: 'charlie@example.test', uid: 'uid_c', nick: 'Charlie房主', profileKey: 'pk_c', bio: 'C簡介' },
  );
  colOf('rooms').push({
    _id: 'ABCD',
    seats: [
      { role: 'p1', uid: 'uid_b', email: 'bob@example.test', name: 'Bob新入座' },
      { role: 'p2', uid: 'uid_c', email: 'charlie@example.test', name: 'Charlie房主' },
    ],
  });

  // 1. 座位換人：列表仍顯示 seat 0 是 Alice (uid_a)，伺服器 seat 0 已換成 Bob (uid_b)
  const staleListedRoom = {
    roomId: 'ABCD',
    hostUid: 'uid_a',
    hostName: 'Alice原玩家',
    seats: [
      { uid: 'uid_a', name: 'Alice原玩家' },
      { uid: 'uid_c', name: 'Charlie房主' },
    ],
  };
  const seatTarget = api.buildLobbySeatProfileTarget(staleListedRoom, 0);
  assert.ok(seatTarget && seatTarget.targetUid === 'uid_a' && seatTarget.seatIdx === undefined,
    '大廳座位入口有 UID 時不得附帶 seatIdx');
  const resSeatChanged = await viewProfile(seatTarget);
  assert.strictEqual(resSeatChanged.statusCode, 200);
  assert.strictEqual(resSeatChanged.body.found, true);
  assert.strictEqual(resSeatChanged.body.profileKey, 'pk_a', '座位換人後點 A 必須開 A，絕不可開到 B');
  assert.strictEqual(resSeatChanged.body.nick, 'Alice原玩家');

  // 1b. 即使舊頁籤同時送 roomCode + seatIdx + targetUid，後端也必須優先用 targetUid（絕不開 B）
  const resBothParams = await viewProfile({ roomCode: 'ABCD', seatIdx: '0', targetUid: 'uid_a', fallbackNick: 'Alice原玩家' });
  assert.strictEqual(resBothParams.body.found, true);
  assert.strictEqual(resBothParams.body.profileKey, 'pk_a', '同時傳 seatIdx 與 targetUid 時後端不可改開另一人 B');

  // 2. 目標換座但仍在房：大廳列表顯示 Charlie 在 seat 0，實際 Charlie 已移到 seat 1（且用 room seat.email 直接解析）
  colOf('playerProfiles').splice(2, 1); // 移除 Charlie 的 playerProfiles，驗證確實從房間內新座位命中
  const swappedRoom = {
    roomId: 'ABCD',
    seats: [{ uid: 'uid_c', name: 'Charlie房主' }, { uid: 'uid_b', name: 'Bob新入座' }],
  };
  const swapTarget = api.buildLobbySeatProfileTarget(swappedRoom, 0);
  const resSwapped = await viewProfile(swapTarget);
  assert.strictEqual(resSwapped.body.found, true, '目標換座仍在房時必須從房內新座位找到');
  assert.strictEqual(resSwapped.body.nick, 'Charlie房主');

  // 3. 房間已刪除後仍可用 UID 找回
  const deletedRoom = { roomId: 'GONE', hostUid: 'uid_a', hostName: 'Alice原玩家', seats: [{ uid: 'uid_a', name: 'Alice原玩家' }] };
  const resGoneHost = await viewProfile(api.buildLobbyHostProfileTarget(deletedRoom));
  assert.strictEqual(resGoneHost.body.found, true, '房間刪除後點房主應退回 UID 找到名片');
  assert.strictEqual(resGoneHost.body.profileKey, 'pk_a');
  const resGoneSeat = await viewProfile(api.buildLobbySeatProfileTarget(deletedRoom, 0));
  assert.strictEqual(resGoneSeat.body.found, true, '房間刪除後點座位應退回 UID 找到名片');
  assert.strictEqual(resGoneSeat.body.profileKey, 'pk_a');

  // 4. 查無 UID 對應（房間已換成 Bob、Alice 沒有任何帳號紀錄）=> 明確 found:false，絕不可開成 Bob！
  const anonListed = { roomId: 'ABCD', seats: [{ uid: 'uid_anon_missing', name: '訪客A' }] };
  const resUnknown = await viewProfile(api.buildLobbySeatProfileTarget(anonListed, 0));
  assert.strictEqual(resUnknown.body.found, false, '查無 UID 對應時必須明確回 found:false，不得用同座位他人補值');
  assert.strictEqual(resUnknown.body.nick, '訪客A');
  assert.strictEqual(resUnknown.body.profileKey, '');

  // 5. 一般未換座正對照
  const normalRoom = { roomId: 'ABCD', hostUid: 'uid_b', hostName: 'Bob新入座', seats: [{ uid: 'uid_b', name: 'Bob新入座' }] };
  const resNormal = await viewProfile(api.buildLobbySeatProfileTarget(normalRoom, 0));
  assert.strictEqual(resNormal.body.found, true);
  assert.strictEqual(resNormal.body.profileKey, 'pk_b');

  // 6. 缺少 UID 或僅空白 UID 的舊資料不可猜人（即使有 hostName / seat.name）
  assert.strictEqual(api.buildLobbyHostProfileTarget({ roomId: 'ABCD', hostName: 'Bob新入座' }), null, '缺 hostUid 不可猜 seatIdx:0');
  assert.strictEqual(api.buildLobbyHostProfileTarget({ roomId: 'ABCD', hostUid: '   \t ', hostName: 'Bob新入座' }), null, '空白 hostUid 必須回 null');
  assert.strictEqual(api.buildLobbySeatProfileTarget({ roomId: 'ABCD', seats: [{ name: 'Bob新入座' }] }, 0), null, '缺 seat.uid 不可猜 seatIdx');
  assert.strictEqual(api.buildLobbySeatProfileTarget({ roomId: 'ABCD', seats: [{ uid: '  \n ', name: 'Bob新入座' }] }, 0), null, '空白 seat.uid 必須回 null');

  // 7. 向後相容正對照：對戰頁／等待室僅傳 { roomCode, seatIdx }（不含 targetUid）照常解析該席
  const resSeatOnly = await viewProfile({ roomCode: 'ABCD', seatIdx: '0' });
  assert.strictEqual(resSeatOnly.body.found, true);
  assert.strictEqual(resSeatOnly.body.profileKey, 'pk_b');
}

async function buildFrameBundle({ apiSrc, avSrc } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6664-ui-'));
  try {
    writeFileSync(join(tmp, 'profile-api.ts'), apiSrc ?? read(API_PATH));
    const avCompiled = svelteCompile(avSrc ?? read(AV_PATH), { generate: 'client', css: 'injected', filename: 'AvatarCircle.svelte' });
    assert.strictEqual(avCompiled.warnings.filter((w) => w.code === 'css_unused_selector').length, 0, 'AvatarCircle 不可有 unused CSS');
    writeFileSync(join(tmp, 'AvatarCircle.js'), avCompiled.js.code);
    writeFileSync(join(tmp, 'entry.js'), [
      "import { mount } from 'svelte';",
      "import AvatarCircle from './AvatarCircle.js';",
      "import * as api from './profile-api.ts';",
      "window.__api = api;",
      "window.__mountAvatar = (target, props) => mount(AvatarCircle, { target, props });",
    ].join('\n'));
    const res = await esbuildBuild({
      entryPoints: [join(tmp, 'entry.js')],
      bundle: true,
      format: 'iife',
      write: false,
      nodePaths: [join(ROOT, 'node_modules')],
      plugins: [{
        name: 'stubs',
        setup(b) {
          b.onResolve({ filter: /^\$lib\/cards\/thumb$/ }, () => ({ path: 'thumb', namespace: 's' }));
          b.onLoad({ filter: /^thumb$/, namespace: 's' }, () => ({ contents: 'export const cardThumb=(u)=>u;' }));
          b.onResolve({ filter: /^\$lib\/img-retry$/ }, () => ({ path: 'retry', namespace: 's' }));
          b.onLoad({ filter: /^retry$/, namespace: 's' }, () => ({ contents: 'export const retryImg=()=>({});' }));
          b.onResolve({ filter: /^\$lib\/cards\/pool$/ }, () => ({ path: 'pool', namespace: 's' }));
          b.onLoad({ filter: /^pool$/, namespace: 's' }, () => ({ contents: 'export const loadIndex=async()=>null;export const loadSet=async()=>[];export const loadAllSets=async()=>[];export const loadCardSetMap=async()=>({});' }));
        },
      }],
    });
    return res.outputFiles[0].text;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const COMPOSITE_PROFILES = [
  { size: 16, dpr: 1, box: 64, minOut: 70, minGlowWeight: 500, requireGlowOut: false },
  { size: 16, dpr: 1, box: 65, minOut: 70, minGlowWeight: 500, requireGlowOut: false },
  { size: 16, dpr: 2, box: 64, minOut: 350, minGlowWeight: 4000, requireGlowOut: true },
  { size: 16, dpr: 3, box: 64, minOut: 750, minGlowWeight: 8000, requireGlowOut: true },
  { size: 28, dpr: 2, box: 80, minOut: 1100, minGlowWeight: 10000, requireGlowOut: true },
  { size: 56, dpr: 2, box: 140, minOut: 5000, minGlowWeight: 50000, requireGlowOut: true },
  { size: 56, dpr: 2, box: 141, minOut: 5000, minGlowWeight: 50000, requireGlowOut: true },
  { size: 72, dpr: 2, box: 160, minOut: 8500, minGlowWeight: 80000, requireGlowOut: true },
  { size: 72, dpr: 2, box: 161, minOut: 8500, minGlowWeight: 80000, requireGlowOut: true },
];

/**
 * 實際瀏覽器合成截圖檢查（量得到頁面 CSS 與 SVG drop-shadow 光暈與小尺寸抗鋸齒）：
 * 涵蓋 16px (DPR 1/2/3)、28px、56px、72px，逐款以 SVG 座標 (r<46) 與畫面實際圓心幾何 (r<size/2)
 * 驗證內圓為 0 像素侵入、外圈具可見裝飾，並以有光暈 vs 停用光暈差值驗證瀏覽器光暈確實存在。
 */
async function assertBrowserCompositeScreenshotClean(browser, bundle, profiles = COMPOSITE_PROFILES) {
  for (const prof of profiles) {
    const { size, dpr, box, minOut, minGlowWeight, requireGlowOut } = prof;
    const cols = 5;
    const rows = 4;
    const gridW = cols * box;
    const gridH = rows * box;
    const ctx = await browser.newContext({
      viewport: { width: Math.max(840, gridW + 32), height: Math.max(680, gridH + 32) },
      deviceScaleFactor: dpr,
    });
    const pg = await ctx.newPage();
    const pageErrors = [];
    pg.on('pageerror', (e) => pageErrors.push(e.message));
    try {
      await pg.setContent(`<!DOCTYPE html><html><body style="margin:0;background:transparent;"><div id="comp-grid" style="display:grid;grid-template-columns:repeat(${cols},${box}px);grid-auto-rows:${box}px;width:${gridW}px;height:${gridH}px;"></div><script>${bundle}</script></body></html>`);
      const frameCount = await pg.evaluate((sz) => {
        const grid = document.getElementById('comp-grid');
        const frames = window.__api.AVATAR_FRAMES;
        for (const f of frames) {
          const cell = document.createElement('div');
          cell.className = 'comp-cell';
          cell.dataset.frameId = f.id;
          cell.style.cssText = 'display:flex;align-items:center;justify-content:center;position:relative;';
          grid.appendChild(cell);
          window.__mountAvatar(cell, { name: '測', size: sz, frame: f.id, ring: false });
          const inner = cell.querySelector('.prof-avatar-circle');
          if (inner) inner.style.visibility = 'hidden';
        }
        return frames.length;
      }, size);
      assert.strictEqual(frameCount, 20, '應有 20 款外框可供合成截圖檢查');

      const captureMetrics = async (disableGlow) => {
        await pg.evaluate((noG) => {
          for (const g of document.querySelectorAll('#comp-grid svg g[mask] > g')) {
            if (noG) {
              if (!g.dataset.origFilter) g.dataset.origFilter = g.style.filter || '';
              g.style.filter = 'none';
            } else if (g.dataset.origFilter !== undefined) {
              g.style.filter = g.dataset.origFilter;
            }
          }
        }, disableGlow);
        const gridRect = await pg.locator('#comp-grid').boundingBox();
        const rects = await pg.evaluate(() => Array.from(document.querySelectorAll('#comp-grid .comp-cell')).map((cell) => {
          const cb = cell.getBoundingClientRect();
          const wb = cell.querySelector('.prof-avatar-circle').getBoundingClientRect();
          const sb = cell.querySelector('svg.prof-av-frame-svg').getBoundingClientRect();
          return {
            id: cell.dataset.frameId,
            cell: { x: cb.x, y: cb.y, w: cb.width, h: cb.height },
            wrap: { x: wb.x, y: wb.y, w: wb.width, h: wb.height },
            svg: { x: sb.x, y: sb.y, w: sb.width, h: sb.height },
          };
        }));
        const buf = await pg.locator('#comp-grid').screenshot({ omitBackground: true });
        const b64 = 'data:image/png;base64,' + buf.toString('base64');
        return await pg.evaluate(async ({ url, gridRect, rects }) => {
          const img = await new Promise((res, rej) => {
            const i = new Image();
            i.onload = () => res(i);
            i.onerror = rej;
            i.src = url;
          });
          const c = document.createElement('canvas');
          c.width = img.width;
          c.height = img.height;
          const x = c.getContext('2d');
          x.drawImage(img, 0, 0);
          const d = x.getImageData(0, 0, c.width, c.height).data;
          const sx = c.width / gridRect.width;
          const sy = c.height / gridRect.height;
          return rects.map((r) => {
            const x0 = Math.max(0, Math.floor((r.cell.x - gridRect.x) * sx));
            const y0 = Math.max(0, Math.floor((r.cell.y - gridRect.y) * sy));
            const x1 = Math.min(c.width, Math.ceil((r.cell.x + r.cell.w - gridRect.x) * sx));
            const y1 = Math.min(c.height, Math.ceil((r.cell.y + r.cell.h - gridRect.y) * sy));
            const acx = (r.wrap.x + r.wrap.w / 2 - gridRect.x) * sx;
            const acy = (r.wrap.y + r.wrap.h / 2 - gridRect.y) * sy;
            const aRad = (r.wrap.w / 2) * sx;
            const scx = (r.svg.x + r.svg.w / 2 - gridRect.x) * sx;
            const scy = (r.svg.y + r.svg.h / 2 - gridRect.y) * sy;
            const svgUnitsPerPx = 140 / (r.svg.w * sx);
            let insideSvg = 0;
            let insideCss = 0;
            let maxAlpha = 0;
            let outside = 0;
            let weight = 0;
            for (let py = y0; py < y1; py++) {
              for (let px = x0; px < x1; px++) {
                const a = d[(py * c.width + px) * 4 + 3];
                if (a > 0) {
                  const rSvg = Math.hypot(px + 0.5 - scx, py + 0.5 - scy) * svgUnitsPerPx;
                  const rCss = Math.hypot(px + 0.5 - acx, py + 0.5 - acy);
                  if (rSvg < 46) {
                    insideSvg++;
                    if (a > maxAlpha) maxAlpha = a;
                  }
                  if (rCss < aRad) {
                    insideCss++;
                    if (a > maxAlpha) maxAlpha = a;
                  }
                  if (rSvg >= 46) {
                    if (a > 8) outside++;
                    weight += a;
                  }
                }
              }
            }
            return { id: r.id, insideSvg, insideCss, maxAlpha, outside, weight };
          });
        }, { url: b64, gridRect, rects });
      };

      const actualList = await captureMetrics(false);
      const noGlowList = await captureMetrics(true);
      assert.deepStrictEqual(pageErrors, [], `size=${size}@${dpr}x 瀏覽器合成截圖不可有 JS 錯誤：` + pageErrors.join('; '));

      for (let i = 0; i < actualList.length; i++) {
        const act = actualList[i];
        const ng = noGlowList[i];
        assert.strictEqual(act.insideSvg, 0, `瀏覽器合成截圖外框 ${act.id} (${size}px@${dpr}x) SVG 內圓 r<46 不可有外框／光暈像素，實得 ${act.insideSvg} (maxAlpha=${act.maxAlpha})`);
        assert.strictEqual(act.insideCss, 0, `瀏覽器合成截圖外框 ${act.id} (${size}px@${dpr}x) 畫面內圓 r<size/2 不可有外框／光暈像素，實得 ${act.insideCss} (maxAlpha=${act.maxAlpha})`);
        assert.ok(act.outside >= minOut, `瀏覽器合成截圖外框 ${act.id} (${size}px@${dpr}x) 外圈裝飾不足：${act.outside} < ${minOut}`);
        const glowDelta = act.weight - ng.weight;
        assert.ok(glowDelta >= minGlowWeight, `瀏覽器光暈缺失 ${act.id} (${size}px@${dpr}x)：有光暈權重 ${act.weight} vs 停用光暈 ${ng.weight} (差值 ${glowDelta} < ${minGlowWeight})`);
        if (requireGlowOut) {
          assert.ok(act.outside > ng.outside, `瀏覽器光暈缺失 ${act.id} (${size}px@${dpr}x)：有光暈外圈像素 ${act.outside} 未高於無光暈 ${ng.outside}`);
        }
      }
    } finally {
      await ctx.close();
    }
  }
}

/** 強制走 Canvas PNG 備援（SVG 外框載入失敗但保留固定頭像），逐款驗證 20 款內圓零改動、外圈有備援裝飾且可匯出 PNG。 */
async function assertCanvasFallbackPixelClean(browser, bundle) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 600 } });
  const pg = await ctx.newPage();
  const pageErrors = [];
  pg.on('pageerror', (e) => pageErrors.push(e.message));
  try {
    await pg.setContent(`<!DOCTYPE html><html><body><script>${bundle}</script></body></html>`);
    const results = await pg.evaluate(async () => {
      const api = window.__api;
      const sc = document.createElement('canvas');
      sc.width = 160;
      sc.height = 224;
      const sx = sc.getContext('2d');
      sx.fillStyle = '#00ff88';
      sx.fillRect(0, 0, 160, 224);
      const avUrl = sc.toDataURL('image/png');
      const blankC = document.createElement('canvas');
      blankC.width = 2;
      blankC.height = 2;
      const blankUrl = blankC.toDataURL('image/png');

      const baseCard = {
        found: true, profileKey: 'pk_1', nick: '測試', bio: '',
        avatar: { cardId: '19145', x: 0.5, y: 0.5, zoom: 1.4 },
        googleVerified: true, champOfficial: 1, champCommunity: 0, totalWins: 5,
        showTotalWins: true, showOfficialCrowns: true, showCommunityCrowns: true,
        pinnedHonors: [], canFriend: false, friendStatus: 'self',
      };
      const loadWithBlankFrame = (u) => new Promise((res) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => res(null);
        i.src = String(u).startsWith('data:image/svg+xml') ? blankUrl : avUrl;
      });
      const loadFallbackOnlyAvatar = (u) => new Promise((res) => {
        if (String(u).startsWith('data:image/svg+xml')) return res(null);
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => res(null);
        i.src = avUrl;
      });
      const baseC = await api.renderProfileCardToCanvas({ ...baseCard, avatarFrame: 'admin_gold' }, { loadImage: loadWithBlankFrame });
      const bd = baseC.getContext('2d').getImageData(0, 0, baseC.width, baseC.height).data;
      const AV_CX = 32 + 72 + 18;
      const AV_CY = 96 + 22;
      const AV_R = 72;
      const out = [];
      for (const f of api.AVATAR_FRAMES) {
        const fbC = await api.renderProfileCardToCanvas({ ...baseCard, avatarFrame: f.id }, { loadImage: loadFallbackOnlyAvatar });
        const fd = fbC.getContext('2d').getImageData(0, 0, fbC.width, fbC.height).data;
        let modified = 0;
        let deltaMax = 0;
        let outerDiff = 0;
        for (let dy = -AV_R - 30; dy <= AV_R + 30; dy++) {
          for (let dx = -AV_R - 30; dx <= AV_R + 30; dx++) {
            const dist = Math.hypot(dx + 0.5, dy + 0.5);
            const idx = ((AV_CY + dy) * fbC.width + (AV_CX + dx)) * 4;
            const diff = Math.max(Math.abs(fd[idx] - bd[idx]), Math.abs(fd[idx + 1] - bd[idx + 1]), Math.abs(fd[idx + 2] - bd[idx + 2]));
            if (dist < AV_R) {
              if (diff > 0) {
                modified++;
                if (diff > deltaMax) deltaMax = diff;
              }
            } else if (dist >= AV_R + 1 && dist <= AV_R + 28) {
              if (diff > 20) outerDiff++;
            }
          }
        }
        out.push({
          id: f.id,
          modified,
          deltaMax,
          outerDiff,
          exportable: fbC.toDataURL('image/png').startsWith('data:image/png;base64,'),
        });
      }
      return out;
    });
    assert.deepStrictEqual(pageErrors, [], 'Canvas 備援檢查不可有 JS 錯誤：' + pageErrors.join('; '));
    assert.strictEqual(results.length, 20, 'Canvas PNG 備援應覆蓋全部 20 款外框');
    for (const fb of results) {
      assert.strictEqual(fb.exportable, true, `圖片載入失敗時 Canvas PNG 備援 ${fb.id} 仍須可匯出`);
      assert.strictEqual(fb.modified, 0, `Canvas PNG 降級外框 ${fb.id} 不可改動頭像內圓像素，實得 ${fb.modified} (deltaMax=${fb.deltaMax})`);
      assert.ok(fb.outerDiff >= 1500, `Canvas PNG 降級外框 ${fb.id} 外圈應有可見裝飾，實得 ${fb.outerDiff}`);
    }
  } finally {
    await ctx.close();
  }
}

async function assertAll20FramesPixelClean(browser, bundle) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 900 } });
  const pg = await ctx.newPage();
  const pageErrors = [];
  pg.on('pageerror', (e) => pageErrors.push(e.message));
  try {
    await pg.setContent(`<!DOCTYPE html><html><body><div id="host"></div><script>${bundle}</script></body></html>`);
    const report = await pg.evaluate(async () => {
      const api = window.__api;
      const host = document.getElementById('host');
      const frames = api.AVATAR_FRAMES;
      // Mount 2 instances of each of the 20 frames (40 total) to test multi-instance ID uniqueness
      for (let copy = 0; copy < 2; copy++) {
        for (const f of frames) {
          const slot = document.createElement('div');
          slot.dataset.frameId = f.id;
          slot.dataset.copy = String(copy);
          host.appendChild(slot);
          window.__mountAvatar(slot, { name: '測', size: 72, frame: f.id, ring: true });
        }
      }
      await new Promise((r) => setTimeout(r, 30));

      const allSvgs = Array.from(host.querySelectorAll('svg.prof-av-frame-svg'));
      const allIds = [];
      const maskMatchErrors = [];
      for (const svg of allSvgs) {
        const localIds = new Set();
        for (const el of svg.querySelectorAll('linearGradient[id], radialGradient[id], mask[id]')) {
          const id = el.getAttribute('id');
          allIds.push(id);
          localIds.add(id);
        }
        const masked = svg.querySelector('g[mask]');
        const mRef = masked?.getAttribute('mask') || '';
        const mMatch = /^url\(#([^)]+)\)$/.exec(mRef);
        if (!mMatch || !localIds.has(mMatch[1])) {
          maskMatchErrors.push('missing-or-unpaired-mask:' + mRef);
        }
      }

      // Rasterize each of the 20 rendered DOM SVGs (copy 0) and inspect inner circle r<46 vs outer decoration
      const svgPixelResults = [];
      for (const f of frames) {
        const slot = host.querySelector(`[data-frame-id="${f.id}"][data-copy="0"]`);
        const svgEl = slot.querySelector('svg.prof-av-frame-svg');
        const clone = svgEl.cloneNode(true);
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        clone.setAttribute('width', '280');
        clone.setAttribute('height', '280');
        const markup = new XMLSerializer().serializeToString(clone);
        const img = await new Promise((res, rej) => {
          const i = new Image();
          i.onload = () => res(i);
          i.onerror = () => rej(new Error('SVG load failed: ' + f.id));
          i.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup);
        });
        const S = 280;
        const c = document.createElement('canvas');
        c.width = S;
        c.height = S;
        const cctx = c.getContext('2d');
        cctx.drawImage(img, 0, 0, S, S);
        const data = cctx.getImageData(0, 0, S, S).data;
        let inside = 0;
        let outside = 0;
        for (let y = 0; y < S; y++) {
          for (let x = 0; x < S; x++) {
            const a = data[(y * S + x) * 4 + 3];
            if (a > 0) {
              const r = Math.hypot((x + 0.5) * 0.5 - 70, (y + 0.5) * 0.5 - 70);
              if (r < 46) inside++;
              else if (a > 32) outside++;
            }
          }
        }
        svgPixelResults.push({ id: f.id, inside, outside });
      }

      // Check psychic_nebula outer orbit arcs unmasked minR >= 49
      const psArt = api.AVATAR_FRAME_ART.psychic_nebula;
      const arcSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 140" width="280" height="280" fill="none">'
        + psArt.shapes.slice(0, 2).map((s) => `<path d="${s.d}" transform="${s.tf}" stroke="${s.stroke}" stroke-width="${s.sw}" stroke-linecap="${s.slc}"/>`).join('')
        + '</svg>';
      const arcImg = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(arcSvg);
      });
      const ac = document.createElement('canvas');
      ac.width = 280;
      ac.height = 280;
      const actx = ac.getContext('2d');
      actx.drawImage(arcImg, 0, 0, 280, 280);
      const ad = actx.getImageData(0, 0, 280, 280).data;
      let arcMinR = 999;
      for (let y = 0; y < 280; y++) {
        for (let x = 0; x < 280; x++) {
          if (ad[(y * 280 + x) * 4 + 3] > 0) {
            const r = Math.hypot((x + 0.5) * 0.5 - 70, (y + 0.5) * 0.5 - 70);
            if (r < arcMinR) arcMinR = r;
          }
        }
      }

      // Check ALL 20 frames in real 780px Canvas PNG export (inner circle r < AV_R - 1 untouched vs unframed avatar!)
      const solidAvatarCanvas = document.createElement('canvas');
      solidAvatarCanvas.width = 160;
      solidAvatarCanvas.height = 224;
      const sctx = solidAvatarCanvas.getContext('2d');
      sctx.fillStyle = '#00ff88';
      sctx.fillRect(0, 0, 160, 224);
      const solidAvatarUrl = solidAvatarCanvas.toDataURL('image/png');
      const loadImg = (u) => new Promise((res) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => res(null);
        i.src = u.startsWith('data:') ? u : solidAvatarUrl;
      });
      const baseCard = {
        found: true, profileKey: 'pk_1', nick: '測試', bio: '',
        avatar: { cardId: '19145', x: 0.5, y: 0.5, zoom: 1.4 },
        googleVerified: true, champOfficial: 1, champCommunity: 0, totalWins: 5,
        showTotalWins: true, showOfficialCrowns: true, showCommunityCrowns: true,
        pinnedHonors: [], canFriend: false, friendStatus: 'self',
      };
      const pngPixelResults = [];
      for (const f of frames) {
        const svgUrl = api.buildAvatarFrameSvgDataUrl(f.id);
        const fImg = await new Promise((res, rej) => {
          const i = new Image();
          i.onload = () => res(i);
          i.onerror = () => rej(new Error('PNG SVG dataUrl load failed: ' + f.id));
          i.src = svgUrl;
        });
        const fc = document.createElement('canvas');
        fc.width = 280;
        fc.height = 280;
        const fctx = fc.getContext('2d');
        fctx.drawImage(fImg, 0, 0, 280, 280);
        const fData = fctx.getImageData(0, 0, 280, 280).data;
        let svgDataUrlInside = 0;
        for (let y = 0; y < 280; y++) {
          for (let x = 0; x < 280; x++) {
            if (fData[(y * 280 + x) * 4 + 3] > 0) {
              if (Math.hypot((x + 0.5) * 0.5 - 70, (y + 0.5) * 0.5 - 70) < 46) svgDataUrlInside++;
            }
          }
        }

        const canvas = await api.renderProfileCardToCanvas({ ...baseCard, avatarFrame: f.id }, { loadImage: loadImg });
        const dataUrl = canvas.toDataURL('image/png');
        const cctx = canvas.getContext('2d');
        const imgData = cctx.getImageData(0, 0, canvas.width, canvas.height).data;
        const AV_CX = 32 + 72 + 18;
        const AV_CY = 96 + 22;
        const AV_R = 72;
        let innerCovered = 0;
        let outerDecorated = 0;
        for (let y = AV_CY - AV_R - 30; y <= AV_CY + AV_R + 30; y++) {
          for (let x = AV_CX - AV_R - 30; x <= AV_CX + AV_R + 30; x++) {
            const dist = Math.hypot(x + 0.5 - AV_CX, y + 0.5 - AV_CY);
            const idx = (y * canvas.width + x) * 4;
            const r = imgData[idx], g = imgData[idx + 1], b = imgData[idx + 2];
            if (dist < AV_R - 1.5) {
              if (r > 12 || g < 240 || Math.abs(b - 136) > 12) innerCovered++;
            } else if (dist >= AV_R + 2 && dist <= AV_R + 28) {
              if (r > 55 || g > 90 || b > 75) outerDecorated++;
            }
          }
        }
        pngPixelResults.push({ id: f.id, svgDataUrlInside, innerCovered, outerDecorated, exportable: dataUrl.startsWith('data:image/png;base64,') });
      }

      const fbCanvas = await api.renderProfileCardToCanvas({ ...baseCard, avatarFrame: 'admin_gold' }, { loadImage: async () => null });
      const fbExportable = fbCanvas.toDataURL('image/png').startsWith('data:image/png;base64,');

      return {
        svgCount: allSvgs.length,
        totalIds: allIds.length,
        uniqueIds: new Set(allIds).size,
        maskMatchErrors,
        svgPixelResults,
        arcMinR: Number(arcMinR.toFixed(2)),
        pngPixelResults,
        fbExportable,
      };
    });

    assert.deepStrictEqual(pageErrors, [], '瀏覽器不可有 JS 錯誤：' + pageErrors.join('; '));
    assert.strictEqual(report.svgCount, 40, '應掛載 20×2=40 顆外框 SVG');
    assert.strictEqual(report.uniqueIds, report.totalIds, '40 顆多實例 SVG 的漸層與遮罩 ID 必須完全唯一');
    assert.deepStrictEqual(report.maskMatchErrors, [], '每個外框 SVG 都必須配對到自身 <mask>：' + report.maskMatchErrors.join(','));
    assert.ok(report.arcMinR >= 49, 'psychic_nebula 星環外弧去遮罩含描邊應 >= 49，實得 ' + report.arcMinR);
    for (const s of report.svgPixelResults) {
      assert.strictEqual(s.inside, 0, `瀏覽器 SVG 外框 ${s.id} 內圓 r<46 不可有可見像素，實得 ${s.inside}`);
      assert.ok(s.outside >= 3000, `瀏覽器 SVG 外框 ${s.id} 外圈裝飾不足：${s.outside}`);
    }
    for (const p of report.pngPixelResults) {
      assert.strictEqual(p.exportable, true, `PNG ${p.id} 必須可匯出`);
      assert.strictEqual(p.svgDataUrlInside, 0, `PNG 用 SVG 外框 ${p.id} 內圓 r<46 不可有可見像素，實得 ${p.svgDataUrlInside}`);
      assert.strictEqual(p.innerCovered, 0, `Canvas PNG 外框 ${p.id} 不可遮擋頭像內圓像素，實得 ${p.innerCovered}`);
      assert.ok(p.outerDecorated >= 400, `Canvas PNG 外框 ${p.id} 外圈應有可見裝飾，實得 ${p.outerDecorated}`);
    }
    assert.strictEqual(report.fbExportable, true, '圖片載入失敗時 Canvas PNG 外框降級仍須可匯出');
  } finally {
    await ctx.close();
  }
}

/** 抽取真實 src/routes/game/+page.svelte 的等待中與對戰中房間清單模板並以 Svelte 5 編譯，驗證缺／空白／有效 UID 互動行為。 */
function extractLobbyUlBlock(gameSrc, openTag) {
  const start = gameSrc.indexOf(openTag);
  assert.ok(start >= 0, '找不到大廳房間清單：' + openTag);
  const end = gameSrc.indexOf('</ul>', start);
  assert.ok(end > start, '找不到大廳房間清單結尾 </ul>：' + openTag);
  return gameSrc.slice(start, end + 5);
}

async function buildLobbyTemplateBundle(gameSrc, apiSrc) {
  const waitUl = extractLobbyUlBlock(gameSrc, '<ul class="open-room-list">');
  const playUl = extractLobbyUlBlock(gameSrc, '<ul class="open-room-list playing-list">');
  const svelteHarness = [
    '<script>',
    "  import { buildLobbyHostProfileTarget, buildLobbySeatProfileTarget } from './profile-api.ts';",
    '  let { lobbyRooms = [], playingRooms = [], roomArchetypes = {}, onProfile = () => {}, onJoin = () => {} } = $props();',
    '  const onlineLoading = false;',
    "  const myName = '測試玩家';",
    "  const hostPresence = () => 'online';",
    "  const fmtRoomAge = () => '1分';",
    '  function openProfileModal(t) { onProfile(t); }',
    '  function openLobbyHostProfile(r) { const t = buildLobbyHostProfileTarget(r); if (t) openProfileModal(t); }',
    '  function openLobbySeatProfile(r, seatIdx) { const t = buildLobbySeatProfileTarget(r, seatIdx); if (t) openProfileModal(t); }',
    '  function handleJoinFromList(roomId) { onJoin(roomId); }',
    '</script>',
    '<div class="lobby"><div class="online-form lobby-unified">',
    '<div id="wait-sec">' + waitUl + '</div>',
    '<div id="play-sec">' + playUl + '</div>',
    '</div></div>',
  ].join('\n');

  const tmp = mkdtempSync(join(tmpdir(), 'v6665-lobby-'));
  try {
    writeFileSync(join(tmp, 'profile-api.ts'), apiSrc ?? read(API_PATH));
    const compiled = svelteCompile(svelteHarness, { generate: 'client', css: 'injected', filename: 'LobbyRoomsHarness.svelte' });
    writeFileSync(join(tmp, 'LobbyRoomsHarness.js'), compiled.js.code);
    writeFileSync(join(tmp, 'entry.js'), [
      "import { mount } from 'svelte';",
      "import LobbyRoomsHarness from './LobbyRoomsHarness.js';",
      "window.__mountLobby = (target, props) => mount(LobbyRoomsHarness, { target, props });",
    ].join('\n'));
    const res = await esbuildBuild({
      entryPoints: [join(tmp, 'entry.js')],
      bundle: true,
      format: 'iife',
      write: false,
      nodePaths: [join(ROOT, 'node_modules')],
      plugins: [{
        name: 'stubs',
        setup(b) {
          b.onResolve({ filter: /^\$lib\/cards\/pool$/ }, () => ({ path: 'pool', namespace: 's' }));
          b.onLoad({ filter: /^pool$/, namespace: 's' }, () => ({ contents: 'export const loadIndex=async()=>null;export const loadSet=async()=>[];export const loadAllSets=async()=>[];export const loadCardSetMap=async()=>({});' }));
        },
      }],
    });
    return res.outputFiles[0].text;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function assertLobbyUidTemplateBehavior(browser, gameSrc, apiSrc) {
  const bundle = await buildLobbyTemplateBundle(gameSrc, apiSrc);
  const ctx = await browser.newContext({ viewport: { width: 900, height: 800 } });
  const pg = await ctx.newPage();
  const pageErrors = [];
  pg.on('pageerror', (e) => pageErrors.push(e.message));
  try {
    await pg.setContent(`<!DOCTYPE html><html><body><div id="root"></div><script>${bundle}</script></body></html>`);
    await pg.evaluate(() => {
      window.__opened = [];
      window.__joins = [];
      window.__mountLobby(document.getElementById('root'), {
        lobbyRooms: [
          { roomId: 'W_OK', hostUid: '  uid_host_ok  ', hostName: '正常房主', createdAt: Date.now(), seats: [{ uid: '  uid_host_ok  ', name: '正常房主' }] },
          { roomId: 'W_WS', hostUid: '   \t ', hostName: '空白房主', createdAt: Date.now(), seats: [{ uid: '   \t ', name: '空白房主' }] },
          { roomId: 'W_NO', hostName: '無UID房主', createdAt: Date.now(), seats: [{ name: '無UID房主' }] },
        ],
        playingRooms: [
          { roomId: 'P_OK', hostName: '快速開局', seats: [{ uid: 'uid_p1', name: 'LIN' }, { uid: '  uid_p2  ', name: 'hsuboyuan' }] },
          { roomId: 'P_WS', hostName: '空白對戰', seats: [{ uid: '   ', name: '空白P1' }, { uid: '', name: '缺UIDP2' }] },
          { roomId: 'P_WS2', hostName: '空白對戰2', seats: [{ uid: '', name: '缺UIDP1' }, { uid: ' \t ', name: '空白P2' }] },
        ],
        roomArchetypes: { P_OK: { p1: '超級龍頭地鼠', p2: '魔靈烈箭鷹' } },
        onProfile: (t) => window.__opened.push(t),
        onJoin: (id) => window.__joins.push(id),
      });
    });

    const inspect = await pg.evaluate(() => {
      const waitRows = Array.from(document.querySelectorAll('#wait-sec .open-room-row'));
      const playRows = Array.from(document.querySelectorAll('#play-sec .open-room-row'));
      const info = (row) => ({
        metaText: row.querySelector('.or-meta')?.textContent || '',
        btnCount: row.querySelectorAll('.or-meta [role="button"], .or-meta .or-prof-link').length,
      });
      return {
        wOk: info(waitRows[0]),
        wWs: info(waitRows[1]),
        wNo: info(waitRows[2]),
        pOk: info(playRows[0]),
        pWs: info(playRows[1]),
        pWs2: info(playRows[2]),
      };
    });

    assert.deepStrictEqual(pageErrors, [], '大廳模板不可有 JS 錯誤：' + pageErrors.join('; '));
    assert.strictEqual(inspect.wOk.btnCount, 1, '有效 hostUid 應顯示 1 個可點按鈕');
    assert.strictEqual(inspect.wWs.btnCount, 0, '空白 hostUid 不可顯示無效按鈕（應維持純文字）');
    assert.ok(inspect.wWs.metaText.includes('空白房主'), '空白 hostUid 仍須保留房主名稱純文字');
    assert.strictEqual(inspect.wNo.btnCount, 0, '缺少 hostUid 不可顯示按鈕');
    assert.ok(inspect.wNo.metaText.includes('無UID房主'), '缺少 hostUid 仍須保留房主名稱純文字');

    assert.strictEqual(inspect.pOk.btnCount, 2, '有效 P1/P2 UID 應顯示 2 個可點按鈕');
    assert.strictEqual(inspect.pWs.btnCount, 0, '空白或缺少 UID 的對戰雙方不可顯示無效按鈕');
    assert.ok(inspect.pWs.metaText.includes('空白P1') && inspect.pWs.metaText.includes('缺UIDP2'), '空白／缺 UID 對戰雙方仍須保留純文字名稱');
    assert.strictEqual(inspect.pWs2.btnCount, 0, 'P2 空白或 P1 缺少 UID 不可顯示無效按鈕');
    assert.ok(inspect.pWs2.metaText.includes('缺UIDP1') && inspect.pWs2.metaText.includes('空白P2'), 'P2 空白／P1 缺 UID 仍須保留純文字名稱');

    // 實測有效 UID：滑鼠點擊、Enter、Space，且送出已 trim 的正規化目標，不觸發加入／觀戰
    await pg.locator('#wait-sec .open-room-row').nth(0).locator('.or-prof-link').click();
    const p1Btn = pg.locator('#play-sec .open-room-row').nth(0).locator('.or-prof-link').nth(0);
    const p2Btn = pg.locator('#play-sec .open-room-row').nth(0).locator('.or-prof-link').nth(1);
    await p1Btn.focus();
    await pg.keyboard.press('Enter');
    await p2Btn.focus();
    await pg.keyboard.press('Space');

    const res = await pg.evaluate(() => ({ opened: window.__opened, joins: window.__joins }));
    assert.deepStrictEqual(res.joins, [], '點擊有效玩家連結絕不可誤觸加入／觀戰');
    assert.deepStrictEqual(res.opened, [
      { roomCode: 'W_OK', targetUid: 'uid_host_ok', fallbackNick: '正常房主' },
      { roomCode: 'P_OK', targetUid: 'uid_p1', fallbackNick: 'LIN' },
      { roomCode: 'P_OK', targetUid: 'uid_p2', fallbackNick: 'hsuboyuan' },
    ], '點擊／鍵盤操作必須傳遞正規化後的 targetUid 與 roomCode');
  } finally {
    await ctx.close();
  }
}

console.log('\n【A】大廳玩家名稱入口與後端 _profResolveTarget 實際整合與反證');
await T('A1 現行大廳入口與後端：換人絕不開錯、換座命中、刪房退回 UID、查無回 found:false、缺／空白 UID 不猜人與純 seatIdx 相容', () =>
  assertLobbyResolutionContract(read(API_PATH), read(SRV_PATH)));

await T('A2 舊提交 v6.663 (0329ee55) 反證：「點 A 卻開 B」必須確實重現並翻紅', async () => {
  if (!hasBaseCommit(ROOT, BASE_V6663)) { shallowSkip('v6664 A2 舊版反證', '需要 0329ee55 commit'); return; }
  const oldSrv = readBaseBlob(ROOT, BASE_V6663, SRV_PATH);
  const oldGame = readBaseBlob(ROOT, BASE_V6663, GAME_PATH);
  assert.ok(oldSrv.ok && oldGame.ok);
  assert.ok(oldGame.out.includes('roomCode: r.roomId,\n      seatIdx,'), '確認 0329ee55 確實同時送 seatIdx 與 targetUid');
  const { colOf, viewProfile } = buildBackendHarness(normEol(oldSrv.out));
  colOf('playerProfiles').push(
    { _id: 'alice@example.test', uid: 'uid_a', nick: 'Alice原玩家', profileKey: 'pk_a' },
    { _id: 'bob@example.test', uid: 'uid_b', nick: 'Bob新入座', profileKey: 'pk_b' },
  );
  colOf('rooms').push({
    _id: 'ABCD',
    seats: [{ role: 'p1', uid: 'uid_b', email: 'bob@example.test', name: 'Bob新入座' }],
  });
  const resOld = await viewProfile({ roomCode: 'ABCD', seatIdx: '0', targetUid: 'uid_a', fallbackNick: 'Alice原玩家' });
  assert.strictEqual(resOld.body.profileKey, 'pk_b', '舊版 0329ee55 確實會誤開成 Bob (pk_b)');
  await mutantMustBreak('v6663_seat_changed_opens_wrong_player', async () => {
    assert.strictEqual(resOld.body.profileKey, 'pk_a', '座位換人點 A 不該開成 B');
  }, '座位換人');
});

await T('A3 真實突變：後端把 seatIdx 移回 targetUid 之前 ⇒ 同時帶 seatIdx+targetUid 必紅', async () => {
  const srv = read(SRV_PATH);
  const mutSrv = srv.replace(
    `          const tu = typeof s.targetUid === 'string' ? s.targetUid.trim() : '';\n          if (tu) {\n            const seat = rm.seats.find((x) => x && x.uid === tu);\n            if (seat && seat.email) return { email: _frNormEmail(seat.email), fallbackNick: seat.name || '', uid: tu };\n            const byU = await _profEmailByUid(tu);\n            return { email: byU.email, fallbackNick: (seat && seat.name) || _profCleanText(s.fallbackNick || '', 32) || byU.fallbackNick || '', uid: tu };\n          }`,
    '',
  ).replace(
    `              if (seat.uid) {\n                const byU = await _profEmailByUid(seat.uid);\n                return { email: byU.email, fallbackNick: seat.name || byU.fallbackNick || '', uid: seat.uid };\n              }\n            }\n          }`,
    `              if (seat.uid) {\n                const byU = await _profEmailByUid(seat.uid);\n                return { email: byU.email, fallbackNick: seat.name || byU.fallbackNick || '', uid: seat.uid };\n              }\n            }\n          }\n          if (s.targetUid) {\n            const tu = String(s.targetUid).trim();\n            const seat = rm.seats.find((x) => x && x.uid === tu);\n            if (seat && seat.email) return { email: _frNormEmail(seat.email), fallbackNick: seat.name || '', uid: tu };\n            const byU = await _profEmailByUid(tu);\n            return { email: byU.email, fallbackNick: (seat && seat.name) || s.fallbackNick || byU.fallbackNick || '', uid: tu };\n          }`,
  );
  assert.notStrictEqual(mutSrv, srv, 'A3 突變錨點未命中');
  await mutantMustBreak('M_seatIdx_before_targetUid', () => assertLobbyResolutionContract(read(API_PATH), mutSrv), '不可改開另一人');
});

console.log('\n【B】20 款 SVG 外框逐款實際像素檢查（瀏覽器 SVG + 合成截圖 + Canvas PNG + 強制備援）＋HEAD-FAIL 與突變');
const chromium = await pwChromium();
if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.664');
  if (browser) {
    try {
      const okBundle = await buildFrameBundle();
      await T('B1 20 款瀏覽器 DOM SVG 與 780px Canvas PNG 逐款像素檢查（內圓 r<46 零遮擋、外圈有裝飾、40 實例 ID 唯一、星環外弧 >=49）', () =>
        assertAll20FramesPixelClean(browser, okBundle));

      await T('B1b 20 款實際 AvatarCircle 多尺寸合成截圖（16px DPR 1/2/3、28/56/72px）＋光暈存在驗證＋20 款強制 Canvas PNG 備援像素檢查', async () => {
        await assertBrowserCompositeScreenshotClean(browser, okBundle);
        await assertCanvasFallbackPixelClean(browser, okBundle);
      });

      await T('B2 真實突變：停用 AvatarCircle SVG 內圓遮罩與停用 PNG SVG 內圓遮罩兩條皆必紅', async () => {
        const av = read(AV_PATH);
        const avNoMask = av.replace('r={AVATAR_FRAME_MASK_R}', 'r={0}');
        assert.notStrictEqual(avNoMask, av, 'B2a 突變錨點未命中');
        const badAvBundle = await buildFrameBundle({ avSrc: avNoMask });
        await mutantMustBreak('M_disable_svg_mask', () => assertAll20FramesPixelClean(browser, badAvBundle), '內圓 r<46 不可有可見像素');

        const api = read(API_PATH);
        const apiNoMask = api.replace('r="${AVATAR_FRAME_MASK_R}"', 'r="0"');
        assert.notStrictEqual(apiNoMask, api, 'B2b 突變錨點未命中');
        const badPngBundle = await buildFrameBundle({ apiSrc: apiNoMask });
        await mutantMustBreak('M_disable_png_mask', () => assertAll20FramesPixelClean(browser, badPngBundle), 'PNG 用 SVG 外框');

        const apiWithCross = api.replace(
          "{ t: 'circle', cx: 70, cy: 70, r: 49.6, stroke: '#2d1d04', sw: 6.2 },",
          "{ t: 'circle', cx: 70, cy: 70, r: 49.6, stroke: '#2d1d04', sw: 6.2 },{ t: 'line', x1: 20, y1: 70, x2: 120, y2: 70, stroke: '#ff0000', sw: 6 },",
        );
        assert.notStrictEqual(apiWithCross, api, 'B2c 測試線段錨點未命中');
        const maskedCrossBundle = await buildFrameBundle({ apiSrc: apiWithCross });
        await assertAll20FramesPixelClean(browser, maskedCrossBundle);
        const unmaskedCrossBundle = await buildFrameBundle({ apiSrc: apiWithCross.replace('r="${AVATAR_FRAME_MASK_R}"', 'r="0"') });
        await mutantMustBreak('M_unmasked_center_line_png', () => assertAll20FramesPixelClean(browser, unmaskedCrossBundle), 'PNG 用 SVG 外框');
      });

      await T('B3 v6.664/v6.665 HEAD-FAIL ＋ 4 項獨立突變（外層光暈滲透、Canvas 備援裁切、恢復小尺寸裁切、移除瀏覽器光暈）各自必紅', async () => {
        const p72 = [COMPOSITE_PROFILES[COMPOSITE_PROFILES.length - 2]];
        const pSmall = COMPOSITE_PROFILES.slice(0, 7); // 16@1(偶/奇)/2/3, 28@2, 56@2(偶/奇)

        if (hasBaseCommit(ROOT, BASE_V6664)) {
          const oldAv = readBaseBlob(ROOT, BASE_V6664, AV_PATH);
          const oldApi = readBaseBlob(ROOT, BASE_V6664, API_PATH);
          assert.ok(oldAv.ok && oldApi.ok, '讀取 b390744e 外框檔案失敗');
          const oldAvBundle = await buildFrameBundle({ avSrc: normEol(oldAv.out), apiSrc: normEol(oldApi.out) });
          await mutantMustBreak('HEAD_FAIL_v6664_css_glow_bleed', () => assertBrowserCompositeScreenshotClean(browser, oldAvBundle, p72), '瀏覽器合成截圖外框');
          await mutantMustBreak('HEAD_FAIL_v6664_canvas_fallback_shadow', () => assertCanvasFallbackPixelClean(browser, oldAvBundle), 'Canvas PNG 降級外框');
        } else {
          shallowSkip('v6665 B3 HEAD-FAIL', '需要 b390744e commit');
        }

        if (hasBaseCommit(ROOT, COMMIT_V6665)) {
          const v665Av = readBaseBlob(ROOT, COMMIT_V6665, AV_PATH);
          const v665Api = readBaseBlob(ROOT, COMMIT_V6665, API_PATH);
          assert.ok(v665Av.ok && v665Api.ok, '讀取 4fed8ee3 外框檔案失敗');
          const v665Bundle = await buildFrameBundle({ avSrc: normEol(v665Av.out), apiSrc: normEol(v665Api.out) });
          await mutantMustBreak('HEAD_FAIL_v6665_small_size_bleed', () => assertBrowserCompositeScreenshotClean(browser, v665Bundle, pSmall), '瀏覽器合成截圖外框');
        } else {
          shallowSkip('v6666 B3 HEAD-FAIL', '需要 4fed8ee3 commit');
        }

        // 突變 1：把 drop-shadow 移回外層 .prof-av-frame-svg 並移除硬遮罩（重現外層光暈侵入 72px 內圓）
        const av = read(AV_PATH);
        const avNoRadialMask = av
          .replace('      style:mask-image={innerMaskHole}\n      style:-webkit-mask-image={innerMaskHole}\n', '');
        assert.notStrictEqual(avNoRadialMask, av, 'B3 突變（移除小尺寸硬遮罩）錨點未命中');
        const avBleed = avNoRadialMask
          .replace(
            '  style:height={`${size}px`}\n>',
            '  style:height={`${size}px`}\n  style:--pf-glow={frameSpec?.glow ?? \'transparent\'}\n>',
          )
          .replace(
            '    overflow: visible;\n  }\n  .prof-avatar-circle',
            '    overflow: visible;\n    filter: drop-shadow(0 0 3px var(--pf-glow, transparent));\n  }\n  .prof-avatar-circle',
          );
        assert.notStrictEqual(avBleed, avNoRadialMask, 'B3 突變 1 錨點未命中');
        const mutGlowBundle = await buildFrameBundle({ avSrc: avBleed });
        await mutantMustBreak('M_restore_css_drop_shadow_bleed', () => assertBrowserCompositeScreenshotClean(browser, mutGlowBundle, p72), '瀏覽器合成截圖外框');

        // 突變 2：移除 Canvas PNG 備援的 evenodd 外圈裁切（陰影重新侵入頭像內圓）
        const api = read(API_PATH);
        const apiNoFbClip = api.replace("      ctx.clip('evenodd');\n", '');
        assert.notStrictEqual(apiNoFbClip, api, 'B3 突變 2 錨點未命中');
        const mutFbBundle = await buildFrameBundle({ apiSrc: apiNoFbClip });
        await mutantMustBreak('M_remove_canvas_fallback_clip', () => assertCanvasFallbackPixelClean(browser, mutFbBundle), 'Canvas PNG 降級外框');

        // 突變 3：恢復原本小尺寸裁切（僅移除外層螢幕像素硬遮罩，保留 SVG mask 46.5 與內層光暈）⇒ 小尺寸 16/28/56px 必紅
        const mutSmallBundle = await buildFrameBundle({ avSrc: avNoRadialMask });
        await mutantMustBreak('M_restore_small_size_clip', () => assertBrowserCompositeScreenshotClean(browser, mutSmallBundle, pSmall), '瀏覽器合成截圖外框');

        // 突變 4：移除瀏覽器光暈（將 drop-shadow 改為 none）⇒ 光暈存在斷言必紅
        const avNoGlow = av.replace(
          'style:filter={`drop-shadow(0 0 3px ${frameSpec?.glow ?? \'transparent\'})`}',
          "style:filter={'none'}",
        );
        assert.notStrictEqual(avNoGlow, av, 'B3 突變 4 錨點未命中');
        const mutNoGlowBundle = await buildFrameBundle({ avSrc: avNoGlow });
        await mutantMustBreak('M_remove_browser_glow', () => assertBrowserCompositeScreenshotClean(browser, mutNoGlowBundle, [COMPOSITE_PROFILES[0], ...p72]), '瀏覽器光暈缺失');
      });

      console.log('\n【C】深／淺色大廳房間玩家連結對比度、真實模板缺／空白／有效 UID 對照與互動');
      await T('C1 深／淺色大廳房間連結對比 >=4.5:1、字色異於一般文字、鍵盤 Enter/Space 與不觸發加入／觀戰', async () => {
        const gameSrc = read(GAME_PATH);
        // Unwrap Svelte :global(...) handling nested parens such as :not(...)
        function unwrapGlobalCss(css) {
          let out = '';
          let i = 0;
          while (i < css.length) {
            const idx = css.indexOf(':global(', i);
            if (idx < 0) { out += css.slice(i); break; }
            out += css.slice(i, idx);
            let depth = 1;
            let j = idx + 8;
            while (j < css.length && depth > 0) {
              if (css[j] === '(') depth++;
              else if (css[j] === ')') depth--;
              j++;
            }
            out += css.slice(idx + 8, j - 1);
            i = j;
          }
          return out;
        }
        const rawCss = unwrapGlobalCss(cssOf(gameSrc, GAME_PATH).replace(/\/\*[\s\S]*?\*\//g, ''));

        const checkViewport = async (vp) => {
          const ctx = await browser.newContext({ viewport: vp });
          const pg = await ctx.newPage();
          try {
            const html = `<!DOCTYPE html><html data-theme="dark"><head><style>
              *{box-sizing:border-box;}
              body{margin:0;padding:0;background:#101c10;font-family:system-ui,sans-serif;}
              html[data-theme="light"] body{background:#eef2ef;}
              ${rawCss}
            </style></head><body>
              <div class="lobby">
              <div class="online-form lobby-unified">
                <ul class="open-room-list">
                  <li class="open-room-row" onclick="window.__rowClicks++">
                    <div class="or-main">
                      <span class="or-host">🎮 測試等待房</span>
                      <button class="btn-sm primary or-act" onclick="window.__joinClicks++">加入</button>
                    </div>
                    <div class="or-meta">
                      <span class="or-host-name">🟢 房主：<span id="lnk-host" class="prof-link or-prof-link" role="button" tabindex="0" onclick="event.stopPropagation();window.__opened.push('host')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();window.__opened.push('host-key')}">HostA</span></span>
                      <span class="or-code">房號 WAIT</span>
                    </div>
                  </li>
                </ul>
                <ul class="open-room-list playing-list">
                  <li class="open-room-row playing-row" onclick="window.__rowClicks++">
                    <div class="or-main">
                      <span class="or-host">⚔️ 快速開局</span>
                      <button class="btn-sm spectator-btn or-act" onclick="window.__specClicks++">👁 觀戰</button>
                    </div>
                    <div class="or-meta">
                      <span class="or-host-name">
                        <span id="lnk-p1" class="prof-link or-prof-link" role="button" tabindex="0" onclick="event.stopPropagation();window.__opened.push('p1')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();window.__opened.push('p1-key')}">LIN</span><span class="or-arch">【超級龍頭地鼠】</span>
                        <span class="or-vs">vs</span>
                        <span id="lnk-p2" class="prof-link or-prof-link" role="button" tabindex="0" onclick="event.stopPropagation();window.__opened.push('p2')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();window.__opened.push('p2-key')}">hsuboyuan</span><span class="or-arch">【魔靈烈箭鷹】</span>
                      </span>
                      <span class="or-code">房號 9DJV</span>
                    </div>
                  </li>
                </ul>
              </div>
              </div>
              <script>window.__opened=[];window.__joinClicks=0;window.__specClicks=0;window.__rowClicks=0;</script>
            </body></html>`;
            await pg.setContent(html);

            const measureTheme = async (theme) => {
              await pg.evaluate((t) => { document.documentElement.setAttribute('data-theme', t); }, theme);
              return await pg.evaluate(() => {
                const parseRgb = (s) => {
                  const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
                  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
                };
                const lum = ([r, g, b]) => [r, g, b].map((v) => {
                  const c = v / 255;
                  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
                }).reduce((acc, v, i) => acc + v * [0.2126, 0.7152, 0.0722][i], 0);
                const contrast = (c1, c2) => {
                  const l1 = lum(parseRgb(c1)), l2 = lum(parseRgb(c2));
                  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
                };
                const row = document.querySelector('.open-room-row');
                const meta = row.querySelector('.or-host-name');
                const lnk = document.getElementById('lnk-host');
                const csRow = getComputedStyle(row);
                const csMeta = getComputedStyle(meta);
                const csLnk = getComputedStyle(lnk);
                return {
                  overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
                  sw: document.documentElement.scrollWidth,
                  cw: document.documentElement.clientWidth,
                  rowBg: csRow.backgroundColor,
                  metaColor: csMeta.color,
                  linkColor: csLnk.color,
                  underlineColor: csLnk.textDecorationColor,
                  textContrast: contrast(csLnk.color, csRow.backgroundColor),
                  underlineContrast: contrast(csLnk.textDecorationColor, csRow.backgroundColor),
                };
              });
            };

            const dark = await measureTheme('dark');
            const light = await measureTheme('light');
            assert.strictEqual(dark.overflow, false, `${vp.width}px 深色不可水平捲動 (sw=${dark.sw}, cw=${dark.cw})`);
            assert.strictEqual(light.overflow, false, `${vp.width}px 淺色不可水平捲動 (sw=${light.sw}, cw=${light.cw})`);
            assert.ok(dark.textContrast >= 4.5, `${vp.width}px 深色連結對比不足：${dark.textContrast.toFixed(2)}`);
            assert.ok(light.textContrast >= 4.5, `${vp.width}px 淺色連結對比不足：${light.textContrast.toFixed(2)}`);
            assert.ok(light.underlineContrast >= 4.5, `${vp.width}px 淺色底線對比不足：${light.underlineContrast.toFixed(2)}`);
            assert.notStrictEqual(light.linkColor, light.metaColor, '淺色連結文字色不可與一般灰色資訊同色');

            await pg.locator('#lnk-host').click();
            await pg.locator('#lnk-p1').focus();
            await pg.keyboard.press('Enter');
            await pg.locator('#lnk-p2').focus();
            await pg.keyboard.press('Space');
            const focusOutline = await pg.evaluate(() => getComputedStyle(document.getElementById('lnk-p2')).outlineStyle);
            const st = await pg.evaluate(() => ({
              opened: window.__opened, join: window.__joinClicks, spec: window.__specClicks, row: window.__rowClicks,
            }));
            assert.deepStrictEqual(st.opened, ['host', 'p1-key', 'p2-key']);
            assert.strictEqual(st.join, 0, '點擊玩家名稱絕不可誤觸加入鈕');
            assert.strictEqual(st.spec, 0, '點擊玩家名稱絕不可誤觸觀戰鈕');
            assert.strictEqual(st.row, 0, '點擊玩家名稱不應冒泡到房間列');
            assert.notStrictEqual(focusOutline, 'none', '鍵盤聚焦時必須顯示清楚焦點外框');
          } finally {
            await ctx.close();
          }
        };

        await checkViewport({ width: 1280, height: 800 });
        await checkViewport({ width: 393, height: 852 });
      });

      await T('C2 真實大廳模板：缺 UID／空白 UID 維持純文字、有效 UID 滑鼠與 Enter/Space 皆可用 ＋ v6.664 HEAD-FAIL 與空白 UID 突變必紅', async () => {
        const gameSrc = read(GAME_PATH);
        const apiSrc = read(API_PATH);
        await assertLobbyUidTemplateBehavior(browser, gameSrc, apiSrc);

        if (hasBaseCommit(ROOT, BASE_V6664)) {
          const oldGame = readBaseBlob(ROOT, BASE_V6664, GAME_PATH);
          const oldApi = readBaseBlob(ROOT, BASE_V6664, API_PATH);
          assert.ok(oldGame.ok && oldApi.ok, '讀取 b390744e 大廳原始碼失敗');
          await mutantMustBreak(
            'HEAD_FAIL_v6664_blank_uid_button',
            () => assertLobbyUidTemplateBehavior(browser, normEol(oldGame.out), normEol(oldApi.out)),
            '空白 hostUid 不可顯示無效按鈕',
          );
        } else {
          shallowSkip('v6665 C2 HEAD-FAIL', '需要 b390744e commit');
        }

        // 突變 3a：房主條件恢復以原始 r.hostUid 判斷
        const mutHost = gameSrc.replace('{#if _hostTarget}', '{#if r.hostUid}');
        assert.notStrictEqual(mutHost, gameSrc, 'C2 突變 3a 錨點未命中');
        await mutantMustBreak(
          'M_restore_raw_host_uid_truthy',
          () => assertLobbyUidTemplateBehavior(browser, mutHost, apiSrc),
          '空白 hostUid 不可顯示無效按鈕',
        );

        // 突變 3b：P1 條件恢復以原始 r.seats?.[0]?.uid 判斷
        const mutSeat1 = gameSrc.replace('{#if _p1Target}', '{#if r.seats?.[0]?.uid}');
        assert.notStrictEqual(mutSeat1, gameSrc, 'C2 突變 3b 錨點未命中');
        await mutantMustBreak(
          'M_restore_raw_seat1_uid_truthy',
          () => assertLobbyUidTemplateBehavior(browser, mutSeat1, apiSrc),
          '空白或缺少 UID 的對戰雙方不可顯示無效按鈕',
        );

        // 突變 3c：P2 條件恢復以原始 r.seats?.[1]?.uid 判斷
        const mutSeat2 = gameSrc.replace('{#if _p2Target}', '{#if r.seats?.[1]?.uid}');
        assert.notStrictEqual(mutSeat2, gameSrc, 'C2 突變 3c 錨點未命中');
        await mutantMustBreak(
          'M_restore_raw_seat2_uid_truthy',
          () => assertLobbyUidTemplateBehavior(browser, mutSeat2, apiSrc),
          'P2 空白或 P1 缺少 UID 不可顯示無效按鈕',
        );
      });
    } finally {
      await browser.close();
    }
  }
}

console.log('\n【D】Rule 40 精確歷史還原鏈（固定 Git blob）與現行版本／公開三檔更新紀錄隔離');
await T('D1 固定歷史 commit blob 逐位元還原：3075b04c → 4fed8ee3 → b390744e → 0329ee55 且對歷史基準皆為 no-op（不隨未來升版誤紅）', () => {
  if (!hasBaseCommit(ROOT, COMMIT_V6666) || !hasBaseCommit(ROOT, COMMIT_V6665) || !hasBaseCommit(ROOT, BASE_V6664) || !hasBaseCommit(ROOT, BASE_V6663)) {
    shallowSkip('v6664/v6665/v6666 D1 還原鏈', '需要 3075b04c、4fed8ee3、b390744e 與 0329ee55 commit');
    return;
  }
  for (const rel of Object.keys(V6666_PAIRS)) {
    const blob666 = readBaseBlob(ROOT, COMMIT_V6666, rel);
    const blob665 = readBaseBlob(ROOT, COMMIT_V6665, rel);
    assert.ok(blob666.ok && blob665.ok, '缺少 3075b04c 或 4fed8ee3 blob: ' + rel);
    const s666 = normEol(blob666.out);
    const s665 = normEol(blob665.out);
    assert.strictEqual(revertV6666IfPresent(rel, s666), s665, '3075b04c 無法精確還原至 4fed8ee3：' + rel);
    assert.strictEqual(revertV6666IfPresent(rel, s665), s665, '對 4fed8ee3 必須為 no-op：' + rel);
  }
  for (const rel of Object.keys(V6665_PAIRS)) {
    const blob666 = readBaseBlob(ROOT, COMMIT_V6666, rel);
    const blob665 = readBaseBlob(ROOT, COMMIT_V6665, rel);
    const blob664 = readBaseBlob(ROOT, BASE_V6664, rel);
    assert.ok(blob666.ok && blob665.ok && blob664.ok, '缺少 3075b04c / 4fed8ee3 / b390744e blob: ' + rel);
    const s666 = normEol(blob666.out);
    const s665 = normEol(blob665.out);
    const s664 = normEol(blob664.out);
    assert.strictEqual(revertV6665IfPresent(rel, s666), s664, '3075b04c 串接還原至 b390744e 失敗：' + rel);
    assert.strictEqual(revertV6665IfPresent(rel, s665), s664, '4fed8ee3 無法精確還原至 b390744e：' + rel);
    assert.strictEqual(revertV6665IfPresent(rel, s664), s664, '對 b390744e 必須為 no-op：' + rel);
  }
  for (const rel of Object.keys(V6664_PAIRS)) {
    const blob666 = readBaseBlob(ROOT, COMMIT_V6666, rel);
    const blob665 = readBaseBlob(ROOT, COMMIT_V6665, rel);
    const blob664 = readBaseBlob(ROOT, BASE_V6664, rel);
    const blob663 = readBaseBlob(ROOT, BASE_V6663, rel);
    assert.ok(blob666.ok && blob665.ok && blob664.ok && blob663.ok, '缺少 3075b04c / 4fed8ee3 / b390744e / 0329ee55 blob: ' + rel);
    const s666 = normEol(blob666.out);
    const s665 = normEol(blob665.out);
    const s664 = normEol(blob664.out);
    const s663 = normEol(blob663.out);
    assert.strictEqual(revertV6664IfPresent(rel, s666), s663, '3075b04c 串接還原至 0329ee55 失敗：' + rel);
    assert.strictEqual(revertV6664IfPresent(rel, s665), s663, '4fed8ee3 串接還原至 0329ee55 失敗：' + rel);
    assert.strictEqual(revertV6664IfPresent(rel, s664), s663, 'b390744e 無法精確還原至 0329ee55：' + rel);
    assert.strictEqual(revertV6664IfPresent(rel, s663), s663, '對 0329ee55 必須為 no-op：' + rel);
  }
});

const PUBLIC_CHLOG_PATHS = ['static/changelog.html', 'static/changelog-bodies.html', 'static/changelog-archive.html'];
const PUBLIC_CHLOG_FORBIDDEN = ['_profResolveTarget', 'server_admin_patch', 'shadowBlur', 'mask-image'];

function assertPublicChangelogIsolation(fileMap) {
  for (const rel of PUBLIC_CHLOG_PATHS) {
    const body = fileMap[rel];
    assert.strictEqual(typeof body, 'string', '缺少公開更新紀錄檔案：' + rel);
    for (const tok of PUBLIC_CHLOG_FORBIDDEN) {
      assert.ok(!body.includes(tok), `公開更新紀錄 ${rel} 不可外洩後台／內部實作字眼：${tok}`);
    }
  }
}

await T('D2 後台版本提示動態同步 version.ts 且公開三檔 changelog 均不外洩內部實作關鍵字（含三檔獨立突變，淺複製亦執行）', async () => {
  const verMatch = /export\s+const\s+VERSION\s*=\s*'([^']+)'/.exec(read('src/lib/version.ts'));
  assert.ok(verMatch && verMatch[1], '讀不到 src/lib/version.ts 的 VERSION');
  const curVer = verMatch[1];
  assert.strictEqual(read('static/site-version.txt').trim(), curVer, `static/site-version.txt 必須同步為 ${curVer}`);
  const adm = read(ADMIN_PATH);
  assert.ok(adm.includes("ver:'v6.665'") && adm.includes("ver:'v6.666'") && adm.includes("ver:'v6.667'"), 'admin.html 必須保留 v6.665／v6.666／v6.667 內部紀錄');
  assert.ok(adm.includes(`window.SITE_VERSION_HINT = '${curVer}'`), `admin.html SITE_VERSION_HINT 必須同步為 ${curVer}`);
  const publicFiles = Object.fromEntries(PUBLIC_CHLOG_PATHS.map((rel) => [rel, read(rel)]));
  const allPublicCh = publicFiles['static/changelog.html'] + '\n' + publicFiles['static/changelog-archive.html'];
  assert.ok(allPublicCh.includes('v6.665') && allPublicCh.includes('v6.666'), '公開更新紀錄（首頁或封存頁）應包含 v6.665 與 v6.666');
  for (const rel of PUBLIC_CHLOG_PATHS) {
    assert.ok(!publicFiles[rel].includes('v6.667'), `公開更新紀錄 ${rel} 不應出現內部維護版本 v6.667`);
  }
  assertPublicChangelogIsolation(publicFiles);

  // 三檔獨立突變：任一公開檔注入同一組內部實作字眼均須各自翻紅並同時指出檔名與違規字眼
  for (const rel of PUBLIC_CHLOG_PATHS) {
    for (const tok of PUBLIC_CHLOG_FORBIDDEN) {
      const polluted = { ...publicFiles, [rel]: publicFiles[rel] + `\n<!-- mut --> ${tok}` };
      await mutantMustBreak(`M_leak_${rel}_${tok}`, () => assertPublicChangelogIsolation(polluted), `公開更新紀錄 ${rel} 不可外洩後台／內部實作字眼：${tok}`);
    }
  }
});

console.log(`\n══ v6.664/v6.665/v6.666 大廳名片 UID 解析與 20 款外框內圓／小尺寸／光暈保護守衛：${pass} PASS / ${fail} FAIL ══`);
if (fail) process.exit(1);
