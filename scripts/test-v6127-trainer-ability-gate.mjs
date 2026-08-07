// v6.127 守衛：效果**完全無法執行**時，訓練家卡／特性必須「不能使用」（gate 擋住）。
//
// 站長提出的規則論述（本版的起點）：
//   「如果棄牌區沒有對應的卡牌，這張牌根本就不能使用。因此就算卡面寫『任意數量／若希望／
//     以任意方式／任意選擇』，只要**已知資訊（棄牌區／自己手牌／自己場上）的狀況不符合**，
//     特性、手牌就應該直接 gate 住不能使用；而如果是招式，就是直接不發動效果。」
//
// 官方判例（`PTCG RULES/PTCG_RULES.md`，逐條查證）：
//   L805  電氣發生器（備戰無【雷】寶可夢）           → 「不可以」
//   L819  野餐籃（雙方場上都沒有傷害指示物）          → 「不可以」
//   L821  電氣發生器（牌庫 0 張）                  → 「不可以」
//   L1957 三合一磁怪｜過度放電（棄牌區無基本能量）**特性** → 「不可以」
//   L2321 危險光線（對手已經灼傷＋混亂）            → 「不可以」
//   ⚠ **招式不同**：L1578 鐵斑葉｜補全之網 棄牌區只有 1 張仍「**可以**」使用
//     → 招式不被禁用，只是效果不發動。所以本守衛只管訓練家／特性。
//
// ⚠ 兩個不套用此判準的例外（官方明文，寫死在此避免日後誤修）：
//   ・**多部效果卡**只要有一部分能執行就可以用：奇樹 L1401／阿楓 L833／夜間學院 L1712。
//     所以「管理員」牌庫 0 但場上有居民會館時**仍可使用**（放回牌庫那半段有效果）。
//   ・**但「先從已知區選擇 → 然後…」結構**前段失敗會封殺整張：米莫莎 L837。
//   ⇒ gate 一律 per-card 寫，不可寫成自動通則。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x127-s.js'), E = join(ROOT, '.x127-e.ts'), O = join(ROOT, '.x127-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* */ } } });
writeFileSync(S, 'export const base="";');
writeFileSync(E,
  "export { TRAINER_GUARDS, canPlayTrainer } from './src/lib/game/effects/_shared';\n"
  + "import './src/lib/game/effects';\n");
await build({
  entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error',
});
const mod = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
const byName = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
    if (c?.id == null) continue;
    pool.set(String(c.id), c);
    if (['H', 'I', 'J'].includes(c.regulationMark) && !byName.has(c.name)) byName.set(c.name, c);
  }
}
const findCard = (pred) => [...pool.values()].find(pred);
const BASIC_E = findCard((c) => c.supertype === 'Energy' && c.subtype === 'Basic');
const ANCIENT = findCard((c) => c.supertype === 'Pokemon' && (c.tags ?? []).includes('古代'));
const DARK_PK = findCard((c) => c.supertype === 'Pokemon' && c.pokemonType === 'Darkness');
const PLAIN_PK = findCard((c) => c.supertype === 'Pokemon' && c.pokemonType !== 'Darkness'
  && !(c.tags ?? []).includes('古代'));
const HALL = byName.get('居民會館');

let pass = 0, fail = 0;
function T(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e && e.message)); fail++; }
}
function ok(cond, msg) { if (!cond) throw new Error(msg); }

const inst = (iid, cardId) => ({ iid, cardId: String(cardId), damage: 0,
  energyAttached: [], evolvedFromStack: [], toolAttached: null });
function mk({ deck = 0, hand = 1, discard = 0, myActive = PLAIN_PK, oppActive = PLAIN_PK,
  stadium = null } = {}) {
  const side = (i, act) => ({
    name: 'p' + i, active: act ? inst('act' + i, act.id) : null, bench: [], prizes: [inst('z' + i, PLAIN_PK.id)],
    hand: Array.from({ length: hand }, (_, k) => inst(`h${i}${k}`, PLAIN_PK.id)),
    deck: Array.from({ length: deck }, (_, k) => inst(`d${i}${k}`, PLAIN_PK.id)),
    discard: Array.from({ length: discard }, (_, k) => inst(`x${i}${k}`, BASIC_E.id)),
  });
  return {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
    isFirstTurn: false, log: [], pendingSelection: null, pendingChainQueue: [],
    setupDone: [true, true], pendingPrizes: [0, 0],
    activeStadium: stadium ? inst('stad', stadium.id) : null,
    players: [side(0, myActive), side(1, oppActive)],
  };
}
const gate = (n, st) => {
  const g = mod.TRAINER_GUARDS.get(n);
  ok(g, `${n} 沒有 regG —— 條件不符時會白白消耗一張卡`);
  return g(st, 0, pool);
};

