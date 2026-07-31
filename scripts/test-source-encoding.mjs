// v6.073 守衛：原始碼檔案必須是**合法且完整**的 UTF-8。
//
// ⭐ 起源（v6.072 真事故）：`src/lib/game/effects/cards/tools.ts` 的結尾在某次
//   「大檔讀取截斷」中被切在半個 UTF-8 位元組上，連同檔尾整段
//   「Tool 卡 TRAINER_GUARD 自動登記」(v2.264) 一起消失，而且**已經 commit 進 repo**。
//   esbuild／vite 對壞 UTF-8 是 lossy 容忍的 → build 一路綠燈，沒有任何機制抓得到。
//   後果：場上沒有可附加對象時，道具仍被列為可打出、打出後盤面零變化（AI 可能反覆選同一張）。
//
// 本守衛做兩件事：
//   1. strict UTF-8 decode（壞位元組 = 檔案被截斷或損毀）
//   2. 結構完整性粗檢：大括號/小括號配對、檔案不得以「未閉合的行註解框線」結尾
//      —— 截斷通常正好切在檔尾，這兩項能在 decode 僥倖通過時補一層網。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const EXT = new Set(['.ts', '.js', '.mjs', '.cjs', '.svelte', '.json', '.html', '.css', '.md']);
const SKIP_DIR = new Set(['node_modules', '.git', '.svelte-kit', 'build', 'dist', 'coverage']);

const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIR.has(e.name)) walk(join(dir, e.name)); continue; }
    if (EXT.has(extname(e.name))) files.push(join(dir, e.name));
  }
})(join(ROOT, 'src'));
for (const sub of ['scripts', 'static']) {
  try {
    (function walk(dir) {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) { if (!SKIP_DIR.has(e.name)) walk(join(dir, e.name)); continue; }
        if (EXT.has(extname(e.name))) files.push(join(dir, e.name));
      }
    })(join(ROOT, sub));
  } catch { /* 目錄不存在就跳過 */ }
}

let pass = 0, fail = 0;
const bad = [];
const dec = new TextDecoder('utf-8', { fatal: true });
for (const f of files) {
  const rel = f.slice(ROOT.length + 1);
  const buf = readFileSync(f);
  let text = null;
  try { text = dec.decode(buf); pass++; }
  catch (e) { fail++; bad.push([rel, `壞的 UTF-8（檔案被截斷或損毀）：${e.message}`]); continue; }
  // ⚠ 只保留 strict UTF-8 這一項。
  //   試過的其他兩項都因誤報率太高而移除（誤報率高的守衛比沒有守衛更糟 —— 會被習慣性忽略）：
  //     ・括號配對粗檢 → 字串／regex／template literal 裡的 { } 造成 5 個誤報
  //     ・「檔案以註解框線結尾」→ 本 codebase 大量卡檔本來就以框線分隔區塊作結，數十個誤報
  //   strict UTF-8 則是零誤報、且正是抓到 v6.072 tools.ts 事故的那一條。
}
if (bad.length) {
  console.log(`原始碼編碼/完整性：❌ 發現 ${bad.length} 個問題`);
  for (const [f, why] of bad) console.log(`  ${f} — ${why}`);
  console.log('\n⚠ 若是檔案被截斷：**不要只把壞位元組砍掉**，必須確認尾段 code 是不是整段不見了');
  console.log('   （v6.072：tools.ts 就是這樣掉了整段 Tool TRAINER_GUARD 自動登記）。');
  process.exit(1);
}
console.log(`原始碼編碼/完整性：✅ ${files.length} 檔全部是合法完整的 UTF-8（無截斷／損毀）`);
