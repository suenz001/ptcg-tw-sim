// v6.109 守衛：「查看牌庫頂 N 張，從中選某類別」的 picker —— 可勾區只放該類別，其餘走下拉。
//
// 玩家回報（超級烈空坐ex｜霸者咆哮）：「應該只篩選出能量卡，然後下拉選單顯示其他的非能量卡片，
//   請參考寶可裝置3.0 之類的卡牌的作法」。
// 卡面（static/cards M6 19608）：「查看自己的牌庫上方4張卡，從其中選擇1張**基本能量卡**，
//   附於這隻寶可夢身上。」⇒ 可選的只有基本能量，其餘 3 張是「看過但不能選」。
//
// 舊寫法 filter:'TOP4' 會把 4 張**全部**丟進可勾區、只靠 params.validIids 擋 —— 玩家要在
// 一堆點不動的卡裡找能量，畫面也完全沒說明為什麼點不下去。
// 正解＝用**類別型 filter**（'BasicEnergy:TOP_N'，UI／ai.ts 兩端都已接線、讀 params.topIids）：
//   ① 可勾區只留基本能量
//   ② 其餘卡自動走 UI 的「🔍 查看翻到的其他 N 張（本次不可選，僅供參考）」下拉
//      （該區塊的 gate 是 /:TOP(\d+|_N)$/ —— 純 'TOPn' 不匹配，這正是舊寫法看不到下拉的原因）
//
// ⚠ 純 'TOPn' 本身不是錯的：卡面若是「選任意 N 張卡」（探險家的嚮導／八朔／多龍奇｜偵查指令）
//   就該全部可勾。判準是「**有沒有 validIids**」——有 = 卡面限了類別 = 顯示也要限。
//   這條判準已寫進 anti-pattern-lint 的 Check W（全站掃描，防未來新卡再犯）。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.v6109-s.js'), E = join(ROOT, '.v6109-e.ts'), O = join(ROOT, '.v6109-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { getAbilityFn } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const M = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
const byName = (n, pred) => [...pool.values()].find(c => c.name === n && (!pred || pred(c)));
let seq = 0;
const inst = (id) => ({ iid: 'i' + (++seq), cardId: String(id), damage: 0, energyAttached: [] });
const mk = (me) => ({ phase: 'playing', turnPhase: 'main', turn: 5, activePlayerIndex: 0, firstPlayerIdx: 0,
  isFirstTurn: false, setupDone: [true, true], log: [], pendingSelection: null, activeStadium: null,
  players: [{ name: 'P1', active: null, bench: [], hand: [], deck: [], discard: [], prizes: [], ...me },
            { name: 'P2', active: null, bench: [], hand: [], deck: [], discard: [], prizes: [] }] });

let pass = 0, fail = 0;
function T(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e && e.message)); fail++; }
}
function ok(cond, msg) { if (!cond) throw new Error(msg); }

const BASIC_ENERGY = [...pool.values()].filter(c => c.supertype === 'Energy' && c.subtype === 'Basic');
const SPECIAL_ENERGY = [...pool.values()].find(c => c.supertype === 'Energy' && c.subtype !== 'Basic');
const SOME_POKEMON = [...pool.values()].find(c => c.supertype === 'Pokemon');
const grass = BASIC_ENERGY.find(c => c.name.includes('草')) ?? BASIC_ENERGY[0];
const fire = BASIC_ENERGY.find(c => c.name.includes('火')) ?? BASIC_ENERGY[1];

// UI 端（+page.svelte）'BasicEnergy:TOP_N' 的候選求值，原樣重寫一份當可執行對照。
// ⚠ 這不是「複製實作再自我驗證」——它下面有靜態斷言釘住 UI 檔真的有這個 case，
//   兩條合起來才成立（單靠任一條都是假綠）。
function uiCandidatesBasicEnergyTopN(deck, params) {
  const topN = new Set(params?.topIids ?? []);
  return deck.filter(c => {
    if (!topN.has(c.iid)) return false;
    const card = pool.get(c.cardId);
    return !!card && card.supertype === 'Energy' && card.subtype === 'Basic';
  });
}

console.log('① 超級烈空坐ex｜霸者咆哮（玩家回報的那張）');

