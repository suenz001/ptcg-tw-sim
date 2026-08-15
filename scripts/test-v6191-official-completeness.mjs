// v6.191 —— 官方卡牌檢索完整性補收 + 玳蘿／老大的指令（烏羽）行為回歸
//
// 事故背景：站長回報「asia.pokemon-card.com 的 M-P 有新卡沒收錄，例如【玳蘿】」。
//   逐張比對台灣官方卡牌檢索後，全站 H/I/J 標共缺 5 張（M-P 4 張 + SV8a 1 張）。
//
// HEAD-FAIL 依據：
//   ・BASE 的 static/cards 沒有 19627/19628/19629/19630/11697 → 卡片存在斷言 FAIL
//   ・BASE 沒有 TRAINER_EFFECTS('玳蘿') → 註冊斷言 FAIL
// v6.193：19630 站長裁定改名為「老大的指令」（原「老大的指令（烏羽）」）⇒ 本檔斷言同步。
//   ・BASE 的 recordOppKO 沒有 Mega ex 計數 → 玳蘿 gate 永遠 false → gate 斷言 FAIL
//   ・BASE 的 ai.ts bench-choose 忽略 includeActive → AI 斷言 FAIL
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x6191-s.js'), E = join(ROOT, '.x6191-e.ts'), O = join(ROOT, '.x6191-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E,
  "export { TRAINER_EFFECTS, TRAINER_GUARDS, RESOLVERS, recordOppKO } from './src/lib/game/effects/_shared';\n"
  + "export { applyAction } from './src/lib/game/engine';\n"
  + "export { isMegaExCard } from './src/lib/game/selection-filter';\n"
  + "export { GUST_SUPPORTER_NAMES } from './src/lib/game/gust-supporters';\n"
  + "export { getAIAction } from './src/lib/game/ai';\n"
  + "import './src/lib/game/effects';\n");
await build({
  entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error',
});
const mod = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const INDEX = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
const live = new Set(INDEX.map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}

let pass = 0, fail = 0;
function T(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e && e.message)); fail++; }
}
const ok = (c, m) => { if (!c) throw new Error(m); };

let iidN = 0;
const inst = (cardId, extra = {}) => ({
  iid: 'i' + (++iidN), cardId: String(cardId), damage: 0, energyAttached: [], toolAttached: null, ...extra,
});
const mkState = (p0, p1, extra = {}) => ({
  phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
  isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
  players: [
    { name: 'A', active: null, bench: [], hand: [], deck: [], discard: [], prizes: [], ...p0 },
    { name: 'B', active: null, bench: [], hand: [], deck: [], discard: [], prizes: [], ...p1 },
  ],
  ...extra,
});

// 測試用固定卡（全部從 static/cards 取真卡，禁手捏卡面）
const ID_TANTAN = '19627';        // 探探鼠 M-P 212/M-P（J）
const ID_REDCARD = '19628';       // 特殊紅牌 M-P 213/M-P（J）
const ID_DAITARO = '19629';       // 玳蘿 M-P 214/M-P（J）
const ID_BOSS_UBA = '19630';      // 老大的指令 M-P 215/M-P（I）— v6.193 改名前叫「老大的指令（烏羽）」
const ID_GUIDE = '11697';         // 探險家的嚮導 SV8a 172/187（H）
const NEW_IDS = [ID_TANTAN, ID_REDCARD, ID_DAITARO, ID_BOSS_UBA, ID_GUIDE];

console.log('① 官方漏收的 5 張卡必須進卡庫（HEAD 沒有 → FAIL）');

