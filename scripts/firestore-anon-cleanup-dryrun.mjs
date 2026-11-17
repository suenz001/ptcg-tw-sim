#!/usr/bin/env node
/**
 * 第三階段：舊純匿名 Firestore 資料清理「僅預覽 (Dry-Run) 與備份／稽核規劃」腳本
 *
 * ⚠⚠⚠ 安全聲明：
 *   1. 本腳本**僅執行唯讀盤點與規劃輸出**，不包含、也不執行任何 Firestore 刪除或 Auth 刪除呼叫。
 *   2. 任何正式清理都必須在觀察第一、二階段效果後，由站長 Wilson 審閱具體 Dry-Run 數據、
 *      備份與還原演練方案並明確同意，才可另案實施。
 *   3. 僅納入核准之 Firestore 路徑（users/{uid} 及其子集合），絕不擴大觸及 Firebase Auth、
 *      MongoDB、rooms 或 feedbacks。
 *
 * 使用方式（僅在具備 Read-Only Firebase Admin 憑證之伺服器／維護環境執行）：
 *   node scripts/firestore-anon-cleanup-dryrun.mjs --days=180 --limit-users=500 --qps=20
 *   node scripts/firestore-anon-cleanup-dryrun.mjs --help
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';

export const DEFAULT_CONFIG = Object.freeze({
  dryRunOnly: true,                 // 強制鎖定唯讀 Dry-Run
  inactivityDays: 180,              // 保守停用門檻（至少 180 天無任何活動）
  dailyDeleteHardCeiling: 18000,    // 同一計費日（太平洋時間）最高累積刪除上限（保留 ≥2,000 筆給網站日常操作；不可視為保證零費用）
  billingTimeZone: 'America/Los_Angeles',
  maxReadOpsPerRun: 25000,          // 單次 Dry-Run 掃描讀取預算上限（避免掃描本身吃爆 50k/日免費讀寫額度）
  qps: 20,                          // 每秒 Firestore 讀取上限（限速）
  limitUsers: 0,                    // 0 = 不限（建議試跑先設 500）
  approvedSubcollections: Object.freeze(['decks', 'favorites', 'meta']),
  forbiddenTargets: Object.freeze(['firebase-auth', 'mongodb', 'rooms', 'feedbacks']),
});

/** 取得目前（或指定時間）所屬之 Google Cloud 計費日 YYYY-MM-DD（太平洋時間）。 */
export function getBillingDayPT(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: DEFAULT_CONFIG.billingTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(date);
}

/** 安全解析 Firestore Timestamp / ISO 字串 / epoch ms 為毫秒時間戳（無法識別回 null）。 */
export function parseTimestampMs(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return null;
    const ms = Date.parse(s);
    return Number.isFinite(ms) && ms > 0 ? ms : null;
  }
  if (typeof v === 'object') {
    if (typeof v.toMillis === 'function') {
      try {
        const ms = v.toMillis();
        return Number.isFinite(ms) && ms > 0 ? ms : null;
      } catch {
        return null;
      }
    }
    const seconds = typeof v.seconds === 'number' ? v.seconds : v._seconds;
    if (typeof seconds === 'number') return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
  }
  return null;
}

/**
 * 判斷 Auth 使用者是否為「純匿名帳號」（不以沒有 email 為唯一依據）。
 * 必須同時檢查 providerData 為空、無 email、無 phoneNumber、無任何綁定身分。
 */
export function classifyPureAnonymousAuth(authUser) {
  if (!authUser || typeof authUser !== 'object') {
    return { eligible: false, reason: 'missing_auth_user' };
  }
  if (!Array.isArray(authUser.providerData)) return { eligible: false, reason: 'missing_provider_data' };
  const providers = authUser.providerData;
  if (providers.length > 0) {
    return { eligible: false, reason: `has_provider(${providers.map((p) => p?.providerId || 'unknown').join(',')})` };
  }
  if (authUser.email) return { eligible: false, reason: 'has_email' };
  if (authUser.phoneNumber) return { eligible: false, reason: 'has_phone' };
  if (authUser.customClaims && authUser.customClaims.admin) {
    return { eligible: false, reason: 'has_admin_claim' };
  }
  return { eligible: true, reason: null };
}

