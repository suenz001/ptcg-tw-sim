/**
 * v6.096 守衛：`.svelte` 從 `$lib/game/*` 具名 import 的每個名字，該模組都必須真的有 export。
 *
 * ⚠ 為什麼要這支：v6.095 的 vite build 直接紅掉（"twoCardStadiumSide is not exported by engine.ts"），
 *   但**完整 npm test 全綠** —— 測試鏈只跑 `.ts` 與字串比對，沒有人做 `.svelte` 的 named-import 解析，
 *   `test-ts2304-scan` 也只掃 143 個 `.ts`。這種錯誤只有在 GitHub Actions build 那一步才會炸，
 *   一次來回要 3~5 分鐘，而且 deploy 會被 skip。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass = 0, fail = 0;
const bad = [];

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (f.endsWith('.svelte')) out.push(p);
  }
  return out;
}

/** 收集一個 .ts 模組對外 export 的名字（含 re-export） */
function exportedNames(tsPath) {
  const src = readFileSync(tsPath, 'utf8');
  const names = new Set();
  for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|var|class|type|interface|enum)\s+([A-Za-z0-9_$]+)/gm)) names.add(m[1]);
  // export { a, b as c, type D }
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const piece of m[1].split(',')) {
      const t = piece.trim().replace(/^type\s+/, '');
      if (!t) continue;
      const asIdx = t.indexOf(' as ');
      names.add((asIdx >= 0 ? t.slice(asIdx + 4) : t).trim());
    }
  }
  return names;
}

const svelteFiles = walk(join(ROOT, 'src/routes')).concat(
  (() => { try { return walk(join(ROOT, 'src/lib/components')); } catch { return []; } })());
ok(svelteFiles.length > 0, `找得到 .svelte 檔（${svelteFiles.length} 個）`);

const modCache = new Map();
for (const f of svelteFiles) {
  const src = readFileSync(f, 'utf8');
  // import { ... } from '$lib/game/xxx'  （只查 $lib/game 底下的自家模組）
  // ⚠ 用 [^{}]* 而不是 [\s\S]*? —— 後者會跨過相鄰的 import 陳述，把別的模組的名字算到這個模組頭上（假陽性）。
  for (const m of src.matchAll(/import\s+(type\s+)?\{([^{}]*)\}\s*from\s*'(\$lib\/game\/[^']+)'/g)) {
    const isTypeOnly = !!m[1];
    const modSpec = m[3];
    const rel = modSpec.replace('$lib/', 'src/lib/');
    let tsPath = join(ROOT, rel + '.ts');
    try { statSync(tsPath); } catch { try { statSync(join(ROOT, rel, 'index.ts')); tsPath = join(ROOT, rel, 'index.ts'); } catch { continue; } }
    if (!modCache.has(tsPath)) modCache.set(tsPath, exportedNames(tsPath));
    const exported = modCache.get(tsPath);
    // ⚠ 一定要**先整段剝掉行尾註解再 split(',')** —— 註解寫在逗號後面時，
    //   `a,   // 說明\n  b,` 會被 split 成 ['a', '   // 說明\n  b'] ，
    //   若先 split 再 `split('//')[0]` 就會把**下一個名字連同註解一起丟掉**（守衛靜默漏檢）。
    for (let piece of m[2].replace(/\/\/[^\n]*/g, '').split(',')) {
      piece = piece.trim();
      if (!piece) continue;
      const typePrefixed = /^type\s+/.test(piece);
      piece = piece.replace(/^type\s+/, '');
      const name = (piece.includes(' as ') ? piece.split(' as ')[0] : piece).trim();
      if (!name || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) continue;
      if (isTypeOnly || typePrefixed) continue;   // type-only import 被 esbuild 抹掉，不影響 build
      if (!exported.has(name)) bad.push(`${f.replace(ROOT, '')} ← '${name}' 不在 ${modSpec} 的 export 清單裡`);
    }
  }
}

function ok(c, l) { if (c) pass++; else { fail++; console.log('  FAIL:', l); } }
ok(bad.length === 0, `⭐ 所有 .svelte 的具名 import 都真的有被 export（否則 vite build 會紅、deploy 被 skip）\n     ${bad.join('\n     ')}`);
// 負對照：確認掃描器真的有在解析（不是空跑）
ok(modCache.size > 0, `負對照：確實有解析到 $lib/game 模組（${modCache.size} 個）`);

console.log(`svelte→engine 具名 export 一致性：PASS ${pass} / FAIL ${fail}`);
if (fail > 0) process.exit(1);
