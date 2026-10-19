// 測試站搜尋排除：真正 HTML parser、磁碟目錄與 CI 接線；不寫產品與正式站。
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { load } from 'cheerio';
import { readBaseBlob, hasBaseCommit, shallowSkip } from './lib/base-blob.mjs';
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BASE = '4101927dcc120789f1f27b52c9d63b9784569030';
const SCRIPT = 'scripts/set-test-site-noindex.mjs';
const WF = '.github/workflows/deploy.yml';
const rd = p => readFileSync(join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
const ok = (name, yes, detail = '') => { if (yes) { pass++; console.log('PASS ' + name); } else { fail++; console.error('FAIL ' + name + ' ' + detail); } };
const scratch = mkdtempSync(join(tmpdir(), 'ptcg-v6591-'));
const samples = {
  'index.html': '<!doctype html><html lang="zh-Hant"><head><title>主頁</title><meta name="robots" content="index, follow"></head><body><!--[--><p>內容</p><!--]--><script>const x="<head>字串</head>";</script></body></html>',
  'card/123/index.html': '<html><head><meta content="index" NAME="ROBOTS"><meta name="googlebot" content="index,follow"></head><body>卡片</body></html>',
  '404.html': '<html><head></head><body>找不到頁面</body></html>',
  'nested/UPPER.HTML': '<html><body>大寫副檔名</body></html>',
  'changelog.html': '<details open><summary>v6.590</summary><div>更新內容</div></details>',
  'doctype-fragment.html': '<!DOCTYPE html><p>片段</p>',
  'duplicate.html': '<html><head><meta name="robots" content="index"><meta name="robots" content="noindex"></head><body>重複</body></html>',
  'googleabc123.html': 'google-site-verification: googleabc123.html\n',
  'googlebad123.html': '<html><head></head><body>這不是驗證檔</body></html>',
  '_app/example.js': 'console.log("不可改動");',
  'robots.txt': 'User-agent: *\nAllow: /\n',
};
const contentFiles = Object.keys(samples).filter(p => /\.html$/i.test(p) && p !== 'googleabc123.html');
function seed(dir) { for (const [p, s] of Object.entries(samples)) { const f = join(dir, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, s); } }
function indexed(html) { const $ = load(html); const tags = $('head meta').filter((_i, e) => String($(e).attr('name') || '').toLowerCase() === 'robots'); return tags.length === 1 && tags.attr('content') === 'noindex, follow'; }
function wiring(wf, pkg) {
  const block = wf.replace(/^\s*#[^\n]*$/gm, '').split(/^  deploy:/m)[0];
  const steps = block.split(/^      - /m).slice(1);
  const positions = steps.flatMap((s, i) => /^        run: node scripts\/set-test-site-noindex\.mjs\s*$/m.test(s) ? [i] : []);
  const build = steps.findIndex(s => /^        run: npm run build\s*$/m.test(s));
  const upload = steps.findIndex(s => /uses:\s*actions\/upload-pages-artifact@/.test(s));
  const clean = positions.length === 1 && !/^\s*(?:if|continue-on-error):/m.test(steps[positions[0]]);
  return { wired: clean && build >= 0 && positions[0] > build && upload > positions[0], official: !Object.entries(pkg.scripts).some(([k, v]) => k !== 'test' && v.includes('set-test-site-noindex.mjs')) };
}
async function moduleFrom(source, label) {
  const dir = join(scratch, label); mkdirSync(join(dir, 'scripts'), { recursive: true });
  const file = join(dir, SCRIPT);
  // 使用已宣告的 cheerio，讓 temp 副本不依賴工作樹或環境的 node_modules 搜尋路徑。
  writeFileSync(file, source.replace("from 'cheerio'", 'from ' + JSON.stringify(import.meta.resolve('cheerio'))));
  return { dir, file, mod: await import(pathToFileURL(file).href) };
}
async function exercise(mod, label) {
  const dir = join(scratch, label, 'build'); seed(dir);
  const before = Object.fromEntries(Object.keys(samples).map(p => [p, readFileSync(join(dir, p))]));
  let error = ''; try { mod.protectTestBuild(dir); } catch (e) { error = e.message; }
  const facts = {};
  for (const p of contentFiles) facts[p] = !error && indexed(readFileSync(join(dir, p), 'utf8'));
  facts['其餘內容與Svelte註記不變'] = !error && (() => { const out = readFileSync(join(dir, 'index.html'), 'utf8'); return out.includes('<!--[--><p>內容</p><!--]-->') && out.includes('<script>const x="<head>字串</head>";</script>') && out.includes('<title>主頁</title>'); })();
  facts['非HTML與驗證檔不變'] = ['_app/example.js', 'robots.txt', 'googleabc123.html'].every(p => readFileSync(join(dir, p)).equals(before[p]));
  const once = contentFiles.map(p => readFileSync(join(dir, p)));
  try { mod.protectTestBuild(dir); facts['重複執行冪等'] = contentFiles.every((p, i) => readFileSync(join(dir, p)).equals(once[i])); } catch { facts['重複執行冪等'] = false; }
  const empty = join(scratch, label, 'empty'); mkdirSync(empty, { recursive: true });
  try { mod.protectTestBuild(empty); facts['空建置必須失敗'] = false; } catch { facts['空建置必須失敗'] = true; }
  return facts;
}
try {
  const source = rd(SCRIPT), wf = rd(WF), pkg = JSON.parse(rd('package.json'));
  const productBytes = [SCRIPT, WF, 'src/app.html', 'static/robots.txt'].map(p => readFileSync(join(ROOT, p)));
  const main = await moduleFrom(source, 'head');
  const facts = await exercise(main.mod, 'head');
  for (const [n, v] of Object.entries(facts)) ok('功能 ' + n, v);
  const w = wiring(wf, pkg); ok('CI只在建置後、上傳前套用且失敗阻擋發布', w.wired); ok('正式站一般build不呼叫排除腳本', w.official);
  const cli = join(main.dir, 'build');
  const log = execFileSync(process.execPath, [main.file], { cwd: main.dir, encoding: 'utf8' });
  ok('CLI真入口執行並驗證所有內容HTML', log.includes('已驗證 ' + contentFiles.length + ' 份 HTML') && contentFiles.every(p => indexed(readFileSync(join(cli, p), 'utf8'))));
  const mutations = [
    ['index取代noindex', s => s.replace('content="noindex, follow"', 'content="index, follow"'), 'index.html'],
    ['漏深層路徑', s => s.replace('if (item.isDirectory()) walk(file);', 'if (item.isDirectory()) continue;'), 'card/123/index.html'],
    ['漏HTML片段', s => s.replace("text: META });\n  }\n  let out", "text: '' });\n  }\n  let out"), 'changelog.html'],
    ['漏404', s => s.replace("/\\.html$/i.test(item.name)", "/\\.html$/i.test(item.name) && item.name !== '404.html'"), '404.html'],
    ['漏大寫副檔名', s => s.replace('/\\.html$/i.test(item.name)', '/\\.html$/.test(item.name)'), 'nested/UPPER.HTML'],
    ['空建置靜默成功', s => s.replace("if (!plans.length) throw new Error('找不到建置 HTML，拒絕發布未驗證的測試站');", ''), '空建置必須失敗'],
  ];
  for (let i = 0; i < mutations.length; i++) {
    const [name, change, expected] = mutations[i]; const changed = change(source.replace(/\r\n/g, '\n'));
    ok('突變錨點有效 ' + name, changed !== source.replace(/\r\n/g, '\n'));
    const mutant = await moduleFrom(changed, 'mut' + i); const f = await exercise(mutant.mod, 'mut' + i);
    ok('突變被功能斷言抓到 ' + name, f[expected] === false);
    ok('突變正對照仍保留檔案 ' + name, f['非HTML與驗證檔不變']);
  }
  ok('接線突變：漏掉發布步驟必紅', !wiring(wf.replace('run: node scripts/set-test-site-noindex.mjs', 'run: echo skipped'), pkg).wired);
  ok('接線突變：註解假接線不可放行', !wiring(wf.replace('run: node scripts/set-test-site-noindex.mjs', '# run: node scripts/set-test-site-noindex.mjs\n        run: echo skipped'), pkg).wired);
  ok('接線突變：失敗繼續發布必紅', !wiring(wf.replace('run: node scripts/set-test-site-noindex.mjs', 'continue-on-error: true\n        run: node scripts/set-test-site-noindex.mjs'), pkg).wired);
  ok('隔離突變：正式build接入必紅', !wiring(wf, { scripts: { build: 'npm run original && node scripts/set-test-site-noindex.mjs' } }).official);
  ok('N1只改註解不影響功能', indexed(main.mod.noindexHtml(samples['index.html'] + '<!--一般註解-->')));
  const admin = rd('oracle-admin/admin.html');
  const entries = admin.slice(admin.indexOf('const CL_ADMIN_ONLY_ENTRIES ='), admin.indexOf('/** 純函式', admin.indexOf('const CL_ADMIN_ONLY_ENTRIES =')));
  const internal = new Function(entries + '; return CL_ADMIN_ONLY_ENTRIES;')();
  ok('admin包含本版內部維護紀錄', internal.some(e => e.ver === 'v6.591' && e.internal && e.bodyHtml.includes('noindex')));
  if (hasBaseCommit(ROOT, BASE)) {
    const old = readBaseBlob(ROOT, BASE, WF); if (!old.ok) throw Error('讀取BASE workflow失敗');
    ok('HEAD-FAIL 真BASE未接禁收錄步驟', !wiring(old.out, pkg).wired);
    const currentVersion = rd('src/lib/version.ts').match(/VERSION = '([^']+)'/)?.[1];
    if (!currentVersion) throw Error('讀不到產品版本');
    // 僅驗本版維持正式SEO與隱藏紀錄；未來版可正常更新玩家公告與正式SEO。
    const releaseText = (p, version, readCurrent = rd) => {
      if (version === '6.591') return readCurrent(p);
      const released = readBaseBlob(ROOT, '211ab51adb8555390dd1256ecf63db98b8a0e1cd', p);
      if (!released.ok) throw Error('讀取v6.591發布內容失敗 ' + p);
      return released.out;
    };
    for (const p of ['src/app.html', 'static/robots.txt', 'static/changelog.html', 'static/changelog-bodies.html', 'static/changelog-archive.html']) {
      const b = readBaseBlob(ROOT, BASE, p); if (!b.ok) throw Error('讀取BASE失敗 ' + p);
      const before = b.out.replace(/\r\n/g, '\n');
      const unchanged = (version, readCurrent = rd) => releaseText(p, version, readCurrent).replace(/\r\n/g, '\n') === before;
      ok('v6.591正式SEO與公開紀錄不變 ' + p, unchanged(currentVersion));
      ok('未來版新增內容不破壞本版歷史契約 ' + p, unchanged('6.592', () => '未來改版內容'));
      ok('本版額外內容突變必紅 ' + p, !unchanged('6.591', () => before + '\n'));
    }
    const oldScript = readBaseBlob(ROOT, BASE, SCRIPT);
    const oldMod = oldScript.ok ? (await moduleFrom(oldScript.out, 'base')).mod : { noindexHtml: s => s, protectTestBuild: () => 0 };
    const baseFacts = await exercise(oldMod, 'base');
    for (const p of contentFiles) ok('HEAD-FAIL BASE內容頁缺少noindex ' + p, baseFacts[p] === false);
    ok('HEAD-FAIL 舊發布產物首頁／深層／片段都沒有noindex', ['index.html', 'card/123/index.html', 'changelog.html'].every(p => baseFacts[p] === false));
    ok('BASE正對照 原內容、非HTML、驗證檔不變', baseFacts['其餘內容與Svelte註記不變'] && baseFacts['非HTML與驗證檔不變']);
  } else shallowSkip('v6591 BASE反證', '需要6.590歷史');
  ok('產品bytes未被測試改寫', [SCRIPT, WF, 'src/app.html', 'static/robots.txt'].every((p, i) => readFileSync(join(ROOT, p)).equals(productBytes[i])));
} finally {
  const rel = relative(resolve(tmpdir()), resolve(scratch));
  if (!rel || isAbsolute(rel) || rel.startsWith('..') || !rel.startsWith('ptcg-v6591-')) throw Error('拒絕清除非本測試temp路徑');
  rmSync(scratch, { recursive: true, force: true });
}
console.log('測試站搜尋排除：' + pass + ' PASS / ' + fail + ' FAIL');
process.exitCode = fail ? 1 : 0;
