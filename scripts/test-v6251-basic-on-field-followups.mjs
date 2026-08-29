// v6.251 守衛：v6.250「場上視角的【基礎】寶可夢」收斂之後，獨立審查抓到的三個漏網。
//
// ⭐ 二分法紀律（官方裁定，出處＝`PTCG RULES/PTCG_RULES.json` 的 `qa[].id`）：
//   ・手牌／牌庫／棄牌區視角 → isBasicPokemonCard（化石在這些區域是**物品**卡）
//       id 789 禿鷹娜｜瞄準獵物 選對手手牌的化石 → 不可以
//       id 795 保母曼波｜溫柔鰭 從棄牌區拿化石 → 不可以
//       id 572 配樂之笛 翻對手牌庫頂看到化石 → 不可以
//   ・場上 instance 視角 → isBasicPokemonOnField（化石在場上就是【基礎】寶可夢）
//       id 783 保母蟲｜治癒襁褓 可以恢復場上化石的 HP
//       id 787 雙斧戰龍｜斧擊衝撞 可以把對手戰鬥場的化石【昏厥】
//
// 三個漏網（v6.250 的 lint 只掃 `.stage === 'Basic'`，它們全躲在
// `supertype === 'Pokemon' && !evolvesFrom` 這個等價樣式底下）：
//   ① 保母蟲｜治癒襁褓（v2620_i_wave12_misc5.ts）— 場上化石完全不回血（直接違反官方 id 783）
//   ② 變化之書（items_misc.ts）— 場上互換目標排除化石；且本地 helper `isBasicOnField`
//      只因**名字**和中央述詞不同就躲過 lint（本地版遮蔽中央版的溫床）
//   ③ 琉琪亞的展示（v172_hij_batch.ts）— 對「對手備戰的【基礎】」用了卡片視角
//
// ⭐ 本檔的 lint 因此**擴充**成兩種樣式：
//   A：`!x.evolvesFrom`（用「有沒有進化來源」判【基礎】）
//   B：名稱含 Basic 的**本地述詞定義**（防止再出現 isBasicOnField 這種同義本地版）
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.v6251-s.js'), E = join(ROOT, '.v6251-e.ts'), O = join(ROOT, '.v6251-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* noop */ } } });
writeFileSync(S, 'export const base="";');
writeFileSync(E,
  "export { applyAction, isBasicPokemonOnField, isBasicPokemonCard } from './src/lib/game/engine';\n"
  + "export { TRAINER_GUARDS } from './src/lib/game/effects';\n"
  + "import './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const M = await import(pathToFileURL(O).href);
const { applyAction } = M;

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
const QA = JSON.parse(readFileSync(join(ROOT, 'PTCG RULES/PTCG_RULES.json'), 'utf8'));
const QA_ARR = Array.isArray(QA) ? QA : (QA.qa || Object.values(QA));
const qa = (id) => QA_ARR.find(x => String(x.id) === String(id));

let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  OK  ', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };
const ok = (c, m) => { if (!c) throw new Error(m); };
const logText = (l) => String(l?.message ?? l?.text ?? l);

// ── 卡片 id（全部從 static/cards 逐字查證）─────────────────────────────────
const FOSSIL   = '17128'; // 陳舊的羽毛化石（Item / I）— 官方 id 783/787 用的就是這張
const FIN      = '18046'; // 陳舊的鰭之化石（Item / J）— 站內給它「不受對手支援者影響」的被動
const BASIC    = '14086'; // 願增猿（Basic / subtype=Basic）
const BASICEX  = '14085'; // 拉普拉斯ex（Basic / subtype=ex）
const STAGE2   = '17971'; // 大竺葵（Stage2 / 非 ex）
const NANNY    = '13031'; // 保母蟲（Stage2 / I）— 招式「治癒襁褓」
const BOOK     = '18494'; // 變化之書（Item / J）
const LUCIA    = '17201'; // 琉琪亞的展示（Supporter / H）

let nn = 0;
const inst = (cid, e = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [],
  status: undefined, secondaryStatus: undefined, tertiaryStatus: undefined, ...e });
const prizeSet = () => Array.from({ length: 6 }, () => inst(BASIC));
const ZH_OF = { Grass: '草', Fire: '火', Water: '水', Lightning: '雷', Psychic: '超',
                Fighting: '鬥', Darkness: '惡', Metal: '鋼' };
const ENERGY_ID = {};
for (const c of pool.values()) {
  if (c.supertype !== 'Energy' || c.subtype !== 'Basic') continue;
  for (const [k, zh] of Object.entries(ZH_OF)) if (!ENERGY_ID[k] && c.name === `基本【${zh}】能量`) ENERGY_ID[k] = String(c.id);
}
ENERGY_ID.Colorless = ENERGY_ID.Colorless ?? ENERGY_ID.Water;

function mk(p0 = {}, p1 = {}) {
  return {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
    isFirstTurn: false, log: [], setupDone: [true, true], pendingMulliganDraw: [0, 0],
    pendingPrizes: [0, 0], pendingSelection: null, activeStadium: null,
    players: [
      { name: 'P1', active: null, bench: [], hand: [], deck: [], discard: [], prizes: prizeSet(), ...p0 },
      { name: 'P2', active: null, bench: [], hand: [], deck: [], discard: [], prizes: prizeSet(), ...p1 },
    ],
  };
}

