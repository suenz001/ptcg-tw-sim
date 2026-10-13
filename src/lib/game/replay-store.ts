// ⭐v6.560 復盤資料的瀏覽器儲存（IndexedDB）＋檔案匯出入（gzip）。
//
// ⚠ 為什麼不是玩家建議的 cookie：cookie 一個上限 4KB，而且每一次連線都會被送到伺服器；
//   一場復盤壓縮後約 30～60KB ⇒ 用瀏覽器自己的資料庫（IndexedDB），效果一樣是「不用另外存檔」。
// ⭐ 站長裁定保留最近 10 場（MAX_SAVED_REPLAYS）。
// ⭐ 進行中的對局另存一份（IN_PROGRESS_ID），中途重新整理頁面時可以接著記，不會只剩後半場。
//
// 所有函式都不會 throw：瀏覽器不支援／私密模式寫不進去 ⇒ 回 null／false，呼叫端照常運作。

import { validateReplayData, type ReplayData, type ReplayMeta, type ReplayStep } from './replay-record';

export const MAX_SAVED_REPLAYS = 10;
const DB_NAME = 'ptcg-tw-sim-replays';
const STORE = 'replays';
const IN_PROGRESS_ID = '__in_progress__';

export interface SavedReplayInfo { id: string; meta: ReplayMeta; bytes: number }

// ── gzip（瀏覽器內建 CompressionStream；沒有就存原文）──────────────────────────
export async function gzipText(text: string): Promise<Uint8Array> {
  const raw = new TextEncoder().encode(text);
  if (typeof CompressionStream === 'undefined') return raw;
  try {
    const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch { return raw; }
}
/** gzip 或原文都能讀（看前兩個位元組 1f 8b）。 */
export async function gunzipText(bytes: Uint8Array): Promise<string> {
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') throw new Error('這個瀏覽器太舊，無法讀取壓縮的復盤檔');
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).text();
  }
  return new TextDecoder().decode(bytes);
}

/** 檔案（下載的復盤檔，或玩家自己解壓的 JSON）→ 復盤資料；不合格回 { error }。 */
export async function parseReplayBytes(bytes: Uint8Array): Promise<{ data: ReplayData } | { error: string }> {
  let text: string;
  try { text = await gunzipText(bytes); } catch (e) { return { error: e instanceof Error ? e.message : '無法解壓縮' }; }
  let obj: unknown;
  try { obj = JSON.parse(text); } catch { return { error: '檔案不是有效的復盤檔（格式錯誤）' }; }
  const why = validateReplayData(obj);
  return why ? { error: why } : { data: obj as ReplayData };
}

// ── IndexedDB ────────────────────────────────────────────────────────────
function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' }); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
}
function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | null> {
  return new Promise((resolve) => {
    try {
      const t = db.transaction(STORE, mode);
      const s = t.objectStore(STORE);
      const r = fn(s);
      t.oncomplete = () => resolve(r ? (r.result as T) : null);
      t.onerror = () => resolve(null);
      t.onabort = () => resolve(null);
    } catch { resolve(null); }
  });
}
interface Row { id: string; meta?: ReplayMeta; gz: Uint8Array; savedAt: number; gameId?: string }

/** 存一場完成的復盤；超過 10 場就刪最舊的。同一局（gameId）重複存只留一份。回傳存檔 id。 */
export async function saveReplay(data: ReplayData): Promise<string | null> {
  const db = await openDb(); if (!db) return null;
  try {
    const gz = await gzipText(JSON.stringify(data));
    const all = ((await tx<Row[]>(db, 'readonly', (s) => s.getAll() as IDBRequest<Row[]>)) ?? []).filter((r) => r.id !== IN_PROGRESS_ID);
    const id = 'r_' + data.meta.savedAt + '_' + String(data.meta.gameId).slice(0, 12);
    const dupes = all.filter((r) => r.meta?.gameId === data.meta.gameId).map((r) => r.id);
    const keep = all.filter((r) => !dupes.includes(r.id)).sort((a, b) => b.savedAt - a.savedAt);
    const drop = keep.slice(MAX_SAVED_REPLAYS - 1).map((r) => r.id);
    await tx(db, 'readwrite', (s) => {
      for (const x of [...dupes, ...drop]) s.delete(x);
      s.put({ id, meta: data.meta, gz, savedAt: data.meta.savedAt } as Row);
      s.delete(IN_PROGRESS_ID);
    });
    return id;
  } finally { db.close(); }
}

/** 最近的復盤（新→舊），只回摘要。 */
export async function listReplays(): Promise<SavedReplayInfo[]> {
  const db = await openDb(); if (!db) return [];
  try {
    const all = ((await tx<Row[]>(db, 'readonly', (s) => s.getAll() as IDBRequest<Row[]>)) ?? []).filter((r) => r.id !== IN_PROGRESS_ID && r.meta);
    return all.sort((a, b) => b.savedAt - a.savedAt).slice(0, MAX_SAVED_REPLAYS).map((r) => ({ id: r.id, meta: r.meta as ReplayMeta, bytes: r.gz?.byteLength ?? 0 }));
  } finally { db.close(); }
}

export async function loadReplay(id: string): Promise<ReplayData | null> {
  const db = await openDb(); if (!db) return null;
  try {
    const row = await tx<Row>(db, 'readonly', (s) => s.get(id) as IDBRequest<Row>);
    if (!row?.gz) return null;
    const r = await parseReplayBytes(new Uint8Array(row.gz));
    return 'data' in r ? r.data : null;
  } catch { return null; } finally { db.close(); }
}

export async function deleteReplay(id: string): Promise<boolean> {
  const db = await openDb(); if (!db) return false;
  try { await tx(db, 'readwrite', (s) => { s.delete(id); }); return true; } finally { db.close(); }
}

/** 進行中的對局：存目前為止的步驟（只留一份，換局就覆蓋）。 */
export async function saveInProgress(gameId: string, steps: ReplayStep[]): Promise<void> {
  const db = await openDb(); if (!db) return;
  try {
    const gz = await gzipText(JSON.stringify(steps));
    await tx(db, 'readwrite', (s) => { s.put({ id: IN_PROGRESS_ID, gameId, gz, savedAt: Date.now() } as Row); });
  } catch { /* 寫不進去就算了 */ } finally { db.close(); }
}
/** 重新整理後接著記：只有同一局（gameId 相同）才拿得到。 */
export async function loadInProgress(gameId: string): Promise<ReplayStep[] | null> {
  const db = await openDb(); if (!db) return null;
  try {
    const row = await tx<Row>(db, 'readonly', (s) => s.get(IN_PROGRESS_ID) as IDBRequest<Row>);
    if (!row?.gz || row.gameId !== gameId) return null;
    const arr = JSON.parse(await gunzipText(new Uint8Array(row.gz)));
    return Array.isArray(arr) ? (arr as ReplayStep[]) : null;
  } catch { return null; } finally { db.close(); }
}

/** 下載復盤檔（gzip 壓縮的 JSON）。 */
export async function downloadReplayFile(data: ReplayData): Promise<void> {
  const gz = await gzipText(JSON.stringify(data));
  const d = new Date(data.meta.savedAt);
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  const safe = (s: string | null) => String(s ?? '?').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 16);
  const url = URL.createObjectURL(new Blob([gz as BlobPart], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `復盤-${safe(data.meta.p1name)}-vs-${safe(data.meta.p2name)}-${ymd}.ptcgreplay`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
