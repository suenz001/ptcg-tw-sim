// ⭐⭐⭐ v6.329 守衛：三張被本站佔用的官方卡正式歸位
//
// 背景見 `test-v6328-two-card-stadium-id-renumber.mjs` 檔頭。
// 這一版把 19624 / 19625 / 19626 還給官方那三張卡：
//   ・19624 膽小蟲        J 標  209/M-P → M-P-J（既有卡名的另一印刷）
//   ・19625 超級米立龍ex  J 標  210/M-P → M-P-J（⭐**全新卡名＋全新招式名**，站內先前完全沒有）
//   ・19626 麻麻小魚      I 標  211/M-P → M-P-I（既有卡名的另一印刷）
//
// 卡面逐欄取自台灣官方卡牌檢索 detail 頁（client-rendered，`web_fetch` 回空白
// ⇒ 用瀏覽器頁內 same-origin fetch + DOMParser 取原始 DOM 核對）。
// ⚠ 這裡的期望值**不是抄實作**，是抄官方卡面 —— 實作若與卡面不符，這支就要紅。
import { readFileSync, readdirSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass = 0, fail = 0;
const ok = (c, m) => { if (!c) throw new Error(m); };
function T(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e && e.message)); fail++; }
}

const dir = join(ROOT, 'static/cards');
const INDEX = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
const liveCodes = new Set(INDEX.map((e) => e.code));
const BY_ID = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !liveCodes.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) BY_ID.set(String(c.id), c);
}

/** 官方卡面（逐欄）。⚠ 動這張表之前先開官方 detail 頁核對，不要照著實作改。 */
const OFFICIAL = {
  '19624': {
    name: '膽小蟲', setCode: 'M-P-J', collectorNumber: '209/M-P', regulationMark: 'J',
    supertype: 'Pokemon', subtype: 'Basic', stage: 'Basic', hp: 70, pokemonType: 'Grass',
    abilities: [{ name: '懦弱', effect: '若對手的場上有「寶可夢【ex】」，則這隻寶可夢【撤退】所需的能量全部消除。' }],
    attacks: [{ name: '衝撞', cost: ['Grass'], damage: '10', effect: '' }],
    weakness: { type: 'Fire', value: '×2' }, retreatCost: ['Colorless', 'Colorless', 'Colorless'],
    pokedexNumber: 767, species: '疾行寶可夢', illustrator: 'Tonji Matsuno',
  },
  '19625': {
    name: '超級米立龍ex', setCode: 'M-P-J', collectorNumber: '210/M-P', regulationMark: 'J',
    supertype: 'Pokemon', subtype: 'ex', stage: 'Basic', hp: 260, pokemonType: 'Water',
    abilities: null,
    attacks: [{ name: '三貫頭擊', cost: ['Water', 'Water', 'Water'], damage: '150×',
                effect: '擲3次硬幣，造成正面出現的次數×150點傷害。' }],
    weakness: { type: 'Lightning', value: '×2' }, retreatCost: ['Colorless'],
    pokedexNumber: 978, species: null, illustrator: 'Keisuke Azuma',
  },
  '19626': {
    name: '麻麻小魚', setCode: 'M-P-I', collectorNumber: '211/M-P', regulationMark: 'I',
    supertype: 'Pokemon', subtype: 'Basic', stage: 'Basic', hp: 40, pokemonType: 'Lightning',
    abilities: null,
    attacks: [{ name: '紋絲不動', cost: ['Colorless'], damage: '', effect: '將這隻寶可夢恢復「10」HP。' }],
    weakness: { type: 'Fighting', value: '×2' }, retreatCost: null,   // 官方「撤退 --」⇒ 不寫這個欄位
    pokedexNumber: 602, species: '電魚寶可夢', illustrator: 'Saboteri',
  },
};

console.log('A. 卡面資料逐欄與台灣官方一致');