console.log('① 卡面逐字複驗（禁憑印象；全部讀 static/cards 與官方 QA）');

T('官方 id 783 逐字＝治癒襁褓可以恢復場上化石的 HP', () => {
  const e = qa(783);
  ok(e, '找不到 QA id 783');
  ok(e.question.includes('治癒襁褓') && e.question.includes('陳舊的羽毛化石'), e.question);
  ok(e.question.includes('作為[基礎]寶可夢放置於場上'), e.question);
  ok(e.answer.startsWith('可以'), '官方答案不是「可以」：' + e.answer);
});

T('官方 id 795 逐字＝棄牌區的化石是「物品」卡（棄牌區那半不可以一起改）', () => {
  const e = qa(795);
  ok(e && e.answer.startsWith('不可以'), e && e.answer);
  ok(e.answer.includes('在棄牌區時視為「物品」卡'), e.answer);
});

T('保母蟲｜治癒襁褓 卡面逐字＝自己的所有【基礎】寶可夢各回 100 HP', () => {
  const c = pool.get(NANNY);
  ok(c && c.name === '保母蟲', '找不到保母蟲');
  const a = (c.attacks || []).find(x => x.name === '治癒襁褓');
  ok(a && a.effect === '將自己的所有【基礎】寶可夢各恢復「100」HP。', a && a.effect);
  ok(!/牌庫|棄牌|手牌/.test(a.effect), '卡面沒有提到任何非場上區域 ⇒ 純場上視角');
});

T('變化之書 卡面逐字＝棄牌區選【基礎】寶可夢**卡**、與**場上**的【基礎】寶可夢互換（兩個視角）', () => {
  const c = pool.get(BOOK);
  ok(c && c.name === '變化之書' && c.subtype === 'Item', '找不到變化之書');
  ok(c.rulesText.includes('從自己的棄牌區選擇1張【基礎】寶可夢卡'), c.rulesText);
  ok(c.rulesText.includes('與自己的場上的1隻【基礎】寶可夢互換'), c.rulesText);
  ok(c.rulesText.includes('將換下的寶可夢丟棄'), c.rulesText);
});

T('琉琪亞的展示 卡面逐字＝選 1 隻對手**備戰區**的【基礎】寶可夢互換並混亂', () => {
  const c = pool.get(LUCIA);
  ok(c && c.name === '琉琪亞的展示' && c.subtype === 'Supporter', '找不到琉琪亞的展示');
  ok(c.rulesText === '選擇1隻對手的備戰區的【基礎】寶可夢，與戰鬥寶可夢互換。然後，將新上場的寶可夢【混亂】。',
    c.rulesText);
});

T('化石卡面逐字：可作為【基礎】寶可夢放置於場上（且 pool 裡是 Trainer ⇒ 卡片述詞判不到）', () => {
  for (const id of [FOSSIL, FIN]) {
    const c = pool.get(id);
    ok(c.supertype === 'Trainer' && c.subtype === 'Item', `${c.name} 應為 Trainer/Item`);
    ok(c.rulesText.includes('可作為HP60的【無】屬性的【基礎】寶可夢放置於場上'), c.rulesText);
    ok(M.isBasicPokemonCard(c) === false, `${c.name} 的卡片述詞應為 false（手牌／棄牌區＝物品卡）`);
    ok(M.isBasicPokemonOnField({ fossilOnField: true }, c) === true, `${c.name} 場上述詞應為 true`);
  }
  // ⚠⚠ v6.262 更正：這裡原本的註解寫「現行台灣卡面沒有那句／站內被動來自舊版卡面」——
  //   **那是錯的結論，只讀了 rulesText**。陳舊的鰭之化石那句免疫在
  //   `abilities[0]`＝特性「鰭之守護」的 `effect` 欄，逐字是
  //   「對手從手牌使出支援者卡時，這隻寶可夢不會受到那個效果的影響。」
  //   （長期記憶鐵律：特性讀 abilities[].effect，不是 .text，也不是 rulesText。）
  const fin = pool.get(FIN);
  ok(!/支援者/.test(fin.rulesText), 'rulesText 這一段只講「作為基礎寶可夢放置／不陷入特殊狀態／無法撤退」');
  const finAb = (fin.abilities || [])[0];
  ok(finAb && finAb.label === '特性' && finAb.name === '鰭之守護', '找不到特性「鰭之守護」');
  ok(finAb.effect === '對手從手牌使出支援者卡時，這隻寶可夢不會受到那個效果的影響。',
    '鰭之守護 effect 逐字不符：' + finAb.effect);
});

console.log('② 漏網①：保母蟲｜治癒襁褓 —— 場上化石必須真的回血（官方 id 783）');

function nannyAttack(targets) {
  const a = inst(NANNY);
  a.energyAttached = [inst(ENERGY_ID.Colorless)];
  const st = mk({ active: a, bench: targets }, { active: inst(BASIC) });
  return applyAction(st, { type: 'ATTACK', attackIndex: 0, actorIdx: 0 }, pool);
}

