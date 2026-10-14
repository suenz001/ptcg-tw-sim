// ⭐v6.567 首頁「版本更新記錄」只給玩家看每一版的大標題（站長 2026-10-14）：
//   「首頁的changelog，每版的更新紀錄有分大標題和小字 我認為只要讓大字讓玩家們看就好，小字這些太細節的內容不用給玩家看」
//   ・資料檔（static/changelog.html／changelog-bodies.html／changelog-archive.html）維持完整內容（標題＋摘要＋細節），
//     admin「📋 更新記錄」分頁讀同一份資料顯示完整版；玩家端只在**顯示時**轉成「版本＋大標題」。
//   ・<details data-internal="1"> ＝ 與遊戲內容無關的內部維護版本 ⇒ 玩家端整則不顯示（admin 照樣看得到）。
//   ・<details data-dup="1"> ＝ 同一版的第二份舊紀錄（v6.07x～v6.099 有短版與長版兩份）⇒ 玩家端只顯示第一份。
//   ・純字串處理、零 import ⇒ 首頁不多載任何東西；不認得的內容（封存連結等）原樣保留。
//   ⚠ 只處理我們自己 repo 裡的靜態檔（或 admin 自己寫的覆蓋內容），不是外部輸入；標題內的 HTML（例如 <span>）原樣保留。

/** 一則更新：版本、大標題（HTML）、是否為內部版本。 */
export interface ChangelogTitle { ver: string; titleHtml: string; internal: boolean; dup: boolean }

const DETAILS_RE = /<details\b([^>]*)>([\s\S]*?)<\/details>/g;

/** 沒有 <b> 大標題的舊格式：取摘要純文字的第一句（最多 40 字）。資料檔已全部補上標題，這只是保險。 */
function fallbackTitle(summaryInner: string, ver: string): string {
  const text = summaryInner.replace(/<span class="ver-badge">[^<]*<\/span>/, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  const t = text.startsWith(ver) ? text.slice(ver.length).trim() : text;
  const first = t.split(/[。：:！!]/)[0] || t;
  return first.length > 40 ? first.slice(0, 40) + '…' : first;
}

/**
 * 大標題＝版本徽章後面緊接的那個 <b>…</b>（含巢狀 <b>：依深度配對到對應的 </b>，不會在內層的 </b> 截斷）。
 * 徽章後面不是 <b>（舊格式，粗體在句子中間）⇒ 回 null，改走 fallbackTitle（不把句中的粗體片段誤當標題）。
 */
function leadingTitle(summaryInner: string): string | null {
  const m = /^\s*(?:<span class="ver-badge">[^<]*<\/span>)?\s*<b>/.exec(summaryInner);
  if (!m) return null;
  const tagRe = /<(\/?)b>/g;
  tagRe.lastIndex = m[0].length;
  let depth = 1;
  for (let t = tagRe.exec(summaryInner); t; t = tagRe.exec(summaryInner)) {
    depth += t[1] ? -1 : 1;
    if (depth === 0) return summaryInner.slice(m[0].length, t.index).trim();
  }
  return null;   // 沒有配對的 </b>（資料壞掉）⇒ 交給 fallback
}

/** 從一段 changelog HTML 抽出每一則的版本與大標題（依原順序）。 */
export function parseChangelogTitles(html: string): ChangelogTitle[] {
  const out: ChangelogTitle[] = [];
  for (const m of String(html || '').matchAll(DETAILS_RE)) {
    const attrs = m[1] || '';
    const sm = /<summary>([\s\S]*?)<\/summary>/.exec(m[2] || '');
    if (!sm) continue;
    const verM = /<span class="ver-badge">([^<]*)<\/span>/.exec(sm[1]);
    const ver = verM ? verM[1].trim() : '';
    const title = leadingTitle(sm[1]);
    out.push({ ver, titleHtml: title ?? fallbackTitle(sm[1], ver), internal: /\bdata-internal\s*=\s*"1"/.test(attrs), dup: /\bdata-dup\s*=\s*"1"/.test(attrs) });
  }
  return out;
}

/**
 * 玩家端顯示用：把每一則 <details>（標題＋摘要＋可展開的細節）換成只有「版本＋大標題」的一行，內部版本整則拿掉；
 * 其餘內容（封存連結、註解）原樣保留。
 */
export function changelogTitlesOnly(html: string): string {
  return String(html || '').replace(DETAILS_RE, (_all, attrs: string, inner: string) => {
    const [t] = parseChangelogTitles('<details' + attrs + '>' + inner + '</details>');
    if (!t || t.internal || t.dup) return '';
    return '<div class="log-item"><span class="ver-badge">' + t.ver + '</span> <b>' + t.titleHtml + '</b></div>';
  });
}