console.log('① 純牌庫型：牌庫為空 → 不能使用（官方 L821）');

for (const n of ['黑連', '野餐女孩', '帕底亞的夥伴', '蓋伊', '高級香氛', '黑暗球', '精靈球', '小剛的發掘']) {
  T(`${n}：牌庫 0 擋住 / 牌庫有牌放行`, () => {
    ok(byName.has(n), `${n} 不在 live HIJ 卡池（卡池變動？請重新檢視本守衛）`);
    ok(gate(n, mk({ deck: 0 })) === false, `${n} 牌庫空卻可以使用 —— 抽/搜 0 張＝完全無效果`);
    ok(gate(n, mk({ deck: 10 })) === true, `${n} 牌庫有牌卻被擋 —— gate 過嚴`);
  });
}

console.log('② 依場上／手牌狀態的 gate');

T('⭐⭐ 覺醒戰鼓：場上沒有「古代」寶可夢 → 不能使用（抽 0 張）', () => {
  ok(ANCIENT, '卡池找不到「古代」寶可夢');
  ok(gate('覺醒戰鼓', mk({ deck: 10, myActive: PLAIN_PK })) === false,
    '場上 0 隻古代卻可以使用 —— 會白白消耗一張卡（官方 L805 電氣發生器同型）');
  ok(gate('覺醒戰鼓', mk({ deck: 10, myActive: ANCIENT })) === true, '場上有古代卻被擋');
  ok(gate('覺醒戰鼓', mk({ deck: 0, myActive: ANCIENT })) === false, '牌庫空仍放行');
});

T('⭐⭐ 手部修剪器：雙方手牌都 ≤5 → 不能使用（沒有卡會被丟）', () => {
  // ⚠ gate 時這張卡還在自己手上，自己那側要 −1
  ok(gate('手部修剪器', mk({ hand: 4 })) === false, '雙方手牌都 ≤5 卻可以使用');
  ok(gate('手部修剪器', mk({ hand: 9 })) === true, '雙方手牌都 8 張（>5）卻被擋');
});

T('⭐⭐ 火箭隊的雅典娜：手牌已達標或牌庫空 → 不能使用', () => {
  ok(gate('火箭隊的雅典娜', mk({ deck: 10, hand: 6 })) === false,
    '手牌（扣掉本卡）已 5 張卻可以使用 —— 抽 0 張');
  ok(gate('火箭隊的雅典娜', mk({ deck: 10, hand: 3 })) === true, '手牌不足卻被擋');
  ok(gate('火箭隊的雅典娜', mk({ deck: 0, hand: 1 })) === false, '牌庫空仍放行');
});

T('⭐⭐ 暗黑鈴：雙方戰鬥位都是【惡】 → 不能使用（卡面明文排除【惡】）', () => {
  ok(DARK_PK, '卡池找不到【惡】寶可夢');
  ok(gate('暗黑鈴', mk({ myActive: DARK_PK, oppActive: DARK_PK })) === false,
    '雙方都是【惡】卻可以使用 —— 完全沒有狀態會改變（官方 L2321 危險光線同型）');
  ok(gate('暗黑鈴', mk({ myActive: PLAIN_PK, oppActive: DARK_PK })) === true,
    '有一隻非【惡】卻被擋');
});

T('⭐ 暗黑鈴：⚠ 站長裁定 —— 混亂「免疫」**不算**進 gate', () => {
  // 免疫是防禦方的能力，不該讓攻擊方連卡都打不出來；官方 L2321 只涵蓋「狀態已經存在」。
  const st = mk({ myActive: PLAIN_PK, oppActive: PLAIN_PK });
  ok(gate('暗黑鈴', st) === true, '前提：一般盤面可以使用');
  const src = readFileSync(join(ROOT, 'src/lib/game/effects/cards/m5_preview.ts'), 'utf8');
  const i = src.indexOf("regG('暗黑鈴'");
  ok(i > 0, '找不到暗黑鈴的 regG');
  const body = src.slice(i, src.indexOf('});', i));
  ok(!/[Ii]mmune/.test(body),
    '暗黑鈴的 gate 把「免疫」也算進去了 —— 站長 2026-08-07 裁定：免疫不 gate');
});