T('★ 場上化石 damage 50 → 治癒襁褓後應為 0（HEAD：仍是 50）', () => {
  const fossil = inst(FOSSIL, { fossilOnField: true, damage: 50 });
  const out = nannyAttack([fossil]);
  const b = out.players[0].bench.find(c => c.iid === fossil.iid);
  ok(b, '化石應仍在備戰：' + JSON.stringify(out.log.slice(-3).map(logText)));
  ok(b.damage === 0, `場上化石應被治癒襁褓回滿（官方 id 783），實得 damage=${b.damage}`);
});

T('★ 備戰多隻化石全部回血；戰鬥場的保母蟲自己（Stage2）不回血', () => {
  // ⚠ 治癒襁褓是保母蟲自己的招式 ⇒ 攻擊當下戰鬥場一定是保母蟲（Stage2），
  //   所以 active 那一支實務上只會落在「保母蟲自己」身上 —— 正確答案是**不**回血。
  const f1 = inst(FOSSIL, { fossilOnField: true, damage: 40 });
  const f2 = inst(FOSSIL, { fossilOnField: true, damage: 60 });
  const a = inst(NANNY, { damage: 50 });
  a.energyAttached = [inst(ENERGY_ID.Colorless)];
  const st = mk({ active: a, bench: [f1, f2] }, { active: inst(BASIC) });
  const out = applyAction(st, { type: 'ATTACK', attackIndex: 0, actorIdx: 0 }, pool);
  ok(out.players[0].bench.every(c => c.damage === 0), '備戰多隻化石應全部回血：'
    + JSON.stringify(out.players[0].bench.map(c => c.damage)));
  ok(out.players[0].active?.damage === 50, `保母蟲自己是 Stage2，不該回血，實得 ${out.players[0].active?.damage}`);
});

T('正對照：Stage2（大竺葵）damage 50 → 治癒襁褓後仍是 50（判準沒變成無差別）', () => {
  const s2 = inst(STAGE2, { damage: 50 });
  const out = nannyAttack([s2]);
  const b = out.players[0].bench.find(c => c.iid === s2.iid);
  ok(b && b.damage === 50, `Stage2 不是【基礎】，不該回血，實得 ${b && b.damage}`);
});

T('正對照：基礎 ex（拉普拉斯ex，subtype=ex）damage 50 → 回到 0（禁用 subtype 判基礎）', () => {
  const be = inst(BASICEX, { damage: 50 });
  const out = nannyAttack([be]);
  const b = out.players[0].bench.find(c => c.iid === be.iid);
  ok(b && b.damage === 0, `基礎 ex 應回血，實得 ${b && b.damage}`);
});

console.log('③ 漏網②：變化之書 —— 場上互換目標必須含化石，且「看得到」===「勾得動」');

function playBook({ fieldActive, fieldBench = [], discard = [] }) {
  const b1 = inst(BOOK), b2 = inst(BOOK);
  const st = mk({ active: fieldActive, bench: fieldBench, hand: [b1, b2], discard },
                { active: inst(BASIC) });
  return { st, b1 };
}

T('★ 場上只有化石時，變化之書仍可使用（HEAD：gate 直接判 false）', () => {
  const fossil = inst(FOSSIL, { fossilOnField: true });
  const fromDiscard = inst(BASIC);
  const { st, b1 } = playBook({ fieldActive: fossil, discard: [fromDiscard] });
  const g = M.TRAINER_GUARDS.get('變化之書');
  ok(typeof g === 'function', '找不到 變化之書 的 gate');
  ok(g(st, 0, pool) === true, 'gate 應放行（場上化石＝【基礎】寶可夢，官方 id 783/787）');
  ok(b1, 'fixture 健全性');
});

T('★ 場上目標 picker 的 validIids 必須含化石、排除進化寶可夢（filter === validIids）', () => {
  const fossil = inst(FOSSIL, { fossilOnField: true });
  const s2 = inst(STAGE2);
  const fromDiscard = inst(BASIC);
  const { st, b1 } = playBook({ fieldActive: fossil, fieldBench: [s2], discard: [fromDiscard] });
  let out = applyAction(st, { type: 'PLAY_TRAINER', iid: b1.iid }, pool);
  ok(out.pendingSelection?.effectKey === 'changing-book-step1',
    '第一段（棄牌區選【基礎】寶可夢卡）沒開：' + JSON.stringify(out.log.slice(-2).map(logText)));
  out = applyAction(out, { type: 'RESOLVE_SELECTION', selectedIids: [fromDiscard.iid] }, pool);
  const ps = out.pendingSelection;
  ok(ps?.effectKey === 'changing-book-step2', '第二段（選場上目標）沒開：'
    + JSON.stringify(out.log.slice(-2).map(logText)));
  const vi = ps.params?.validIids;
  ok(Array.isArray(vi), 'step2 沒有宣告 validIids ⇒ picker 會列出場上所有寶可夢（v6.109「看得到卻勾不動」的反面）');
  ok(vi.includes(fossil.iid), '場上化石不在候選裡（官方 id 783/787）：' + JSON.stringify(vi));
  ok(!vi.includes(s2.iid), 'Stage2 不該進候選：' + JSON.stringify(vi));
  ok(ps.params?.filterBasic === undefined, '死參數 filterBasic 還在（全站沒有任何消費點）');
});

