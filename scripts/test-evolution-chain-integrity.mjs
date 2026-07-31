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
//   B. 階段沒有**正好差 1**（Basic→Stage1→Stage2）→ 進化必須逐階，必為資料錯
//      ⚠ 原本只擋「同階」，但「差 2 階」（Stage2 ← Basic）同樣不合法，會漏 → 已收緊。
//   C. evolvesFrom 指向一張 **ex／GX／V／超級** 版本 → 正是上述爬蟲 pattern 的指紋
//   D. Basic 卡卻有 evolvesFrom（基礎不該有前一階）
//   E. Stage1／Stage2 卻沒有 evolvesFrom（進化卡沒前一階＝永遠放不上場）
//   F. 同名寶可夢的 stage／evolvesFrom **跨印刷必須一致**
//      ⭐ v6.076 由 Wilson 糾正而加：大力鱷(SV-P-I) 被標成 1 階，但同名卡在 MC/SV5K/SV8a
//        三個印刷都是 2 階、HP 全部 180、evolvesFrom 全部藍鱷 —— 同一張卡不可能階段不同。
//        我當時卻因為官方 detail 頁寫「1階進化」就當成官方特例放行，是**信錯了證據層級**。
//      ⚠ 只比這兩個欄位：HP／屬性在不同卡包本來就會不同（實測 hp/pokemonType 有數十組正常差異），
//        比下去會變成誤報機器。stage／evolvesFrom 實測全站 0 組差異 → 零誤報，可安全當守衛。
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

// ⚠ 白名單目前**刻意保持空的**。
//   ⭐ v6.076 教訓（Wilson 糾正）：我原本把「大力鱷(SV-P-I 222/SV-P)」加進白名單，理由是
//     官方 detail 頁上寫「1階進化」。但實體卡是 **2 階進化**，官方頁那欄不可盡信。
//     我當時**漏看了更硬的站內證據**：同名的 MC/SV5K/SV8a 三個印刷 HP 全部都是 180、
//     evolvesFrom 全部是藍鱷，只有那一筆階段不同 —— 同一張卡的不同印刷，階段不可能不一樣。
//   ⭐ 通則：**跨印刷比對（同名卡在別的卡包長怎樣）優先於官方單一網頁欄位**。
//     多數印刷一致、少數一筆不同 → 那一筆才是異常值，不要當成「官方特例」放行。
//     真的要加白名單，先做跨印刷比對，並在此註明查證過程。
const KNOWN_OK = new Set([]);

const STAGE_ORDER = { Basic: 0, Stage1: 1, Stage2: 2 };
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
  // B：階段必須正好差 1
  const pre = all.find(x => x.name === c.evolvesFrom);
  if (pre) {
    const a = STAGE_ORDER[String(c.stage)], b = STAGE_ORDER[String(pre.stage)];
    if (a !== undefined && b !== undefined && a - b !== 1) {
      report('B 階段不連續', `[${c._set}] ${c.name}(${c.stage}) ← ${c.evolvesFrom}(${pre.stage})　差 ${a - b} 階，進化必須逐階`);
    }
  }
}
// D／E：階段與 evolvesFrom 的有無必須一致
for (const c of HIJ) {
  if (String(c.stage) === 'Basic') {
    if (c.evolvesFrom) report('D 基礎卻有前一階', `[${c._set}] ${c.name}(Basic) ← ${c.evolvesFrom}`);
  } else if (STAGE_ORDER[String(c.stage)] !== undefined && !c.evolvesFrom) {
    report('E 進化卡沒前一階', `[${c._set}] ${c.name}(${c.stage}) 沒有 evolvesFrom → 永遠放不上場`);
  }
}
// F：同名寶可夢的 stage／evolvesFrom 跨印刷一致性
{
  const byName = {};
  for (const c of all) (byName[c.name] ||= []).push(c);
  for (const [nm, xs] of Object.entries(byName)) {
    for (const field of ['stage', 'evolvesFrom']) {
      const variants = [...new Set(xs.map(c => String(c[field] ?? '-')))];
      if (variants.length < 2) continue;
      const detail = variants.map(v => {
        const where = [...new Set(xs.filter(c => String(c[field] ?? '-') === v).map(c => `${c._set} ${c.collectorNumber}`))];
        return `${v}(${where.join('、')})`;
      }).join('  vs  ');
      report('F 跨印刷不一致', `${nm}.${field}：${detail}　同一張卡的不同印刷不該有差異，少數的那筆才是異常值`);
    }
  }
}
if (fail) {
  console.log(`\n進化鏈完整性：❌ ${fail} 個問題`);
  console.log('⚠ 修法：開官方 detail 頁看卡片左上的階段字樣（基礎／1階進化／2階進化），');
  console.log('   「1階進化」的 evolvesFrom ＝ 進化清單中的【基礎】那張，不是清單中自己的前一項。');
  process.exit(1);
}
console.log(`進化鏈完整性：✅ 掃 ${HIJ.length} 張 H/I/J 寶可夢，${seen.size} 種進化關係全部合法`);