T('⭐⭐⭐ A1 三張卡都在卡庫，且每一個欄位都與官方卡面逐欄相符', () => {
  for (const [id, w] of Object.entries(OFFICIAL)) {
    const c = BY_ID.get(id);
    ok(c, `官方 id ${id}（${w.name}）不在卡庫`);
    for (const k of ['name', 'setCode', 'collectorNumber', 'regulationMark', 'supertype',
                     'subtype', 'stage', 'hp', 'pokemonType', 'pokedexNumber', 'illustrator']) {
      ok(c[k] === w[k], `${id}.${k} 應為 ${JSON.stringify(w[k])}，實得 ${JSON.stringify(c[k])}`);
    }
    ok(JSON.stringify(c.weakness) === JSON.stringify(w.weakness), `${id} 弱點不符：` + JSON.stringify(c.weakness));
    ok(c.resistance == null, `${id} 官方抵抗力是「--」，不該有 resistance 欄位`);
    // 撤退：官方「--」⇒ 欄位缺席（與既有印刷 14707 一致）
    if (w.retreatCost === null) ok(c.retreatCost == null, `${id} 官方撤退是「--」，不該寫 retreatCost`);
    else ok(JSON.stringify(c.retreatCost) === JSON.stringify(w.retreatCost), `${id} 撤退費用不符`);
    if (w.species === null) ok(c.species == null, `${id} 官方沒有分類名，不該寫 species`);
    else ok(c.species === w.species, `${id} 分類名不符：${c.species}`);
    // 特性
    if (w.abilities === null) ok(!c.abilities || c.abilities.length === 0, `${id} 不該有特性`);
    else {
      ok((c.abilities ?? []).length === w.abilities.length, `${id} 特性數不符`);
      w.abilities.forEach((a, i) => {
        ok(c.abilities[i].name === a.name, `${id} 特性名不符：${c.abilities[i].name}`);
        ok(c.abilities[i].effect === a.effect, `${id} 特性效果逐字不符：${c.abilities[i].effect}`);
      });
    }
    // 招式
    ok(c.attacks.length === w.attacks.length, `${id} 招式數不符`);
    w.attacks.forEach((a, i) => {
      const g = c.attacks[i];
      ok(g.name === a.name, `${id} 招式名不符：${g.name}`);
      ok(JSON.stringify(g.cost) === JSON.stringify(a.cost), `${id}｜${a.name} 能量費用不符：` + JSON.stringify(g.cost));
      ok(g.damage === a.damage, `${id}｜${a.name} 傷害欄不符：${g.damage}`);
      ok(g.effect === a.effect, `${id}｜${a.name} 效果逐字不符：${g.effect}`);
    });
    // 圖檔／來源可由 id 合成（不再需要圖檔例外表）
    ok(c.imageUrl === `https://asia.pokemon-card.com/tw/card-img/tw000${id}.png`, `${id} imageUrl 不對：${c.imageUrl}`);
    ok(c.sourceUrl === `https://asia.pokemon-card.com/tw/card-search/detail/${id}/`, `${id} sourceUrl 不對`);
  }
});

T('⭐⭐ A2 卡包張數：index.json 宣告 = 實際檔案（M6 −3、M-P +3，全站總數不變）', () => {
  for (const code of ['M6', 'M-P-J', 'M-P-I']) {
    const arr = JSON.parse(readFileSync(join(dir, code + '.json'), 'utf8'));
    const d = INDEX.find((e) => e.code === code);
    ok(d.cardCount === arr.length && d.count === arr.length,
      `${code}: index.json ${d.cardCount}/${d.count}，實際 ${arr.length}`);
    const sc = {};
    for (const c of arr) sc[c.supertype] = (sc[c.supertype] ?? 0) + 1;
    for (const [k, v] of Object.entries(d.supertypeCounts)) {
      ok((sc[k] ?? 0) === v, `${code}.supertypeCounts.${k} 宣告 ${v}，實際 ${sc[k] ?? 0}`);
    }
  }
  const csm = JSON.parse(readFileSync(join(ROOT, 'static/card-set-map.json'), 'utf8'));
  for (const [id, w] of Object.entries(OFFICIAL)) {
    ok(csm[id] === w.setCode, `card-set-map 的 ${id} 應指向 ${w.setCode}，實得 ${csm[id]}`);
  }
  ok(Object.keys(csm).length === BY_ID.size, `card-set-map (${Object.keys(csm).length}) 與卡庫 (${BY_ID.size}) 張數不一致`);
});