T('★ 完整互換：化石換成棄牌區的【基礎】寶可夢，且換上去的那隻**不得**殘留化石身分', () => {
  const fossil = inst(FOSSIL, { fossilOnField: true, damage: 20 });
  const fromDiscard = inst(BASIC);
  const { st, b1 } = playBook({ fieldActive: fossil, discard: [fromDiscard] });
  let out = applyAction(st, { type: 'PLAY_TRAINER', iid: b1.iid }, pool);
  out = applyAction(out, { type: 'RESOLVE_SELECTION', selectedIids: [fromDiscard.iid] }, pool);
  out = applyAction(out, { type: 'RESOLVE_SELECTION', selectedIids: [fossil.iid] }, pool);
  const act = out.players[0].active;
  ok(act && act.cardId === BASIC, `戰鬥場應換成願增猿，實得 ${act && pool.get(act.cardId)?.name}\n`
    + out.log.map(logText).slice(-4).join('\n'));
  ok(act.damage === 20, `卡面「傷害指示物…全部保留」，實得 ${act.damage}`);
  ok(!act.fossilOnField,
    '⚠ 換上去的寶可夢殘留 fossilOnField ⇒ 會變成 HP60、不能撤退、不會中狀態的假化石');
  ok(out.players[0].discard.some(c => c.cardId === FOSSIL), '換下的化石應被丟棄');
});

T('正對照：場上只有 Stage2 時 gate 為 false（沒有變成無差別放行）', () => {
  const { st } = playBook({ fieldActive: inst(STAGE2), discard: [inst(BASIC)] });
  ok(M.TRAINER_GUARDS.get('變化之書')(st, 0, pool) === false, '場上沒有【基礎】就不該可以使用');
});

T('⭐ 棄牌區那半維持**卡片視角**：棄牌區只有化石時 gate 為 false（官方 id 795）', () => {
  const { st } = playBook({ fieldActive: inst(BASIC), discard: [inst(FOSSIL)] });
  ok(M.TRAINER_GUARDS.get('變化之書')(st, 0, pool) === false,
    '棄牌區的化石是**物品**卡，不可以被當成【基礎】寶可夢卡選出來（官方 id 795）');
});

console.log('④ 漏網③：琉琪亞的展示 —— 對手備戰的化石是合法目標');

T('★ 對手備戰只有化石時，琉琪亞的展示仍可使用（HEAD：gate 判 false）', () => {
  const st = mk({ active: inst(BASIC), hand: [inst(LUCIA)] },
                { active: inst(STAGE2), bench: [inst(FOSSIL, { fossilOnField: true })] });
  ok(M.TRAINER_GUARDS.get('琉琪亞的展示')(st, 0, pool) === true,
    'gate 應放行（對手備戰的化石＝【基礎】寶可夢）');
});

T('★ 完整流程：化石被換到對手戰鬥場，且不會被【混亂】（化石不會陷入特殊狀態）', () => {
  const lucia = inst(LUCIA);
  const fossil = inst(FOSSIL, { fossilOnField: true });
  const oppActive = inst(STAGE2);
  const st = mk({ active: inst(BASIC), hand: [lucia] }, { active: oppActive, bench: [fossil] });
  let out = applyAction(st, { type: 'PLAY_TRAINER', iid: lucia.iid }, pool);
  const vi = out.pendingSelection?.params?.validIids;
  ok(out.pendingSelection?.effectKey === 'lucia-show',
    'picker 沒開：' + JSON.stringify(out.log.slice(-2).map(logText)));
  ok(Array.isArray(vi) && vi.includes(fossil.iid), '化石不在候選裡：' + JSON.stringify(vi));
  out = applyAction(out, { type: 'RESOLVE_SELECTION', selectedIids: [fossil.iid] }, pool);
  ok(out.players[1].active?.iid === fossil.iid, '化石應被換到對手戰鬥場');
  ok(out.players[1].active.status === undefined && out.players[1].active.secondaryStatus === undefined
     && out.players[1].active.tertiaryStatus === undefined,
    '化石卡面「不會陷入特殊狀態」，不該真的帶著【混亂】');
});

T('正對照：對手備戰只有 Stage2 → gate 為 false', () => {
  const st = mk({ active: inst(BASIC), hand: [inst(LUCIA)] },
                { active: inst(BASIC), bench: [inst(STAGE2)] });
  ok(M.TRAINER_GUARDS.get('琉琪亞的展示')(st, 0, pool) === false, 'Stage2 不是【基礎】，不該可用');
});

T('⭐ 現況鎖：陳舊的鰭之化石仍被排除（特性「鰭之守護」；由中央免疫述詞 isImmuneToOppSupporter 接手）', () => {
  const st = mk({ active: inst(BASIC), hand: [inst(LUCIA)] },
                { active: inst(STAGE2), bench: [inst(FIN, { fossilOnField: true })] });
  ok(M.TRAINER_GUARDS.get('琉琪亞的展示')(st, 0, pool) === false,
    '鰭之化石的支援者免疫沒有被 isImmuneToOppSupporter 接住 ⇒ 刪內聯檢查刪錯了');
});

