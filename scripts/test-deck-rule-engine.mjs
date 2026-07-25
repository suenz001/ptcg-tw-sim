// admin 批次2：牌組原型規則引擎守衛。
//   直接從 oracle-admin/server_admin_patch.js 抽出實際的 deckToSets / deckMatchesRule / classifyDeck
//   來跑（不是複製一份邏輯來測，避免測試與實作漂移）。
//   卡名一律取自 static/cards 台灣官方卡面（鐵律），不憑印象。
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const src = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');

// ── 從 patch 檔抽出三個純函式（以 function 宣告起頭、到該行縮排的 '}' 為止）──
function grabFn(name) {
  const i = src.indexOf('function ' + name + '(');
  assert.ok(i > 0, name + ' 應存在於 server_admin_patch.js');
  const indent = ' '.repeat(src.slice(0, i).length - src.lastIndexOf('\n', i) - 1);
  const end = src.indexOf('\n' + indent + '}', i);
  assert.ok(end > i, name + ' 找不到結尾');
  return src.slice(i, end + indent.length + 2);
}
const code = [grabFn('deckToSets'), grabFn('deckMatchesRule'), grabFn('classifyDeck')].join('\n')
  + '\nreturn { deckToSets, deckMatchesRule, classifyDeck };';
const { deckToSets, deckMatchesRule, classifyDeck } = new Function(code)();

// ── 現役卡池：建 cardId → 卡名 對照（與伺服器端 tournament-pool.json 同構）──
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const nameMap = new Map();
const idByName = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
    if (c?.id == null || !c.name) continue;
    nameMap.set(String(c.id), c.name);
    if (!idByName.has(c.name)) idByName.set(c.name, []);
    idByName.get(c.name).push(String(c.id));
  }
}
const idOf = (n, k = 0) => {
  const arr = idByName.get(n);
  assert.ok(arr && arr[k], '卡池應有卡：' + n);
  return arr[k];
};

let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

// Wilson 的實例：祭典熱舞 = 含【裹蜜蟲】【角金魚】、不含【蜜集大蛇ex】
//   （他口述的「果蜜蟲」查無此卡；官方卡名為「裹蜜蟲」＝蜜集大蛇ex 的進化前）
const RULE = { name: '祭典熱舞', includes: ['裹蜜蟲', '角金魚'], excludes: ['蜜集大蛇ex'], priority: 10 };
const deckOf = (names) => Object.fromEntries(names.map((n) => [idOf(n), 4]));

T('資料前提：三張卡都在現役卡池（卡名取自 static/cards 官方卡面）', () => {
  for (const n of ['裹蜜蟲', '角金魚', '蜜集大蛇ex']) assert.ok(idByName.has(n), n + ' 應存在');
});

T('命中：含兩張必含卡、且沒有排除卡', () => {
  const sets = deckToSets(deckOf(['裹蜜蟲', '角金魚', '甜蜜球']), nameMap);
  assert.equal(deckMatchesRule(sets, RULE), true);
});

T('不命中：缺其中一張必含卡', () => {
  const sets = deckToSets(deckOf(['裹蜜蟲', '甜蜜球']), nameMap);
  assert.equal(deckMatchesRule(sets, RULE), false, '缺「角金魚」不該算祭典熱舞');
});

T('不命中：含了排除卡（這正是 excludes 的用途）', () => {
  const sets = deckToSets(deckOf(['裹蜜蟲', '角金魚', '蜜集大蛇ex']), nameMap);
  assert.equal(deckMatchesRule(sets, RULE), false, '含蜜集大蛇ex 應被排除');
});

T('卡名比對涵蓋所有印刷版本（用任一版本的 cardId 都算同一張卡）', () => {
  const alts = idByName.get('角金魚') || [];
  for (let k = 0; k < alts.length; k++) {
    const cc = { [idOf('裹蜜蟲')]: 4, [alts[k]]: 4 };
    assert.equal(deckMatchesRule(deckToSets(cc, nameMap), RULE), true,
      '第 ' + (k + 1) + ' 個印刷版本的角金魚也該命中（這就是用卡名而非 cardId 的理由）');
  }
  console.log('   「角金魚」現役印刷版本數：' + alts.length);
});

