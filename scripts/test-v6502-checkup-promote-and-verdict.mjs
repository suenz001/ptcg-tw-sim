// ⭐⭐v6.502 守衛：寶可夢檢查的三個舊缺口（Fable v6.500 審查 B／C／D，站長 2026-10-07：「審查到的這三個舊問題都要修」）
//
// C：只有冰冷之帳／揚沙打倒戰鬥寶可夢（沒有中毒／灼傷昏厥）時，原本先換回合、被打倒的一方在下一回合中才補位
//    （還被標成「本回合才從備戰區放上戰鬥場」）⇒ 改成檢查後停下來等補位，補完才換回合、不標旗標。
// B：正面朝上獎賞的取獎視窗開著時，v6.500 維持舊流程（先補位才放冰冷之帳）⇒ 改成同樣在同一次檢查放好（取獎視窗後開的視窗會排隊）。
// D：雙方同時中毒昏厥、雙方都沒有備戰 ⇒ 原本先結算的一方被判輸 ⇒ 改成平手（中央 judgeEndgameV6361，官方 L1460）。
//
// G1 C 冰冷之帳單獨打倒對手戰鬥寶可夢 ⇒ 不換回合、等補位；補完換回合；新戰鬥寶可夢沒有 movedToActiveThisTurn
// G2 C 揚沙單獨打倒對手戰鬥寶可夢 ⇒ 同上
// G3 C 冰冷之帳打倒「結束回合那一方」自己的戰鬥寶可夢 ⇒ 也停下來等它補完才換回合
// G4 B 正面朝上獎賞視窗開著時，冰冷之帳已在同一次檢查放好（對戰圓形競技場保護的備戰補上場後仍是 0）
// G5 D 雙方同時中毒昏厥、都沒有備戰 ⇒ 平手
// G5b D 雙方同時灼傷昏厥 ⇒ 平手
// G6 D 正對照：只有一方中毒昏厥且沒有備戰 ⇒ 對手勝
// G7 D 冰冷之帳把雙方最後的寶可夢一起打倒（一方中毒昏厥、另一方戰鬥寶可夢被冰冷之帳打倒）⇒ 平手
// G8～G11：Opus 審查補充（停等時不能再出牌、四種組合一致平手、力之沙漏只給回合結束時的戰鬥寶可夢）
// HEAD-FAIL：同一批案例餵 v6.501 的引擎（git archive）逐條列紅（Rule 41）。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
import { hasBaseCommit, shallowSkip } from './lib/base-blob.mjs';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.501。
const BASE_SHA = '8730eacb';
const tmpFiles = [];
process.on('exit', () => { for (const p of tmpFiles) { try { rmSync(p, { recursive: true, force: true }); } catch {} } });