console.log('⑤ lint 擴充：`!x.evolvesFrom` 樣式 ＋ 同義的本地 Basic 述詞定義');

/** 剝掉 // 與 block 註解（說明文字會引用舊寫法，不剝會誤判） */
function stripComments(src) {
  let out = '', st = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i], n = src[i + 1] || '';
    if (st === 0) {
      if (c === '/' && n === '/') { st = 1; i++; out += '  '; continue; }
      if (c === '/' && n === '*') { st = 2; i++; out += '  '; continue; }
      out += c; continue;
    }
    if (st === 1) { if (c === '\n') { st = 0; out += '\n'; } else out += ' '; continue; }
    if (c === '*' && n === '/') { st = 0; i++; out += '  '; continue; }
    out += (c === '\n' ? '\n' : ' ');
  }
  return out;
}
/** ⚠ `!!x.evolvesFrom` 是「是不是進化」，不是本維度 ⇒ 用 lookbehind 排除。 */
const NEG_EVO_RE = /(?<!!)!\s*[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*\.evolvesFrom/;

/** 一律正規化成 `/src/...`（ROOT 尾端有沒有斜線都不影響白名單比對）。 */
const relOf = (f) => ('/' + f.replace(ROOT, '').replace(/\\/g, '/').replace(/^\/+/, ''));
const GAME_FILES = [];
(function walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p); else if (e.name.endsWith('.ts')) GAME_FILES.push(p);
  }
})(join(ROOT, 'src/lib/game'));

/**
 * 白名單（樣式 A）：**非場上視角**、或雖是場上視角但對化石無行為差異且已查證的用法。
 * 每筆＝[相對路徑, 該行剝註解後 trim 的完整內容, 理由]。⚠ 下方有死條目檢查。
 */
const ALLOW_A = [
  // ── 牌庫／手牌／棄牌區視角（卡片述詞的等價寫法或其 AI 鏡射）──────────────
  ['/src/lib/game/selection-filter.ts', "return !card.evolvesFrom;", '中央卡片述詞 isBasicPokemonCard 本體'],
  ['/src/lib/game/selection-filter.ts', "'PsychicBasic': (c) => c.supertype === 'Pokemon' && !c.evolvesFrom && c.pokemonType === 'Psychic',", '中央 deck-search filter（牌庫視角）'],
  ['/src/lib/game/selection-filter.ts', "'RocketBasic':    (c) => c.supertype === 'Pokemon' && !c.evolvesFrom && c.name.includes('火箭隊的'),", '中央 deck-search filter（牌庫視角）'],
  ['/src/lib/game/selection-filter.ts', "if (c.supertype === 'Pokemon' && !c.evolvesFrom && c.pokemonType === 'Fighting') return true;", '中央 deck-search filter（牌庫視角）'],
  ['/src/lib/game/ai.ts', "if (f === 'Basic')           return card.supertype === 'Pokemon' && !card.evolvesFrom", 'AI 鏡射 UI 的牌庫／手牌 filter'],
  ['/src/lib/game/ai.ts', "if (f === 'PsychicBasic')    return card.supertype === 'Pokemon' && !card.evolvesFrom && card.pokemonType === 'Psychic';", '同上'],
  ['/src/lib/game/ai.ts', "if (card.supertype === 'Pokemon' && !card.evolvesFrom && card.pokemonType === 'Grass') return true;", '同上'],
  ['/src/lib/game/ai.ts', "if (card.supertype === 'Pokemon' && !card.evolvesFrom && card.pokemonType === 'Fighting') return true;", '同上'],
  ['/src/lib/game/ai.ts', "return card.supertype === 'Pokemon' && !card.evolvesFrom && card.name.includes('火箭隊的');", '同上'],
  ['/src/lib/game/effects.ts', "return !card.evolvesFrom;", '謎擬Q｜呼朋引伴的 gate＝掃自己**牌庫**（牌庫視角）'],
  ['/src/lib/game/effects/cards/energy_cards.ts', "return cc?.supertype === 'Pokemon' && !cc.evolvesFrom && cc.pokemonType === 'Psychic';", '感應【超】能量＝從**牌庫**找基礎【超】'],
  ['/src/lib/game/effects/cards/pokemon_search.ts', "if (!(card?.supertype === 'Pokemon' && !card.evolvesFrom)) return false;", 'bench-named-basic-from-deck resolver 再驗證（牌庫視角）'],
  ['/src/lib/game/engine.ts', "if (card.subtype !== 'Stage1' && card.subtype !== 'Stage2' && !card.evolvesFrom) return true;", 'canBeInitialActiveCard＝對戰準備時從**手牌**放（官方 id 786：化石不可以）'],
  // ── 「是不是進化寶可夢」的判定（不是【基礎】判定）─────────────────────────
  ['/src/lib/game/ai.ts', "if (!card.evolvesFrom) return false;", '壯偉碩木 step1/step2＝要求**有**進化來源'],
  ['/src/lib/game/ai.ts', "if (card.supertype !== 'Pokemon' || !card.evolvesFrom) return false;", '惡之覺醒＝要求**有**進化來源'],
  ['/src/lib/game/effects.ts', "if (!p.retreatingCard.evolvesFrom) return {};", '阿利多斯｜大網＝對手戰鬥場是**進化**寶可夢時撤退費+1'],
  ['/src/lib/game/effects.ts', "if (!att.evolvesFrom) return 0;", '比克提尼｜勝利聲援＝**進化**寶可夢才 +10'],
  ['/src/lib/game/effects/cards/v172_hij_batch.ts', "if (!evoCard || !evoCard.evolvesFrom) {", '壯偉碩木：選到的必須是進化卡'],
  ['/src/lib/game/effects/cards/v172_hij_batch.ts', "if (!evoCard || !evoCard.evolvesFrom || !canEvolveOnto(evoCard.evolvesFrom, stage1Name)) {", '同上'],
  ['/src/lib/game/effects/cards/v2360_j_mark_batch.ts', "if (!evoCard || !evoCard.evolvesFrom) {", '同型：選到的必須是進化卡'],
  ['/src/lib/game/effects/cards/v2650_i_wave15_misc8.ts', "if (!card || card.supertype !== 'Pokemon' || !card.evolvesFrom) return false;", '同型：進化卡判定'],
  ['/src/lib/game/engine.ts', "if (!evoCard || evoCard.supertype !== 'Pokemon' || !evoCard.evolvesFrom) return state;", 'EVOLVE：選到的必須是進化卡'],
  ['/src/lib/game/stage2-index.ts', "if (!c || c.supertype !== 'Pokemon' || !c.evolvesFrom) continue;", '進化鏈索引'],
  ['/src/lib/game/stage2-index.ts', "if (!card || card.supertype !== 'Pokemon' || !card.evolvesFrom) return false;", '進化鏈索引'],
  // ── 場上視角，但已逐條查證對化石**無行為差異**（不改，避免無謂改動）─────────
  ['/src/lib/game/effects.ts', "['尾甲', (att) => att.subtype === 'ex' && !att.evolvesFrom],", '奇麒麟ex｜尾甲的主詞是**攻擊方**；化石沒有招式、subtype 也不是 ex ⇒ 恆不成立'],
  ['/src/lib/game/effects/cards/v2999_g3_wave1.ts', "const isBasic = !victimCard.evolvesFrom && victimCard.stage !== 'Stage1' && victimCard.stage !== 'Stage2';", '爆炸頭水牛｜捲牆：卡住化石的是「【無】屬性」那半（化石 pokemonType=null），屬 v6.206/6.208 的屬性維度待辦，本輪不動'],
  ['/src/lib/game/effects/cards/tools.ts', "TOOL_HP_BONUS.set('勇氣護符', (card) => !card.evolvesFrom ? 50 : 0);", '勇氣護符是 **G 標**，不在維護範圍（v6.112 已載明）'],
];

