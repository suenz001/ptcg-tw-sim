// 僅由 GitHub Pages 發布步驟呼叫；正式站 npm run build 不執行本檔。
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { load } from 'cheerio';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const META = '<meta name="robots" content="noindex, follow">';

export function noindexHtml(html) {
  // 用 HTML parser 的位置做局部編輯，保留 Svelte hydration 註記與其餘原始 bytes。
  const $ = load(html, { sourceCodeLocationInfo: true });
  const edits = [];
  $('meta').each((_i, el) => {
    if (String($(el).attr('name') || '').trim().toLowerCase() !== 'robots') return;
    const loc = el.sourceCodeLocation;
    if (!loc) throw new Error('robots 標籤缺少來源位置');
    edits.push({ from: loc.startOffset, to: loc.endOffset, text: '' });
  });
  const head = $('head')[0]?.sourceCodeLocation;
  const htmlTag = $('html')[0]?.sourceCodeLocation;
  if (head?.startTag) {
    edits.push({ from: head.startTag.endOffset, to: head.startTag.endOffset, text: META });
  } else if (htmlTag?.startTag) {
    edits.push({ from: htmlTag.startTag.endOffset, to: htmlTag.startTag.endOffset, text: '<head>' + META + '</head>' });
  } else {
    // changelog 等 HTML 片段作為獨立網址開啟時，也必須在隱含 head 內有 noindex。
    const at = /^\s*<!doctype\b[^>]*>/i.exec(html)?.[0].length || 0;
    edits.push({ from: at, to: at, text: META });
  }
  let out = html;
  for (const e of edits.sort((a, b) => b.from - a.from)) out = out.slice(0, e.from) + e.text + out.slice(e.to);
  const check = load(out);
  const tags = check('head meta').filter((_i, el) => String(check(el).attr('name') || '').toLowerCase() === 'robots');
  if (tags.length !== 1 || tags.attr('content') !== 'noindex, follow') throw new Error('noindex head 驗證失敗');
  return out;
}

export function protectTestBuild(buildDir) {
  const plans = [];
  function walk(dir) {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      if (item.isSymbolicLink()) throw new Error('建置目錄不可包含連結：' + item.name);
      const file = join(dir, item.name);
      if (item.isDirectory()) walk(file);
      else if (item.isFile() && /\.html$/i.test(item.name)) {
        const before = readFileSync(file, 'utf8');
        // Google 擁有權驗證檔必須保持原文；僅認檔名與單行驗證內容精確相符者。
        if (/^google[0-9a-f]+\.html$/.test(item.name) && before.trim() === 'google-site-verification: ' + item.name) continue;
        plans.push({ file, before, after: noindexHtml(before) });
      }
    }
  }
  walk(buildDir);
  if (!plans.length) throw new Error('找不到建置 HTML，拒絕發布未驗證的測試站');
  // 先完成全站轉換與驗證，再寫回；任一錯誤直接讓 CI 停止、不上傳 artifact。
  for (const p of plans) if (p.before !== p.after) writeFileSync(p.file, p.after);
  return plans.length;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const count = protectTestBuild(join(ROOT, 'build'));
  console.log('[test-site] 已驗證 ' + count + ' 份 HTML：noindex, follow');
}
