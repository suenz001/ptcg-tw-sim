// 守衛 v6.435：借招（複製對手／牌庫頂的招式）借不到「玩家層級冷卻中」的招式
//
// 【站長裁定 2026-09-28】「夢幻ex｜基因駭入不能借冷卻中的天仙石」。
//   夢幻ex 是 G 標（不在維護範圍），但全站 H／I／J 的借招卡是同一句話的同一個判準：
//   皮可西｜揮指、索羅亞克｜欺詐、阿響的樹才怪｜試著模仿、狐大盜｜技能大盜、
//   火箭隊的貓老大ex｜高傲指令、呆呆王｜耀閃挑戰（可借非規則的騎拉帝納｜渾沌匍匐）、火箭隊的謎擬Ｑ｜扮晶晶酒。
//   被借的招式卡面：「在上個自己的回合，若自己的寶可夢使出了『X』，則無法使用這個招式。」
//   ⇒ 借招的這一方上個自己的回合用過 X ⇒ 這一招不是借招候選。
// 【官方問答（PTCG_RULES.md L2002～2005）——反方向，必須維持】
//   夢幻ex 用基因駭入**借來**用過天仙石 ⇒ 下個自己的回合：自己的仙子伊布ex 可以用天仙石、也可以再借一次。
//   ⇒ 借來用的不算「自己的寶可夢使出了天仙石」（引擎蓋章記的是印在卡上的那一招）。
// 【修法】冷卻判準搬到 leaf 模組 player-attack-cooldown.ts（copy-attack.ts 不可 import engine.ts），
//   中央候選枚舉 copyAttackCandidates 問同一個述詞；AI 的耀閃挑戰試打也改用中央候選。
//
// HEAD-FAIL（BASE＝v6.434 8f9f7ea9，把 engine.ts／copy-attack.ts／ai-slowking.ts 換回 BASE blob 實跑）：
//   逐條結果寫在報告與 commit 訊息（Rule 41：缺席的東西用哨兵，不整支 throw）。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
import { stripCommentsBlankChecked } from './lib/strip-comments.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x-v6435-s.js'), E = join(ROOT, '.x-v6435-e.ts'), O = join(ROOT, '.x-v6435-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export * as ENG from './src/lib/game/engine';\n"
  + "export * as CA from './src/lib/game/copy-attack';\n"
  + "export * as SK from './src/lib/game/ai-slowking';\n"
  + "export * as DTK from './src/lib/game/deck-top-known';\n"
  + "import './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { ENG, CA, SK, DTK } = await import(pathToFileURL(O).href);
const { createGame, applyAction } = ENG;

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}

// 卡片事實一律取自 static/cards（台灣官方卡面）
const SYLVEON = '16770';   // 仙子伊布ex（H）：魔法魅惑／天仙石［水雷超］
const GIRATINA = '19581';  // 騎拉帝納（J，非規則）：渾沌匍匐［超超無］（唯一一招）
const CLEFABLE = '16757';  // 皮可西（H）：揮指［無無］「選擇1個對手的戰鬥寶可夢持有的招式，作為這個招式使用。」
const ZORUA = '16939';     // 索羅亞克（I）：欺詐［無無無］
const SUDO = '12699';      // 阿響的樹才怪（I）：試著模仿［無無］（擲幣）
const THIEVUL = '19196';   // 狐大盜（J）：技能大盜［無無］（自己沒有手牌才可借對手場上任一隻）
const SLOWKING = '10934';  // 呆呆王（H）：耀閃挑戰［超無］
const FILLER = '17038';    // 卡比獸（基礎、無特性）
const EN = { W: '18519', L: '18520', P: '14103' };
for (const id of [SYLVEON, GIRATINA, CLEFABLE, ZORUA, SUDO, THIEVUL, SLOWKING]) assert.ok(pool.get(id), '找不到測試用卡 ' + id);
const sy = pool.get(SYLVEON);
const IDX_CHARM = sy.attacks.findIndex((a) => a.name === '魔法魅惑');
const IDX_STONE = sy.attacks.findIndex((a) => a.name === '天仙石');
assert.ok(IDX_CHARM >= 0 && IDX_STONE >= 0);
assert.ok(/自己的寶可夢使出了「天仙石」，則無法使用這個招式/.test(sy.attacks[IDX_STONE].effect), '天仙石卡面措辭變了，請重新查證');
assert.ok(/選擇1個對手的戰鬥寶可夢持有的招式，作為這個招式使用/.test(pool.get(CLEFABLE).attacks[0].effect), '揮指卡面措辭變了');
const IDX_CRAWL = pool.get(GIRATINA).attacks.findIndex((a) => a.name === '渾沌匍匐');
assert.ok(IDX_CRAWL >= 0);