async function loadEngine(srcRoot) {
  const dir = mkdtempSync(join(tmpdir(), 'v6502-')); tmpFiles.push(dir);
  const S = join(dir, 's.mjs'), O = join(dir, 'o.mjs');
  writeFileSync(S, 'export const base="";export const assets="";');
  await build({ stdin: { contents: "export { createGame, applyAction } from './src/lib/game/engine';\n", resolveDir: srcRoot, loader: 'ts' },
    outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
    alias: { '$lib': join(srcRoot, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
  return await import(pathToFileURL(O).href);
}

const dirC = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dirC, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dirC)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dirC, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
const need = (id, name) => { assert.equal(pool.get(id)?.name, name, `fixture：${id} 應為 ${name}`); return id; };
const FROS = String([...pool.values()].find(c => c.name === '雪妖女' && c.abilities?.some(a => a.name === '冰冷之帳')).id);
const KISS = need('11227', '波克基斯'), CACNEA = need('13698', '沙鈴仙人掌'), KOKO = need('12116', '卡璞・鳴鳴ex');
const ARENA = String([...pool.values()].find(c => c.name === '對戰圓形競技場').id);
const DEF = '13163';
const TTAR = need('12800', '火箭隊的班基拉斯');
const LOUIS = need('10640', '力之沙漏');
const WATER = String([...pool.values()].find(c => c.supertype === 'Energy' && c.subtype === 'Basic' && c.name === '基本【水】能量').id);
assert.ok(pool.get(KISS).abilities?.length > 0 && !(pool.get(KOKO).abilities?.length), 'fixture：波克基斯有特性、卡璞・鳴鳴ex 沒有');
const hp = (id) => Number(pool.get(id).hp);


function makeCases({ createGame, applyAction }) {
  let n = 0; const inst = (cid, x = {}) => ({ iid: 'v502_' + (++n), cardId: String(cid), damage: 0, energyAttached: [], ...x });
  const pr = () => Array.from({ length: 6 }, () => inst(DEF));
  function board(p0, p1, extra = {}) {
    const s = createGame({ name: 'P1', entries: [{ cardId: DEF, count: 1 }] }, { name: 'P2', entries: [{ cardId: DEF, count: 1 }] }, pool);
    return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, isFirstTurn: false, turn: 5, log: [],
      setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], pendingSelection: null, ...extra,
      players: [
        { ...s.players[0], hand: [], deck: [inst(DEF), inst(DEF)], discard: [], prizes: pr(), bench: [], ...p0 },
        { ...s.players[1], hand: [], deck: [inst(DEF), inst(DEF)], discard: [], prizes: pr(), bench: [], ...p1 }] };
  }
  const tails = (fn) => { const o = Math.random; Math.random = () => 0.9; try { return fn(); } finally { Math.random = o; } };
  const endTurn = (s) => tails(() => applyAction(s, { type: 'END_TURN' }, pool));
  const send = (s, who, iid) => tails(() => applyAction(s, { type: 'SEND_NEW_ACTIVE', senderIdx: who, iid }, pool));
  const tentLogs = (s) => s.log.filter(l => /^冰冷之帳：/.test(l.message) && !/獎賞卡/.test(l.message));
  const C = {};
  C.G1 = () => {
    let s = endTurn(board({ active: inst(KOKO), bench: [inst(FROS)] }, { active: inst(KISS, { damage: hp(KISS) - 10 }), bench: [inst(KOKO)] }));
    assert.ok(s.players[1].discard.some(c => c.cardId === KISS), '前置：冰冷之帳打倒對手的波克基斯');
    assert.equal(s.activePlayerIndex, 0, '還沒換回合'); assert.equal(s.endTurnContinueAfterKO, 0, '停下來等補位');
    s = send(s, 1, s.players[1].bench[0].iid);
    assert.equal(s.activePlayerIndex, 1, '補完才換回合'); assert.equal(s.turnPhase, 'main');
    assert.ok(!s.players[1].active.movedToActiveThisTurn, '檢查後的補位不算「本回合從備戰區放上戰鬥場」');
    assert.equal(tentLogs(s).length, 1);
  };
  C.G2 = () => {
    let s = endTurn(board({ active: inst(TTAR), bench: [] }, { active: inst(CACNEA, { damage: hp(CACNEA) - 20 }), bench: [inst(KOKO)] }));
    assert.ok(s.players[1].discard.some(c => c.cardId === CACNEA), '前置：揚沙打倒對手的沙鈴仙人掌');
    assert.equal(s.activePlayerIndex, 0); assert.equal(s.endTurnContinueAfterKO, 0);
    s = send(s, 1, s.players[1].bench[0].iid);
    assert.equal(s.activePlayerIndex, 1); assert.ok(!s.players[1].active.movedToActiveThisTurn);
  };
  C.G3 = () => {
    let s = endTurn(board({ active: inst(KISS, { damage: hp(KISS) - 10 }), bench: [inst(FROS)] }, { active: inst(KOKO), bench: [] }));
    assert.equal(s.players[0].active, null, '前置：自己的波克基斯被冰冷之帳打倒');
    assert.equal(s.activePlayerIndex, 0); assert.equal(s.endTurnContinueAfterKO, 0);
    s = send(s, 0, s.players[0].bench[0].iid);
    assert.equal(s.activePlayerIndex, 1, '補完才換回合');
    assert.ok(!s.players[0].active.movedToActiveThisTurn);
  };
  C.G4 = () => {
    const prizes = pr(); prizes[0] = { ...prizes[0], faceUp: true };
    let s = endTurn(board({ active: inst(KOKO), bench: [inst(FROS)], prizes },
                          { active: inst(CACNEA, { status: 'poisoned', damage: hp(CACNEA) - 10 }), bench: [inst(KISS)] },
                          { activeStadium: inst(ARENA) }));
    assert.equal(s.pendingSelection?.effectKey, 'take-prize-choose', '前置：正面朝上獎賞 ⇒ 取獎視窗');
    assert.equal(tentLogs(s).length, 0, '對手備戰受對戰圓形競技場保護 ⇒ 這次檢查沒有任何寶可夢被放');
    s = tails(() => applyAction(s, { type: 'RESOLVE_SELECTION', senderIdx: 0, actorIdx: 0, effectKey: 'take-prize-choose',
      selectedIids: [s.pendingSelection.params?.options?.[0]?.id ?? 'random'] }, pool));
    s = send(s, 1, s.players[1].bench[0].iid);
    assert.equal(s.players[1].active?.cardId, KISS);
    assert.equal(s.players[1].active.damage, 0, '補上戰鬥場之後不再補放（舊流程會放 10）');
    assert.equal(s.activePlayerIndex, 1);
  };
  C.G5 = () => {
    const s = endTurn(board({ active: inst(CACNEA, { status: 'poisoned', damage: hp(CACNEA) - 10 }), bench: [] },
                            { active: inst(CACNEA, { status: 'poisoned', damage: hp(CACNEA) - 10 }), bench: [] }));
    assert.equal(s.phase, 'game-over'); assert.equal(s.winner ?? null, null, '雙方同時沒有寶可夢 ⇒ 平手');
  };
  C.G5b = () => {
    const s = endTurn(board({ active: inst(CACNEA, { status: 'burned', damage: hp(CACNEA) - 20 }), bench: [] },
                            { active: inst(CACNEA, { status: 'burned', damage: hp(CACNEA) - 20 }), bench: [] }));
    assert.equal(s.phase, 'game-over'); assert.equal(s.winner ?? null, null, '雙方同時灼傷昏厥 ⇒ 平手');
  };
  C.G6 = () => {
    const s = endTurn(board({ active: inst(KOKO), bench: [] }, { active: inst(CACNEA, { status: 'poisoned', damage: hp(CACNEA) - 10 }), bench: [] }));
    assert.equal(s.phase, 'game-over'); assert.equal(s.winner, 0);
  };
  C.G7 = () => {
    const s = endTurn(board({ active: inst(KISS, { damage: hp(KISS) - 10 }), bench: [inst(FROS, { damage: hp(FROS) - 10 })], deck: [inst(DEF)] },
                            { active: inst(CACNEA, { status: 'poisoned', damage: hp(CACNEA) - 10 }), bench: [] }));
    // 我方雪妖女不受自己的冰冷之帳 ⇒ 我方還有雪妖女可上場 ⇒ 不是平手：對手沒有寶可夢 ⇒ 我方勝
    assert.equal(s.phase, 'game-over'); assert.equal(s.winner, 0);
  };
  // ── Opus 審查補充 ──
  C.G8 = () => {
    // 審查 1：停下來等對手補位時，結束回合的一方不可以再做主階段動作
    const e = inst(WATER);
    let s = endTurn(board({ active: inst(KOKO), bench: [inst(FROS)], hand: [e] }, { active: inst(KISS, { damage: hp(KISS) - 10 }), bench: [inst(KOKO)] }));
    assert.equal(s.endTurnContinueAfterKO, 0, '前置：停等補位');
    assert.equal(s.turnPhase, 'end', '停等時 turnPhase 是 end');
    const s2 = applyAction(s, { type: 'ATTACH_ENERGY', energyIid: e.iid, targetIid: s.players[0].active.iid }, pool);
    assert.equal(s2.players[0].active.energyAttached.length, 0, '等補位時不能附能量');
  };
  // 審查 2：雙方同時中毒昏厥，一方沒有備戰、獎賞只剩 1 張（取完＋自己沒有寶可夢 ⇒ v6.420 平手）。誰結束回合、有沒有正面朝上獎賞都要一致
  const g9 = (ender, faceUp, st = 'poisoned') => () => {
    const prizes = [inst(DEF, faceUp ? { faceUp: true } : {})];
    const d = st === 'poisoned' ? 10 : 20;
    const s = endTurn(board({ active: inst(CACNEA, { status: st, damage: hp(CACNEA) - d }), bench: [], prizes },
                            { active: inst(CACNEA, { status: st, damage: hp(CACNEA) - d }), bench: [inst(KOKO)] },
                            { activePlayerIndex: ender }));
    assert.equal(s.phase, 'game-over', '應判終局'); assert.equal(s.winner ?? null, null, `應平手（winner=${s.winner} ${s.winReason}）`);
  };
  C.G9a = g9(0, false); C.G9b = g9(0, true); C.G9c = g9(1, false); C.G9d = g9(1, true); C.G9e = g9(1, false, 'burned');
  C.G10 = () => {
    // 審查 3：回合結束時的戰鬥寶可夢被冰冷之帳打倒，補上來的那隻帶力之沙漏 ⇒ 不問（卡面：回合結束時在戰鬥場）
    let s = endTurn(board({ active: inst(KISS, { damage: hp(KISS) - 10 }), bench: [inst(FROS), inst(KOKO, { toolAttached: inst(LOUIS) })], discard: [inst(WATER)] },
                          { active: inst(KOKO), bench: [] }));
    assert.equal(s.players[0].active, null, '前置');
    s = send(s, 0, s.players[0].bench.find(b => b.cardId === KOKO).iid);
    assert.notEqual(s.pendingSelection?.effectKey, 'brailliant-attach', '補上來的那隻不問力之沙漏');
    assert.equal(s.activePlayerIndex, 1);
  };
  C.G11 = () => {
    // 審查 3 正對照：回合結束時就在戰鬥場、帶力之沙漏 ⇒ 照常問
    const s = endTurn(board({ active: inst(KOKO, { toolAttached: inst(LOUIS) }), bench: [], discard: [inst(WATER)] }, { active: inst(KOKO), bench: [] }));
    assert.equal(s.pendingSelection?.effectKey, 'brailliant-attach');
  };
  return C;
}

let pass = 0, fail = 0;
const NAMES = {
  G1: 'C：冰冷之帳單獨打倒對手戰鬥寶可夢 ⇒ 等補位才換回合，新戰鬥寶可夢不標「本回合放上戰鬥場」',
  G2: 'C：揚沙單獨打倒對手戰鬥寶可夢 ⇒ 同上',
  G3: 'C：冰冷之帳打倒結束回合那一方自己的戰鬥寶可夢 ⇒ 也等它補完才換回合',
  G4: 'B：正面朝上獎賞視窗開著時，冰冷之帳在同一次檢查結算（受保護的備戰補上場後仍是 0）',
  G5: 'D：雙方同時中毒昏厥、都沒有備戰 ⇒ 平手',
  G5b: 'D：雙方同時灼傷昏厥、都沒有備戰 ⇒ 平手',
  G6: 'D 正對照：只有一方沒有寶可夢 ⇒ 對手勝',
  G8: '審查 1：停等補位時 turnPhase=end，結束回合的一方不能再附能量',
  G9a: '審查 2：雙方同時中毒昏厥＋取完獎賞自己卻沒有寶可夢 ⇒ 平手（我方結束回合、無正面獎賞）',
  G9b: '審查 2：同上（我方結束回合、有正面朝上獎賞）',
  G9c: '審查 2：同上（對手結束回合、無正面獎賞）',
  G9d: '審查 2：同上（對手結束回合、有正面朝上獎賞）',
  G9e: '審查 2：同 G9c，但是灼傷',
  G10: '審查 3：檢查後才補上場的寶可夢不觸發力之沙漏',
  G11: '審查 3 正對照：回合結束時就在戰鬥場 ⇒ 力之沙漏照常問',
  G7: 'D 正對照：一方中毒昏厥沒有備戰、另一方戰鬥寶可夢被打倒但還有雪妖女 ⇒ 還有寶可夢的一方勝',
};
const CUR = makeCases(await loadEngine(ROOT));
for (const [k, f] of Object.entries(CUR)) { try { f(); pass++; console.log('  OK', k, NAMES[k]); } catch (e) { fail++; console.log('  FAIL', k, NAMES[k], '::', e.message); } }
console.log('── HEAD-FAIL（v6.501 引擎）──');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const bdir = mkdtempSync(join(tmpdir(), 'v6502-base-')); tmpFiles.push(bdir);
  execSync(`git -C "${ROOT}" archive ${BASE_SHA} src | tar -x -C "${bdir}"`);
  const B = makeCases(await loadEngine(bdir));
  const red = [];
  for (const [k, f] of Object.entries(B)) { try { f(); } catch (e) { if (e instanceof assert.AssertionError) red.push(k); else throw e; } }
  console.log('  （v6.501 紅了：' + red.join('、') + '）');
  const expectRed = ['G1', 'G2', 'G3', 'G4', 'G5', 'G5b', 'G8', 'G9a', 'G9b', 'G9c'], expectGreen = ['G6', 'G7', 'G11'];
  // G9d 在 v6.501 碰巧是平手（審查表格）；G10 在 v6.501 碰巧不問（舊版先換回合才補位）——兩條由突變測試證明會紅（M9／M10）
  if (expectRed.every(k => red.includes(k)) && expectGreen.every(k => !red.includes(k))) { pass++; console.log('  OK S0 HEAD-FAIL：G1～G5b、G8、G9a～G9c 在 v6.501 紅，G6／G7／G11（正對照）綠'); }
  else { fail++; console.log('  FAIL S0 HEAD-FAIL 分佈不符 :: 紅＝' + red.join(',')); }
} else shallowSkip('v6502 S0：HEAD-FAIL', '需要 BASE commit');
console.log(`\n=== v6.502 寶可夢檢查三個舊缺口：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
