/**
 * v6.658 回歸守衛：舊版歸屬保留、同步競態與唯讀掃描預算。
 * 共用 v6.657 的 Mock Firebase 基礎，新增逐情境行為驗收。
 * 前版背景：
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
import { revertV6658IfPresent, V6658_PAIRS } from './lib/revert-v6658-sync-safety.mjs';
import { pwLaunch } from './lib/pw.mjs';
import { revertV6657IfPresent, V6657_PAIRS } from './lib/revert-v6657-anon-decks-local.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_SHA = '919f6d0fd1a6a6989639253e3bbf95fe5973b1ca';
const PRODUCT = process.env.PTCG_V6658_SOURCE || ROOT;
const read = (rel) => normEol(readFileSync(join(PRODUCT, rel), 'utf8'));

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
    nodePaths: [join(ROOT, 'node_modules')],
    entryPoints: [join(PRODUCT, 'src/lib/decks/storage.ts')],
    bundle: true, format: 'esm', outfile: storeModPath,
    plugins: [{
      name: 'stub',
      setup(b) { b.onResolve({ filter: /^\.\/cardIdMigration$/ }, () => ({ path: cardIdMigStub })); },
    }],
  });
  await build({
    nodePaths: [join(ROOT, 'node_modules')],
    entryPoints: [join(PRODUCT, 'src/lib/decks/favorites.ts')],
    bundle: true, format: 'esm', outfile: favModPath,
  });
  await build({
    nodePaths: [join(ROOT, 'node_modules')],
    entryPoints: [join(PRODUCT, 'src/lib/decks/member-sync.ts')],
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
  const additions = dkSrc.includes('v6658-sync-safety') ? `import {cloneDecks,reconcileDeckSync,favoritesEqual,createCloudTaskQueue} from ${JSON.stringify(join(PRODUCT,'src/lib/decks/sync-commit.ts'))};\nimport {readLocalRecovery,initializeLegacyAnonymousOwnership,markMemberCloudPushSucceeded} from ${JSON.stringify(join(PRODUCT,'src/lib/decks/member-sync.ts'))};` : ''; 
  writeFileSync(harnessTs, `
import {
  loadDecks, saveDecksChecked, upsertDeckChecked, deleteDeckChecked, newDeck, sortDecks
} from ${JSON.stringify(join(PRODUCT, 'src/lib/decks/storage.ts'))};
import { loadFavorites, saveFavoritesChecked } from ${JSON.stringify(join(PRODUCT, 'src/lib/decks/favorites.ts'))};
import { createAuthGeneration } from ${JSON.stringify(join(PRODUCT, 'src/lib/auth/google-auth.ts'))};
import {
  readDeckOwnership, writeDeckOwnership, hasDeckOwnershipRecord, readFavOwner, writeFavOwner,
  markAnonLocalEdit, markAnonLocalDelete, markMemberLocalEdit, markMemberCloudDeleteResult,
  markFavoritesLocalChange, planMemberDeckSync, finalizeOwnershipAfterSync, planFavoritesMigration,
  combineLocalSaveResults, isCrossAccountOwnership, isolateCrossAccountLocalStorage
} from ${JSON.stringify(join(PRODUCT, 'src/lib/decks/member-sync.ts'))};

${additions}
export function createHarness(api) {
  const $state = (x) => x;
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
  const clearLocalDecksRev = () => api.clearLocalDecksRev?.();
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
    nodePaths: [join(ROOT, 'node_modules')],
    entryPoints: [harnessTs], bundle: true, format: 'esm', outfile: harnessJs,
    alias: { '$lib': join(PRODUCT, 'src/lib') },
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


  const waitFor = async (fn) => { for(let i=0;i<300;i++) { if(fn()) return; await new Promise(r=>setTimeout(r,5)); } throw new Error('fixture did not reach pending operation'); };
  const user = {uid:'member',isAnonymous:false,providerData:[{providerId:'password'}]};
  const old = '2025-01-01T00:00:00.000Z';
  const setup = async () => { const m=createMockEnv(); m.ensure('member').decks.set('d',deck('d','ORIGINAL',old,4)); const h=createHarness(m.api); h.mount(); await m.api.fireAuth({...user}); return {m,h}; };

  await TA('R1a 舊匿名來源經實際Auth確認後登入既有會員仍保留並上傳',async()=>{
    const m=createMockEnv(); m.api.readLocalDecksRevUid=()=> 'old-anon-uid';
    stMod.saveDecksChecked([deck('guest','GUEST',old,4)]);
    const h=createHarness(m.api); h.mount();
    await m.api.fireAuth({uid:'old-anon-uid',isAnonymous:true,providerData:[]});
    await m.api.fireAuth({...user});
    ok(stMod.loadDecks().some(d=>d.id==='guest'),'舊匿名牌組不可消失');
    ok(m.ensure('member').decks.has('guest'),'匿名來源確認後應遷移到會員');
  });
  await TA('R1b 來源不明先保留備份且不誤傳他人資料',async()=>{
    const m=createMockEnv(); m.api.readLocalDecksRevUid=()=> 'unknown-old-uid';
    stMod.saveDecksChecked([deck('private','PRIVATE',old,4)]);
    const h=createHarness(m.api); h.mount(); await m.api.fireAuth({...user});
    const backup=JSON.parse(m.lsEnv.ls.getItem('ptcg-tw-sim:decks-recovery-v1')||'[]');
    ok(backup.some(b=>b.decks.some(d=>d.id==='private')),'來源不明資料必須保留可恢復副本');
    ok(!m.ensure('member').decks.has('private'),'不可自動誤傳來源不明牌組');
  });
  await TA('R1c 保留副本失敗不得清除舊資料',async()=>{
    const m=createMockEnv(); m.api.readLocalDecksRevUid=()=> 'unknown-old-uid';
    stMod.saveDecksChecked([deck('private','PRIVATE',old,4)]);
    const orig=m.lsEnv.ls.setItem; m.lsEnv.ls.setItem=(k,v)=>{if(k.includes('recovery'))throw new Error('quota'); orig(k,v);};
    const h=createHarness(m.api); h.mount(); await m.api.fireAuth({...user});
    ok(stMod.loadDecks().some(d=>d.id==='private'),'備份失敗不可清掉原始牌組');
    ok(!m.ensure('member').decks.has('private'),'不得上傳前帳號內容');
  });
  await TA('R2a 雲端讀取期間編輯保留新內容及待傳標記',async()=>{
    const {m,h}=await setup(); m.api.holdNextCloudRead(); let readStarted=false;
    const orig=m.api.loadDecksFromCloud; m.api.loadDecksFromCloud=(u)=>{readStarted=true;return orig(u);};
    const pending=h.retryMemberSync(); await waitFor(()=>readStarted);
    const edited=deck('d','NEW',old,9); const arr=h.persistSingleDeckLocally(edited); h.setDecksState(arr,'d'); h.setDirty('d');
    m.api.releaseCloudRead(); await pending;
    ok(stMod.loadDecks().some(d=>d.name==='NEW'),'新編輯不可被舊雲端快照覆寫');
    ok(h.getState().dirtyDeckIds.includes('d'),'尚未上傳的新編輯必須留在dirty');
    await h.saveAllDecksToCloud(); ok(m.ensure('member').decks.get('d').name==='NEW','下次存檔可補傳');
  });
  await TA('R2b 雲端讀取期間新增及刪除不會被復活或清除',async()=>{
    const {m,h}=await setup(); m.api.holdNextCloudRead(); let started=false;
    const orig=m.api.loadDecksFromCloud; m.api.loadDecksFromCloud=(u)=>{started=true;return orig(u);};
    const pending=h.retryMemberSync(); await waitFor(()=>started);
    stMod.deleteDeckChecked('d');
    const newD=deck('new','NEW-DECK',old,4); const arr=h.persistSingleDeckLocally(newD); h.setDecksState(arr,'new'); h.setDirty('new');
    m.api.releaseCloudRead(); await pending;
    ok(!stMod.loadDecks().some(d=>d.id==='d'),'同步途中刪除不可被雲端復活');
    ok(stMod.loadDecks().some(d=>d.id==='new'),'同步途中新增必須保留');
    await h.saveAllDecksToCloud(); ok(!m.ensure('member').decks.has('d'),'刪除可補同步'); ok(m.ensure('member').decks.has('new'));
  });
  await TA('R3a 存檔途中再次修改不會誤標同步完成',async()=>{
    const {m,h}=await setup(); let arr=h.persistSingleDeckLocally(deck('d','FIRST',old,5)); h.setDecksState(arr,'d'); h.setDirty('d');
    let release; const orig=m.api.syncDeckToCloud; m.api.syncDeckToCloud=async(u,d)=>{await new Promise(r=>release=r);return orig(u,d);};
    const pending=h.saveAllDecksToCloud(); await waitFor(()=>release);
    arr=h.persistSingleDeckLocally(deck('d','SECOND',old,6)); h.setDecksState(arr,'d'); h.setDirty('d');
    release(); await pending;
    ok(m.ensure('member').decks.get('d').name==='FIRST');
    ok(h.getState().syncStatus!=='synced' && h.getState().dirtyDeckIds.includes('d'),'新版本未上傳不可清除標記');
    m.api.syncDeckToCloud=orig; await h.saveAllDecksToCloud(); ok(m.ensure('member').decks.get('d').name==='SECOND');
  });
  await TA('R3b 成功存檔且沒有中途修改可正常清除dirty（正對照）',async()=>{
    const {m,h}=await setup(); const arr=h.persistSingleDeckLocally(deck('d','DONE',old,5)); h.setDecksState(arr,'d'); h.setDirty('d');
    await h.saveAllDecksToCloud(); ok(h.getState().syncStatus==='synced'); ok(h.getState().dirtyDeckIds.length===0); ok(m.ensure('member').decks.get('d').name==='DONE');
  });
  await TA('R3c 常用卡牌存檔途中修改必須保留待傳狀態',async()=>{
    const {m,h}=await setup(); h.toggleFavorite('c1');
    let release; const orig=m.api.saveFavoritesToCloud; m.api.saveFavoritesToCloud=async(u,f)=>{await new Promise(r=>release=r);return orig(u,f);};
    const pending=h.saveAllDecksToCloud(); await waitFor(()=>release); h.toggleFavorite('c2'); release(); await pending;
    ok(msMod.readDeckOwnership().pendingFavorites,'途中新增常用卡牌不能誤清pending');
    ok(favMod.loadFavorites().has('c2'),'新常用卡牌應留在本機');
  });

  await TA('R2c 另一分頁於同步期間改牌保留新版本',async()=>{
    const {m,h}=await setup(); m.api.holdNextCloudRead(); let started=false;
    const orig=m.api.loadDecksFromCloud; m.api.loadDecksFromCloud=u=>{started=true;return orig(u);};
    const pending=h.retryMemberSync(); await waitFor(()=>started);
    stMod.upsertDeckChecked(deck('d','OTHER-TAB',old,7)); msMod.markMemberLocalEdit('member',['d']);
    m.api.releaseCloudRead(); await pending;
    ok(stMod.loadDecks().some(d=>d.name==='OTHER-TAB'),'不能只看目前分頁的記憶體');
    ok(h.getState().dirtyDeckIds.includes('d'));
  });
  await TA('R2d 初次遷移上傳期間再編輯保留新內容',async()=>{
    const m=createMockEnv(); const h=createHarness(m.api);h.mount();await m.api.fireAuth({uid:'anon',isAnonymous:true,providerData:[]});
    h.persistSingleDeckLocally(deck('g','FIRST',old,4));
    let release;const orig=m.api.syncDeckToCloud;m.api.syncDeckToCloud=async(u,d)=>{await new Promise(r=>release=r);return orig(u,d);};
    const pending=m.api.fireAuth({...user}); await waitFor(()=>release);
    h.persistSingleDeckLocally(deck('g','SECOND',old,5));h.setDirty('g');release();await pending;
    ok(stMod.loadDecks().some(d=>d.name==='SECOND'));ok(h.getState().dirtyDeckIds.includes('g'));
  });
  await TA('R3d 取消收藏後重試不會把雲端舊收藏加回',async()=>{
    const {m,h}=await setup();h.toggleFavorite('c1');await h.saveAllDecksToCloud();
    h.toggleFavorite('c1');await h.retryMemberSync();
    ok(!favMod.loadFavorites().has('c1')&&!m.ensure('member').favs.has('c1'),'本人收藏待傳時應包含取消操作');
  });
  await TA('R3e 舊分頁按存檔不能先覆寫別分頁的新修改',async()=>{
    const {m,h}=await setup();stMod.upsertDeckChecked(deck('d','OTHER-TAB',old,8));msMod.markMemberLocalEdit('member',['d']);
    await h.saveAllDecksToCloud();ok(m.ensure('member').decks.get('d').name==='OTHER-TAB');ok(stMod.loadDecks().some(d=>d.name==='OTHER-TAB'));
  });

  await TA('S1 跨帳號隔離後取收藏快照，不把A收藏上傳B',async()=>{
    const m=createMockEnv();m.ensure('A').decks.set('a',deck('a','A',old,4));m.ensure('A').favs.add('PRIVATE-A');m.ensure('B').favs.add('B-FAV');
    const h=createHarness(m.api);h.mount();await m.api.fireAuth({...user,uid:'A'});await m.api.fireAuth({...user,uid:'B'});
    ok(!m.ensure('B').favs.has('PRIVATE-A'),'隔離前的收藏快照不可傳給下一帳號');ok(m.ensure('B').favs.has('B-FAV'));
  });
  await TA('S2 合併落地失敗保留owner並清rev，不能確認舊快取',async()=>{
    const {m,h}=await setup();const before=JSON.stringify(msMod.readDeckOwnership());m.ensure('member').decks.set('d2',deck('d2','CLOUD-NEW',old,4));
    let cleared=false;m.api.clearLocalDecksRev=()=>{cleared=true;};
    const set=m.lsEnv.ls.setItem;m.lsEnv.ls.setItem=(k,v)=>{if(k==='ptcg-tw-sim:decks')throw new Error('quota');return set(k,v);};
    await h.retryMemberSync();ok(cleared,'本機落地失敗必須清rev');ok(JSON.stringify(msMod.readDeckOwnership())===before,'本機未落地不能確認owner');
    m.lsEnv.ls.setItem=set;await h.retryMemberSync();ok(stMod.loadDecks().some(d=>d.id==='d2'));
  });

  await TA('S3 舊分頁排序不能蓋掉別分頁新內容',async()=>{
    const {m,h}=await setup(); const previous=h.getState().decks;
    stMod.upsertDeckChecked(deck('d','OTHER-TAB-ORDER',old,8));msMod.markMemberLocalEdit('member',['d']);
    h.persistDeckOrder(previous);await h.saveAllDecksToCloud();
    ok(stMod.loadDecks().some(d=>d.name==='OTHER-TAB-ORDER'));ok(m.ensure('member').decks.get('d').name==='OTHER-TAB-ORDER');
  });

  await TA('S4 自動同步等待期間的新收藏保留pending',async()=>{
    const {m,h}=await setup();m.api.cloudDecksUnchanged=async()=>false;
    m.api.holdNextCloudRead();let started=false;const orig=m.api.loadDecksFromCloud;m.api.loadDecksFromCloud=u=>{started=true;return orig(u);};
    const pending=m.api.fireAuth({...user});await waitFor(()=>started);h.toggleFavorite('NEW-FAVORITE');m.api.releaseCloudRead();await pending;
    ok(msMod.readDeckOwnership().pendingFavorites,'自動同步也不能清掉途中收藏');
  });
  await TA('S5 確認rev完成後才能落地及清快取，避免晚回應復活舊rev',async()=>{
    const {m,h}=await setup();let release,cleared=false;
    m.api.recordCloudDecksRev=async()=>{await new Promise(r=>release=r);};m.api.clearLocalDecksRev=()=>{cleared=true;};
    const set=m.lsEnv.ls.setItem;m.lsEnv.ls.setItem=(k,v)=>{if(k==='ptcg-tw-sim:decks')throw new Error('quota');return set(k,v);};
    const pending=h.retryMemberSync();await waitFor(()=>release);ok(!cleared,'必須等rev讀取完成再提交本機');release();await pending;ok(cleared);
  });

  await TA('S6 本機寫入失敗時新增與排序不丟掉畫面草稿',async()=>{
    const {m,h}=await setup();m.lsEnv.setThrow(true);
    const arr=h.persistSingleDeckLocally(deck('new-quota','UNSAVED-DRAFT',old,4));h.setDecksState(arr,'new-quota');h.setDirty('new-quota');h.persistDeckOrder(arr);
    ok(h.getState().decks.some(d=>d.id==='new-quota'),'儲存失敗不能用舊disk清除畫面草稿');
    m.lsEnv.setThrow(false);await h.saveAllDecksToCloud();ok(stMod.loadDecks().some(d=>d.id==='new-quota'));ok(m.ensure('member').decks.has('new-quota'));
  });
  const dry=await import(pathToFileURL(join(PRODUCT,'scripts/firestore-anon-cleanup-dryrun.mjs')).href);
  // BASE 沒有匯出的掃描器：抽取原 CLI 的實際掃描迴圈，保留原判準做行為紅對照。
  const drySource = read('scripts/firestore-anon-cleanup-dryrun.mjs');
  const scanCandidates = dry.scanAnonymousCandidates || (async ({auth,db,opts,now,pace}) => {
    const start = drySource.indexOf('  const cutoffMs = Date.now() - opts.days');
    const end = drySource.indexOf('  const manifestJson =', start);
    ok(start > 0 && end > start, 'BASE 掃描區段定位失敗');
    const body = drySource.slice(start,end).replace('  const pace = createRateLimiter(opts.qps);','').replaceAll('Date.now()', 'now');
    return await new Function('auth','db','opts','now','pace','getBillingDayPT','classifyPureAnonymousAuth','evaluateUidCandidate','DEFAULT_CONFIG',
      'return (async()=>{' + body + ';return {summary,candidates,excluded};})()')(
        auth,db,opts,now,pace,dry.getBillingDayPT,dry.classifyPureAnonymousAuth,dry.evaluateUidCandidate,dry.DEFAULT_CONFIG);
  });
  const now=Date.parse('2026-11-18T00:00:00.000Z');
  const authOld={uid:'guest',providerData:[],metadata:{lastSignInTime:old,lastRefreshTime:old,creationTime:old}};
  const candidate=(extra={})=>({uid:'guest',authUser:authOld,userDocExists:false,userDocData:null,subcollections:[{name:'decks',docs:[{id:'d',data:{updatedAt:old},updateTimeMs:now,createTimeMs:Date.parse(old)}]}],cutoffMs:now-180*86400000,...extra});
  T('R4a 子文件較新伺服器時間不可被舊欄位遮掉',()=>ok(!dry.evaluateUidCandidate(candidate()).eligible));
  T('R4b 父文件較新伺服器時間不可被舊欄位遮掉',()=>ok(!dry.evaluateUidCandidate(candidate({userDocExists:true,userDocData:{updatedAt:old,_updateTime:now},subcollections:[]})).eligible));
  T('R4c 全部時間確實過期仍可列候選（正對照）',()=>ok(dry.evaluateUidCandidate(candidate({subcollections:[{name:'decks',docs:[{id:'d',data:{updatedAt:old},updateTimeMs:Date.parse(old)}]}]})).eligible));
  await TA('R5a 讀取硬預算與不完整UID不得列候選',async()=>{

    let readDocs=0;
    const all=Array.from({length:150},(_,i)=>({id:String(i),data:()=>({updatedAt:old}),createTime:{toMillis:()=>Date.parse(old)},updateTime:{toMillis:()=>Date.parse(old)}}));
    const col={id:'decks',get:async()=>{readDocs+=all.length;return {size:all.length,docs:all};},limit(n){let offset=0; return {startAfter(d){offset=Number(d.id)+1;return this;},async get(){const docs=all.slice(offset,offset+n);readDocs+=Math.max(1,docs.length);return {size:docs.length,docs};}};}};
    const ref={get:async()=>({exists:false}),listCollections:async()=>[col]};
    const result=await scanCandidates({auth:{listUsers:async()=>({users:[authOld]})},db:{collection:()=>({doc:()=>ref})},opts:{days:180,limitUsers:0,maxReads:100,qps:20},now,pace:async()=>{}});
    ok(result.summary.estimatedFirestoreReads<=100,'總讀取不能突破100'); ok(readDocs<=98,'必須保留父文件讀取預算');
    ok(result.summary.stoppedByReadBudget,'預算停止必須標明'); ok(result.candidates.length===0,'未掃完的UID不可列候選');
  });
  await TA('R5b Auth近期活躍與缺訊號不發Firestore讀取',async()=>{
 let calls=0;
    const users=[{...authOld,uid:'recent',metadata:{...authOld.metadata,lastRefreshTime:new Date(now).toISOString()}},{...authOld,uid:'missing',metadata:{lastSignInTime:old}}];
    const result=await scanCandidates({auth:{listUsers:async()=>({users})},db:{collection(){calls++;throw new Error('unexpected firestore read');}},opts:{days:180,limitUsers:0,maxReads:100,qps:20},now,pace:async()=>{}});
    ok(calls===0); ok(result.summary.scannedAuthUsers===2);
  });
  await TA('R5c 小集合完整讀取及空查詢最低一筆（正對照）',async()=>{

    const col={id:'decks',get:async()=>({size:0,docs:[]}),limit(n){return {startAfter(){return this;},get:async()=>({size:0,docs:[]})};}};
    const ref={get:async()=>({exists:true,data:()=>({updatedAt:old}),updateTime:{toMillis:()=>Date.parse(old)}}),listCollections:async()=>[col]};
    const result=await scanCandidates({auth:{listUsers:async()=>({users:[authOld]})},db:{collection:()=>({doc:()=>ref})},opts:{days:180,limitUsers:0,maxReads:100,qps:20},now,pace:async()=>{}});
    ok(result.summary.estimatedFirestoreReads===3); ok(result.candidates.length===1);
  });

  T('R4d 不合法秒時間不能傳入候選判斷',()=>{
    ok(dry.parseTimestampMs({seconds:NaN})===null);ok(dry.parseTimestampMs({_seconds:-1})===null);
  });
  await TA('R5d 未核准集合不讀內容',async()=>{
let reads=0;
    const ref={get:async()=>({exists:false}),listCollections:async()=>[{id:'private-other',limit(){reads++;throw new Error('must not read');}}]};
    const result=await scanCandidates({auth:{listUsers:async()=>({users:[authOld]})},db:{collection:()=>({doc:()=>ref})},opts:{days:180,limitUsers:0,maxReads:100,qps:20},now,pace:async()=>{}});
    ok(reads===0&&result.candidates.length===0);
  });

  T('I1 本版逆轉逐字回BASE且BASE為no-op',()=>{
    for(const rel of Object.keys(V6658_PAIRS)) {
      const base=readBaseBlob(ROOT,BASE_SHA,rel);ok(base.ok,'BASE blob missing '+rel);
      assert.strictEqual(revertV6658IfPresent(rel,readFileSync(join(ROOT,rel),'utf8')),normEol(base.out),rel);
      assert.strictEqual(revertV6658IfPresent(rel,normEol(base.out)),normEol(base.out),rel+' BASE noop');
    }
  });
  console.log(`\n${pass} PASS / ${fail} FAIL`);
  if(fail)process.exitCode=1;
} finally { if(browser)await browser.close().catch(()=>{}); rmSync(TMP,{recursive:true,force:true}); }