// Rule 41：新東西缺席時用哨兵，讓每一條各自誠實翻紅
const MISSING = Symbol('MISSING');
const cands = (key, st, aIdx = 0) => (typeof CA?.copyAttackCandidates === 'function' ? CA.copyAttackCandidates(key, st, aIdx, pool) : MISSING);
const names = (cs) => (cs === MISSING ? 'MISSING' : cs.map((c) => c.attackName).join(','));

let nn = 0;
const inst = (cid, e = [], x = {}) => ({ iid: 'c' + (++nn), cardId: String(cid), damage: 0, energyAttached: e, ...x });
const en = (k) => inst(EN[k]);
/**
 * 我方（P1，idx 0）戰鬥位＝借招的寶可夢（能量足夠）；對手戰鬥位＝仙子伊布ex（備戰 2 隻）。
 *   cool：我方遊戲層級「上個自己的回合用過的招式」；oppCool：對手的。
 */
function mk(attackerId, energies, { cool = [], oppCool = [], hand = null, deckTop = null, benchStamp = null } = {}) {
  const s = createGame({ name: 'P1', entries: [{ cardId: FILLER, count: 1 }] },
    { name: 'P2', entries: [{ cardId: FILLER, count: 1 }] }, pool);
  const deck = Array.from({ length: 10 }, () => inst(FILLER));
  if (deckTop) deck.unshift(inst(deckTop));
  return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
    isFirstTurn: false, setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
    pendingSelection: null,
    attackNamesUsedLastSelfTurn: { p1: [...cool], p2: [...oppCool] },
    players: [
      { ...s.players[0], hand: hand ?? [inst(FILLER)], deck, discard: [],
        prizes: Array.from({ length: 6 }, () => inst(FILLER)),
        active: inst(attackerId, energies.map(en)),
        bench: [inst(FILLER, [], benchStamp ? { attackUsedLastSelfTurn: benchStamp } : {})], energyAttachedThisTurn: true },
      { ...s.players[1], hand: [inst(FILLER)], deck: Array.from({ length: 10 }, () => inst(FILLER)), discard: [],
        prizes: Array.from({ length: 6 }, () => inst(FILLER)),
        active: inst(SYLVEON, [en('W'), en('L'), en('P')]), bench: [inst(FILLER), inst(FILLER)] }] };
}