function collectA() {
  const hits = []; let lines = 0;
  for (const f of GAME_FILES) {
    const src = stripComments(readFileSync(f, 'utf8')).split('\n');
    lines += src.length;
    src.forEach((line, i) => {
      if (NEG_EVO_RE.test(line)) hits.push({ rel: relOf(f), n: i + 1, text: line.trim() });
    });
  }
  return { hits, lines };
}

T("⭐ lint A：`!x.evolvesFrom` 判【基礎】的樣式全部在白名單上", () => {
  ok(GAME_FILES.length > 100, `只掃到 ${GAME_FILES.length} 個 .ts，掃描器壞了？`);      // 下限斷言
  const { hits, lines } = collectA();
  ok(lines > 70000, `只掃到 ${lines} 行，掃描器壞了？`);                                  // 下限斷言
  ok(hits.length >= 25, `只找到 ${hits.length} 筆 !x.evolvesFrom（白名單 ${ALLOW_A.length} 筆）⇒ 掃描器壞了？`);
  const bad = hits.filter(h => !ALLOW_A.some(a => a[0] === h.rel && a[1] === h.text));
  ok(bad.length === 0,
    `手刻「用有沒有進化來源判【基礎】」${bad.length} 處 —— 若是**場上視角**必須改走 isBasicPokemonOnField，`
    + `若是牌庫／手牌／棄牌區視角請走 isBasicPokemonCard 並補進白名單並寫理由：\n`
    + bad.map(h => `${h.rel}:${h.n}  ${h.text.slice(0, 140)}`).join('\n'));
});

T('⭐ lint A：白名單不得有死條目（寫法改了就要重新判定視角）', () => {
  const { hits } = collectA();
  const dead = ALLOW_A.filter(a => !hits.some(h => h.rel === a[0] && h.text === a[1]));
  ok(dead.length === 0, '白名單死條目：\n' + dead.map(a => `${a[0]}  ${a[1]}`).join('\n'));
});

