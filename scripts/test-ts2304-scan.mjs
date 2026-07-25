// v6.020（Fable 規劃）：TS2304「找不到名稱」全站掃描器 — 永久封死「用中央 helper 忘 import」這類
//   runtime ReferenceError 炸彈（esbuild/vite 不做型檢照樣 bundle → 走到執行點才炸，測試鏈抓不到）。
//   用 TypeScript compiler API + 獨立 minimal tsconfig（不依賴 .svelte-kit sync）。TS2304 必須 0。
//   ⚠只 filter code 2304（未定義名稱）；其他型別 diagnostics（$app 虛擬模組 TS2307 等）忽略。
import ts from 'typescript';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
function walk(dir){ const o=[]; for(const e of readdirSync(dir)){ const p=join(dir,e); if(statSync(p).isDirectory())o.push(...walk(p)); else if(e.endsWith('.ts'))o.push(p); } return o; }
// v6.022：掃描範圍擴到整個 src/lib（原只有 game/cards）——通知模組等新檔也納入守衛。
//   實測 125 檔 TS2304=0，無既有 noise。
const files = walk(join(ROOT,'src/lib'));
const options = {
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  baseUrl: ROOT,
  paths: { '$lib/*': ['src/lib/*'], '$app/*': ['.svelte-kit-stub/$app/*'] },
  skipLibCheck: true, noEmit: true, strict: false, allowJs: false,
  types: [], lib: ['lib.es2020.d.ts', 'lib.dom.d.ts'],
};
const program = ts.createProgram(files, options);
const diags = ts.getPreEmitDiagnostics(program);
const ts2304 = diags.filter(d => d.code === 2304);
if (ts2304.length) {
  console.log(`TS2304 掃描：❌ 發現 ${ts2304.length} 處「找不到名稱」（用了未 import 的符號 → runtime ReferenceError 炸彈）\n`);
  for (const d of ts2304) {
    const { line } = d.file.getLineAndCharacterOfPosition(d.start);
    const rel = d.file.fileName.slice(ROOT.length + 1);
    console.log(`  ${rel}:${line + 1} — ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`);
  }
  console.log('\n（修法：補上該符號的 import；helper 多半在 effects/_shared.ts 或 engine.ts）');
  process.exit(1);
}
console.log(`TS2304 掃描：✅ 無「找不到名稱」（掃 ${files.length} 檔）`);
process.exit(0);