const RAYQ = byName('超級烈空坐ex', c => (c.abilities || []).some(a => a.name === '霸者咆哮'));
T('卡面確實限「基本能量卡」（查證用，防我自己記錯）', () => {
  const eff = (RAYQ.abilities || []).find(a => a.name === '霸者咆哮')?.effect ?? '';
  ok(eff.includes('基本能量卡'), '卡面文字變了：' + eff);
  ok(eff.includes('4張'), '卡面翻的張數變了：' + eff);
});

T('⭐ 用類別型 filter，可勾區只有基本能量；非能量卡不進可勾區', () => {
  const fn = M.getAbilityFn('超級烈空坐ex', '霸者咆哮', 0);
  ok(typeof fn === 'function', '霸者咆哮沒註冊');
  const self = inst(RAYQ.id);
  const deck = [inst(grass.id), inst(SOME_POKEMON.id), inst(fire.id), inst(SPECIAL_ENERGY.id), inst(grass.id)];
  const r = fn(mk({ bench: [self], deck }), 0, pool, self);
  const ps = r.pendingSelection;
  ok(ps?.filter === 'BasicEnergy:TOP_N', 'filter 應為 BasicEnergy:TOP_N，實得 ' + ps?.filter);
  ok((ps?.params?.topIids ?? []).length === 4, '要傳 topIids（類別型 filter 讀的就是它）');
  const cand = uiCandidatesBasicEnergyTopN(deck, ps.params);
  ok(cand.length === 2, '可勾區應只有 2 張基本能量，實得 ' + cand.length);
  ok(cand.every(c => c.iid === deck[0].iid || c.iid === deck[2].iid), '可勾的不是那兩張基本能量');
  ok(!cand.some(c => c.iid === deck[3].iid), '特殊能量不得可勾（卡面寫「基本能量卡」）');
  ok(!cand.some(c => c.iid === deck[4].iid), '第 5 張不在翻開的 4 張內，不得可勾');
});

T('⭐ 翻到的非能量卡仍看得到（走「查看翻到的其他 N 張」下拉，不是消失）', () => {
  const fn = M.getAbilityFn('超級烈空坐ex', '霸者咆哮', 0);
  const self = inst(RAYQ.id);
  const deck = [inst(grass.id), inst(SOME_POKEMON.id), inst(SPECIAL_ENERGY.id), inst(SOME_POKEMON.id)];
  const ps = fn(mk({ bench: [self], deck }), 0, pool, self).pendingSelection;
  const peek = new Set(ps?.params?.topIids ?? []);
  const cand = new Set(uiCandidatesBasicEnergyTopN(deck, ps.params).map(c => c.iid));
  const others = deck.filter(c => peek.has(c.iid) && !cand.has(c.iid));
  ok(others.length === 3, '應有 3 張「看過但不可選」，實得 ' + others.length);
  // 卡面是「查看」4 張 → 4 張都要在 peek 集合內，玩家才看得到自己翻到什麼
  ok(peek.size === 4, 'peek 集合應含全部 4 張（卡面「查看4張」），實得 ' + peek.size);
});

T('4 張全無基本能量時不卡住（minCount 0，可以不選）', () => {
  const fn = M.getAbilityFn('超級烈空坐ex', '霸者咆哮', 0);
  const self = inst(RAYQ.id);
  const deck = [inst(SOME_POKEMON.id), inst(SOME_POKEMON.id), inst(SPECIAL_ENERGY.id), inst(SOME_POKEMON.id)];
  const ps = fn(mk({ bench: [self], deck }), 0, pool, self).pendingSelection;
  ok(ps?.minCount === 0, '沒有基本能量時 minCount 必須是 0，否則玩家關不掉 picker');
  ok(uiCandidatesBasicEnergyTopN(deck, ps.params).length === 0, '不該有可勾的卡');
});

console.log('② 杖尾鱗甲龍｜鱗片律動（同型，一併收斂）');

const TYRANT = byName('杖尾鱗甲龍', c => (c.abilities || []).some(a => a.name === '鱗片律動'));
T('卡面確實限「基本能量卡」', () => {
  const eff = (TYRANT.abilities || []).find(a => a.name === '鱗片律動')?.effect ?? '';
  ok(eff.includes('基本能量卡'), '卡面文字變了：' + eff);
});

