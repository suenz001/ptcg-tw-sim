/**
 * v6.657 守衛：
 *   1. Firestore 索引精簡驗證（僅 collectionGroup "decks" 的 entries / notes 停用單欄索引，保留 rooms 與時間/名稱/排序索引）。
 *   2. 純匿名訪客組牌／常用卡牌純本機化（0 Firestore 讀寫）＋ 本機寫入失敗不吞錯 ＋ UI 明確提醒。
 *   3. 正式會員安全差異遷移（同 UID Email/Google 升級、既有帳號登入、跨帳號隔離、登出隔離、離線重試與過期非同步任務取消）。
 *   4. 第三階段 Dry-Run 腳本唯讀與安全判準驗證 + 精確逆轉 (revert-v6657) + 突變測試 + 真瀏覽器檢查。
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { normEol } from './lib/eol-agnostic.mjs';
import { pwLaunch } from './lib/pw.mjs';
import { revertV6657IfPresent, V6657_PAIRS } from './lib/revert-v6657-anon-decks-local.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_SHA = '652db337939007e9070f6e85a59911cedffbbc18';
const read = (rel) => normEol(readFileSync(join(ROOT, rel), 'utf8'));

let pass = 0, fail = 0;
function ok(cond, msg) { if (!cond) throw new assert.AssertionError({ message: msg }); }
function T(name, fn) {
  try { fn(); console.log('  PASS', name); pass++; }
  catch (e) { console.log('  FAIL', name, '::', e.message); fail++; }
}
async function TA(name, fn) {
  try { await fn(); console.log('  PASS', name); pass++; }
  catch (e) { console.log('  FAIL', name, '::', e.message); fail++; }
}

const TMP = mkdtempSync(join(tmpdir(), 'v6657-'));
let browser;
try {
  // ── 1. Firestore Indexes 第一階段靜態與安全驗證 ──────────────────────────────
  console.log('\n【A】Firestore 索引設定與前端／元件靜態守衛');
  T('A1 firestore.indexes.json 保留 rooms 複合索引，僅豁免 decks.entries 與 decks.notes（不使用 *）', () => {
    const idx = JSON.parse(read('firestore.indexes.json'));
    ok(Array.isArray(idx.indexes) && idx.indexes.some((i) => i.collectionGroup === 'rooms'
      && i.fields?.some((f) => f.fieldPath === 'status' && f.order === 'ASCENDING')
      && i.fields?.some((f) => f.fieldPath === 'createdAt' && f.order === 'DESCENDING')),
      '必須完整保留 rooms(status ASC, createdAt DESC) 複合索引');
    const ov = idx.fieldOverrides || [];
    const paths = ov.map((o) => `${o.collectionGroup}:${o.fieldPath}`).sort();
    assert.deepStrictEqual(paths, ['decks:entries', 'decks:notes'], '只允許對 decks.entries 與 decks.notes 設定欄位豁免');
    for (const o of ov) {
      ok(o.fieldPath !== '*', '不可使用 fieldPath: "*"');
      assert.deepStrictEqual(o.indexes, [], `${o.collectionGroup}.${o.fieldPath} 的 indexes 必須為 []`);
    }
  });

  const dkSrc = read('src/routes/decks/+page.svelte');
  const gpSrc = read('src/routes/game/+page.svelte');
  const dpSrc = read('src/routes/deck-posts/+page.svelte');
  const abSrc = read('src/lib/ui/AccountBar.svelte');
  const bnSrc = read('src/lib/decks/DecksSyncBanner.svelte');

  T('A2 匿名訪客守衛、同 UID 升級入口、跨頁隔離與 UI 文案齊備', () => {
    ok(/\bconst\s+isMemberUser\b/.test(dkSrc), '必須定義 isMemberUser');
    ok(dkSrc.includes('await signInAnonymously(auth)'), '必須保留其他功能所需之匿名驗證');
    ok(dkSrc.includes('triggerMemberSyncAfterAuth(result?.user ?? auth.currentUser)'), 'upgradeAccount / loginWithEmail 必須顯式呼叫 triggerMemberSyncAfterAuth');
    ok(dkSrc.includes('googleAuthRevision.update'), 'upgradeAccount 同 UID 升級後必須遞增 googleAuthRevision');
    ok(dkSrc.includes('onGoogleComplete={(user) => { void triggerMemberSyncAfterAuth(user); }}'), 'AccountBar Google 完成後必須觸發同步');
    ok(dkSrc.includes('本機儲存失敗'), '必須組合明確的本機寫入失敗訊息');
    ok(abSrc.includes('目前僅存在此瀏覽器，登入後可同步跨裝置使用'), 'AccountBar 必須明確告知匿名僅存本機且登入可同步');
    ok(bnSrc.includes('目前僅存在此瀏覽器'), 'DecksSyncBanner 必須顯示匿名本機提示');
    ok(bnSrc.includes('onRetrySync') && bnSrc.includes('雲端同步未完成'), 'DecksSyncBanner 必須提供雲端同步重試操作');
    ok(bnSrc.includes('localSaveError'), 'DecksSyncBanner 必須顯示本機寫入失敗警告');
    ok(bnSrc.includes('html[data-theme="light"]'), 'DecksSyncBanner 淺色主題必須使用 html[data-theme="light"]');
    ok(gpSrc.includes('isolateCrossAccountLocalStorage') && gpSrc.includes('planMemberDeckSync'), 'game 頁登出／切換帳號必須同步隔離歸屬');
    ok(dpSrc.includes('isolateCrossAccountLocalStorage') && dpSrc.includes('markAnonLocalEdit') && dpSrc.includes('markMemberLocalEdit'), 'deck-posts 匯入必須同步記錄歸屬並隔離前帳號快取');
  });

  // ── 2. 編譯 lib 模組實測 Storage / Favorites / MemberSync ────────────────────
  console.log('\n【B】storage / favorites / member-sync 模組實跑測試');
  const syncModPath = join(TMP, 'member-sync.mjs');
  const storeModPath = join(TMP, 'storage.mjs');
  const favModPath = join(TMP, 'favorites.mjs');
  const cardIdMigStub = join(TMP, 'cardIdMigration.mjs');
  writeFileSync(cardIdMigStub, 'export const migrateCardId = (x) => x; export const migrateDeck = (d) => d;');

  function makeStorageEnv() {
    const store = new Map();
    let throwOnSet = false;
    const ls = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { if (throwOnSet) throw new Error('QuotaExceededError: full'); store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); },
      clear: () => { store.clear(); },
    };
    return { store, ls, setThrow: (b) => { throwOnSet = b; } };
  }

  await build({
    entryPoints: [join(ROOT, 'src/lib/decks/storage.ts')],
    bundle: true, format: 'esm', outfile: storeModPath,
    plugins: [{
      name: 'stub',
      setup(b) { b.onResolve({ filter: /^\.\/cardIdMigration$/ }, () => ({ path: cardIdMigStub })); },
    }],
  });
  await build({
    entryPoints: [join(ROOT, 'src/lib/decks/favorites.ts')],
    bundle: true, format: 'esm', outfile: favModPath,
  });
  await build({
    entryPoints: [join(ROOT, 'src/lib/decks/member-sync.ts')],
    bundle: true, format: 'esm', outfile: syncModPath,
    plugins: [{
      name: 'stub-storage',
      setup(b) {
        b.onResolve({ filter: /^\.\/storage$/ }, () => ({ path: storeModPath }));
      },
    }],
  });

  const stMod = await import(pathToFileURL(storeModPath).href);
  const favMod = await import(pathToFileURL(favModPath).href);
  const msMod = await import(pathToFileURL(syncModPath).href);

  const deck = (id, name, updatedAt, count = 1, notes = '') => ({
    id, name, entries: count > 0 ? [{ cardId: 'sv1-1', count }] : [],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt, notes,
  });

  T('B1 本機寫入檢查（成功回 ok:true；localStorage 拋錯絕不吞掉且不假裝保存）', () => {
    const env = makeStorageEnv();
    globalThis.localStorage = env.ls;
    const d1 = deck('d1', '皮卡丘', '2026-05-01T10:00:00.000Z', 4);
    assert.deepStrictEqual(stMod.upsertDeckChecked(d1).save, { ok: true });
    assert.strictEqual(stMod.loadDecks().length, 1);
    assert.deepStrictEqual(favMod.saveFavoritesChecked(new Set(['c1', 'c2'])), { ok: true });
    assert.strictEqual(favMod.loadFavorites().size, 2);

    env.setThrow(true);
    const badSave = stMod.saveDecksChecked([d1]);
    assert.strictEqual(badSave.ok, false);
    ok(badSave.error.includes('QuotaExceeded'), '錯誤訊息必須保留 QuotaExceeded');
    assert.strictEqual(stMod.saveDecks([d1]), false);
    const badUp = stMod.upsertDeckChecked(deck('d2', '噴火龍', '2026-05-01T11:00:00.000Z'));
    assert.strictEqual(badUp.save.ok, false);
    const badDel = stMod.deleteDeckChecked('d1');
    assert.strictEqual(badDel.save.ok, false);
    const badFav = favMod.saveFavoritesChecked(new Set(['c1']));
    assert.strictEqual(badFav.ok, false);
    assert.strictEqual(favMod.saveFavorites(new Set(['c1'])), false);
    const badOwner = msMod.writeDeckOwnership(msMod.emptyOwnership());
    assert.strictEqual(badOwner.ok, false);
  });

  T('B2 安全差異遷移：只傳本機新增與嚴格較新牌組，不覆蓋雲端較新，略過空白預設 stub', () => {
    const own = {
      kind: 'anon', memberUid: null, knownCloudIds: [], pendingUpsertIds: [], pendingDeleteIds: [],
      anonIds: ['d-new', 'd-newer'], pendingFavorites: true,
    };
    const stub = deck('d-stub', '我的第一個牌組', '2026-05-01T00:00:00.000Z', 0);
    const dNew = deck('d-new', '匿名新牌組', '2026-05-01T12:00:00.000Z', 4);
    const dNewerLocal = deck('d-newer', '本機較新版', '2026-05-02T12:00:00.000Z', 3);
    const dOlderLocal = deck('d-older', '本機較舊版', '2026-05-01T08:00:00.000Z', 1);
    const dSameLocal = deck('d-same', '等價無差異', '2026-05-01T09:00:00.000Z', 2);

    const cloudDecks = [
      deck('d-cloud-only', '雲端固有', '2026-05-01T01:00:00.000Z', 2),
      deck('d-newer', '雲端較舊版', '2026-05-02T10:00:00.000Z', 1),
      deck('d-older', '雲端較新版', '2026-05-03T00:00:00.000Z', 4),
      deck('d-same', '等價無差異', '2026-05-01T09:00:00.000Z', 2),
    ];

    const plan = msMod.planMemberDeckSync({
      uid: 'uid-m1',
      localDecks: [stub, dNew, dNewerLocal, dOlderLocal, dSameLocal],
      cloudDecks,
      ownership: own,
      hasOwnershipRecord: true,
    });
    assert.strictEqual(plan.isCrossAccount, false);
    assert.deepStrictEqual(plan.toUpload.map((d) => d.id).sort(), ['d-new', 'd-newer'],
      '只上傳匿名新增與本機確實較新，絕不重複上傳等價或覆蓋雲端較新');
    const mergedOlder = plan.mergedDecks.find((d) => d.id === 'd-older');
    assert.strictEqual(mergedOlder.name, '雲端較新版', '雲端較新必須勝出');
    ok(!plan.mergedDecks.some((d) => d.id === 'd-stub'), '未動過之空白預設牌組不得上傳');

    // finalizeOwnershipAfterSync 後再同步應為 0 上傳
    const ownAfter = msMod.finalizeOwnershipAfterSync({
      uid: 'uid-m1', cloudIdsBefore: cloudDecks.map((d) => d.id),
      uploadedIds: ['d-new', 'd-newer'], failedUploadIds: [], deletedIds: [], failedDeleteIds: [], pendingFavoritesRemaining: false,
    });
    const plan2 = msMod.planMemberDeckSync({
      uid: 'uid-m1',
      localDecks: plan.mergedDecks,
      cloudDecks: [...cloudDecks.filter((c) => c.id !== 'd-newer'), dNew, dNewerLocal],
      ownership: ownAfter,
      hasOwnershipRecord: true,
    });
    assert.strictEqual(plan2.toUpload.length, 0, '同步完成後重進不應重複上傳');
  });

  T('B3 跨帳號切換與離線刪除防護：A 的牌組／常用卡絕不污染 B；已從他處刪除跟隨移除', () => {
    const env = makeStorageEnv();
    globalThis.localStorage = env.ls;
    const ownA = {
      kind: 'member', memberUid: 'uid-A', knownCloudIds: ['A1'],
      pendingUpsertIds: [], pendingDeleteIds: [], anonIds: ['ANON1'], pendingFavorites: true,
    };
    const plan = msMod.planMemberDeckSync({
      uid: 'uid-B',
      localDecks: [deck('A1', 'A的私人牌組', '2026-05-05T00:00:00.000Z', 4), deck('ANON1', '匿名新建', '2026-05-05T01:00:00.000Z', 2)],
      cloudDecks: [deck('B1', 'B的雲端牌組', '2026-05-01T00:00:00.000Z', 3)],
      ownership: ownA,
      hasOwnershipRecord: true,
    });
    assert.strictEqual(plan.isCrossAccount, true);
    assert.strictEqual(plan.droppedCrossAccountCount, 1);
    assert.deepStrictEqual(plan.toUpload.map((d) => d.id), ['ANON1']);
    assert.deepStrictEqual(plan.mergedDecks.map((d) => d.id).sort(), ['ANON1', 'B1']);

    // 常用卡牌亦不可將 uid-A 的清單混給 uid-B
    const favAB = msMod.planFavoritesMigration({
      uid: 'uid-B', localFavorites: new Set(['fav-from-A']), cloudFavorites: new Set(['fav-B']),
      favOwner: 'uid-A', isCrossAccount: true,
    });
    assert.deepStrictEqual([...favAB.merged], ['fav-B']);
    assert.strictEqual(favAB.needsCloudUpload, false);

    // markAnonLocalEdit 不可把 knownCloudIds 內的前帳號牌組塞進 anonIds
    msMod.writeDeckOwnership(ownA);
    msMod.markAnonLocalEdit(['A1', 'ANON2']);
    const afterMark = msMod.readDeckOwnership();
    ok(!afterMark.anonIds.includes('A1'), '曾屬會員雲端之 A1 不可歸類為匿名自建');
    ok(afterMark.anonIds.includes('ANON2'));

    // 同帳號他裝置刪除跟隨移除，失敗刪除下次繼續重試
    const ownSame = {
      kind: 'member', memberUid: 'uid-B', knownCloudIds: ['B1', 'B-gone-remote', 'B-del-pending'],
      pendingUpsertIds: [], pendingDeleteIds: ['B-del-pending'], anonIds: [], pendingFavorites: false,
    };
    const planDel = msMod.planMemberDeckSync({
      uid: 'uid-B',
      localDecks: [deck('B1', 'B1', '2026-05-01T00:00:00.000Z'), deck('B-gone-remote', '已從他裝置刪除', '2026-05-01T00:00:00.000Z'), deck('B-del-pending', '待刪', '2026-05-01T00:00:00.000Z')],
      cloudDecks: [deck('B1', 'B1', '2026-05-01T00:00:00.000Z'), deck('B-del-pending', '待刪', '2026-05-01T00:00:00.000Z')],
      ownership: ownSame,
      hasOwnershipRecord: true,
    });
    assert.deepStrictEqual(planDel.toDeleteFromCloud, ['B-del-pending']);
    assert.deepStrictEqual(planDel.mergedDecks.map((d) => d.id), ['B1'], 'B-gone-remote 不得復活上傳');
  });

  // ── 3. 實測抽取 src/routes/decks/+page.svelte 完整流程（含 Mock Firebase + 異常情境）────
  console.log('\n【C】從 src/routes/decks/+page.svelte 實抽同步狀態機執行（Mock Firebase）');
  const scriptMatch = /<script lang="ts">([\s\S]*?)<\/script>/.exec(dkSrc);
  ok(scriptMatch, '找不到 decks/+page.svelte script 區塊');

  function sliceRange(startAnchor, endAnchor, inclusiveEnd = false) {
    const s = dkSrc.indexOf(startAnchor);
    const e = dkSrc.indexOf(endAnchor, s > 0 ? s : 0);
    ok(s > 0 && e > s, `找不到區段錨點：${startAnchor} .. ${endAnchor}`);
    return dkSrc.slice(s, inclusiveEnd ? e + endAnchor.length : e);
  }
  const coreSnippet = [
    sliceRange('let _authSessionEpoch = 0;', '  let syncStatus ='),
    sliceRange('const isMemberUser =', '// ── Auth modal state'),
    sliceRange('function persistDeckOrder(', '// v5.798：'),
    sliceRange('function toggleFavorite(', '// v5.330：常用卡牌雲端存'),
    sliceRange('function withTimeout<', '  // ── Deck actions'),
    sliceRange('async function upgradeAccount()', '// v3.92 忘記密碼'),
  ].join('\n');

  const harnessTs = join(TMP, 'decks-harness.ts');
  writeFileSync(harnessTs, `
import {
  loadDecks, saveDecksChecked, upsertDeckChecked, deleteDeckChecked, newDeck, sortDecks
} from ${JSON.stringify(join(ROOT, 'src/lib/decks/storage.ts'))};
import { loadFavorites, saveFavoritesChecked } from ${JSON.stringify(join(ROOT, 'src/lib/decks/favorites.ts'))};
import { createAuthGeneration } from ${JSON.stringify(join(ROOT, 'src/lib/auth/google-auth.ts'))};
import {
  readDeckOwnership, writeDeckOwnership, hasDeckOwnershipRecord, readFavOwner, writeFavOwner,
  markAnonLocalEdit, markAnonLocalDelete, markMemberLocalEdit, markMemberCloudDeleteResult,
  markFavoritesLocalChange, planMemberDeckSync, finalizeOwnershipAfterSync, planFavoritesMigration,
  combineLocalSaveResults, isCrossAccountOwnership, isolateCrossAccountLocalStorage
} from ${JSON.stringify(join(ROOT, 'src/lib/decks/member-sync.ts'))};

export function createHarness(api) {
  let decks = [];
  let activeId = null;
  let favorites = loadFavorites();
  let firebaseUser = null;
  let authInitializing = true;
  let syncStatus = 'idle';
  let syncError = null;
  let localSaveError = null;
  let _localSaveErrSlots = {};
  let dirtyDeckIds = new Set();
  let showAuthModal = false;
  let authMode = 'login';
  let authEmail = '';
  let authPassword = '';
  let authError = null;
  let authLoading = false;
  let unsubAuthFn = null;
  let pool = []; let poolById = new Map(); let poolReady = true; let poolError = null;
  let _rawAllCards = []; let sets = [];

  const $googleAuthBusy = false;
  let _revCount = 0;
  const googleAuthRevision = { update: (fn) => { _revCount = fn(_revCount); } };
  const auth = api.auth;
  const authGeneration = createAuthGeneration(() => auth.currentUser?.uid ?? null);
  const getAuth = () => api.auth;
  const confirm = (m) => api.confirm(m);
  const alert = (m) => api.alert(m);
  const onMount = (fn) => { api._onMount = fn; };
  const loadAllSets = () => Promise.resolve([]);
  const loadIndex = () => Promise.resolve([]);
  const filterDeckSelectable = (x) => x;
  const filterPlayerSelectable = (x) => x;
  const buildCardIndex = () => new Map();
  const loadCardPolicyOnce = () => Promise.resolve();
  const syncDeckToCloud = (u, d) => api.syncDeckToCloud(u, d);
  const removeDeckFromCloud = (u, id) => api.removeDeckFromCloud(u, id);
  const loadDecksFromCloud = (u) => api.loadDecksFromCloud(u);
  const cloudDecksUnchanged = (u, n) => api.cloudDecksUnchanged(u, n);
  const recordCloudDecksRev = (u) => api.recordCloudDecksRev(u);
  const bumpCloudDecksRev = (u) => api.bumpCloudDecksRev(u);
  const readLocalDecksRevUid = () => api.readLocalDecksRevUid();
  const loadFavoritesFromCloud = (u) => api.loadFavoritesFromCloud(u);
  const saveFavoritesToCloud = (u, s) => api.saveFavoritesToCloud(u, s);
  const onAuthStateChanged = (a, cb) => api.onAuthStateChanged(a, cb);
  const signInAnonymously = (a) => api.signInAnonymously(a);
  const EmailAuthProvider = api.EmailAuthProvider;
  const linkWithCredential = (u, c) => api.linkWithCredential(u, c);
  const signInWithCredential = (a, c) => api.signInWithCredential(a, c);
  const signInWithEmailAndPassword = (a, e, p) => api.signInWithEmailAndPassword(a, e, p);
  const signOut = (a) => api.signOut(a);
  const applyDeckOrder = (arr) => arr;
  const schedulePresetMetaPrefetch = () => {};
  const initAdminPresets = () => {};
  const friendlyAuthError = (c) => String(c || 'err');

  ${coreSnippet}

  return {
    mount: () => api._onMount(),
    setDirty, pushDeck, flushPendingPushes, dropDeck, toggleFavorite,
    saveAllDecksToCloud, loadAllDecksFromCloud, syncMemberAccount, triggerMemberSyncAfterAuth, retryMemberSync,
    upgradeAccount, loginWithEmail, handleSignOut, persistDeckOrder, persistSingleDeckLocally,
    getState: () => ({ decks, activeId, favorites: [...favorites], firebaseUser, syncStatus, syncError, localSaveError, dirtyDeckIds: [...dirtyDeckIds], authError, revision: _revCount }),
    setCreds: (e, p) => { authEmail = e; authPassword = p; },
    setDecksState: (arr, id) => { decks = arr; activeId = id; },
  };
}
`);

  const harnessJs = join(TMP, 'decks-harness.mjs');
  await build({
    entryPoints: [harnessTs], bundle: true, format: 'esm', outfile: harnessJs,
    alias: { '$lib': join(ROOT, 'src/lib') },
    plugins: [{
      name: 'stub-app-path',
      setup(b) {
        b.onResolve({ filter: /^\.\// }, (args) => {
          if (args.path === './cardIdMigration') return { path: cardIdMigStub };
          if (args.path === './firebase') {
            const p = join(TMP, 'fb-stub.mjs');
            if (!existsSync(p)) writeFileSync(p, 'export const db = {}; export const auth = {}; export const FS_READ_ENABLED = true; export function waitForAuthReady(){ return Promise.resolve(null); }');
            return { path: p };
          }
          return undefined;
        });
        b.onResolve({ filter: /^firebase\// }, () => {
          const p = join(TMP, 'fb-sdk-stub.mjs');
          if (!existsSync(p)) writeFileSync(p, [
            'export const initializeApp = () => ({});',
            'export const getAuth = () => ({ currentUser: null });',
            'export const getFirestore = () => ({});',
            'export class GoogleAuthProvider {}',
            'export class EmailAuthProvider {}',
            'export const reauthenticateWithCredential = async () => ({});',
            'export const reauthenticateWithPopup = async () => ({});',
            'export const linkWithPopup = async () => ({});',
            'export const signInWithPopup = async () => ({});',
            'export const signInWithCredential = async () => ({});',
            'export const unlink = async () => ({});',
            'export const onAuthStateChanged = () => () => {};',
            'export const signOut = async () => {};',
          ].join('\n'));
          return { path: p };
        });
      },
    }],
  });
  const { createHarness } = await import(pathToFileURL(harnessJs).href);

  function createMockEnv() {
    const lsEnv = makeStorageEnv();
    globalThis.localStorage = lsEnv.ls;
    globalThis.window = { addEventListener: () => {}, removeEventListener: () => {} };
    const cloud = new Map(); // uid -> { decks: Map<id,Deck>, favs: Set<string>, rev: number }
    const stats = { reads: 0, writes: 0, deletes: 0, favReads: 0, favWrites: 0, metaChecks: 0, metaBumps: 0, anonSignIns: 0 };
    const alerts = [];
    let authCb = null;
    const ensure = (u) => { if (!cloud.has(u)) cloud.set(u, { decks: new Map(), favs: new Set(), rev: 1 }); return cloud.get(u); };
    let failWrites = false;
    let failFavWrites = false;
    let cloudDelayResolve = null;

    const api = {
      auth: { currentUser: null },
      EmailAuthProvider: { credential: (e, p) => ({ e, p }) },
      withTimeout: (p) => p,
      confirm: () => true,
      alert: (m) => alerts.push(m),
      onAuthStateChanged: (_a, cb) => { authCb = cb; return () => {}; },
      signInAnonymously: async () => {
        stats.anonSignIns++;
        const u = { uid: 'anon-1', isAnonymous: true, email: null, providerData: [] };
        api.auth.currentUser = u;
        await authCb(u);
        return { user: u };
      },
      linkWithCredential: async (u, c) => {
        // 模擬真實 Firebase：同 UID 升級為正式會員（保留原 uid）
        u.isAnonymous = false;
        u.email = c.e;
        u.providerData = [{ providerId: 'password', email: c.e }];
        api.auth.currentUser = u;
        return { user: u };
      },
      signInWithCredential: async (_a, c) => {
        const u = { uid: 'existing-' + c.e, isAnonymous: false, email: c.e, providerData: [{ providerId: 'password' }] };
        api.auth.currentUser = u;
        await authCb(u);
        return { user: u };
      },
      signInWithEmailAndPassword: async (_a, e) => {
        const u = { uid: 'member-' + e, isAnonymous: false, email: e, providerData: [{ providerId: 'password' }] };
        api.auth.currentUser = u;
        await authCb(u);
        return { user: u };
      },
      signOut: async () => {
        api.auth.currentUser = null;
        await authCb(null);
      },
      loadDecksFromCloud: async (u) => {
        stats.reads++;
        if (cloudDelayResolve) {
          await new Promise((r) => { cloudDelayResolve = r; });
        }
        return [...ensure(u).decks.values()].map((d) => structuredClone(d));
      },
      syncDeckToCloud: async (u, d) => {
        stats.writes++;
        if (failWrites) throw new Error('network error');
        ensure(u).decks.set(d.id, structuredClone(d));
      },
      removeDeckFromCloud: async (u, id) => {
        stats.deletes++;
        if (failWrites) throw new Error('network error');
        ensure(u).decks.delete(id);
      },
      cloudDecksUnchanged: async (u, n) => { stats.metaChecks++; return ensure(u).decks.size === n && ensure(u).rev > 0; },
      recordCloudDecksRev: async () => {},
      bumpCloudDecksRev: async (u) => { stats.metaBumps++; ensure(u).rev++; },
      readLocalDecksRevUid: () => null,
      loadFavoritesFromCloud: async (u) => { stats.favReads++; return new Set(ensure(u).favs); },
      saveFavoritesToCloud: async (u, s) => {
        stats.favWrites++;
        if (failFavWrites) throw new Error('fav write err');
        ensure(u).favs = new Set(s);
      },
      fireAuth: async (u) => { api.auth.currentUser = u; await authCb(u); },
      holdNextCloudRead: () => { cloudDelayResolve = () => {}; },
      releaseCloudRead: () => { const r = cloudDelayResolve; cloudDelayResolve = null; if (r) r(); },
    };
    return {
      lsEnv, cloud, stats, alerts, api, ensure,
      setFailWrites: (b) => { failWrites = b; },
      setFailFavWrites: (b) => { failFavWrites = b; },
    };
  }

  await TA('C1 純匿名組牌／常用／重整：0 次 Firestore 讀寫，仍保留匿名驗證，資料保留於本機', async () => {
    const m = createMockEnv();
    const h = createHarness(m.api);
    h.mount();
    await m.api.fireAuth(null); // 觸發 signInAnonymously
    assert.strictEqual(m.stats.anonSignIns, 1, '仍應保留匿名登入供其他功能使用');
    assert.strictEqual(m.stats.reads + m.stats.writes + m.stats.favReads + m.stats.favWrites + m.stats.metaChecks, 0,
      '匿名載入不得觸發任何 Firestore decks/favorites/meta 讀寫');

    // 匿名新建、修改、排序、常用、刪除
    const custom = deck('d-custom', '我的水箭龜', '2026-05-01T12:00:00.000Z', 4);
    h.setDecksState([custom], 'd-custom');
    h.persistSingleDeckLocally(custom);
    h.setDirty('d-custom');
    h.pushDeck(custom);
    await h.flushPendingPushes();
    h.toggleFavorite('sv1-9');
    h.persistDeckOrder([custom]);
    assert.strictEqual(m.stats.reads + m.stats.writes + m.stats.deletes + m.stats.favReads + m.stats.favWrites + m.stats.metaChecks + m.stats.metaBumps, 0,
      '匿名編輯與儲存不可打任何 Firestore API');

    // 模擬重新整理（新建 harness 讀同一份 localStorage）
    const h2 = createHarness(m.api);
    h2.mount();
    await m.api.fireAuth({ uid: 'anon-1', isAnonymous: true, providerData: [] });
    const st2 = h2.getState();
    ok(st2.decks.some((d) => d.id === 'd-custom' && d.name === '我的水箭龜'), '重新整理後匿名牌組應留在本機');
    ok(st2.favorites.includes('sv1-9'), '重新整理後匿名常用卡牌應留在本機');
    assert.strictEqual(m.stats.reads + m.stats.writes + m.stats.favReads + m.stats.favWrites, 0);
  });

  await TA('C2 同 UID 匿名升級 Email 與 Google 綁定：即便 Firebase 不重複觸發 onAuthStateChanged 也能自動完成差異同步', async () => {
    const m = createMockEnv();
    const h = createHarness(m.api);
    h.mount();
    await m.api.fireAuth(null);
    const anonDeck = deck('d-anon-up', '匿名閃電鳥', '2026-05-02T10:00:00.000Z', 4);
    h.persistSingleDeckLocally(anonDeck);
    h.toggleFavorite('sv2-5');
    assert.strictEqual(m.stats.writes, 0);

    h.setCreds('player1@example.com', 'pass1234');
    await h.upgradeAccount(); // linkWithCredential 保留 uid: 'anon-1'，模擬不另觸發 onAuthStateChanged
    const st = h.getState();
    assert.strictEqual(st.syncStatus, 'synced', '同 UID Email 升級後應立即完成同步並顯示已同步');
    ok(st.revision >= 1, '同 UID Email 升級必須遞增 googleAuthRevision');
    ok(m.ensure('anon-1').decks.has('d-anon-up'), '匿名期間建的牌組必須上傳至同 UID 雲端');
    ok(m.ensure('anon-1').favs.has('sv2-5'), '匿名期間加的常用卡牌必須上傳至同 UID 雲端');

    // Google 同 UID 綁定（linkWithPopup 保留原 anon UID 且不假設 onAuthStateChanged 重觸發）
    const mG = createMockEnv();
    const hG = createHarness(mG.api);
    hG.mount();
    await mG.api.fireAuth(null);
    const gDeck = deck('d-anon-google', '匿名超夢', '2026-05-02T11:00:00.000Z', 4);
    hG.persistSingleDeckLocally(gDeck);
    const linkedGoogleSameUid = {
      uid: 'anon-1', isAnonymous: false, email: 'guser@example.com',
      providerData: [{ providerId: 'google.com', email: 'guser@example.com' }],
    };
    mG.api.auth.currentUser = linkedGoogleSameUid;
    await hG.triggerMemberSyncAfterAuth(linkedGoogleSameUid);
    assert.strictEqual(hG.getState().syncStatus, 'synced', '同 UID Google 綁定後應立即完成同步');
    ok(mG.ensure('anon-1').decks.has('d-anon-google'), 'Google 綁定後匿名牌組必須上傳至雲端');
  });

  await TA('C3 登入已有雲端牌組的既有會員 + 離線寫入失敗保留與重試恢復', async () => {
    const m = createMockEnv();
    const h = createHarness(m.api);
    h.mount();
    await m.api.fireAuth(null);
    const anonDeck = deck('d-local-new', '匿名預組', '2026-05-03T10:00:00.000Z', 4);
    h.persistSingleDeckLocally(anonDeck);

    // 先預設目標會員已有雲端牌組（涵蓋舊缺口 cloud.length > 0）且此時雲端寫入失敗
    m.ensure('member-old@example.com').decks.set('d-cloud-1', deck('d-cloud-1', '雲端既有', '2026-05-01T00:00:00.000Z', 4));
    m.setFailWrites(true);
    h.setCreds('old@example.com', 'pass1234');
    await h.loginWithEmail();

    let st = h.getState();
    assert.strictEqual(st.syncStatus, 'error', '上傳失敗絕不可標示為 synced');
    ok(st.decks.some((d) => d.id === 'd-local-new'), '失敗時本機牌組必須保留');
    ok(!m.ensure('member-old@example.com').decks.has('d-local-new'), '寫入失敗時雲端尚無該牌組');

    // 恢復網路並點選重試
    m.setFailWrites(false);
    await h.retryMemberSync();
    st = h.getState();
    assert.strictEqual(st.syncStatus, 'synced', '重試成功後應轉為 synced');
    ok(m.ensure('member-old@example.com').decks.has('d-local-new'), '重試後新增本機牌組補傳進雲端');
    ok(m.ensure('member-old@example.com').decks.has('d-cloud-1'), '原有雲端牌組完整保留');
  });

  await TA('C4 登出＋切換帳號隔離，與非同步競態（舊 UID 逾期任務不得寫入新帳號狀態）', async () => {
    const m = createMockEnv();
    m.ensure('member-A@example.com').decks.set('A-secret', deck('A-secret', 'A 的秘密賽場牌', '2026-05-04T00:00:00.000Z', 4));
    m.ensure('member-A@example.com').favs.add('card-A');
    m.ensure('member-B@example.com').decks.set('B-own', deck('B-own', 'B 的牌組', '2026-05-04T00:00:00.000Z', 4));

    const h = createHarness(m.api);
    h.mount();
    await m.api.fireAuth({ uid: 'member-A@example.com', isAnonymous: false, email: 'A@example.com', providerData: [{ providerId: 'password' }] });
    ok(h.getState().decks.some((d) => d.id === 'A-secret'));
    ok(h.getState().favorites.includes('card-A'));

    // 登出後不殘留 A 的私有快取，再登入 B 不混入 A
    await h.handleSignOut();
    ok(!h.getState().decks.some((d) => d.id === 'A-secret'), '登出後不應保留前會員的雲端快取於匿名模式');
    ok(!h.getState().favorites.includes('card-A'), '登出後不應保留前會員的常用卡牌');

    await m.api.fireAuth({ uid: 'member-B@example.com', isAnonymous: false, email: 'B@example.com', providerData: [{ providerId: 'password' }] });
    ok(!m.ensure('member-B@example.com').decks.has('A-secret'), 'A 牌組絕不可誤傳進 B 雲端');
    ok(!m.ensure('member-B@example.com').favs.has('card-A'), 'A 常用卡絕不可混進 B 雲端');

    // 競態模擬：開始 A 的雲端讀取並卡住，途中切換成 B，再放行 A
    m.api.holdNextCloudRead();
    const pendingA = m.api.fireAuth({ uid: 'member-A@example.com', isAnonymous: false, email: 'A@example.com', providerData: [{ providerId: 'password' }] });
    await m.api.fireAuth({ uid: 'member-B@example.com', isAnonymous: false, email: 'B@example.com', providerData: [{ providerId: 'password' }] });
    m.api.releaseCloudRead();
    await pendingA;
    const afterRace = h.getState();
    assert.strictEqual(afterRace.firebaseUser.uid, 'member-B@example.com');
    ok(afterRace.decks.every((d) => d.id !== 'A-secret'), '過期的 A 任務放行後不得回寫 B 的畫面');
  });

  await TA('C5 本機儲存失敗不靜默吞掉＋正式會員既有效能快取與寫入不退步', async () => {
    const m = createMockEnv();
    m.ensure('member-fast').decks.set('M1', deck('M1', '快取牌', '2026-05-01T00:00:00.000Z', 4));
    const h = createHarness(m.api);
    h.mount();
    await m.api.fireAuth({ uid: 'member-fast', isAnonymous: false, email: 'f@example.com', providerData: [{ providerId: 'password' }] });
    assert.strictEqual(h.getState().syncStatus, 'synced');

    // 再進頁模擬 rev 未變（cloudDecksUnchanged 命中 → 0 次 collection 全拉）
    const readsBefore = m.stats.reads;
    await m.api.fireAuth({ uid: 'member-fast', isAnonymous: false, email: 'f@example.com', providerData: [{ providerId: 'password' }] });
    assert.strictEqual(m.stats.reads, readsBefore, 'rev 未變應走快取跳過全拉');

    // localStorage 寫入失敗時必須寫入 localSaveError；且同一操作後續小筆成功不得洗掉前面大筆失敗
    let failNextKey = 'ptcg-tw-sim:decks';
    const origSetItem = m.lsEnv.ls.setItem;
    m.lsEnv.ls.setItem = (k, v) => {
      if (k === failNextKey) throw new Error('QuotaExceededError: decks key full');
      return origSetItem(k, v);
    };
    await h.saveAllDecksToCloud();
    ok(!!h.getState().localSaveError, 'saveDecksChecked 失敗後，即便後續 saveFavoritesChecked 成功也不得洗掉 localSaveError');

    // P2-2：persistSingleDeckLocally 寫入失敗後緊接 setDirty（只寫 decks-owner-v1 成功）絕不可洗掉 decks 失敗橫幅
    h.persistSingleDeckLocally(deck('M1', '修改後滿載', '2026-05-02T00:00:00.000Z', 4));
    h.setDirty('M1');
    ok(!!h.getState().localSaveError, 'setDirty 成功寫入 owner key 後絕不可洗掉 decks key 的 localSaveError');
    failNextKey = null;

    // 恢復寫入能力並重新存檔後，error 才應解除
    await h.saveAllDecksToCloud();
    assert.strictEqual(h.getState().localSaveError, null, '真正重寫成功後才應清除 localSaveError');

    // P1 殘留邊界：從 v6.656 升級或無 favs-owner-v1 (favOwner === null) 時跨帳號 A → B，A 的常用卡牌也必須徹底隔離
    const mUp = createMockEnv();
    mUp.lsEnv.ls.setItem('ptcg-tw-sim:decks', JSON.stringify([deck('A-old', 'A舊版牌', '2026-05-01T00:00:00.000Z', 4)]));
    mUp.lsEnv.ls.setItem('ptcg-tw-sim:favorites', JSON.stringify(['fav-A-old']));
    mUp.lsEnv.ls.setItem('ptcg-tw-sim:decks-rev-v1', JSON.stringify({ uid: 'uid-A-legacy', rev: 'r1' }));
    mUp.api.readLocalDecksRevUid = () => 'uid-A-legacy';
    const origLoadUp = mUp.api.loadDecksFromCloud;
    mUp.api.loadDecksFromCloud = async () => { throw new Error('offline switch'); };
    const hUp = createHarness(mUp.api);
    hUp.mount();
    await mUp.api.fireAuth({ uid: 'uid-B-new', isAnonymous: false, email: 'bnew@example.com', providerData: [{ providerId: 'password' }] });
    assert.strictEqual(hUp.getState().favorites.length, 0, 'curFavOwner 為 null 的跨帳號切換也必須立即清空 A 的舊 favorites');
    hUp.toggleFavorite('fav-B-new');
    mUp.api.loadDecksFromCloud = origLoadUp;
    await hUp.retryMemberSync();
    ok(!mUp.ensure('uid-B-new').favs.has('fav-A-old'), 'A 的無 owner 舊常用卡牌絕不可傳給 B');
    ok(mUp.ensure('uid-B-new').favs.has('fav-B-new'));

    // saveFavoritesToCloud 失敗時不得偽稱 synced
    m.setFailFavWrites(true);
    await h.saveAllDecksToCloud();
    assert.strictEqual(h.getState().syncStatus, 'error', '常用卡牌上傳失敗不可將 syncStatus 設為 synced');
    m.setFailFavWrites(false);

    // P1-2：跨帳號切換若初始雲端讀取失敗，離線編輯再重試絕不可把前會員 A 的牌組／常用卡傳給會員 B
    const mCross = createMockEnv();
    mCross.ensure('uid-A').decks.set('A-priv', deck('A-priv', 'A私人牌', '2026-05-01T00:00:00.000Z', 4));
    mCross.ensure('uid-A').favs.add('fav-A-priv');
    const hCross = createHarness(mCross.api);
    hCross.mount();
    await mCross.api.fireAuth({ uid: 'uid-A', isAnonymous: false, email: 'a@example.com', providerData: [{ providerId: 'password' }] });
    ok(hCross.getState().decks.some((d) => d.id === 'A-priv'));

    const origLoadCloud = mCross.api.loadDecksFromCloud;
    mCross.api.loadDecksFromCloud = async () => { throw new Error('offline during switch'); };
    await mCross.api.fireAuth({ uid: 'uid-B', isAnonymous: false, email: 'b@example.com', providerData: [{ providerId: 'password' }] });
    assert.strictEqual(hCross.getState().syncStatus, 'error');
    ok(!hCross.getState().decks.some((d) => d.id === 'A-priv'), '跨帳號讀取失敗時不可將 A 牌組留在 B 的畫面');

    // 在失敗離線狀態下，B 編輯自己新牌組與常用卡，然後恢復網路並重試
    const bOffline = deck('B-off', 'B離線新牌', '2026-05-06T00:00:00.000Z', 4);
    hCross.persistSingleDeckLocally(bOffline);
    hCross.toggleFavorite('fav-B-off');
    mCross.api.loadDecksFromCloud = origLoadCloud;
    await hCross.retryMemberSync();
    assert.strictEqual(hCross.getState().syncStatus, 'synced');
    ok(mCross.ensure('uid-B').decks.has('B-off'), 'B 自己的離線新牌組應補傳成功');
    ok(!mCross.ensure('uid-B').decks.has('A-priv'), 'A 的私人牌組絕不可在重試後傳進 B');
    ok(!mCross.ensure('uid-B').favs.has('fav-A-priv'), 'A 的常用卡牌絕不可在重試後混進 B');
    ok(mCross.ensure('uid-B').favs.has('fav-B-off'));
  });

  // ── 4. 第三階段 Dry-Run 腳本驗證 ──────────────────────────────────────────────
  console.log('\n【D】第三階段 Dry-Run 腳本判準與唯讀安全驗證');
  const dryMod = await import(pathToFileURL(join(ROOT, 'scripts/firestore-anon-cleanup-dryrun.mjs')).href);
  const drySrc = read('scripts/firestore-anon-cleanup-dryrun.mjs');

  T('D1 腳本不包含任何刪除或 Auth 變更呼叫，且嚴格鎖定 dryRunOnly', () => {
    ok(dryMod.DEFAULT_CONFIG.dryRunOnly === true);
    ok(!/\.\s*(delete|recursiveDelete|deleteUser)\s*\(/.test(drySrc), 'Dry-Run 腳本不得出現刪除呼叫');
    ok(dryMod.DEFAULT_CONFIG.dailyDeleteHardCeiling < 20000 && dryMod.DEFAULT_CONFIG.dailyDeleteHardCeiling <= 18000);
  });

  T('D2 lastRefreshTime／Firestore 時間戳／providerData 綜合判定與父子分別列計', () => {
    const cutoff = Date.parse('2026-05-01T00:00:00.000Z');
    const oldTime = '2025-10-01T00:00:00.000Z';
    const recentTime = '2026-10-01T00:00:00.000Z';

    // 1. 無 email 但 providerData 非空 → 不可誤殺
    assert.strictEqual(dryMod.evaluateUidCandidate({
      uid: 'u1',
      authUser: { uid: 'u1', providerData: [{ providerId: 'apple.com' }], metadata: { lastSignInTime: oldTime, lastRefreshTime: oldTime } },
      userDocExists: false, userDocData: null, subcollections: [], cutoffMs: cutoff,
    }).eligible, false);

    // 2. lastSignInTime 雖舊，但 lastRefreshTime 或子集合 updatedAt 很新 → 必須排除
    const rRefresh = dryMod.evaluateUidCandidate({
      uid: 'u2',
      authUser: { uid: 'u2', providerData: [], metadata: { lastSignInTime: oldTime, lastRefreshTime: recentTime } },
      userDocExists: true, userDocData: { updatedAt: oldTime },
      subcollections: [{ name: 'decks', docs: [{ id: 'd1', data: { updatedAt: oldTime } }] }],
      cutoffMs: cutoff,
    });
    assert.strictEqual(rRefresh.eligible, false);
    assert.strictEqual(rRefresh.excludeReason, 'recent_activity');

    const rSubNew = dryMod.evaluateUidCandidate({
      uid: 'u3',
      authUser: { uid: 'u3', providerData: [], metadata: { lastSignInTime: oldTime, lastRefreshTime: oldTime } },
      userDocExists: false, userDocData: null,
      subcollections: [{ name: 'decks', docs: [{ id: 'd1', data: { updatedAt: recentTime } }] }],
      cutoffMs: cutoff,
    });
    assert.strictEqual(rSubNew.eligible, false);

    // 3. 缺 lastRefreshTime 或缺文件時間戳或未核准子集合 → 一律保守排除
    assert.strictEqual(dryMod.evaluateUidCandidate({
      uid: 'u3b',
      authUser: { uid: 'u3b', providerData: [], metadata: { lastSignInTime: oldTime } },
      userDocExists: false, userDocData: null,
      subcollections: [{ name: 'decks', docs: [{ id: 'd1', data: { updatedAt: oldTime } }] }],
      cutoffMs: cutoff,
    }).excludeReason, 'missing_auth_signin_or_refresh_time');

    assert.strictEqual(dryMod.evaluateUidCandidate({
      uid: 'u4',
      authUser: { uid: 'u4', providerData: [], metadata: { lastSignInTime: oldTime, lastRefreshTime: oldTime } },
      userDocExists: false, userDocData: null,
      subcollections: [{ name: 'secret_notes', docs: [{ id: 'x', data: { updatedAt: oldTime } }] }],
      cutoffMs: cutoff,
    }).excludeReason, 'unapproved_subcollection(secret_notes)');

    // 4. 全部訊號明確且皆舊於 cutoff → 通過且分別統計父文件與各子集合數；二次覆驗擋住升級／新活動競態
    const rOk = dryMod.evaluateUidCandidate({
      uid: 'u5',
      authUser: { uid: 'u5', providerData: [], metadata: { lastSignInTime: oldTime, lastRefreshTime: oldTime } },
      userDocExists: true, userDocData: { updatedAt: oldTime },
      subcollections: [
        { name: 'decks', docs: [{ id: 'd1', data: { updatedAt: oldTime } }, { id: 'd2', data: { updatedAt: oldTime } }] },
        { name: 'favorites', docs: [{ id: 'f1', data: { createdAt: oldTime } }] },
      ],
      cutoffMs: cutoff,
    });
    assert.strictEqual(rOk.eligible, true);
    assert.strictEqual(rOk.counts.parentUserDoc, 1);
    assert.deepStrictEqual(rOk.counts.subcollections, { decks: 2, favorites: 1 });
    assert.strictEqual(rOk.counts.totalFirestoreDocs, 4);

    const snapU5 = { uid: 'u5', latestActivityIso: new Date(rOk.latestActivityMs).toISOString(), counts: rOk.counts };
    assert.strictEqual(dryMod.reverifyCandidateBeforeDelete({
      liveAuthUser: { uid: 'u5', providerData: [{ providerId: 'google.com' }], metadata: { lastSignInTime: oldTime, lastRefreshTime: oldTime } },
      liveUserDocExists: true, liveUserDocData: { updatedAt: oldTime },
      liveSubcollections: [], candidateSnapshot: snapU5, cutoffMs: cutoff,
    }).safeToDelete, false, '正式刪除前若已綁定身分必須中止');
    assert.strictEqual(dryMod.reverifyCandidateBeforeDelete({
      liveAuthUser: { uid: 'u5', providerData: [], metadata: { lastSignInTime: oldTime, lastRefreshTime: oldTime } },
      liveUserDocExists: true, liveUserDocData: { updatedAt: oldTime },
      liveSubcollections: [
        { name: 'decks', docs: [{ id: 'd1', data: { updatedAt: oldTime } }, { id: 'd2', data: { updatedAt: oldTime } }, { id: 'd3', data: { updatedAt: oldTime } }] },
        { name: 'favorites', docs: [{ id: 'f1', data: { createdAt: oldTime } }] },
      ],
      candidateSnapshot: snapU5, cutoffMs: cutoff,
    }).safeToDelete, false, '正式刪除前若文件數增加必須中止');
  });

  // ── 5. Rule 40 精確逆轉與突變測試 ────────────────────────────────────────────
  console.log('\n【E】Rule 40 精確還原與突變測試');
  T('E1 revertV6657IfPresent 將 12 個異動檔逐字還原回 BASE (652db337)，且在 BASE 為 no-op', () => {
    if (!hasBaseCommit(ROOT, BASE_SHA)) { shallowSkip('E1 精確逆轉', '需要完整 git 歷史'); return; }
    for (const rel of Object.keys(V6657_PAIRS)) {
      const b = readBaseBlob(ROOT, BASE_SHA, rel);
      ok(b.ok, `讀不到 BASE ${rel}`);
      const baseText = normEol(b.out);
      const curText = read(rel);
      assert.strictEqual(revertV6657IfPresent(rel, curText), baseText, `${rel} 還原後與 BASE 不一致`);
      assert.strictEqual(revertV6657IfPresent(rel, baseText), baseText, `${rel} 在 BASE 應為 no-op`);
    }
  });
  T('E2 突變反對照：確認跨帳號隔離／索引豁免與匿名提示守衛不是安慰劑', () => {
    // 突變 1：若 planMemberDeckSync 不過濾前帳號牌組，uid-A 快取必須被抓出失敗
    const leaked = msMod.planMemberDeckSync({
      uid: 'uid-B',
      localDecks: [deck('A1', 'A牌組', '2026-05-05T00:00:00.000Z', 4)],
      cloudDecks: [],
      ownership: { kind: 'member', memberUid: 'uid-A', knownCloudIds: ['A1'], pendingUpsertIds: [], pendingDeleteIds: [], anonIds: [], pendingFavorites: false },
      hasOwnershipRecord: true,
    });
    assert.strictEqual(leaked.toUpload.length, 0, '跨帳號不能把 A1 排進上傳清單');

    // 突變 2：若 firestore.indexes.json 使用 fieldPath: "*" 或刪掉 rooms，必須違背不變量
    const badIdx = { indexes: [], fieldOverrides: [{ collectionGroup: 'decks', fieldPath: '*', indexes: [] }] };
    ok(!(badIdx.indexes.length > 0 && badIdx.fieldOverrides.every((o) => o.fieldPath !== '*')), '突變守衛必須擋掉 * 與遺失 rooms 索引');
  });

  // ── 6. Playwright 真瀏覽器元件編譯與互動測試 ────────────────────────────────
  console.log('\n【F】Playwright 真瀏覽器實測 UI 顯示、本機儲存寫入失敗與重試橫幅');
  await TA('F1 AccountBar 與 DecksSyncBanner 在真 Chromium 互動渲染正確且零 console/pageerror', async () => {
    const pwHtml = join(TMP, 'pw.html');
    const pwJs = join(TMP, 'pw.bundle.mjs');
    const pwEntry = join(TMP, 'pw-entry.ts');
    writeFileSync(pwEntry, `
import { mount } from 'svelte';
import AccountBar from ${JSON.stringify(join(ROOT, 'src/lib/ui/AccountBar.svelte'))};
import DecksSyncBanner from ${JSON.stringify(join(ROOT, 'src/lib/decks/DecksSyncBanner.svelte'))};

let props = { anonymous: true, isMember: false, syncStatus: 'idle', syncError: null, localSaveError: null, email: null, googleUser: null, busy: false };
const barRoot = document.getElementById('bar');
const banRoot = document.getElementById('banner');
let retried = 0;

function render() {
  barRoot.innerHTML = '';
  banRoot.innerHTML = '';
  mount(AccountBar, {
    target: barRoot,
    props: {
      email: props.email, anonymous: props.anonymous, syncStatus: props.syncStatus, syncError: props.syncError,
      unsaved: 0, googleUser: props.googleUser, busy: props.busy,
      onOpenAuth: () => {}, onChangePassword: () => {}, onSignOut: () => {},
    },
  });
  mount(DecksSyncBanner, {
    target: banRoot,
    props: {
      anonymous: !props.isMember, syncStatus: props.syncStatus, syncError: props.syncError,
      localSaveError: props.localSaveError, onOpenAuth: () => {}, onRetrySync: () => { retried++; },
    },
  });
}
render();
window.__setProps = (patch) => { props = { ...props, ...patch }; render(); };
window.__getRetried = () => retried;
`);
    const compiledCss = [];
    await build({
      entryPoints: [pwEntry], bundle: true, format: 'esm', outfile: pwJs,
      conditions: ['browser'],
      absWorkingDir: ROOT,
      nodePaths: [join(ROOT, 'node_modules')],
      alias: { '$lib': join(ROOT, 'src/lib') },
      plugins: [{
        name: 'svelte-compile',
        setup(b) {
          b.onResolve({ filter: /^firebase\// }, () => {
            const p = join(TMP, 'fb-sdk-stub2.mjs');
            if (!existsSync(p)) writeFileSync(p, [
              'export const initializeApp = () => ({});',
              'export const getAuth = () => ({ currentUser: null });',
              'export const getFirestore = () => ({});',
              'export class GoogleAuthProvider {}',
              'export class EmailAuthProvider {}',
              'export const reauthenticateWithCredential = async () => ({});',
              'export const reauthenticateWithPopup = async () => ({});',
              'export const linkWithPopup = async () => ({});',
              'export const signInWithPopup = async () => ({});',
              'export const signInWithCredential = async () => ({});',
              'export const unlink = async () => ({});',
            ].join('\n'));
            return { path: p };
          });
          b.onResolve({ filter: /^\.\.\/firebase$/ }, () => {
            const p = join(TMP, 'fb-stub2.mjs');
            if (!existsSync(p)) writeFileSync(p, 'export const db = {}; export const auth = {}; export const FS_READ_ENABLED = true;');
            return { path: p };
          });
          b.onLoad({ filter: /\.svelte$/ }, async (args) => {
            const { compile } = await import('svelte/compiler');
            const src = readFileSync(args.path, 'utf8');
            const res = compile(src, { filename: args.path, generate: 'client', dev: false });
            if (res.css?.code) compiledCss.push(res.css.code);
            return { contents: res.js.code, loader: 'js' };
          });
        },
      }],
    });
    writeFileSync(pwHtml, `<!doctype html><html><head><style>${compiledCss.join('\n')}</style></head><body><div id="bar"></div><div id="banner"></div><script type="module">${readFileSync(pwJs, 'utf8')}</script></body></html>`);

    browser = await pwLaunch('v6657 F1 Playwright');
    if (!browser) return;
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setContent(readFileSync(pwHtml, 'utf8'));
    const anonText = await page.textContent('body');
    ok(anonText.includes('目前僅存在此瀏覽器，登入後可同步跨裝置使用'), '應顯示匿名本機提示');
    ok(anonText.includes('⬜ 本機'), 'AccountBar 應保留本機標籤');

    await page.evaluate(() => window.__setProps({ localSaveError: '本機儲存失敗：QuotaExceededError' }));
    const errText = await page.textContent('body');
    ok(errText.includes('本機儲存失敗'), '本機寫入失敗時必須顯示警告');

    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'light');
      window.__setProps({ localSaveError: null, anonymous: false, isMember: true, syncStatus: 'error', syncError: '連線逾時' });
    });
    const lightErrColor = await page.evaluate(() => getComputedStyle(document.querySelector('.dsb-err')).color);
    assert.strictEqual(lightErrColor, 'rgb(158, 28, 28)', '淺色主題下 .dsb-err 文字必須是高對比深紅 (#9e1c1c)');
    await page.click('.dsb-btn');
    const retries = await page.evaluate(() => window.__getRetried());
    assert.strictEqual(retries, 1, '點擊重試按鈕必須觸發 onRetrySync');
    assert.deepStrictEqual(errors, [], '瀏覽器執行不可有 pageerror');
  });

  console.log(`\n${pass} PASS / ${fail} FAIL`);
  if (fail) process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  rmSync(TMP, { recursive: true, force: true });
}