T('⭐⭐⭐ 5 張新印刷都在 live 卡庫，且卡名／編號／標逐字對齊官方', () => {
  const want = {
    [ID_TANTAN]:   ['探探鼠', '212/M-P', 'J', 'M-P-J', 'Pokemon'],
    [ID_REDCARD]:  ['特殊紅牌', '213/M-P', 'J', 'M-P-J', 'Trainer'],
    [ID_DAITARO]:  ['玳蘿', '214/M-P', 'J', 'M-P-J', 'Trainer'],
    [ID_BOSS_UBA]: ['老大的指令', '215/M-P', 'I', 'M-P-I', 'Trainer'],
    [ID_GUIDE]:    ['探險家的嚮導', '172/187', 'H', 'SV8a', 'Trainer'],
  };
  for (const [id, [name, num, mark, setCode, supertype]] of Object.entries(want)) {
    const c = pool.get(id);   // ⚠ v5.990：比對 DB 卡存在一律用 String(id)
    ok(c, '卡庫沒有 id ' + id + '（' + name + '）—— 官方 M-P/SV8a 有這張，我們漏收');
    ok(c.name === name, id + ' 卡名應為「' + name + '」，實際「' + c.name + '」');
    ok(c.collectorNumber === num, id + ' 編號應為 ' + num + '，實際 ' + c.collectorNumber);
    ok(c.regulationMark === mark, id + ' regulationMark 應為 ' + mark);
    ok(c.setCode === setCode, id + ' setCode 應為 ' + setCode);
    ok(c.supertype === supertype, id + ' supertype 應為 ' + supertype);
  }
});

T('⭐ 玳蘿 rulesText 逐字（台灣官方卡面）', () => {
  const c = pool.get(ID_DAITARO);
  ok(c, '卡庫沒有玳蘿');
  const t = (c.rulesText || '').replace(/\s+/g, '');
  ok(t.includes('這張卡必須在上個對手的回合自己的「超級進化寶可夢【ex】」【昏厥】了才可使用。'),
    '玳蘿的使用條件文字對不上官方卡面：' + JSON.stringify(c.rulesText));
  ok(t.includes('從自己的牌庫選擇最多2張基本能量卡，附於自己的1隻「超級進化寶可夢【ex】」身上。並且重洗牌庫。'),
    '玳蘿的效果文字對不上官方卡面：' + JSON.stringify(c.rulesText));
});

T('⭐ 19630 與其他「老大的指令」印刷卡面逐字相同（所以走同一條中央管線）', () => {
  const a = pool.get(ID_BOSS_UBA);
  const b = [...pool.values()].find((c) => c.name === '老大的指令' && String(c.id) !== ID_BOSS_UBA);
  ok(a && b, '找不到兩張卡');
  ok((a.rulesText || '').replace(/\s+/g, '') === (b.rulesText || '').replace(/\s+/g, ''),
    '卡面不同 —— 不可以共用 factory，請重讀卡面：' + JSON.stringify(a.rulesText));
});

T('⭐ index.json 的張數已同步（禁 build-sets-index.js 重生）', () => {
  for (const code of ['M-P-I', 'M-P-J', 'SV8a']) {
    const e = INDEX.find((x) => x.code === code);
    ok(e, 'index.json 沒有 ' + code);
    const arr = JSON.parse(readFileSync(join(dir, code + '.json'), 'utf8'));
    ok(e.cardCount === arr.length && e.count === arr.length,
      code + ' 張數不同步：index=' + e.cardCount + '/' + e.count + ' 實際=' + arr.length);
    ok(e.regulationMark && e.name && e.name !== code, code + ' 的手工欄位被重生洗掉了');
  }
});

console.log('② 玳蘿：gate 與效果（走中央 startEnergyChain singleTarget）');

T('⭐⭐⭐ 玳蘿／老大的指令都已註冊 effect + gate', () => {
  for (const n of ['玳蘿', '老大的指令']) {
    ok(mod.TRAINER_EFFECTS.has(n), '沒有註冊 TRAINER_EFFECTS：' + n);
    ok(mod.TRAINER_GUARDS.has(n), '沒有註冊 TRAINER_GUARDS（gate）：' + n);
  }
  ok(mod.RESOLVERS.has('v6191-daitaro-pick'), '玳蘿的 resolver 沒註冊 —— picker 會卡死');
});

T('⭐ Gust 系卡名單一來源（禁兩處各抄一份；v6.193 改名後不留死條目）', () => {
  ok(mod.GUST_SUPPORTER_NAMES.includes('老大的指令'), '清單缺 老大的指令');
  ok(!mod.GUST_SUPPORTER_NAMES.includes('老大的指令（烏羽）'),
    '19630 已改名為「老大的指令」⇒ 清單裡的括號冠名條目是零產出的死條目，必須刪');
});