T('⭐⭐ lint A 正對照：三個漏網的**原始樣式**必須被抓到', () => {
  // 以下三段逐字取自 v6.250（＝BASE f3c2008d）的原始碼，是這一輪真的漏掉的三處。
  const leaks = [
    // ① 保母蟲｜治癒襁褓
    "return !!c && c.supertype === 'Pokemon' && !c.evolvesFrom",
    // ② 變化之書 本地 helper / gate
    "return !!card && card.supertype === 'Pokemon' && !card.evolvesFrom",
    // ②' 變化之書 step2 防呆（否定式）
    "if (!fieldCard || fieldCard.supertype !== 'Pokemon' || fieldCard.evolvesFrom",
  ];
  ok(NEG_EVO_RE.test(leaks[0]), '判準抓不到保母蟲的原始樣式 ⇒ 安慰劑：' + leaks[0]);
  ok(NEG_EVO_RE.test(leaks[1]), '判準抓不到變化之書的原始樣式 ⇒ 安慰劑：' + leaks[1]);
  // ⚠ leaks[2] 是「肯定式」(fieldCard.evolvesFrom 為真就拒絕)，樣式 A 抓不到 ——
  //   這正是為什麼還需要樣式 B（本地述詞定義）與行為端測試，靜態單一樣式一定有洞。
  ok(!NEG_EVO_RE.test(leaks[2]), '（記錄用）肯定式寫法本來就不在樣式 A 的射程內');
  // 不可誤抓：中央述詞用法與「是不是進化」判定
  ok(!NEG_EVO_RE.test('if (!isBasicPokemonOnField(inst, pool.get(inst.cardId))) return c;'), '誤抓中央述詞用法');
  ok(!NEG_EVO_RE.test('const isEvo = !!card.evolvesFrom;'), '誤抓「是不是進化」的雙重否定寫法');
  ok(!NEG_EVO_RE.test(stripComments("// 舊寫法：!card.evolvesFrom")), '註解沒被剝掉 ⇒ 會誤報');
  ok(NEG_EVO_RE.test(stripComments("x = !card.evolvesFrom; // 說明")), '剝註解把程式也吃掉了');
});

/** 樣式 B：名稱含 Basic 的**本地述詞定義**（isBasicOnField 那種同義本地版）。 */
const DEF_RE = /(?:function\s+([A-Za-z_$][\w$]*)\s*\(|const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]*)?=>)/g;
const BODY_RE = /evolvesFrom|stage\s*[!=]==\s*'Basic'|subtype\s*[!=]==\s*'Basic'/;
/** [相對路徑, 函式名, 理由] */
const ALLOW_B = [
  ['/src/lib/game/selection-filter.ts', 'isBasicPokemonCard', '中央卡片述詞本體'],
  ['/src/lib/game/selection-filter.ts', 'isBasicPokemonOnField', '中央場上述詞本體'],
  ['/src/lib/game/selection-filter.ts', 'isBasicEnergyOfType', '基本**能量**，非寶可夢'],
  ['/src/lib/game/selection-filter.ts', 'getBasicEnergyType', '基本**能量**，非寶可夢'],
  ['/src/lib/game/ai.ts', 'isBasicGrass', '基本【草】**能量**'],
  ['/src/lib/game/ai.ts', 'isBasicGrass2', '基本【草】**能量**'],
  ['/src/lib/game/effects.ts', 'isRocketBasicTarget', '抵抗之幕：要求卡名含「火箭隊的」⇒ 化石恆不符合'],
  ['/src/lib/game/effects.ts', 'rcHasFieldBasic', '神奇糖果：靠 evolvesFrom **鏈結**逐字比對卡名（canEvolveOnto），不是【基礎】判定；化石可正常被糖果進化'],
  ['/src/lib/game/effects/cards/m2_dragon_charizard_batch.ts', 'isBasicEnergyOf', '基本**能量**'],
  ['/src/lib/game/effects/cards/m6_wave14.ts', 'isBasicOf', '基本**能量**'],
  ['/src/lib/game/effects/cards/v2349_j_mark_batch.ts', 'attachBasicEnergyFromDeckToActive', '基本**能量**'],
  ['/src/lib/game/effects/cards/v2352_j_mark_batch.ts', 'isBasicEnergyName', '基本**能量**'],
  ['/src/lib/game/effects/cards/v2354_j_mark_batch.ts', 'isBasicLightningEnergy', '基本**能量**'],
  ['/src/lib/game/effects/cards/v2401_i_wave2_draw_swap_search.ts', 'deckSearchBasicEnergyPost', '基本**能量**'],
  ['/src/lib/game/effects/cards/v2402_mega_gardevoir.ts', 'isBasicPsy', '基本**能量**'],
  ['/src/lib/game/effects/cards/v2630_i_wave13_misc6.ts', 'deckSearchBasicEnergyAttachOnePost', '基本**能量**'],
  ['/src/lib/game/effects/cards/v2750_h_wave2_full.ts', 'discardSearchBasicEnergiesPost', '基本**能量**'],
  ['/src/lib/game/effects/cards/v2996_g4_wave2.ts', 'isBasicEnergyOfType', '基本**能量**'],
  ['/src/lib/game/effects/cards/v2996_g4_wave2.ts', 'isBasicPokemonHPLE70', '保母曼波｜溫柔鰭／禿鷹娜＝棄牌區・對手手牌視角（官方 id 789/795）'],
];