T('⭐ 同樣走類別型 filter + topIids', () => {
  const fn = M.getAbilityFn('杖尾鱗甲龍', '鱗片律動', 0);
  ok(typeof fn === 'function', '鱗片律動沒註冊');
  const self = inst(TYRANT.id);
  const deck = [inst(grass.id), inst(SPECIAL_ENERGY.id), inst(SOME_POKEMON.id),
                inst(fire.id), inst(SOME_POKEMON.id), inst(SOME_POKEMON.id), inst(grass.id)];
  const ps = fn(mk({ active: self, deck }), 0, pool, self).pendingSelection;
  ok(ps?.filter === 'BasicEnergy:TOP_N', 'filter 應為 BasicEnergy:TOP_N，實得 ' + ps?.filter);
  ok((ps?.params?.topIids ?? []).length === 6, '要傳 topIids');
  const cand = uiCandidatesBasicEnergyTopN(deck, ps.params);
  ok(cand.length === 2, '可勾區應只有前 6 張裡的 2 張基本能量，實得 ' + cand.length);
  ok(!cand.some(c => c.iid === deck[6].iid), '第 7 張不在翻開的 6 張內');
});

console.log('③ 兩端接線 + 反向守衛（單靠行為端會是假綠）');

const GP = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
const AI = readFileSync(join(ROOT, 'src/lib/game/ai.ts'), 'utf8');

T('⭐ UI 與 ai.ts 都認得 BasicEnergy:TOP_N（兩份 filter 會漂移，兩邊都要有）', () => {
  ok(/f === 'BasicEnergy:TOP_N'/.test(GP), '+page.svelte 沒有這個 case');
  ok(/f === 'BasicEnergy:TOP_N'/.test(AI), 'ai.ts 沒有這個 case');
});