const MEGA_EX_ID = '17975';           // 超級艾路雷朵ex M-P-J 059/M-P
const BASIC_GRASS = [...pool.values()].find((c) => c.supertype === 'Energy' && c.subtype === 'Basic' && c.name.includes('【草】'));
const NON_MEGA_ID = '14084';          // 菊草葉（基礎，非 Mega ex）

T('⭐ isMegaExCard 認得超級艾路雷朵ex、不認菊草葉（測試盤面自驗）', () => {
  ok(mod.isMegaExCard(pool.get(MEGA_EX_ID)), '中央述詞不認 ' + pool.get(MEGA_EX_ID)?.name);
  ok(!mod.isMegaExCard(pool.get(NON_MEGA_ID)), '中央述詞誤認 ' + pool.get(NON_MEGA_ID)?.name);
  ok(BASIC_GRASS, '卡庫找不到基本【草】能量');
});

// ⭐⭐⭐ Fable 審查抓到、查證屬實：v168_supporters.ts 早有一份「老大的指令（烏羽）」的
//   regG/reg（卡沒進卡庫前是死碼）。effects.ts 的 import 順序會讓它**覆蓋**factory 版。
//   ⚠ 只斷言「檔案裡沒有那串字」是不夠的（v6.154 教訓：字串守衛擋不住接線沒接上）——
//     這裡用**行為端**驗「現在生效的是哪一份」：factory 版的 fail log 含「化石/」，舊版沒有。
T('⭐⭐⭐ 行為端：實際生效的必須是 factory 版（不是被別的檔覆蓋掉的舊註冊）', () => {
  const empty = mkState({ active: inst(NON_MEGA_ID) }, { active: inst(NON_MEGA_ID), bench: [] });
  for (const n of ['老大的指令']) {
    const out = mod.TRAINER_EFFECTS.get(n)(empty, 0, pool);
    const last = out.log[out.log.length - 1];
    const msg = typeof last === 'string' ? last : (last?.message ?? '');
    ok(msg.startsWith(n + '：'), n + ' 的 log 開頭不是卡名：' + msg);
    ok(msg.includes('化石/'),
      n + ' 生效的不是 supporters_gust 的 factory 版（缺「化石/」）—— 有別的檔重複註冊把它覆蓋掉了：' + msg);
  }
});