function collectB() {
  const hits = [];
  for (const f of GAME_FILES) {
    const src = stripComments(readFileSync(f, 'utf8'));
    DEF_RE.lastIndex = 0;
    let m;
    while ((m = DEF_RE.exec(src))) {
      const name = m[1] || m[2];
      if (!/basic/i.test(name)) continue;
      if (!BODY_RE.test(src.slice(m.index, m.index + 700))) continue;
      hits.push({ rel: relOf(f), name,
                  n: src.slice(0, m.index).split('\n').length });
    }
  }
  return hits;
}

T('⭐ lint B：名稱含 Basic 的本地述詞定義全部在白名單上（擋 isBasicOnField 那種同義本地版）', () => {
  const hits = collectB();
  ok(hits.length >= 15, `只找到 ${hits.length} 個本地 Basic 述詞（白名單 ${ALLOW_B.length} 筆）⇒ 掃描器壞了？`);
  const bad = hits.filter(h => !ALLOW_B.some(a => a[0] === h.rel && a[1] === h.name));
  ok(bad.length === 0,
    `新的本地【基礎】述詞 ${bad.length} 個 —— 場上視角請直接用 isBasicPokemonOnField、`
    + `卡片視角請用 isBasicPokemonCard；能量類請補進白名單寫明理由：\n`
    + bad.map(h => `${h.rel}:${h.n}  ${h.name}`).join('\n'));
});

T('⭐ lint B：白名單不得有死條目', () => {
  const hits = collectB();
  const dead = ALLOW_B.filter(a => !hits.some(h => h.rel === a[0] && h.name === a[1]));
  ok(dead.length === 0, '白名單死條目：\n' + dead.map(a => `${a[0]}  ${a[1]}`).join('\n'));
});

T('⭐⭐ lint B 正對照：v6.250 上真正存在過的 `isBasicOnField` 會被抓到', () => {
  const sample = "function isBasicOnField(insts, pool) {\n"
    + "  return insts.some(c => { const card = pool.get(c.cardId);\n"
    + "    return !!card && card.supertype === 'Pokemon' && !card.evolvesFrom; });\n}";
  DEF_RE.lastIndex = 0;
  const m = DEF_RE.exec(sample);
  ok(m && /basic/i.test(m[1] || m[2]), '抽取器抓不到函式名 ⇒ 安慰劑');
  ok(BODY_RE.test(sample.slice(m.index, m.index + 700)), '判準抓不到函式本體的手刻樣式 ⇒ 安慰劑');
  ok(!ALLOW_B.some(a => a[1] === 'isBasicOnField'), 'isBasicOnField 不該還在白名單上（它已經被刪掉）');
  // 不可誤抓：與【基礎】無關的函式名
  DEF_RE.lastIndex = 0;
  const m2 = DEF_RE.exec('function isEvolutionCard(c) { return !!c.evolvesFrom; }');
  ok(m2 && !/basic/i.test(m2[1] || m2[2]), '誤把非 Basic 命名的函式納入樣式 B');
});

T('⭐ 三個修好的消費點都真的接上中央述詞（行為端之外再加一道靜態確認）', () => {
  const nanny = readFileSync(join(ROOT, 'src/lib/game/effects/cards/v2620_i_wave12_misc5.ts'), 'utf8');
  const i = nanny.indexOf("regPost('保母蟲|治癒襁褓'");
  ok(i > 0, '找不到 保母蟲|治癒襁褓');
  ok(/isBasicPokemonOnField/.test(nanny.slice(i, i + 800)), '治癒襁褓沒走中央述詞');
  const items = readFileSync(join(ROOT, 'src/lib/game/effects/cards/items_misc.ts'), 'utf8');
  ok(!/function isBasicOnField\s*\(/.test(items), '本地 helper isBasicOnField 還在（本地版遮蔽中央版）');
  ok(!/filterBasic/.test(stripComments(items)), '死參數 filterBasic 還在');
  const j = items.indexOf('function changingBookFieldTargetIids');
  ok(j > 0 && /isBasicPokemonOnField/.test(items.slice(j, j + 600)), '變化之書場上目標沒走中央述詞');
  const v172 = stripComments(readFileSync(join(ROOT, 'src/lib/game/effects/cards/v172_hij_batch.ts'), 'utf8'));
  const k = v172.indexOf("regG('琉琪亞的展示'");
  ok(k > 0, '找不到 琉琪亞的展示');
  const win = v172.slice(k, k + 1400);
  ok(((win.match(/isBasicPokemonOnField/g) || []).length) >= 2, '琉琪亞的展示 gate 與 picker 沒有都接上');
  ok(!/陳舊的鰭之化石/.test(win), '不可達的鰭之化石內聯死碼還在（免疫由 isImmuneToOppSupporter 統一負責）');
});

console.log('\n=== v6.251 場上【基礎】三個漏網 + lint 擴充：PASS ' + pass + ' / FAIL ' + fail + ' ===');
if (fail > 0) process.exit(1);