/**
 * 跑完整 ATTACK 流程，回傳**引擎實際造成的傷害**。
 * ⚠ 不能讀防守方的 `damage` —— 450／900 會把全站任何一隻打昏（最高 HP 也才 3xx），
 *   讀不到就變成 KO/null。改讀戰鬥紀錄那一行「造成 N 點傷害」＝管線末端的值。
 */
const dealt = (defId) => {
  const st = M.applyAction(mkState(defId), { type: 'ATTACK', attackIndex: 0 }, BY_ID);
  const line = (st.log ?? []).map((l) => (typeof l === 'string' ? l : (l?.message ?? l?.text ?? '')))
    .reverse().find((t) => /造成\s*\d+\s*點傷害/.test(t));
  if (!line) {
    // 全反面（0 傷害）時引擎不會寫「造成 N 點傷害」那一行 ⇒ 讀擲幣**結算**那一行
    //   格式：「三貫頭擊：0/3 次正面 → 0×150 = 0 傷害」
    const coin = (st.log ?? []).map((l) => (typeof l === 'string' ? l : (l?.message ?? l?.text ?? '')))
      .find((t) => /三貫頭擊：\d+\/\d+\s*次正面/.test(t));
    const m = coin && coin.match(/=\s*(\d+)\s*傷害/);
    if (m) return Number(m[1]);
    return 'no-damage-log:' + JSON.stringify((st.log ?? []).slice(-4));
  }
  return Number(line.match(/造成\s*(\d+)\s*點傷害/)[1]);
};

console.log('B. 行為端：超級米立龍ex｜三貫頭擊（全新卡名＋全新招式名）');

const S = join(ROOT, '.y6329-s.js'), E = join(ROOT, '.y6329-e.ts'), O = join(ROOT, '.y6329-o.mjs');
const cleanup = () => { for (const p of [S, E, O]) { try { if (existsSync(p)) unlinkSync(p); } catch { /* ignore */ } } };
let M;
try {
  const { build } = await import('esbuild');
  writeFileSync(S, 'export const base="";');
  writeFileSync(E,
    "export { ATTACK_PRE } from './src/lib/game/effects/_shared';\n"
    + "export { applyAction } from './src/lib/game/engine';\n"
    + "export { isMegaExCard } from './src/lib/game/selection-filter';\nimport './src/lib/game/effects';\n");
  await build({
    entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
    alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error',
  });
  M = await import(pathToFileURL(O).href + '?v=' + Date.now());
} finally { cleanup(); }

/** 最小盤面：P0 的戰鬥位是超級米立龍ex（附滿【水】×3），P1 的戰鬥位是對照用防守方 */
const WATER = [...BY_ID.values()].find((c) => c.name === '基本【水】能量');
let _n = 0;
const inst = (cid, e = {}) => ({ iid: `X${++_n}`, cardId: String(cid), damage: 0, energyAttached: [], ...e });
const mkState = (defId) => ({
  phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0,
  turn: 5, isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
  players: [
    { name: 'A', active: inst('19625', { energyAttached: [inst(WATER.id), inst(WATER.id), inst(WATER.id)] }),
      bench: [], hand: [], deck: [], discard: [], prizes: [] },
    { name: 'B', active: inst(defId), bench: [], hand: [], deck: [], discard: [], prizes: [] },
  ],
});

T('⭐⭐⭐ B1 走完整 ATTACK 流程：全正面 450／一正兩反 150／全反面 0（"150×" 不得被當成固定 150）', () => {
  const real = Math.random;
  try {
    // 找一張沒有【水】弱點的對手，避免弱點×2 污染基準值
    const def = [...BY_ID.values()].find((c) => c.supertype === 'Pokemon' && c.hp >= 300
      && c.weakness?.type && c.weakness.type !== 'Water');
    ok(def, '找不到合適的對照用防守方');
    Math.random = () => 0.1;                                   // < 0.5 ＝ 正面
    ok(dealt(String(def.id)) === 450, '全正面應為 3×150＝450，實得 ' + dealt(String(def.id)));
    Math.random = () => 0.9;                                   // >= 0.5 ＝ 反面
    const b = dealt(String(def.id));
    ok(b === 0, '全反面應為 0，實得 ' + b + '（若為 150 ⇒ damage 欄的 "150×" 被當成固定傷害解析了）');
    let n = 0;
    Math.random = () => (n++ === 0 ? 0.1 : 0.9);               // 正、反、反
    const c = dealt(String(def.id));
    ok(c === 150, '一次正面應為 150，實得 ' + c);
  } finally { Math.random = real; }
});