/**
 * 綜合計算最後活動時間並決定是否納入 Dry-Run 候選（缺漏或無法確認一律保守排除）。
 */
export function evaluateUidCandidate({
  uid,
  authUser,
  userDocExists,
  userDocData,
  subcollections, // Array<{ name, docs: Array<{ id, data, createTimeMs, updateTimeMs }> }>
  cutoffMs,
  approvedSubcollections = DEFAULT_CONFIG.approvedSubcollections,
}) {
  const anonCheck = classifyPureAnonymousAuth(authUser);
  if (!anonCheck.eligible) {
    return { eligible: false, excludeReason: anonCheck.reason, latestActivityMs: null, counts: emptyCounts() };
  }

  // Auth 訊號必須同時檢視 lastSignInTime、lastRefreshTime 與 creationTime
  const signInMs = parseTimestampMs(authUser.metadata?.lastSignInTime);
  const refreshMs = parseTimestampMs(authUser.metadata?.lastRefreshTime);
  const createdMs = parseTimestampMs(authUser.metadata?.creationTime);
  const authSignals = [signInMs, refreshMs, createdMs].filter((x) => x !== null);
  if (authSignals.length === 0) {
    return { eligible: false, excludeReason: 'missing_auth_timestamps', latestActivityMs: null, counts: emptyCounts() };
  }

  // 必須同時具備 lastSignInTime 與 lastRefreshTime，缺任一項即無法排除近期仍有 token refresh 活動，一律保守跳過
  if (refreshMs === null || signInMs === null) {
    return { eligible: false, excludeReason: 'missing_auth_signin_or_refresh_time', latestActivityMs: null, counts: emptyCounts() };
  }

  // 父文件身分安全檢查（即使 Auth 無 providerData，若父文件含會員欄位亦排除）
  if (userDocExists && userDocData) {
    if (userDocData.email || userDocData.googleUid || userDocData.isMember === true) {
      return { eligible: false, excludeReason: 'user_doc_indicates_member', latestActivityMs: null, counts: emptyCounts() };
    }
  }

  const allActivityMs = [...authSignals];
  if (userDocExists && userDocData) {
    const times = [userDocData.updatedAt, userDocData._updateTime, userDocData.createdAt, userDocData._createTime].map(parseTimestampMs).filter((t) => t !== null);
    allActivityMs.push(...times);
    const uUp = times.length ? Math.max(...times) : null;
    const uCr = uUp;
    if (uUp !== null) allActivityMs.push(uUp);
    if (uCr !== null) allActivityMs.push(uCr);
    if (uUp === null && uCr === null) {
      return { eligible: false, excludeReason: 'user_doc_missing_timestamps', latestActivityMs: null, counts: emptyCounts() };
    }
  }

  const subCounts = {};
  let unapprovedSub = null;
  for (const sub of subcollections || []) {
    if (!approvedSubcollections.includes(sub.name)) {
      unapprovedSub = sub.name;
      break;
    }
    subCounts[sub.name] = (sub.docs || []).length;
    for (const d of sub.docs || []) {
      const times = [d.data?.updatedAt, d.updateTimeMs, d.data?.createdAt, d.createTimeMs].map(parseTimestampMs).filter((t) => t !== null);
      allActivityMs.push(...times);
      const dUp = times.length ? Math.max(...times) : null;
      const dCr = dUp;
      if (dUp === null && dCr === null) {
        return { eligible: false, excludeReason: `subdoc_missing_timestamp(${sub.name}/${d.id})`, latestActivityMs: null, counts: emptyCounts() };
      }
      if (dUp !== null) allActivityMs.push(dUp);
      if (dCr !== null) allActivityMs.push(dCr);
    }
  }

  if (unapprovedSub) {
    return { eligible: false, excludeReason: `unapproved_subcollection(${unapprovedSub})`, latestActivityMs: null, counts: emptyCounts() };
  }

  const totalSubDocs = Object.values(subCounts).reduce((a, b) => a + b, 0);
  if (!userDocExists && totalSubDocs === 0) {
    return { eligible: false, excludeReason: 'no_firestore_docs', latestActivityMs: Math.max(...allActivityMs), counts: emptyCounts() };
  }

  const latestActivityMs = Math.max(...allActivityMs);
  if (latestActivityMs > cutoffMs) {
    return { eligible: false, excludeReason: 'recent_activity', latestActivityMs, counts: emptyCounts() };
  }

  return {
    eligible: true,
    excludeReason: null,
    latestActivityMs,
    authMetadataSnapshot: {
      creationTime: authUser.metadata?.creationTime ?? null,
      lastSignInTime: authUser.metadata?.lastSignInTime ?? null,
      lastRefreshTime: authUser.metadata?.lastRefreshTime ?? null,
    },
    counts: {
      uid,
      parentUserDoc: userDocExists ? 1 : 0,
      subcollections: subCounts,
      totalFirestoreDocs: (userDocExists ? 1 : 0) + totalSubDocs,
    },
  };
}

