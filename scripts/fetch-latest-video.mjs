/**
 * v6.166 首頁「最新影片」— 建置時抓一次 YouTube 頻道 RSS，寫進 src/lib/home-video.json。
 *
 * ⭐為什麼是「建置時」而不是 runtime：
 *   站長的優先序是「勿擾民、不增加玩家載入負擔」＞「一定要即時最新」。
 *   ・瀏覽器不能直接抓 YouTube RSS（CORS），所以 runtime 方案一定要多一層代理／後台設定。
 *   ・建置時抓一次 ⇒ 玩家端**對 YouTube 零 runtime 依賴**：YouTube 掛掉、變慢、擋台灣，
 *     首頁都不受影響。
 *   ・站長幾乎每天都會出版；發新片之後只要跟著出下一版，影片就會自動換成最新的，
 *     不必手動貼影片 ID、也不必開後台。
 *
 * ⭐為什麼寫進 src/lib/ 而不是 static/：
 *   這份資料是**建置時就定案**的，runtime 再去 fetch 一次換不到任何即時性，
 *   卻要多一個請求、而且會讓影片區在首繪之後才插進版面（把下面的更新記錄往下推＝CLS）。
 *   改成讓 vite 直接 import 進 bundle：首繪就渲染、零額外請求、零位移。
 *
 * ⭐fail-open 是硬性要求，而且**不可以倒退**（Fable 覆核抓到的破口）：
 *   抓 RSS 失敗時若只退回 repo 內的舊值，會出現「上一版顯示新片 X，這一版 RSS 掛了
 *   ⇒ 站上影片倒退回更舊的那支」。因此候選來源有三個，取 publishedAt 最新的那個：
 *     ① YouTube 頻道 RSS（最新）
 *     ② 正式站現行的 /home-video.json（＝上一次成功發布的值，同網域、必定可達）
 *     ③ repo 內既有的 src/lib/home-video.json（最後保底）
 *   三個全部拿不到才寫空值（首頁整區不顯示）。任何一步都不丟例外、不讓 build 失敗。
 *
 * 用法：`npm run build` 的第一步（見 package.json）。也可單獨執行做人工更新。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ① 給 vite 直接 import 進 bundle 的那份（玩家端唯一實際用到的）
const OUT = join(ROOT, 'src/lib/home-video.json');
// ② 同一份內容也發佈成靜態檔。**玩家端不會去讀它**，它只有一個用途：
//    當作「上一次成功發布的值」，讓下一次 build 在 YouTube 抓不到時有東西可退，
//    不會退回 repo 內愈來愈舊的基準（Fable 覆核抓到的「fail-open 會倒退」破口）。
const OUT_PUBLIC = join(ROOT, 'static/home-video.json');

// 頻道 @ptcg-tw-sim 的 channelId（2026-08-11 從頻道頁 HTML 取得，並以 RSS 回傳的 yt:channelId 交叉驗證）
export const CHANNEL_ID = 'UCddJpPmz3z66MHTRpuVr17A';
const FEED = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`;
const LIVE_JSON = 'https://www.ptcg-tw-sim.com/home-video.json';
const TIMEOUT_MS = 12000;

/** 從 Atom feed 取出「第一個 entry」= 最新影片。純字串解析，不引入 XML 套件。 */
export function parseLatestEntry(xml) {
  if (typeof xml !== 'string' || !xml.includes('<entry>')) return null;
  const entry = xml.slice(xml.indexOf('<entry>'), xml.indexOf('</entry>') + 8);
  const pick = (tag) => {
    const m = entry.match(new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>'));
    return m ? m[1].trim() : '';
  };
  return normalize({ videoId: pick('yt:videoId'), title: decodeEntities(pick('title')), publishedAt: pick('published') });
}

/** 一律過同一道閘：影片 ID 必須是 11 碼的 [A-Za-z0-9_-]，否則當作沒拿到。 */
export function normalize(o) {
  const videoId = typeof o?.videoId === 'string' ? o.videoId : '';
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
  return {
    videoId,
    title: typeof o.title === 'string' ? o.title : '',
    publishedAt: typeof o.publishedAt === 'string' ? o.publishedAt : '',
  };
}

/** RSS 標題會做 XML escape（例如 &amp;、&quot;），寫進 JSON 前還原成原字。 */
export function decodeEntities(s) {
  return String(s)
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

/** 從候選中挑 publishedAt 最新的一個 —— 這是「絕不倒退」的唯一判準。 */
export function pickNewest(candidates) {
  const ok = candidates.filter(Boolean);
  if (!ok.length) return null;
  const ts = (o) => {
    const t = Date.parse(o.publishedAt || '');
    return Number.isFinite(t) ? t : -1;
  };
  return ok.reduce((best, c) => (ts(c) > ts(best) ? c : best));
}

async function getJson(url) {
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    const res = await fetch(url, { signal: ac.signal, headers: { 'user-agent': UA } });
    clearTimeout(timer);
    if (!res.ok) return null;
    return normalize(await res.json());
  } catch {
    return null;
  }
}

const UA = 'ptcg-tw-sim-build/1.0 (+https://www.ptcg-tw-sim.com)';

async function getRss() {
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    const res = await fetch(FEED, { signal: ac.signal, headers: { 'user-agent': UA } });
    clearTimeout(timer);
    if (!res.ok) {
      console.log(`[home-video] RSS HTTP ${res.status}`);
      return null;
    }
    return parseLatestEntry(await res.text());
  } catch (e) {
    console.log('[home-video] RSS 抓取失敗：' + (e?.message || e));
    return null;
  }
}

function readExisting() {
  try {
    if (!existsSync(OUT)) return null;
    return normalize(JSON.parse(readFileSync(OUT, 'utf8')));
  } catch {
    return null;
  }
}

function writeBoth(o) {
  const text = JSON.stringify(o, null, 2) + '\n';
  writeFileSync(OUT, text, 'utf8');
  writeFileSync(OUT_PUBLIC, text, 'utf8');
}

async function main() {
  const existing = readExisting();
  const [rss, live] = await Promise.all([getRss(), getJson(LIVE_JSON)]);
  if (!rss) console.log('[home-video] 改用備援來源（正式站現行值／repo 既有值），fail-open 不中斷 build');
  const next = pickNewest([rss, live, existing]);

  if (!next) {
    writeBoth({ videoId: '', title: '', publishedAt: '' });
    console.log('[home-video] 三個來源都取不到 → 寫入空值（首頁整區不顯示）');
    return;
  }
  writeBoth(next);
  const src = next === rss ? 'YouTube RSS' : next === live ? '正式站現行值' : 'repo 既有值';
  console.log(`[home-video] 採用（${src}）：${next.videoId}（${next.title || '無標題'}）`);
}

// 直接執行時才跑（被守衛 import 取用純函式時不執行）
if (process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('scripts/fetch-latest-video.mjs')) {
  await main();
}