T('⭐⭐ B2 招式有註冊（新卡名＋新招式名必須同版實裝，不能只進卡庫）', () => {
  ok(typeof M.ATTACK_PRE.get('超級米立龍ex|三貫頭擊') === 'function',
    '三貫頭擊沒有註冊 —— 這張是全新卡名，招式必須同版實裝');
});

T('⭐⭐ B3 弱點會照常套用（證明它走的是中央傷害公式，不是自己算完就送）', () => {
  const real = Math.random;
  try {
    const defW = [...BY_ID.values()].find((c) => c.supertype === 'Pokemon' && c.hp >= 300
      && c.weakness?.type === 'Water' && c.weakness?.value === '×2');
    ok(defW, '卡池裡找不到對【水】弱點×2 且 HP≥300 的寶可夢，本條無法實測');
    Math.random = () => 0.1;
    const got = dealt(String(defW.id));
    ok(got === 900,
      '對【水】弱點應為 450×2＝900，實得 ' + got
      + ' ⇒ 這個招式沒有走中央傷害公式（弱點／抵抗力／減傷／免疫都會跟著失效）');
  } finally { Math.random = real; }
});

T('⭐⭐ B4 超級米立龍ex 必須被中央述詞認成「超級進化寶可夢【ex】」（KO 給 3 張獎賞的判準）', () => {
  ok(M.isMegaExCard(BY_ID.get('19625')) === true,
    'isMegaExCard 不認得這張卡：' + JSON.stringify({ subtype: BY_ID.get('19625').subtype, name: BY_ID.get('19625').name }));
  ok(M.isMegaExCard(BY_ID.get('19624')) === false, '膽小蟲被誤判成超級進化寶可夢ex');
});

console.log('D. ⛔ 舊牌組的一次性修復（v6.329 對抗性審查抓到的真回歸）');

const S2 = join(ROOT, '.z6329-s.js'), E2 = join(ROOT, '.z6329-e.ts'), O2 = join(ROOT, '.z6329-o.mjs');
const cleanup2 = () => { for (const p of [S2, E2, O2]) { try { if (existsSync(p)) unlinkSync(p); } catch { /* ignore */ } } };
let D;
try {
  const { build } = await import('esbuild');
  writeFileSync(S2, 'export const base="";');
  writeFileSync(E2,
    "export { migrateDeck, migrateCardId, mergeTwoCardStadiumEntries } from './src/lib/decks/cardIdMigration';\n"
    + "export { validateDeck, TWO_CARD_STADIUM_PAIR_IDS, TWO_CARD_STADIUM_LEFT_IDS } from './src/lib/decks/validation';\n"
    + "export { isHiddenFromPlayers } from './src/lib/cards/visibility';\n");
  await build({
    entryPoints: [E2], outfile: O2, bundle: true, format: 'esm', platform: 'node', target: 'node20',
    alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S2 }, logLevel: 'error',
  });
  D = await import(pathToFileURL(O2).href + '?v=' + Date.now());
} finally { cleanup2(); }

const LEFTS = [...D.TWO_CARD_STADIUM_LEFT_IDS];
const RIGHTS = LEFTS.map((l) => D.TWO_CARD_STADIUM_PAIR_IDS[l]);
const LEGACY_RIGHT = { '19621': '19624', '19622': '19625', '19623': '19626' };
const shape = (d) => d.entries.filter((e) => e.count <= 8).map((e) => e.cardId + '×' + e.count).sort().join(' , ');
/** 判準是**牌組形狀**，不是存檔時間 ⇒ 每個形狀都要在「各種 updatedAt」下得到同樣結果。 */
const STAMPS = [
  ['舊 ISO', '2026-01-01T00:00:00.000Z'],
  ['新 ISO', new Date().toISOString()],
  ['數字（官網代碼匯入寫的就是這種）', Date.now()],
  ['缺席', undefined],
  ['空字串', ''],
  ['非 ISO 格式', '2026/09/08'],
  ['帶時區偏移', '2026-09-08T08:00:00+08:00'],
];

