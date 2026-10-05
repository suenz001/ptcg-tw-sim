// ⭐v6.479 首頁網頁版（≥1024px）右欄「錦標賽動態」小卡的純函式（站長：「依你的建議處理」第 4 項）。
//
// 資料來源：伺服器 v1.55 新增的免登入端點 GET /api/home/tourn-summary（只回公開資訊，見 server_admin_patch.js 的 v155 哨兵）。
//   ・首頁不載 Firebase Auth（v5.971 起首屏不帶 firebase），所以不能用要身分的 /api/tournament/event。
//   ・回應必須帶哨兵 homeTournApi:1 且 events 是陣列，否則一律當「沒有資料」⇒ 整張卡不顯示（fail-open）：
//     舊伺服器（404）、測試站（沒有 API，回 HTML）、逾時、壞回應都一樣。
//   ・只在網頁版抓（手機版面沒有這張卡 ⇒ 手機一發都不多）；載入完首屏之後才抓，不擋畫面。

export const HOME_TOURN_URL = '/api/home/tourn-summary';
/** 逾時上限：抓不到就算了，絕不讓這張卡拖住任何東西 */
export const HOME_TOURN_TIMEOUT_MS = 6000;
/** 最多顯示幾場 */
export const HOME_TOURN_MAX = 3;

export type HomeTournEvent = {
  name: string;
  status: string;
  regCount: number;
  maxPlayers: number | null;
  registrationCloseAt: number | null;
  currentRound: number;
  community: boolean;
};

/** 顯示順序：進行中 → 簽到中 → 賽程已公布 → 報名中（同階維持伺服器順序＝建立時間早的在前） */
const RANK: Record<string, number> = { running: 0, checkin: 1, bracket_ready: 2, registration: 3 };

/** 階段文字（與錦標賽大廳 tStatusLabel 用語一致） */
export function homeTournStatusLabel(ev: Pick<HomeTournEvent, 'status' | 'currentRound'>): string {
  switch (ev.status) {
    case 'running': return ev.currentRound > 0 ? `進行中・第 ${ev.currentRound} 輪` : '進行中';
    case 'checkin': return '簽到中';
    case 'bracket_ready': return '賽程已公布';
    case 'registration': return '報名中';
    default: return '';
  }
}

/** 報名人數文字：有上限顯示「12 / 32 人」，沒有上限顯示「12 人」 */
export function homeTournCountLabel(ev: Pick<HomeTournEvent, 'regCount' | 'maxPlayers'>): string {
  return ev.maxPlayers && ev.maxPlayers > 0 ? `${ev.regCount} / ${ev.maxPlayers} 人` : `${ev.regCount} 人`;
}

/** 台灣時間（UTC+8，固定偏移、不依賴執行環境時區）的 HH:MM；0／缺席回空字串 */
export function formatHmTW(ms: number | null | undefined): string {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '';
  const d = new Date(n + 8 * 3600 * 1000);
  return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
}

/** 驗證並整理伺服器回應。形狀不對一律回 null（＝不顯示卡片）。 */
export function parseHomeTournSummary(raw: unknown): HomeTournEvent[] | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.homeTournApi !== 1 || !Array.isArray(r.events)) return null;
  const out: HomeTournEvent[] = [];
  for (const e of r.events as unknown[]) {
    if (!e || typeof e !== 'object') continue;
    const x = e as Record<string, unknown>;
    const status = typeof x.status === 'string' ? x.status : '';
    if (!(status in RANK)) continue;   // draft／finished／未知階段不顯示
    const name = typeof x.name === 'string' ? x.name.trim() : '';
    if (!name) continue;
    out.push({
      name: name.slice(0, 60),
      status,
      regCount: Math.max(0, Math.floor(Number(x.regCount) || 0)),
      maxPlayers: Number(x.maxPlayers) > 0 ? Math.floor(Number(x.maxPlayers)) : null,
      registrationCloseAt: Number(x.registrationCloseAt) > 0 ? Number(x.registrationCloseAt) : null,
      currentRound: Math.max(0, Math.floor(Number(x.currentRound) || 0)),
      community: x.community === true,
    });
  }
  // 穩定排序：Array.prototype.sort 自 ES2019 起保證穩定 ⇒ 同階維持伺服器順序
  out.sort((a, b) => RANK[a.status] - RANK[b.status]);
  return out.slice(0, HOME_TOURN_MAX);
}

/** 抓一次摘要；任何失敗都回 null。fetchImpl 可注入（守衛用）。 */
export async function fetchHomeTournSummary(fetchImpl: typeof fetch = fetch, timeoutMs = HOME_TOURN_TIMEOUT_MS): Promise<HomeTournEvent[] | null> {
  const ac = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => { try { ac?.abort(); } catch { /* */ } }, timeoutMs);
  try {
    const res = await fetchImpl(HOME_TOURN_URL, { cache: 'no-store', signal: ac?.signal, headers: { Accept: 'application/json' } });
    if (!res || !res.ok) return null;
    const ct = String(res.headers?.get?.('content-type') || '');
    if (!ct.includes('json')) return null;   // 測試站／靜態主機回 HTML（404 頁）⇒ 不解析
    return parseHomeTournSummary(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