/**
 * 正式清理階段二次覆驗純函式（對抗 Dry-Run 與正式刪除之間的競態／升級／恢復活動）：
 *   重新拉取最新 Auth 與 Firestore 狀態後，若身分升級、出現新時間戳或最後活動時間推進即中止該 UID。
 */
export function reverifyCandidateBeforeDelete({ liveAuthUser, liveUserDocExists, liveUserDocData, liveSubcollections, candidateSnapshot, cutoffMs }) {
  const recheck = evaluateUidCandidate({
    uid: candidateSnapshot.uid,
    authUser: liveAuthUser,
    userDocExists: liveUserDocExists,
    userDocData: liveUserDocData,
    subcollections: liveSubcollections,
    cutoffMs,
  });
  if (!recheck.eligible) {
    return { safeToDelete: false, abortReason: `reverify_excluded:${recheck.excludeReason}` };
  }
  const prevMs = parseTimestampMs(candidateSnapshot.latestActivityIso);
  if (prevMs !== null && recheck.latestActivityMs > prevMs) {
    return { safeToDelete: false, abortReason: 'reverify_activity_advanced' };
  }
  if (candidateSnapshot.counts?.totalFirestoreDocs != null && recheck.counts.totalFirestoreDocs > candidateSnapshot.counts.totalFirestoreDocs) {
    return { safeToDelete: false, abortReason: 'reverify_new_docs_created' };
  }
  return { safeToDelete: true, abortReason: null, counts: recheck.counts };
}

function emptyCounts() {
  return { parentUserDoc: 0, subcollections: {}, totalFirestoreDocs: 0 };
}

/**
 * 同一計費日（太平洋時間）累積刪除預算紀錄器（支援中斷續跑，重跑不重置額度）。
 */
export function loadOrInitDailyQuotaState(stateFile, datePT = getBillingDayPT()) {
  if (existsSync(stateFile)) {
    try {
      const parsed = JSON.parse(readFileSync(stateFile, 'utf8'));
      if (parsed && parsed.billingDayPT === datePT && Number.isFinite(parsed.deletedToday)) {
        return parsed;
      }
    } catch { /* fallback to clean day record only if corrupt/past day */ }
  }
  return {
    billingDayPT: datePT,
    hardCeiling: DEFAULT_CONFIG.dailyDeleteHardCeiling,
    deletedToday: 0,
    runs: [],
  };
}

export function createRateLimiter(qps) {
  const minIntervalMs = qps > 0 ? Math.ceil(1000 / qps) : 0;
  let lastAt = 0;
  return async function pace(units = 1) {
    if (minIntervalMs <= 0) return;
    const now = Date.now();
    const wait = lastAt + minIntervalMs - now;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastAt = Date.now() + Math.max(0, units - 1) * minIntervalMs;
  };
}

