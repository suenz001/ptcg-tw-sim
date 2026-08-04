// v6.117 卡庫資料完整性守衛 —— 把 v6.116 補 572 張重印時「手動跑過一次」的檢查變成常設測試。
//
// 為什麼要有這支：那一輪我踩了兩個坑，兩個都是「當下沒有任何測試會紅」的：
//   ① `node scripts/build-sets-index.js --help` 不是查用法，是直接重生 index.json，
//      把手工整理的卡包中文名／releaseDate／regulationMark 全洗回原始碼版
//      （深淵之瞳 → "M5"、regulationMark → null）。只有 test-card-set-order 間接抓到。
//   ② 572 筆配對資料在瀏覽器與本地之間搬運，我手抄錯 1 筆（來源 13948 應為 13947），
//      會把「陳舊的背蓋化石」clone 成「寶可裝置3.0」。靠校驗和才抓出來。
//
// 這支測試守的是**資料層的自洽**，不看任何卡片效果：
//   index.json 手工欄位還在／張數與實際檔案相符／card-set-map 零落差／
//   cardId 全站唯一／setCode 等於所在檔名／卡面文字沒有零寬字元／imageUrl 對得上 id。
// 上面任何一項壞掉，都代表「補卡流程出錯」或「index.json 被重生」，比事後從行為找根因快得多。
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const D = join(ROOT, 'static/cards');

let pass = 0, fail = 0;
function T(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e && e.message)); fail++; }
}
function ok(cond, msg) { if (!cond) throw new Error(msg); }

const INDEX = JSON.parse(readFileSync(join(D, 'index.json'), 'utf8'));
const LIVE = INDEX.map((e) => e.code);
const LIVESET = new Set(LIVE);
/** 只掃 index.json 列出的 live 卡包（排除 *_raw / *_jp_legacy 這類歷史檔）。 */
const CARDS = {};
for (const code of LIVE) {
  const p = join(D, code + '.json');
  if (!existsSync(p)) continue;
  CARDS[code] = JSON.parse(readFileSync(p, 'utf8'));
}

console.log('① index.json 的手工欄位沒被重生掉');

T('⭐⭐ 每個卡包都要有 regulationMark（重生會變 null）', () => {
  const bad = INDEX.filter((e) => !e.regulationMark);
  ok(bad.length === 0,
    bad.length + ' 個卡包的 regulationMark 是空：' + bad.map((e) => e.code).join(',')
    + '\n      → 這是 `build-sets-index.js` 重生過的典型症狀，'
    + '請從 HEAD 取回 index.json 重做手術式更新');
});

T('⭐⭐ 卡包中文名不得退回成 code 本身（深淵之瞳 → "M5"）', () => {
  const bad = INDEX.filter((e) => !e.name || e.name === e.code);
  ok(bad.length === 0,
    bad.length + ' 個卡包的 name 等於 code：' + bad.map((e) => e.code).join(',')
    + '\n      → 同上，index.json 被重生了');
});

T('⭐ 非特典卡包必須有 releaseDate（排序靠它）', () => {
  const bad = INDEX.filter((e) => !/-P(-|$)/.test(e.code) && !e.releaseDate);
  ok(bad.length === 0, '缺 releaseDate：' + bad.map((e) => e.code).join(','));
});

T('正對照：上面三條抳得到「被重生」的樣本', () => {
  const regenerated = [{ code: 'M5', name: 'M5', regulationMark: null, releaseDate: null }];
  ok(regenerated.some((e) => !e.regulationMark), '判準抳不到 regulationMark 空');
  ok(regenerated.some((e) => e.name === e.code), '判準抳不到 name===code');
});

console.log('② 張數、對照表、id 都要自洽');

T('⭐⭐ index.json 的 cardCount/count 與實際卡片檔逐包相符', () => {
  const bad = [];
  for (const e of INDEX) {
    const arr = CARDS[e.code];
    ok(arr, '找不到卡包檔 ' + e.code + '.json');
    if (e.cardCount !== arr.length || (e.count != null && e.count !== arr.length)) {
      bad.push(e.code + ': index=' + e.cardCount + '/' + e.count + ' 實際=' + arr.length);
    }
  }
  ok(bad.length === 0,
    '張數不符：' + bad.join('; ')
    + '\n      → 補卡後 index.json 必須跟著改（build-server-engine 的卡池守衛也依賴這個數字）');
});

T('⭐⭐ card-set-map.json 與實際卡片檔零落差（缺／多／指錯）', () => {
  const m = JSON.parse(readFileSync(join(ROOT, 'static/card-set-map.json'), 'utf8'));
  const real = new Map();
  for (const [code, arr] of Object.entries(CARDS)) {
    for (const c of arr) if (c && c.id != null) real.set(String(c.id), code);
  }
  const missing = [...real.keys()].filter((k) => !(k in m));
  const extra = Object.keys(m).filter((k) => !real.has(k));
  const wrong = [...real.entries()].filter(([k, v]) => k in m && m[k] !== v);
  ok(missing.length === 0 && extra.length === 0 && wrong.length === 0,
    '缺 ' + missing.length + '（' + missing.slice(0, 3) + '） / 多 ' + extra.length
    + '（' + extra.slice(0, 3) + '） / 指錯 ' + wrong.length + '（' + JSON.stringify(wrong.slice(0, 3)) + '）'
    + '\n      → 新 id 不在對照表裡，對戰「依牌組只載必要卡包」會解析不到');
});