let pass = 0, fail = 0;
const failed = [];
const T = (n, f) => { try { f(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; failed.push(n); } };

// ── A：候選枚舉（規則層與 UI picker 共用的唯一來源）───────────────────────────
T('A0 正對照：沒有冷卻 ⇒ 揮指可借天仙石與魔法魅惑', () => {
  const cs = cands('皮可西|揮指', mk(CLEFABLE, ['P', 'P']));
  assert.ok(cs !== MISSING);
  assert.deepEqual(cs.map((c) => c.attackName).sort(), ['天仙石', '魔法魅惑'].sort(), names(cs));
});
T('A1 ⭐ 我方上個自己的回合用過天仙石（遊戲層級紀錄）⇒ 揮指借不到天仙石，魔法魅惑照借', () => {
  const cs = cands('皮可西|揮指', mk(CLEFABLE, ['P', 'P'], { cool: ['天仙石'] }));
  assert.ok(cs !== MISSING);
  assert.ok(!cs.some((c) => c.attackName === '天仙石'), '天仙石仍是候選：' + names(cs));
  assert.ok(cs.some((c) => c.attackName === '魔法魅惑'), '不可以連別的招一起擋掉：' + names(cs));
});
T('A2 ⭐ 舊對局退路：只有場上實體的蓋章（備戰寶可夢 attackUsedLastSelfTurn）也算冷卻', () => {
  const cs = cands('皮可西|揮指', mk(CLEFABLE, ['P', 'P'], { benchStamp: '天仙石' }));
  assert.ok(cs !== MISSING && !cs.some((c) => c.attackName === '天仙石'), names(cs));
});
T('A3 ⭐ 方向：冷卻是「借招的這一方」的事實 —— 對手上回合用過天仙石，我方照樣可以借', () => {
  const cs = cands('皮可西|揮指', mk(CLEFABLE, ['P', 'P'], { oppCool: ['天仙石'] }));
  assert.ok(cs !== MISSING && cs.some((c) => c.attackName === '天仙石'), '把對手的冷卻套到我方身上了：' + names(cs));
});
T('A4 正對照：上回合用過的是別招（魔法魅惑）⇒ 天仙石照借（比對的是招式名）', () => {
  const cs = cands('皮可西|揮指', mk(CLEFABLE, ['P', 'P'], { cool: ['魔法魅惑'] }));
  assert.ok(cs !== MISSING && cs.some((c) => c.attackName === '天仙石') && cs.some((c) => c.attackName === '魔法魅惑'), names(cs));
});
T('A5 ⭐ 同一句卡面的其他借招卡一體適用（欺詐／試著模仿／技能大盜）', () => {
  const cases = [['索羅亞克|欺詐', ZORUA, ['P', 'P', 'P'], null], ['阿響的樹才怪|試著模仿', SUDO, ['P', 'P'], null],
    ['狐大盜|技能大盜', THIEVUL, ['P', 'P'], []]];
  for (const [key, id, e, hand] of cases) {
    const ok0 = cands(key, mk(id, e, { hand }));
    assert.ok(ok0 !== MISSING && ok0.some((c) => c.attackName === '天仙石'), key + ' 正對照借不到天仙石：' + names(ok0));
    const cs = cands(key, mk(id, e, { hand, cool: ['天仙石'] }));
    assert.ok(!cs.some((c) => c.attackName === '天仙石'), key + ' 仍可借冷卻中的天仙石：' + names(cs));
  }
});
T('A6 ⭐ 耀閃挑戰翻到騎拉帝納（非規則）＋我方上回合用過渾沌匍匐 ⇒ 沒有可借的招（正對照：沒冷卻時可借）', () => {
  const c0 = cands('呆呆王|耀閃挑戰', mk(SLOWKING, ['P', 'P'], { deckTop: GIRATINA }));
  assert.ok(c0 !== MISSING && c0.some((c) => c.attackName === '渾沌匍匐'), '正對照：' + names(c0));
  const c1 = cands('呆呆王|耀閃挑戰', mk(SLOWKING, ['P', 'P'], { deckTop: GIRATINA, cool: ['渾沌匍匐'] }));
  assert.ok(!c1.some((c) => c.attackName === '渾沌匍匐'), '仍可借冷卻中的渾沌匍匐：' + names(c1));
});

// ── B：實際出招（走 applyAction，規則層真的吃這份候選）───────────────────────
function attackCopy(st, choiceIdx) {
  return applyAction(st, { type: 'ATTACK', attackIndex: 0, copyAttackChoice: { pokeIid: st.players[1].active.iid, attackIndex: choiceIdx } }, pool);
}
// 天仙石的選擇視窗：effectKey 'sylveon-skystone-bounce'（⚠ pendingSelection 裡沒有「天仙石」字樣，
//   第一版用 /天仙石/ 比對 JSON ＝ 安慰劑，HEAD-FAIL 時抓出來的）
const stonePicker = (st) => st.pendingSelection?.effectKey === 'sylveon-skystone-bounce';
const logText = (st) => (st.log ?? []).map((l) => l.message).join('\n');
T('B0 正對照：沒有冷卻時，揮指指定天仙石 ⇒ 真的使出天仙石（開出選對手備戰的視窗或 log 寫著天仙石）', () => {
  const nx = attackCopy(mk(CLEFABLE, ['P', 'P']), IDX_STONE);
  assert.ok(stonePicker(nx), '沒有開出天仙石的選擇視窗：' + JSON.stringify(nx.pendingSelection));
});
T('B1 ⭐ 冷卻中：揮指指定天仙石 ⇒ 天仙石的效果不發動（對手備戰不動、沒有天仙石的選擇視窗）', () => {
  const nx = attackCopy(mk(CLEFABLE, ['P', 'P'], { cool: ['天仙石'] }), IDX_STONE);
  assert.ok(!stonePicker(nx), '仍開出天仙石的選擇視窗');
  assert.equal(nx.players[1].bench.length, 2, '對手備戰被放回牌庫了');
  assert.ok(!/\|天仙石」|天仙石：/.test(logText(nx)), '仍借到／使出天仙石：' + logText(nx).slice(-300));
});

// ── C：官方 L2002～2005（反方向，不可以被本版誤傷）─────────────────────────────
/** 把當前的選擇視窗一路用「前幾個合法選項」解掉 */
function drain(st) {
  for (let i = 0; i < 6 && st.pendingSelection; i++) {
    const ps = st.pendingSelection;
    const valid = ps.params?.validIids ?? ps.validIids ?? ps.candidateIids
      ?? (ps.type === 'opp-bench-choose' ? st.players[ps.sourcePlayerIdx].bench.map((b) => b.iid) : []);
    const n = Math.max(ps.minCount ?? 0, Math.min(ps.maxCount ?? 1, valid.length));
    const nx = applyAction(st, { type: 'RESOLVE_SELECTION', selectedIids: valid.slice(0, n), token: ps.token }, pool);
    if (nx === st) break;
    st = nx;
  }
  return st;
}
T('C1 ⭐ 官方 L2002～2005：借來用過天仙石 ⇒ 不記成「自己的寶可夢使出了天仙石」（下回合仍可用、仍可再借）', () => {
  let st = drain(attackCopy(mk(CLEFABLE, ['P', 'P']), IDX_STONE));
  assert.ok(!st.pendingSelection, '選擇視窗沒解完：' + JSON.stringify(st.pendingSelection)?.slice(0, 200));
  assert.ok(st.players[1].bench.length < 2, '前提不成立：天仙石沒有真的使出（對手備戰沒被放回牌庫）');
  const used = st.attackNamesUsedThisTurn?.p1 ?? [];
  assert.ok(!used.includes('天仙石'), '借來的天仙石被記成冷卻：' + JSON.stringify(used));
  // 下個自己的回合：述詞不冷卻、揮指仍可再借
  const next = { ...st, attackNamesUsedLastSelfTurn: { p1: used, p2: [] }, attackNamesUsedThisTurn: { p1: [], p2: [] } };
  const f = ENG.isPlayerLevelAttackOnCooldown;
  assert.equal(typeof f, 'function');
  assert.equal(f(next, 0, '天仙石'), false);
  const cs = cands('皮可西|揮指', { ...next, players: [{ ...next.players[0], active: next.players[0].active }, { ...next.players[1], active: inst(SYLVEON) }] });
  assert.ok(cs.some((c) => c.attackName === '天仙石'), '下回合不能再借了：' + names(cs));
});

// ── D：AI（耀閃挑戰試打只從中央候選挑）─────────────────────────────────────────
T('D1 ⭐ AI：已知牌庫頂是騎拉帝納、渾沌匍匐冷卻中 ⇒ bestKnownTopCopy 不會回傳借渾沌匍匐的選擇', () => {
  let st = mk(SLOWKING, ['P', 'P'], { deckTop: GIRATINA, cool: ['渾沌匍匐'] });
  st = DTK.recordKnownDeckTop(st, 0, [st.players[0].deck[0].iid]);
  const r = SK.bestKnownTopCopy(st, 0, 0, pool);
  assert.ok(!(r && r.choice?.attackIndex === IDX_CRAWL && r.choice?.pokeIid === st.players[0].deck[0].iid), '仍選借渾沌匍匐：' + JSON.stringify(r?.choice));
});
T('D2 正對照：沒冷卻時 AI 會考慮借渾沌匍匐', () => {
  let st = mk(SLOWKING, ['P', 'P'], { deckTop: GIRATINA });
  st = DTK.recordKnownDeckTop(st, 0, [st.players[0].deck[0].iid]);
  const r = SK.bestKnownTopCopy(st, 0, 0, pool);
  assert.ok(r && r.choice?.attackIndex === IDX_CRAWL, JSON.stringify(r));
});

// ── E：判準只有一份（Rule 38）────────────────────────────────────────────────
const code = (p) => stripCommentsBlankChecked(readFileSync(join(ROOT, p), 'utf8'));
T('E1 ⭐ 冷卻集合與述詞只在 leaf 模組 player-attack-cooldown.ts 定義一次；engine.ts／copy-attack.ts 都呼叫它', () => {
  const leafP = 'src/lib/game/player-attack-cooldown.ts';
  assert.ok(existsSync(join(ROOT, leafP)), 'leaf 模組不存在');
  const leaf = code(leafP), eng = code('src/lib/game/engine.ts'), ca = code('src/lib/game/copy-attack.ts');
  assert.equal(leaf.split('PLAYER_LEVEL_ATTACK_COOLDOWN.has(').length - 1, 1, 'leaf 裡的判準不是恰好一份');
  for (const [n, src] of [['engine.ts', eng], ['copy-attack.ts', ca]]) {
    assert.ok(!/new Set<string>\(\[\s*'天仙石'/.test(src) && !src.includes('PLAYER_LEVEL_ATTACK_COOLDOWN.has('), n + ' 又自己寫了一份冷卻判準');
  }
  assert.ok(ca.split('isPlayerLevelAttackOnCooldown(').length - 1 >= 1, 'copy-attack.ts 沒有呼叫中央述詞');
  assert.ok(eng.split('isPlayerLevelAttackOnCooldown(').length - 1 >= 2, 'engine.ts 的 ATTACK handler／getAvailableAttacks 沒有都呼叫中央述詞');
  // copy-attack.ts 只可 import leaf（不可 import engine.ts —— 成環）
  assert.ok(!/from '\.\/engine'/.test(ca), 'copy-attack.ts import 了 engine.ts（會成環）');
});
T('E2 engine 仍 re-export ancientKey／isPlayerLevelAttackOnCooldown（既有 import 不受影響），且與 leaf 同一個函式', () => {
  assert.equal(ENG.ancientKey(0), 'p1');
  assert.equal(ENG.ancientKey(1), 'p2');
  assert.equal(typeof ENG.isPlayerLevelAttackOnCooldown, 'function');
});

console.log(`\n${pass} PASS / ${fail} FAIL`);
if (fail) { console.log('紅：' + failed.join('、')); process.exit(1); }