T('⭐⭐ 管理員：牌庫空**且**沒有居民會館才擋（多部效果卡，官方 L1712 夜間學院同型）', () => {
  ok(gate('管理員', mk({ deck: 0 })) === false, '牌庫空又沒有居民會館，卻可以使用');
  ok(gate('管理員', mk({ deck: 5 })) === true, '牌庫有牌卻被擋');
  if (HALL) {
    ok(gate('管理員', mk({ deck: 0, stadium: HALL })) === true,
      '牌庫空但場上有「居民會館」時仍該可以使用 —— 「把這張卡放回牌庫」那半段有效果');
  }
});

console.log('②b ⭐ 站長裁定（v6.128）：多部效果卡灰區三張，牌庫空時**不能執行**');

// 這三張牌庫空時仍有第二段（棄手牌／回合結束）能執行，依官方 L833 阿楓／L1712 夜間學院的
// 「一部分能執行就可用」通則原本可能放行 —— 但那半段對玩家**只有壞處**。
// 站長 2026-08-08 裁定：主效果無法執行就不能使用，不讓玩家誤按而只吃到代價。
for (const n of ['納莉', '丹瑜', '小霞的朝氣']) {
  T(`${n}：牌庫空 → 不能使用（站長裁定，不讓玩家只吃到代價）`, () => {
    ok(byName.has(n), `${n} 不在 live HIJ 卡池`);
    ok(gate(n, mk({ deck: 0 })) === false,
      `${n} 牌庫空卻可以使用 —— 主效果（抽卡／搜能量）無法執行，只剩棄手牌／結束回合的代價`);
    ok(gate(n, mk({ deck: 10 })) === true, `${n} 牌庫有牌卻被擋`);
  });
}

console.log('③ 特性：幸福蛋ex｜幸福切換（原本完全沒有 gate）');

T('⭐⭐⭐ 幸福切換必須有可用性 gate（否則白按就損失特性權）', () => {
  const eng = readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8');
  ok(/ab\.name === '幸福切換'/.test(eng),
    '幸福蛋ex｜幸福切換 在 getUsableAbilities 沒有 gate。\n'
    + '      ⚠ USE_ABILITY 是「先標記本回合已用特性、再執行特性函式」，所以條件不符時按下去\n'
    + '        只會 log 一行，**特性權已經被吃掉**。\n'
    + '      官方同型：L1957 三合一磁怪｜過度放電（棄牌區無基本能量）「不可以使用」。');
  const i = eng.indexOf("ab.name === '幸福切換'");
  const body = eng.slice(i, i + 700);
  ok(/field\.length < 2/.test(body), '沒有檢查「場上要有另一隻寶可夢當接收方」');
  ok(/subtype === 'Basic'/.test(body), '沒有檢查「場上有附加基本能量」');
});

T('⭐ 對照組：官方明文的過度放電本來就有 gate（證明這是一致性缺口，不是新規則）', () => {
  const eng = readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8');
  ok(/ab\.name === '過度放電'/.test(eng), '過度放電的 gate 不見了（本守衛的對照組失效）');
});

console.log('④ 枚舉守衛：純抽卡／牌庫搜尋型訓練家不得再漏 gate');

T('⭐⭐ 卡面「從自己的牌庫抽出N張卡」的 HIJ 訓練家，都必須有牌庫非空 gate', () => {
  const miss = [];
  for (const [name, c] of byName) {
    if (c.supertype !== 'Trainer') continue;
    const t = c.rulesText || '';
    // 只挑「單一效果就是抽卡」的（有第二段效果的另有官方判準，見檔頭「多部效果卡」）
    if (!/^從自己的牌庫抽出\d+張卡。$/.test(t.trim())) continue;
    const g = mod.TRAINER_GUARDS.get(name);
    if (!g || g(mk({ deck: 0 }), 0, pool) !== false) miss.push(`${name}：${t.trim()}`);
  }
  ok(miss.length === 0,
    '這些純抽卡訓練家在牌庫為空時仍可使用（白白消耗一張卡，官方 L821 明文「不可以」）：\n      '
    + miss.join('\n      '));
});

console.log('\n=== v6.127 訓練家／特性 gate 守衛：PASS ' + pass + ' / FAIL ' + fail + ' ===');
process.exit(fail ? 1 : 0);