T('⭐⭐⭐ D1 v6.093~v6.328 的舊格式（左半×2 ＋ 舊右半×2）必須修回「左2＋新右2」，不得被重新拆成 1+1', () => {
  // ⚠ 這正是第一輪審查抓到的真回歸：migrateCardId 不再動舊 id ⇒ split 找不到右半 entry
  //   ⇒ 把玩家**已經拆好**的左半再拆一次成 1+1，左右仍相等 ⇒ 驗證通過、靜默改壞牌組
  //   （一套傳說場地卡憑空變成兩張膽小蟲，60 張、合法、零警告）。
  for (let i = 0; i < LEFTS.length; i++) {
    const want = [LEFTS[i] + '×2', RIGHTS[i] + '×2'].sort().join(' , ');
    for (const [label, stamp] of STAMPS) {
      const d = { id: 'd', name: 'x', updatedAt: stamp,
        entries: [{ cardId: LEFTS[i], count: 2 }, { cardId: LEGACY_RIGHT[LEFTS[i]], count: 2 }] };
      const got = shape(D.migrateDeck(d));
      ok(got === want, `舊格式沒被修好（updatedAt=${label}）：${got}（應為 ${want}）`);
    }
  }
});

T('⭐⭐⭐ D2 反向存亡點：牌組**已經有新右半**時，那三張官方卡一律不可以被吃掉', () => {
  for (const [label, stamp] of STAMPS) {
    // 只放官方卡（沒有左半）
    for (const id of Object.keys(OFFICIAL)) {
      const got = shape(D.migrateDeck({ id: 'd', name: 'x', updatedAt: stamp, entries: [{ cardId: id, count: 2 }] }));
      ok(got === id + '×2', `${id}（${OFFICIAL[id].name}）被換掉了（updatedAt=${label}）：${got}`);
    }
    // 傳說場地卡一整套 ＋ 官方卡同時存在（最容易誤觸的形狀）
    const d = { id: 'd', name: 'x', updatedAt: stamp, entries: [
      { cardId: LEFTS[0], count: 2 }, { cardId: RIGHTS[0], count: 2 }, { cardId: '19624', count: 2 }] };
    ok(shape(D.migrateDeck(d)).includes('19624×2'),
      `同時放傳說場地卡與膽小蟲時，膽小蟲被吃掉了（updatedAt=${label}）：` + shape(D.migrateDeck(d)));
  }
});

T('⭐⭐⭐ D6 匯入路徑（公布欄／JSON 檔）：新時間戳 ＋ 舊 entries 也必須修', () => {
  // ⚠⚠ 第二輪審查抓到的破口：`deck-posts/+page.svelte` 與 `decks/+page.svelte` 的匯入都是
  //   `{ ...newDeck(名稱), entries: 伺服器上的舊資料 }` ⇒ **新時間戳配舊 entries**。
  //   用「存檔時間」當判準的版本會判成新牌組而不修 ⇒ 靜默改壞（公布欄還是伺服器永久資料）。
  const imported = { id: 'new', name: '公布欄匯入', updatedAt: new Date().toISOString(), order: 1,
    entries: [{ cardId: LEFTS[1], count: 2 }, { cardId: LEGACY_RIGHT[LEFTS[1]], count: 2 }] };
  const got = shape(D.migrateDeck(imported));
  ok(got === [LEFTS[1] + '×2', RIGHTS[1] + '×2'].sort().join(' , '),
    '匯入的舊格式牌組沒被修好（＝時間戳判準的假陰）：' + got);
});

