// v1.00 守衛：牌組原型「未分類高頻卡」只列寶可夢，且可排除自訂的支援型寶可夢。
//
// 背景：原本這份清單把老大的指令×228、莉莉艾的決意×205、基本【鬥】能量×96 這種
//   「每副牌都有」的通用卡也列進去 —— 對「該開什麼新規則」毫無鑑別度。
//
// 兩個容易做錯、而且錯了不會報錯的地方（本檔專門釘住）：
//   ① `supertype` 的值是 **'Pokemon'（沒有重音符）**。寫成 'Pokémon' 會整份比不中，
//      清單直接變空 —— 看起來像「沒有未分類牌組」，不像 bug。
//   ② **必須先過濾再 slice(N)**。反過來的話前 N 名會先被通用卡佔滿，
//      過濾完可能一張寶可夢都不剩。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const pat = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');
const adm = readFileSync(join(ROOT, 'oracle-admin/admin.html'), 'utf8');

let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

T('⭐⭐supertype 必須用 \'Pokemon\'（沒有重音符 é）', () => {
  assert.ok(/supertype === 'Pokemon'/.test(pat),
    "應以 c.supertype === 'Pokemon' 判定寶可夢");
  assert.ok(!/supertype === 'Pokémon'/.test(pat),
    "不可寫成 'Pokémon'（帶重音）—— 卡片資料用的是無重音的 'Pokemon'，寫錯會整份比不中、清單變空");
});

T('前提：有 getPokemonNameSet()（把 cardId→卡名 與 cardId→屬性 接起來）', () => {
  assert.ok(/function getPokemonNameSet\(/.test(pat), '應有 getPokemonNameSet');
  const i = pat.indexOf('function getPokemonNameSet(');
  const body = pat.slice(i, pat.indexOf('\n  }', i));
  assert.ok(body.includes('getCardNameMap') && body.includes('getCardAttrMap'),
    '必須同時用到卡名對照與屬性表 —— cardFreq 的 key 是卡名，屬性表的 key 是 cardId');
});

T('⭐⭐先過濾再取前 N 名（順序相反會讓寶可夢一張都不剩）', () => {
  const i = pat.indexOf('const allFreq = [...u.cardFreq.entries()]');
  assert.ok(i > 0, '應有 allFreq');
  const body = pat.slice(i, i + 600);
  const filterAt = body.indexOf('.filter(');
  const sliceAt = body.indexOf('.slice(');
  assert.ok(filterAt > 0 && sliceAt > 0, '應同時有 filter 與 slice');
  assert.ok(filterAt < sliceAt,
    'filter 必須在 slice 之前 —— 先 slice 的話前 N 名會被通用卡佔滿');
});

T('⭐過濾條件：只留寶可夢 且 不在支援型清單內', () => {
  const i = pat.indexOf('const allFreq = [...u.cardFreq.entries()]');
  const body = pat.slice(i, i + 600);
  assert.ok(/pokeNames\.has\(name\)/.test(body), '應檢查是否為寶可夢');
  assert.ok(/!supportNames\.has\(name\)/.test(body), '應排除支援型清單');
});

T('支援型清單存伺服器（環境會變，不可寫死在程式碼裡）', () => {
  assert.ok(pat.includes("app.get('/api/admin/support-pokemon'"), '應有讀取端點');
  assert.ok(pat.includes("app.post('/api/admin/support-pokemon'"), '應有寫入端點');
  assert.ok(/deckRuleSettings/.test(pat), '應存在 mongo collection');
});

T('⭐改清單後統計快取要失效（否則要等 60 秒才看得到效果，會被當成沒作用）', () => {
  const i = pat.indexOf("app.post('/api/admin/support-pokemon'");
  const body = pat.slice(i, pat.indexOf('\n  });', i));
  assert.ok(/_archStatsCache\.clear\(\)/.test(body), '寫入後應清掉 deck-archetype-stats 的快取');
});

T('寫入端點有防呆：去重、去空白、有數量上限', () => {
  const i = pat.indexOf("app.post('/api/admin/support-pokemon'");
  const body = pat.slice(i, pat.indexOf('\n  });', i));
  assert.ok(/new Set\(/.test(body), '應去重');
  assert.ok(/\.trim\(\)/.test(body), '應去空白');
  assert.ok(/\.slice\(0,\s*\d+\)/.test(body), '應有數量上限（避免誤貼整份牌表）');
});

// ── 前端 ──
T('UI：高頻卡可一鍵設為支援型，並有清單管理入口', () => {
  assert.ok(adm.includes('window.addSupportPokemon'), '應有一鍵加入');
  assert.ok(adm.includes('window.openSupportPokemonEditor'), '應有清單編輯器');
  assert.ok(adm.includes('window.saveSupportPokemon'), '應有儲存');
  assert.ok(adm.includes('uncls-chip'), '高頻卡應為可點的 chip');
});

T('UI：會告知被濾掉多少種卡（否則使用者無從判斷清單有沒有生效）', () => {
  assert.ok(adm.includes('filteredOut'), '應讀取後端回傳的 filteredOut');
  assert.ok(/已自動濾掉/.test(adm), '應向使用者說明濾掉的數量');
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