function parseCliArgs(argv) {
  const opts = {
    days: DEFAULT_CONFIG.inactivityDays,
    limitUsers: DEFAULT_CONFIG.limitUsers,
    qps: DEFAULT_CONFIG.qps,
    maxReads: DEFAULT_CONFIG.maxReadOpsPerRun,
    outDir: join(tmpdir(), 'ptcg-tw-cleanup-dryrun'),
    help: false,
  };
  for (const a of argv) {
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a.startsWith('--days=')) opts.days = Math.max(30, Number(a.slice(7)) || DEFAULT_CONFIG.inactivityDays);
    else if (a.startsWith('--limit-users=')) opts.limitUsers = Math.max(0, Number(a.slice(14)) || 0);
    else if (a.startsWith('--qps=')) opts.qps = Math.max(1, Number(a.slice(6)) || DEFAULT_CONFIG.qps);
    else if (a.startsWith('--max-reads=')) opts.maxReads = Math.max(100, Number(a.slice(12)) || DEFAULT_CONFIG.maxReadOpsPerRun);
    else if (a.startsWith('--out=')) opts.outDir = resolve(a.slice(6));
  }
  return opts;
}

// >>> v6658-read-budget
export async function scanAnonymousCandidates({ auth, db, opts, now = Date.now(), pace = createRateLimiter(opts.qps) }) {
  const cutoffMs = now - opts.days * 86400 * 1000;
  const summary = {
    mode: 'DRY_RUN_READ_ONLY',
    generatedAt: new Date().toISOString(),
    billingDayPT: getBillingDayPT(),
    inactivityDays: opts.days,
    cutoffIso: new Date(cutoffMs).toISOString(),
    scannedAuthUsers: 0,
    estimatedFirestoreReads: 0,
    candidatesCount: 0,
    candidateDocs: { parentUsers: 0, decks: 0, favorites: 0, meta: 0, total: 0 },
    excludedByReason: {},
    stoppedByReadBudget: false,
    note: '僅預覽，未執行任何刪除；正式執行前須先完成備份、二次覆驗並取得站長明確同意。',
  };

  const candidates = [];
  const excluded = [];
  let pageToken;

  scanLoop:
  do {
    const res = await auth.listUsers(1000, pageToken);
    pageToken = res.pageToken;
    for (const u of res.users) {
      if (opts.limitUsers > 0 && summary.scannedAuthUsers >= opts.limitUsers) break scanLoop;
      summary.scannedAuthUsers++;
      const exclude = (reason) => {
        summary.excludedByReason[reason] = (summary.excludedByReason[reason] || 0) + 1;
        excluded.push({ uid: u.uid, reason });
      };
      const anon = classifyPureAnonymousAuth(u);
      if (!anon.eligible) { exclude(anon.reason); continue; }
      const signin = parseTimestampMs(u.metadata?.lastSignInTime);
      const refresh = parseTimestampMs(u.metadata?.lastRefreshTime);
      const creation = parseTimestampMs(u.metadata?.creationTime);
      if (signin === null || refresh === null) { exclude('missing_auth_signin_or_refresh_time'); continue; }
      if (Math.max(signin, refresh, creation || 0) > cutoffMs) { exclude('recent_auth_activity'); continue; }
      // 父文件讀取及子集合列舉保守各預留一個額度；不足時連請求都不發。
      if (opts.maxReads - summary.estimatedFirestoreReads < 2) { summary.stoppedByReadBudget = true; break scanLoop; }
      const userRef = db.collection('users').doc(u.uid);
      await pace(2);
      const userSnap = await userRef.get();
      summary.estimatedFirestoreReads++;
      const cols = await userRef.listCollections();
      summary.estimatedFirestoreReads++;
      if (cols.some((c) => !DEFAULT_CONFIG.approvedSubcollections.includes(c.id))) {
        exclude('unapproved_subcollection'); continue;
      }
      const subcollections = [];
      for (const col of cols) {
        const docs = [];
        let cursor = null;
        while (true) {
          const remaining = opts.maxReads - summary.estimatedFirestoreReads;
          if (remaining <= 0) { summary.stoppedByReadBudget = true; break scanLoop; }
          const pageSize = Math.min(100, Math.max(1, Math.floor(opts.qps)), remaining);
          let query = col.limit(pageSize);
          if (cursor) query = query.startAfter(cursor);
          await pace(pageSize);
          const snap = await query.get();
          summary.estimatedFirestoreReads += Math.max(1, snap.size);
          docs.push(...snap.docs.map((d) => ({ id: d.id, data: d.data(),
            createTimeMs: d.createTime?.toMillis?.() ?? null, updateTimeMs: d.updateTime?.toMillis?.() ?? null })));
          if (snap.size < pageSize) break;
          cursor = snap.docs[snap.docs.length - 1];
        }
        subcollections.push({ name: col.id, docs });
      }
      const ev = evaluateUidCandidate({ uid: u.uid, authUser: u, userDocExists: userSnap.exists,
        userDocData: userSnap.exists ? { ...userSnap.data(), _createTime: userSnap.createTime?.toMillis?.() ?? null,
          _updateTime: userSnap.updateTime?.toMillis?.() ?? null } : null, subcollections, cutoffMs });
      if (ev.eligible) {
        summary.candidatesCount++;
        summary.candidateDocs.parentUsers += ev.counts.parentUserDoc;
        for (const k of DEFAULT_CONFIG.approvedSubcollections) summary.candidateDocs[k] += ev.counts.subcollections[k] || 0;
        summary.candidateDocs.total += ev.counts.totalFirestoreDocs;
        candidates.push({ uid: u.uid, latestActivityIso: new Date(ev.latestActivityMs).toISOString(),
          authMetadata: ev.authMetadataSnapshot, counts: ev.counts });
      } else exclude(ev.excludeReason);
    }
  } while (pageToken);
  return { summary, candidates, excluded };
}