T('⭐⭐⭐ D7 官網代碼匯入寫的 updatedAt 是**數字** ⇒ 不可以因此把官方卡誤判成舊右半', () => {
  // ⚠ `decks/+page.svelte` 原本寫 `updatedAt: Date.now()`；用字串比大小的判準
  //   `String(1788…) < '2026…'` 恆真 ⇒ 玩家剛匯入的超級米立龍ex 會被換成競技場右半。
  const d = { id: 'd', name: 'x', updatedAt: Date.now(), entries: [{ cardId: '19625', count: 2 }] };
  ok(shape(D.migrateDeck(d)) === '19625×2',
    '數字型 updatedAt 讓官方卡被吃掉了：' + shape(D.migrateDeck(d)));
});

T('⭐⭐ D3 冪等：修好之後連跑三次不再變動', () => {
  let d = { id: 'd', name: 'x', updatedAt: '2026-01-01T00:00:00.000Z',
    entries: [{ cardId: LEFTS[1], count: 2 }, { cardId: LEGACY_RIGHT[LEFTS[1]], count: 2 }] };
  d = D.migrateDeck(d);
  const want = shape(d);
  for (let i = 0; i < 3; i++) { d = D.migrateDeck(d); ok(shape(d) === want, `第 ${i + 1} 次又變了：` + shape(d)); }
});

T('⭐⭐ D4 v6.093 之前的更舊牌組（只有左半 N 張）仍要正常攤成左右各半', () => {
  const d = { id: 'd', name: 'x', updatedAt: '2026-01-01T00:00:00.000Z', entries: [{ cardId: LEFTS[2], count: 4 }] };
  ok(shape(D.migrateDeck(d)) === [LEFTS[2] + '×2', RIGHTS[2] + '×2'].sort().join(' , '),
    '攤開結果錯誤：' + shape(D.migrateDeck(d)));
});

T('⭐ D8 `decks/+page.svelte` 的官網代碼匯入不得再寫數字型 updatedAt', () => {
  const src = readFileSync(join(ROOT, 'src/routes/decks/+page.svelte'), 'utf8');
  ok(!/updatedAt:\s*Date\.now\(\)/.test(src),
    'updatedAt 必須是 ISO 字串（`Deck.updatedAt: string`）—— 數字會讓雲端合併的大小比較永遠失準');
});

T('⭐⭐⭐ D5 那三個官方 id 不得再被 migrateCardId 換掉、也不得再被登記為停用卡', () => {
  // ⚠ 這條與 test-v6328 的 B1 重複是刻意的：那是本版最容易被日後「順手整理」破壞的不變量，
  //   單點依賴很危險（v6.328 第一版就是在這裡出事）。
  for (const id of Object.keys(OFFICIAL)) {
    ok(D.migrateCardId(id) === id, `${id} 又被 migrateCardId 換成 ${D.migrateCardId(id)} 了`);
    ok(!D.isHiddenFromPlayers(id), `${id} 又被登記成停用卡 —— 玩家會選不到這張官方卡`);
  }
});

console.log('C. 另外兩張是既有卡名的另一印刷 → 靠卡名自動生效');

T('⭐ C1 膽小蟲／麻麻小魚 的招式與特性集，必須與既有印刷完全相同（才能算「另一印刷」）', () => {
  const keyOf = (x) => [...(x.abilities ?? []).map((a) => a.name), ...(x.attacks ?? []).map((a) => a.name)].sort().join('|');
  for (const id of ['19624', '19626']) {
    const c = BY_ID.get(id);
    const same = [...BY_ID.values()].filter((x) => x.name === c.name && String(x.id) !== id);
    ok(same.length > 0, c.name + ' 沒有其他印刷 ⇒ 它是全新卡名，招式必須同版實裝');
    const twin = same.find((x) => keyOf(x) === keyOf(c) && x.pokemonType === c.pokemonType);
    ok(twin, `${c.name} 的招式／特性集與既有印刷都不同 ⇒ 不能當成「另一印刷」自動生效：${keyOf(c)}`);
    // 逐字比對效果，避免「同名不同效果」被當成同一張
    for (const a of c.attacks ?? []) {
      const t = (twin.attacks ?? []).find((x) => x.name === a.name);
      ok(t && t.effect === a.effect, `${c.name}｜${a.name} 的效果與既有印刷不同：${a.effect}`);
    }
  }
});

console.log(`\n${fail === 0 ? '✅' : '❌'} v6.329 官方 id 歸還與三張新卡：${pass} PASS, ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
