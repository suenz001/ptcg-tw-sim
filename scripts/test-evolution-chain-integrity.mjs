// v6.074 守衛：進化鏈資料完整性（evolvesFrom / stage）。
//
// ⭐ 起源（Wilson 回報 → v6.074）：M6 的超級進化 ex 只有烈箭鷹ex 是對的。
//   根因＝爬蟲把官方 detail 頁的「進化」面板當成進化**順序**，但那個面板列的是
//   **該圖鑑編號的所有卡片**（膽小蟲／具甲武者／具甲武者GX／具甲武者ex／超級具甲武者ex），
//   於是抓成「超級具甲武者ex ← 具甲武者ex」——一張**全站根本不存在**的卡，
//   玩家永遠進化不出來，而且完全沒有任何測試會發現。
//
//   官方頁真正的判準是卡片左上的階段字樣：
//     「基礎」   → 沒有 evolvesFrom
//     「1階進化」→ evolvesFrom = 該編號進化清單中的【基礎】那張
//     「2階進化」→ evolvesFrom = 清單中的【1階進化】那張
//
// 三條檢查（只掃 live 卡包的 H/I/J，與全站維護範圍一致）：
//   A. evolvesFrom 指向的卡名在全站寶可夢中**不存在** → 這張進化卡永遠打不出來
//   B. evolvesFrom 指向的卡與自己**同 stage** → 進化必須跨階，必為資料錯
//   C. evolvesFrom 指向一張 **ex／GX／V／超級** 版本 → 正是上述爬蟲 pattern 的指紋
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const all = [];
const fossilNames = new Set();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
    if (c?.supertype === 'Pokemon') all.push({ ...c, _set: f.slice(0, -5) });
    // ⚠「陳舊的○○化石」是 Trainer/Item，但放到備戰後**可以被進化**，是合法的 evolvesFrom
    //   目標。只看 Pokemon 會把 7 張化石系進化卡誤報成「前階不存在」。
    else if (c?.supertype === 'Trainer' && /化石/.test(c.name ?? '')) fossilNames.add(c.name);
  }
}
const pokeNames = new Set(all.map(c => c.name));
const HIJ = all.filter(c => ['H', 'I', 'J'].includes(c.regulationMark));

// ⚠ 已查證為「官方頁自己就這樣標」的例外（不是我們的資料錯）。加白名單前必須先看官方 detail 頁。
const KNOWN_OK = new Set([
  // 大力鱷(SV-P-I 222/SV-P)：官方頁明寫「1階進化」，但同名卡在 MC/SV5K/SV8a 都是 2 階。
  //   官方資料本身就不一致 → 忠實反映官方頁，不改。實務上 evolvesFrom=藍鱷 進化流程仍正確。
  '大力鱷←藍鱷',
]);

let fail = 0;
const report = (tag, msg) => { fail++; console.log(`  ❌ [${tag}] ${msg}`); };
const seen = new Set();
for (const c of HIJ) {
  if (!c.evolvesFrom) continue;
  const key = `${c.name}←${c.evolvesFrom}`;
  if (seen.has(key)) continue;
  seen.add(key);
  if (KNOWN_OK.has(key)) continue;
  // A
  if (!pokeNames.has(c.evolvesFrom) && !fossilNames.has(c.evolvesFrom)) {
    report('A 前階不存在', `[${c._set} ${c.regulationMark}] ${c.name} ← 「${c.evolvesFrom}」（全站查無此寶可夢 → 永遠進化不出來）`);
    continue;
  }
  // C
  if (/(ex$|EX$|GX$|^超級|^V|V$|VMAX$|VSTAR$)/.test(c.evolvesFrom)) {
    report('C 指向ex/GX版本', `[${c._set}] ${c.name} ← 「${c.evolvesFrom}」（官方進化面板是「該編號所有卡片」，抓錯就會指到 ex/GX 版）`);
    continue;
  }
  // B
  const pre = all.find(x => x.name === c.evolvesFrom);
  if (pre && String(pre.stage) === String(c.stage)) {
    report('B 同階進化', `[${c._set}] ${c.name}(${c.stage}) ← ${c.evolvesFrom}(${pre.stage})　進化必須跨階`);
  }
}
if (fail) {
  console.log(`\n進化鏈完整性：❌ ${fail} 個問題`);
  console.log('⚠ 修法：開官方 detail 頁看卡片左上的階段字樣（基礎／1階進化／2階進化），');
  console.log('   「1階進化」的 evolvesFrom ＝ 進化清單中的【基礎】那張，不是清單中自己的前一項。');
  process.exit(1);
}
console.log(`進化鏈完整性：✅ 掃 ${HIJ.length} 張 H/I/J 寶可夢，${seen.size} 種進化關係全部合法`);