T('兩種牌組格式都吃：cardCounts 物件（休閒）與 deckEntries 陣列（錦標賽）', () => {
  const obj = deckOf(['裹蜜蟲', '角金魚']);
  const arr = Object.keys(obj).map((cardId) => ({ cardId, count: 4 }));
  assert.equal(deckMatchesRule(deckToSets(obj, nameMap), RULE), true);
  assert.equal(deckMatchesRule(deckToSets(arr, nameMap), RULE), true, 'deckEntries 陣列格式也要能比對');
});

T('進階：includeIds / excludeIds 可鎖定特定印刷版本', () => {
  const v0 = idOf('角金魚', 0);
  const alts = idByName.get('角金魚');
  const sets = deckToSets({ [idOf('裹蜜蟲')]: 4, [v0]: 4 }, nameMap);
  assert.equal(deckMatchesRule(sets, { ...RULE, includeIds: [v0] }), true);
  if (alts.length > 1) {
    assert.equal(deckMatchesRule(sets, { ...RULE, includeIds: [alts[1]] }), false, '鎖了別的版本就不該命中');
    assert.equal(deckMatchesRule(sets, { ...RULE, excludeIds: [v0] }), false, 'excludeIds 應排除該版本');
  }
});

T('多規則命中時取優先序數字最小者，並回報全部命中的規則', () => {
  const sets = deckToSets(deckOf(['裹蜜蟲', '角金魚']), nameMap);
  const wide = { _id: 'r2', name: '草系通用', includes: ['裹蜜蟲'], excludes: [], priority: 50 };
  const narrow = { _id: 'r1', name: '祭典熱舞', ...RULE, priority: 10 };
  const r = classifyDeck(sets, [wide, narrow]);
  assert.equal(r.rule.name, '祭典熱舞', '應取 priority 較小的');
  assert.equal(r.all.length, 2, '應回報兩條都命中');
});

T('都不符合 → 未分類（rule=null）', () => {
  const sets = deckToSets(deckOf(['甜蜜球']), nameMap);
  const r = classifyDeck(sets, [{ _id: 'r1', ...RULE }]);
  assert.equal(r.rule, null);
  assert.equal(r.all.length, 0);
});

T('打錯卡名 → 0 命中（預覽端點會把打錯的名字列出來，這是最常見的踩雷）', () => {
  const sets = deckToSets(deckOf(['裹蜜蟲', '角金魚']), nameMap);
  const typo = { name: '祭典熱舞', includes: ['果蜜蟲', '角金魚'], excludes: [] };  // 「果」是筆誤
  assert.equal(deckMatchesRule(sets, typo), false);
  assert.ok(!idByName.has('果蜜蟲'), '「果蜜蟲」確實不是官方卡名（官方為「裹蜜蟲」）');
});


// ── 批次3：勝負歸屬判定（p1/p2 與 winner 的對應是最容易寫反的地方）──
const { casualSideResult, tournSideResult } =
  new Function([grabFn('casualSideResult'), grabFn('tournSideResult')].join('\n')
    + '\nreturn { casualSideResult, tournSideResult };')();

T('休閒：winner=0 代表 p1 勝', () => {
  assert.equal(casualSideResult(0, true), 'win', 'p1 側應為勝');
  assert.equal(casualSideResult(0, false), 'loss', 'p2 側應為負');
});
T('休閒：winner=1 代表 p2 勝', () => {
  assert.equal(casualSideResult(1, true), 'loss');
  assert.equal(casualSideResult(1, false), 'win');
});
T('休閒：winner=null 為平局（雙方都不記勝負）', () => {
  assert.equal(casualSideResult(null, true), 'draw');
  assert.equal(casualSideResult(undefined, false), 'draw');
});
T('休閒：winner 是非 0/1 的異常值時當平局，不可誤判成敗場', () => {
  assert.equal(casualSideResult(2, true), 'draw');
  assert.equal(casualSideResult('0', true), 'draw', '字串 0 不等於數字 0，應保守當平局而非誤判 p1 勝');
});
T('錦標賽：以 winnerUid 比對，且型別不一致（數字 vs 字串）也要正確', () => {
  assert.equal(tournSideResult('uidA', 'uidA'), 'win');
  assert.equal(tournSideResult('uidA', 'uidB'), 'loss');
  assert.equal(tournSideResult(123, '123'), 'win', 'uid 型別不一致時仍應判為同一人');
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