T('⭐ cardId 全站唯一（同一個 id 不得出現在兩個卡包）', () => {
  const seen = new Map(); const dup = [];
  for (const [code, arr] of Object.entries(CARDS)) {
    for (const c of arr) {
      if (!c || c.id == null) continue;
      const id = String(c.id);
      if (seen.has(id)) dup.push(id + ' 在 ' + seen.get(id) + ' 與 ' + code);
      else seen.set(id, code);
    }
  }
  ok(dup.length === 0,
    '重複 id：' + dup.slice(0, 5).join('; ')
    + '\n      → 補卡時 diff 必須跟「全站所有 id」比，不能只跟同名 set 檔比');
});

T('⭐ 每張卡的 setCode 必須等於所在檔名', () => {
  const bad = [];
  for (const [code, arr] of Object.entries(CARDS)) {
    for (const c of arr) if (c && c.setCode && c.setCode !== code) bad.push(c.id + ' setCode=' + c.setCode + ' 在 ' + code);
  }
  ok(bad.length === 0,
    bad.length + ' 張不符：' + bad.slice(0, 5).join('; ')
    + '\n      → clone 新印刷時忘了改 setCode（M-P/SV-P 依 reg 分檔）');
});

console.log('③ 卡面文字與圖片網址');

T('⭐ 卡名／招式名／特性名不得含零寬字元', () => {
  const ZW = /[\u200b-\u200f\u2028\u2029\ufeff]/;
  const bad = [];
  for (const [code, arr] of Object.entries(CARDS)) {
    for (const c of arr) {
      if (!c) continue;
      const names = [c.name, ...(c.attacks || []).map((a) => a && a.name), ...(c.abilities || []).map((a) => a && a.name)];
      for (const n of names) if (typeof n === 'string' && ZW.test(n)) bad.push(code + '/' + c.id + ' 「' + n.replace(ZW, '□') + '」');
    }
  }
  ok(bad.length === 0,
    bad.length + ' 處含零寬字元：' + bad.slice(0, 5).join('; ')
    + '\n      → 官方 .skillName 常帶零寬字元，抓回來前必須剥掉；'
    + '不剥會讓「同名+同招式集」的 clone 精配永遠對不上（v6.116 鴨嘴炎獸）');
});

/** live 卡片的 imageUrl 幾乎都可由 id 合成；例外必須列在這裡（v6.116 掃出僅 5 張）。 */
const IMG_EXCEPTIONS = {
  '18965': 'https://asia.pokemon-card.com/hk/card-img/hk00018965.png',
  '18969': 'https://asia.pokemon-card.com/hk/card-img/hk00018969.png',
  '19624': 'https://asia.pokemon-card.com/tw/card-img/tw00019621.png',
  '19625': 'https://asia.pokemon-card.com/tw/card-img/tw00019622.png',
  '19626': 'https://asia.pokemon-card.com/tw/card-img/tw00019623.png',
};

T('⭐ imageUrl 要麼符合「tw + id 補零 8 位」，要麼在例外表裡', () => {
  const bad = [];
  let total = 0;
  for (const [, arr] of Object.entries(CARDS)) {
    for (const c of arr) {
      if (!c || c.id == null || !c.imageUrl) continue;
      total++;
      const want = 'https://asia.pokemon-card.com/tw/card-img/tw' + String(Number(c.id)).padStart(8, '0') + '.png';
      if (c.imageUrl !== want && IMG_EXCEPTIONS[String(c.id)] !== c.imageUrl) bad.push(c.id + ' ' + c.name + ' -> ' + c.imageUrl);
    }
  }
  ok(total > 3000, '掃到的卡太少（' + total + '），判準可能壞了');
  ok(bad.length === 0,
    bad.length + ' 張的卡圖網址合成不出來且不在例外表：' + bad.slice(0, 5).join('; ')
    + '\n      → clone 新印刷時 imageUrl 必須換成新 id（不換就會顯示到來源卡的圖）');
});

T('正對照：例外表不得有腐爛項（卡已不存在或網址已改）', () => {
  const byId = new Map();
  for (const [, arr] of Object.entries(CARDS)) for (const c of arr) if (c && c.id != null) byId.set(String(c.id), c);
  const stale = Object.keys(IMG_EXCEPTIONS).filter((id) => {
    const c = byId.get(id);
    return !c || c.imageUrl !== IMG_EXCEPTIONS[id];
  });
  ok(stale.length === 0, '例外表這幾筆已跟卡片資料對不上：' + stale.join(', '));
});

console.log('④ build-sets-index.js 不得再「沒帶參數就重生」');

T('⭐⭐ 該腳本必須有參數閘：--help 不執行、未知參數 exit 1、要寫檔必須 --write', () => {
  const src = readFileSync(join(ROOT, 'scripts/build-sets-index.js'), 'utf8');
  ok(/process\.argv\.slice\(2\)/.test(src), '沒有讀 argv —— 任何參數都會直接重生');
  ok(/--help/.test(src) && /process\.exit\(0\)/.test(src), '--help 沒有印說明後直接結束');
  ok(/--write/.test(src), '沒有要求明確帶 --write 才寫檔');
  const i = src.lastIndexOf('main();');
  ok(i > src.lastIndexOf('--write'), 'main() 應該在參數閘之後才呼叫');
});

console.log('\n=== v6.117 卡庫資料完整性：PASS ' + pass + ' / FAIL ' + fail + ' ===');
if (fail > 0) process.exit(1);