// <<< v6658-read-budget

async function runCli() {
  const opts = parseCliArgs(process.argv.slice(2));
  if (opts.help) {
    console.log([
      'Firestore 舊純匿名資料清理 Dry-Run 盤點腳本（僅唯讀預覽，絕不執行刪除）',
      '',
      '參數：',
      '  --days=180          無任何 Auth／Firestore 活動之保守門檻天數（預設 180）',
      '  --limit-users=500   最多掃描多少位 Auth 帳號（0 = 全部，預設 0）',
      '  --qps=20            Firestore 唯讀限速（預設 20 ops/s）',
      '  --max-reads=25000   單次 Dry-Run 讀取預算上限（預設 25,000）',
      '  --out=<dir>         Dry-Run 清單與稽核報告輸出目錄',
    ].join('\n'));
    return;
  }

  const candidateDirs = [
    process.env.FIREBASE_ADMIN_PATH,
    '/opt/ptcg/api/node_modules/firebase-admin',
    join(process.cwd(), 'node_modules', 'firebase-admin'),
  ].filter(Boolean);
  const resolvedDir = candidateDirs.find((d) => existsSync(join(d, 'package.json')));
  if (!resolvedDir) {
    console.error('找不到 firebase-admin（本專案前端建置不附帶），請於 Oracle 維護機 /opt/ptcg/api 執行或設定 FIREBASE_ADMIN_PATH。');
    process.exitCode = 1;
    return;
  }
  const req = createRequire(import.meta.url);
  let admin;
  try {
    admin = req(resolvedDir);
  } catch (e) {
    console.error('載入 firebase-admin 失敗：', e?.message || e);
    process.exitCode = 1;
    return;
  }
  const adminMod = admin?.default ?? admin;
  const app = adminMod.apps?.length ? adminMod.app() : adminMod.initializeApp();
  const auth = app.auth();
  const db = app.firestore();

  const outDir = opts.outDir;
  mkdirSync(outDir, { recursive: true });

  const { summary, candidates, excluded } = await scanAnonymousCandidates({ auth, db, opts });

  const manifestJson = JSON.stringify({ summary, candidates }, null, 2);
  const sha256 = crypto.createHash('sha256').update(manifestJson).digest('hex');
  writeFileSync(join(outDir, 'dryrun-summary.json'), JSON.stringify({ ...summary, manifestSha256: sha256 }, null, 2));
  writeFileSync(join(outDir, 'dryrun-candidates.json'), manifestJson);
  writeFileSync(join(outDir, 'dryrun-excluded.json'), JSON.stringify(excluded, null, 2));
  console.log(JSON.stringify({ ...summary, manifestSha256: sha256, outDir }, null, 2));
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('firestore-anon-cleanup-dryrun.mjs')) {
  runCli().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