T('⭐ UI「查看翻到的其他 N 張」下拉的 gate 必須匹配 :TOP_N（否則其他卡玩家看不到）', () => {
  const m = GP.match(/\/:TOP\\?\(\\d\+\|_N\)\$\/\.test\(pendingSelection\.filter/);
  ok(m, '找不到 peeked-others 的 filter gate（結構改了？請同步更新本守衛）');
  const re = /:TOP(\d+|_N)$/;
  ok(re.test('BasicEnergy:TOP_N'), 'gate regex 不匹配 BasicEnergy:TOP_N ⇒ 其他卡不會顯示');
  ok(!re.test('TOP4'), '純 TOP4 本來就不該進這個下拉（全部都可勾）');
});

T('⭐ 反向：全站不得再出現「純 TOPn ＋ validIids」（lint Check W 的行為端對照）', () => {
  const lint = readFileSync(join(ROOT, 'scripts/anti-pattern-lint.mjs'), 'utf8');
  ok(/Check W/.test(lint), 'lint 沒有 Check W —— 沒有全站掃描就防不了新卡再犯');
  ok(/filter:\\s\*'TOP\\d\+'/.test(lint) || /filter:\\s\*'TOP/.test(lint), 'Check W 的判準不見了');
});

T('正對照：卡面「選任意 N 張卡」的仍是純 TOPn（判準不是一律禁止純 TOPn）', () => {
  const files = ['src/lib/game/effects/cards/draw_supporters.ts', 'src/lib/game/effects.ts',
                 'src/lib/game/effects/cards/maroon_dragon_deck.ts'];
  const all = files.map(f => readFileSync(join(ROOT, f), 'utf8')).join('\n');
  ok(/filter: 'TOP6'/.test(all), '探險家的嚮導（選任意 2 張）應維持純 TOP6');
  ok(/filter: 'TOP8'/.test(all), '八朔（選任意最多 3 張）應維持純 TOP8');
  ok(/filter: 'TOP2'/.test(all), '多龍奇｜偵查指令（選任意 1 張）應維持純 TOP2');
});

console.log('④ 同維度殘留（Fable 5 審查指出，本版一併收）：filter 顯示集合 ⊋ 可勾集合');

// 這三組不是 peek-TOP 型，而是「整副牌庫搜尋」型的同一問題：
//   filter 決定畫面顯示什麼、validIids 決定能勾什麼 —— 兩者不一致時，玩家就是在一堆
//   點不動的卡裡找目標。判準一樣是**卡面**：卡面限了什麼，filter 就要限什麼。
const SRC = (f) => readFileSync(join(ROOT, f), 'utf8');

T('⭐ 蛋蛋/急凍鳥/雷電雲（中央 helper，一改三卡）：filter 帶到屬性', () => {
  const s = SRC('src/lib/game/effects/cards/v2401_i_wave2_draw_swap_search.ts');
  ok(/filter: `BasicEnergy:\$\{type\}`/.test(s),
    'deckSearchBasicEnergyPost 應用 BasicEnergy:<Type>（卡面是「基本【草】/【水】/【雷】能量」）');
  ok(!/filter: 'BasicEnergy',/.test(s), '不得退回只寫 BasicEnergy（會列出所有屬性的基本能量）');
});

T('卡面查證：三張都限單一屬性（防我記錯）', () => {
  const want = [['蛋蛋', '果實盈滿', '草'], ['急凍鳥', '冰冷羽擊', '水'], ['雷電雲', '充電', '雷']];
  for (const [n, atk, t] of want) {
    const c = [...pool.values()].find(c => c.name === n && (c.attacks || []).some(a => a.name === atk));
    ok(c, '找不到 ' + n + '｜' + atk);
    const eff = (c.attacks || []).find(a => a.name === atk).effect;
    ok(eff.includes('基本【' + t + '】能量'), n + ' 卡面屬性變了：' + eff);
  }
});

T('⭐ 樹才怪｜考驗之旅：只顯示「變化之書」，不再顯示整副牌庫', () => {
  const s = SRC('src/lib/game/effects/cards/v2354_j_mark_batch.ts');
  ok(/filter: 'Name:變化之書'/.test(s), '應用中央 Name: 精確比對');
  const i = s.indexOf("effectKey: 'j-2354-morphbk-search'");
  ok(i > 0 && !/filter: 'Any'/.test(s.slice(Math.max(0, i - 700), i)), '不得再用 Any（會顯示整副牌庫）');
});

T('⭐ 招式學習器機：卡面兩個條件（名稱含「招式學習器」＋寶可夢道具）都要進 filter', () => {
  const s = SRC('src/lib/game/effects/cards/items_misc.ts');
  ok(/filter: 'Tool:NameContains=招式學習器'/.test(s), '應用 Tool:NameContains=');
  const sf = SRC('src/lib/game/selection-filter.ts');
  ok(/startsWith\('Tool:NameContains='\)/.test(sf), '中央 selection-filter 要收錄這個 prefix');
  // ⚠ 不能用既有的 'NameContains:' —— 那是「名稱含 X 的**物品卡**」（化石採掘場語義）
  ok(/subtype === 'PokemonTool'/.test(sf.slice(sf.indexOf("startsWith('Tool:NameContains=')"),
      sf.indexOf("startsWith('Tool:NameContains=')") + 300)), 'Tool: 前綴必須判 PokemonTool');
});

T('⭐ 反向查證：「招式學習器機」本身是 Item 不是 PokemonTool（所以不能用 NameContains:）', () => {
  const machine = [...pool.values()].find(c => c.name === '招式學習器機');
  ok(machine && machine.subtype === 'Item', '招式學習器機 應為 Item，實得 ' + machine?.subtype);
  const tools = [...pool.values()].filter(c => c.name.includes('招式學習器') && c.subtype === 'PokemonTool');
  ok(tools.length > 0, '找不到任何「招式學習器」道具');
  // NameContains: 的語義會抓到機器本身、抓不到道具 ⇒ 用它就是錯的
  ok(!tools.some(c => c.subtype === 'Item'), '道具不該是 Item');
});

T('⭐ 三處都經中央 evaluator 生效（UI／ai.ts 不需各自再寫一份）', () => {
  ok(/evaluateSelectionFilter\('deck-search'/.test(SRC('src/routes/game/+page.svelte')), 'UI 沒接中央求值器');
  ok(/evaluateSelectionFilter\('deck-search'/.test(SRC('src/lib/game/ai.ts')), 'ai.ts 沒接中央求值器');
});

console.log('\n=== v6.109 查看N張的類別型 filter：PASS ' + pass + ' / FAIL ' + fail + ' ===');
if (fail > 0) process.exit(1);