T('⭐ 靜態對照：v168_supporters.ts 不得再自己註冊任何「老大的指令」', () => {
  const src = readFileSync(join(ROOT, 'src/lib/game/effects/cards/v168_supporters.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // v6.193：改名後「（烏羽）」那個字面量已不存在 ⇒ 只掃它等於永遠綠燈的安慰劑。
  //   改掃**任何**以「老大的指令」開頭的字面量 key 註冊（含未來的冠名版本）。
  ok(!/reg[GR]?\(\s*'老大的指令/.test(src),
    'v168_supporters.ts 又出現「老大的指令…」的字面量註冊 —— 會覆蓋掉 supporters_gust 的 factory');
  // 正對照：判準真的抓得到違規樣本（否則「永遠 PASS」跟「乾淨」長得一樣）
  ok(/reg[GR]?\(\s*'老大的指令/.test("regG('老大的指令（赤日）', () => true);"), '正對照失效');
});

// 場面：自方 active = 超級艾路雷朵ex（Mega ex），牌庫有基本能量

const mkDaitaroState = (koCount, opts = {}) => mkState(
  {
    active: inst(opts.megaOnField === false ? NON_MEGA_ID : MEGA_EX_ID),
    hand: [inst(ID_DAITARO)],
    deck: opts.emptyDeck ? [] : [inst(BASIC_GRASS.id), inst(BASIC_GRASS.id), inst(BASIC_GRASS.id), inst(NON_MEGA_ID)],
  },
  { active: inst(NON_MEGA_ID) },
  { oppAttackKOdMyMegaExInLastOppTurn: [koCount, 0], oppAbilityKOdMyMegaExInLastOppTurn: [0, 0] },
);

T('⭐⭐⭐ gate：上個對手回合沒有自己的 Mega ex 昏厥 → 不可使用', () => {
  ok(mod.TRAINER_GUARDS.get('玳蘿')(mkDaitaroState(0), 0, pool) === false, 'KO=0 卻可使用');
  ok(mod.TRAINER_GUARDS.get('玳蘿')(mkDaitaroState(1), 0, pool) === true, 'KO=1 卻不可使用');
});

T('⭐⭐ gate：牌庫 0 張 / 場上沒有 Mega ex → 不可使用（官方 L805 / L821）', () => {
  ok(mod.TRAINER_GUARDS.get('玳蘿')(mkDaitaroState(1, { emptyDeck: true }), 0, pool) === false,
    '牌庫 0 張仍可使用（官方 L821 電氣發生器：不可以）');
  ok(mod.TRAINER_GUARDS.get('玳蘿')(mkDaitaroState(1, { megaOnField: false }), 0, pool) === false,
    '場上沒有超級進化寶可夢【ex】仍可使用（官方 L805 電氣發生器：不可以）');
});

T('⭐⭐⭐ 效果：deck-search 最多 2 張基本能量（可選 0）→ 全部附到那隻 Mega ex', () => {
  const st0 = mkDaitaroState(1);
  const st1 = mod.TRAINER_EFFECTS.get('玳蘿')(st0, 0, pool);
  const ps = st1.pendingSelection;
  ok(ps && ps.type === 'deck-search', '沒有開牌庫搜尋 picker');
  ok(ps.filter === 'BasicEnergy', 'filter 應為 BasicEnergy，實際 ' + ps.filter);
  ok(ps.maxCount === 2, '卡面「最多2張」→ maxCount 應為 2，實際 ' + ps.maxCount);
  ok(ps.minCount === 0, '帶條件的牌庫搜尋可宣告找不到 → minCount 應為 0');
  ok(ps.params?.allowSkipZero === true, '必須逐卡表態 allowSkipZero（v6.125 規約）');

  const energyIids = st1.players[0].deck.filter((c) => pool.get(c.cardId)?.supertype === 'Energy').slice(0, 2).map((c) => c.iid);
  const st2 = mod.applyAction(st1, { type: 'RESOLVE_SELECTION', selectedIids: energyIids }, pool);
  // 場上只有 1 隻合法目標 → 中央 chain 自動全附（不再彈 picker）
  ok(!st2.pendingSelection, '只有 1 隻 Mega ex 時不該還開 picker');
  const target = st2.players[0].active;
  ok(target.energyAttached.length === 2,
    '2 張能量應全部附到同一隻 Mega ex，實際 ' + target.energyAttached.length);
  ok(st2.players[0].deck.length === 2, '選到的 2 張能量應離開牌庫，實際剩 ' + st2.players[0].deck.length);
});

T('⭐⭐ 「附於1隻」：場上有 2 隻 Mega ex 時必須開單一目標 picker（禁分散）', () => {
  const st0 = mkState(
    { active: inst(MEGA_EX_ID), bench: [inst(MEGA_EX_ID), inst(NON_MEGA_ID)], hand: [inst(ID_DAITARO)],
      deck: [inst(BASIC_GRASS.id), inst(BASIC_GRASS.id), inst(NON_MEGA_ID)] },
    { active: inst(NON_MEGA_ID) },
    { oppAttackKOdMyMegaExInLastOppTurn: [1, 0] },
  );
  const st1 = mod.TRAINER_EFFECTS.get('玳蘿')(st0, 0, pool);
  const energyIids = st1.players[0].deck.filter((c) => pool.get(c.cardId)?.supertype === 'Energy').map((c) => c.iid);
  const st2 = mod.applyAction(st1, { type: 'RESOLVE_SELECTION', selectedIids: energyIids }, pool);
  const ps = st2.pendingSelection;
  ok(ps, '2 隻 Mega ex 卻沒開目標 picker');
  ok(ps.minCount === 1 && ps.maxCount === 1, '「附於1隻」必須是單一目標 picker');
  const valid = ps.params?.validIids ?? [];
  ok(valid.length === 2, '可選目標應只有 2 隻 Mega ex（非 Mega 的備戰不得入選），實際 ' + valid.length);
  const nonMegaIid = st2.players[0].bench.find((c) => pool.get(c.cardId)?.name === '菊草葉')?.iid;
  ok(nonMegaIid && !valid.includes(nonMegaIid), '非「超級進化寶可夢【ex】」竟可被選為目標');
  const st3 = mod.applyAction(st2, { type: 'RESOLVE_SELECTION', selectedIids: [valid[0]] }, pool);
  const all = [st3.players[0].active, ...st3.players[0].bench];
  const got = all.find((c) => c.iid === valid[0]);
  ok(got.energyAttached.length === 2, '2 張能量必須全部附到同一隻，實際 ' + got.energyAttached.length);
});

console.log('③ 中央 KO 計數：只認「超級進化寶可夢【ex】」');

T('⭐⭐ recordOppKO 只在受害者是 Mega ex 時累加（且自 KO 不計）', () => {
  const base = mkState({ active: inst(NON_MEGA_ID) }, { active: inst(MEGA_EX_ID) });
  // activePlayerIndex=0（對手是 0），受害者 idx=1
  const s1 = mod.recordOppKO(base, 1, pool.get(MEGA_EX_ID), 'attack');
  ok((s1.oppAttackKOdMyMegaExThisTurn ?? [0, 0])[1] === 1, 'Mega ex 被招式 KO 沒有計數');
  const s2 = mod.recordOppKO(base, 1, pool.get(NON_MEGA_ID), 'attack');
  ok((s2.oppAttackKOdMyMegaExThisTurn ?? [0, 0])[1] === 0, '非 Mega ex 竟被計入玳蘿的計數');
  const s3 = mod.recordOppKO(base, 0, pool.get(MEGA_EX_ID), 'attack');
  ok((s3.oppAttackKOdMyMegaExThisTurn ?? [0, 0])[0] === 0, '自 KO 不該計入「對手主動 KO 我方」');
});

console.log('④ 同維度連帶：AI 的 bench-choose 漏 includeActive（與 opp-bench-choose 不對稱）');

T('⭐⭐ AI：bench-choose 宣告 includeActive 時，備戰區空也要選得到戰鬥位', () => {
  const st = mkState(
    { active: inst(MEGA_EX_ID), bench: [], hand: [], deck: [], discard: [] },
    { active: inst(NON_MEGA_ID) },
  );
  st.pendingSelection = {
    type: 'bench-choose', actorIdx: 0, sourcePlayerIdx: 0,
    minCount: 1, maxCount: 1, effectKey: 'energy-coin-attach',
    params: { includeActive: true, energyIid: 'nope', energyName: '基本【草】能量' },
  };
  const act = mod.getAIAction(st, pool, 0);
  ok(act && act.type === 'RESOLVE_SELECTION', 'AI 沒有回應 picker');
  ok(act.selectedIids.length === 1 && act.selectedIids[0] === st.players[0].active.iid,
    'AI 送回 ' + JSON.stringify(act.selectedIids) + '：備戰區空 + includeActive:true 時應選戰鬥位，'
    + '否則卡（能量硬幣／能量貼紙／女服務生 等 15 個 picker）等於白打');
});

console.log('⑤ 可重複執行的缺口檢查必須存在（一勞永逸）');

T('⭐⭐⭐ 官方快照 manifest ＋ 完整性守衛 ＋ 更新腳本三件都在', () => {
  for (const p of ['scripts/data/official-set-manifest.json',
                   'scripts/test-official-set-completeness.mjs',
                   'scripts/refresh-official-set-manifest.mjs']) {
    ok(existsSync(join(ROOT, p)), '缺少 ' + p + ' —— 沒有它，下一批官方新卡又只能靠玩家回報');
  }
});

console.log('\n=== v6.191 官方完整性補收：PASS ' + pass + ' / FAIL ' + fail + ' ===');
if (fail > 0) process.exit(1);
