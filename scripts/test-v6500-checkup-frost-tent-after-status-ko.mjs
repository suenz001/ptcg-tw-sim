// ⭐⭐v6.500 守衛：寶可夢檢查中「中毒／灼傷昏厥」之後，同一次檢查的冰冷之帳照常結算，然後才補位
//
// 站長裁定（2026-10-06，逐字）：「修：對手中毒（或灼傷）昏厥後，同一次檢查的冰冷之帳照常對其他還在場上、
//   有特性的寶可夢各放 1 個指示物，已經昏厥的那隻就略過。」
//
// 原本：狀態區一有昏厥就 return 等補位，冰冷之帳要等昏厥方補完位、re-dispatch END_TURN 才放
//   ⇒ ① END_TURN 之後盤面上「冰冷之帳整段沒執行」（Fable 審查 exp1c 看到的現象）
//     ② 對戰圓形競技場保護的備戰被補上戰鬥場後，反而吃到對手雪妖女的指示物（戰鬥場不受保護）
//     ③ 會被冰冷之帳打倒的備戰先被派上場，昏厥後還要再補一次位
//
// F1 使用者情境：對手中毒昏厥＋我方波克基斯剩 10 HP、備戰雪妖女 ⇒ END_TURN 當下冰冷之帳已放、波克基斯已昏厥，雙方都等補位
// F2 雙方都要補：一方補完先等；兩邊都補完才換回合；冰冷之帳整局只放一次
// F3 對戰圓形競技場：對手備戰（有特性）在檢查時受保護 ⇒ 補上戰鬥場後仍是 0（舊版補完才放 ⇒ 10）
// F4 灼傷昏厥同樣：冰冷之帳在補位之前放
// F5 昏厥的那隻略過（棄牌區那張的傷害不變）
// F6 正對照：沒有狀態昏厥 ⇒ 冰冷之帳照常、不停下來等補位
// F7 正面朝上獎賞的取獎視窗開著時維持舊流程（視窗不被蓋掉；補完位後冰冷之帳放一次）
// F8 冰冷之帳把昏厥方最後一隻備戰打倒 ⇒ 直接判勝負，不卡在等補位
// F9～F12：Fable 審查補充（結束回合方自己昏厥、0 先補、等補位時重送 END_TURN、等待提示）
// HEAD-FAIL：同一批案例餵 v6.499 的引擎（git archive）逐條列紅（Rule 41）。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
import { hasBaseCommit, shallowSkip } from './lib/base-blob.mjs';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.499。
const BASE_SHA = '25ecb097';
const tmpFiles = [];
process.on('exit', () => { for (const p of tmpFiles) { try { rmSync(p, { recursive: true, force: true }); } catch {} } });

async function loadEngine(srcRoot) {
  const dir = mkdtempSync(join(tmpdir(), 'v6500-')); tmpFiles.push(dir);
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
assert.ok(pool.get(KISS).abilities?.length > 0 && !(pool.get(KOKO).abilities?.length), 'fixture：波克基斯有特性、卡璞・鳴鳴ex 沒有');
const hp = (id) => Number(pool.get(id).hp);

function makeCases({ createGame, applyAction }) {
  let n = 0; const inst = (cid, x = {}) => ({ iid: 'v500_' + (++n), cardId: String(cid), damage: 0, energyAttached: [], ...x });
  const pr = () => Array.from({ length: 6 }, () => inst(DEF));
  function board(p0, p1, extra = {}) {
    const s = createGame({ name: 'P1', entries: [{ cardId: DEF, count: 1 }] }, { name: 'P2', entries: [{ cardId: DEF, count: 1 }] }, pool);
    return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, isFirstTurn: false, turn: 5, log: [],
      setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], pendingSelection: null, ...extra,
      players: [
        { ...s.players[0], hand: [], deck: [inst(DEF), inst(DEF)], discard: [], prizes: pr(), bench: [], ...p0 },
        { ...s.players[1], hand: [], deck: [inst(DEF), inst(DEF)], discard: [], prizes: pr(), bench: [], ...p1 }] };
  }
  // 擲幣一律反面（奇跡之吻不加、灼傷不解除）—— 讓獎賞張數固定
  const tails = (fn) => { const o = Math.random; Math.random = () => 0.9; try { return fn(); } finally { Math.random = o; } };
  const endTurn = (s) => tails(() => applyAction(s, { type: 'END_TURN' }, pool));
  const send = (s, who, iid) => tails(() => applyAction(s, { type: 'SEND_NEW_ACTIVE', senderIdx: who, iid }, pool));
  const tentLogs = (s) => s.log.filter(l => /^冰冷之帳：/.test(l.message) && !/獎賞卡/.test(l.message));
  const idxOf = (s, re) => s.log.findIndex(l => re.test(l.message));
  const C = {};
  C.F1 = () => {
    const s = endTurn(board({ active: inst(KISS, { damage: hp(KISS) - 10 }), bench: [inst(FROS)] },
                            { active: inst(CACNEA, { status: 'poisoned', damage: hp(CACNEA) - 10 }), bench: [inst(KOKO)] }));
    assert.ok(s.players[1].discard.some(c => c.cardId === CACNEA), '前置：沙鈴仙人掌應被毒死');
    assert.equal(tentLogs(s).length, 1, 'END_TURN 當下冰冷之帳就要放（不等補位）');
    assert.ok(s.players[0].discard.some(c => c.cardId === KISS), '波克基斯（剩 10 HP）應被冰冷之帳打倒');
    assert.equal(s.players[0].active, null); assert.equal(s.players[1].active, null);
    assert.equal(s.endTurnContinueAfterKO, 0, '檢查結束後停下來等補位');
    assert.equal(s.activePlayerIndex, 0, '還沒換回合');
  };
  C.F2 = () => {
    let s = endTurn(board({ active: inst(KISS, { damage: hp(KISS) - 10 }), bench: [inst(FROS)] },
                          { active: inst(CACNEA, { status: 'poisoned', damage: hp(CACNEA) - 10 }), bench: [inst(KOKO)] }));
    s = send(s, 1, s.players[1].bench[0].iid);
    assert.equal(s.players[1].active?.cardId, KOKO);
    assert.equal(s.activePlayerIndex, 0, '另一方戰鬥場還空著 ⇒ 先等，不換回合');
    assert.equal(s.endTurnContinueAfterKO, 0);
    s = send(s, 0, s.players[0].bench[0].iid);
    assert.equal(s.players[0].active?.cardId, FROS);
    assert.equal(s.activePlayerIndex, 1, '兩邊都補完 ⇒ 換回合');
    assert.equal(s.endTurnContinueAfterKO ?? null, null);
    assert.equal(tentLogs(s).length, 1, '冰冷之帳整個檢查只放一次');
    assert.equal(s.players[1].active.damage, 0, '卡璞・鳴鳴ex 沒有特性 ⇒ 不放');
    assert.equal(6 - s.players[0].prizes.length, 1); assert.equal(6 - s.players[1].prizes.length, 1);
  };
  C.F3 = () => {
    let s = endTurn(board({ active: inst(KOKO), bench: [inst(FROS)] },
                          { active: inst(CACNEA, { status: 'poisoned', damage: hp(CACNEA) - 10 }), bench: [inst(KISS)] },
                          { activeStadium: inst(ARENA) }));
    s = send(s, 1, s.players[1].bench[0].iid);
    assert.equal(s.players[1].active?.cardId, KISS);
    assert.equal(s.players[1].active.damage, 0, '檢查時在備戰受對戰圓形競技場保護 ⇒ 補上戰鬥場後仍是 0');
    assert.equal(s.activePlayerIndex, 1);
  };
  C.F4 = () => {
    const s = endTurn(board({ active: inst(KOKO), bench: [inst(FROS)] },
                            { active: inst(CACNEA, { status: 'burned', damage: hp(CACNEA) - 20 }), bench: [inst(KISS)] }));
    assert.ok(s.players[1].discard.some(c => c.cardId === CACNEA), '前置：灼傷昏厥');
    assert.equal(tentLogs(s).length, 1, '灼傷昏厥後冰冷之帳同樣在補位之前放');
    assert.equal(s.players[1].bench[0].damage, 10, '對手備戰的波克基斯（有特性）放 1 個');
    assert.equal(s.endTurnContinueAfterKO, 0);
    const iS = idxOf(s, /燒傷傷害擊倒/), iT = idxOf(s, /^冰冷之帳：/);
    assert.ok(iS >= 0 && iT > iS, 'log 順序：灼傷昏厥 → 冰冷之帳');
  };
  C.F5 = () => {
    const s = endTurn(board({ active: inst(KOKO), bench: [inst(FROS)] },
                            { active: inst(KISS, { status: 'poisoned', damage: hp(KISS) - 10 }), bench: [inst(KOKO)] }));
    const dead = s.players[1].discard.find(c => c.cardId === KISS);
    assert.ok(dead, '前置：波克基斯中毒昏厥');
    assert.equal(dead.damage, hp(KISS), '已昏厥的那隻略過（傷害只有中毒那 10）');
    assert.equal(tentLogs(s).length, 0, '場上沒有其他有特性的寶可夢 ⇒ 沒有放任何指示物');
  };
  C.F6 = () => {
    const s = endTurn(board({ active: inst(KOKO), bench: [inst(FROS), inst(KISS)] },
                            { active: inst(KISS), bench: [inst(KOKO)] }));
    assert.equal(tentLogs(s).length, 1);
    assert.equal(s.players[0].bench[1].damage, 10); assert.equal(s.players[1].active.damage, 10);
    assert.equal(s.endTurnContinueAfterKO ?? null, null, '沒有昏厥 ⇒ 不停');
    assert.equal(s.activePlayerIndex, 1, '直接換回合');
  };
  C.F7 = () => {
    const prizes = pr(); prizes[0] = { ...prizes[0], faceUp: true };
    let s = endTurn(board({ active: inst(KOKO), bench: [inst(FROS), inst(KISS)], prizes },
                          { active: inst(CACNEA, { status: 'poisoned', damage: hp(CACNEA) - 10 }), bench: [inst(KOKO)] }));
    assert.equal(s.pendingSelection?.effectKey, 'take-prize-choose', '前置：有正面朝上獎賞 ⇒ 開取獎視窗');
    assert.equal(tentLogs(s).length, 0, '視窗開著時維持舊流程（不在這時候放，避免蓋掉視窗）');
    s = tails(() => applyAction(s, { type: 'RESOLVE_SELECTION', senderIdx: 0, actorIdx: 0, effectKey: 'take-prize-choose',
      selectedIids: [s.pendingSelection.params?.options?.[0]?.id ?? 'random'] }, pool));
    assert.equal(s.pendingSelection ?? null, null, '取獎視窗應已結束');
    s = send(s, 1, s.players[1].bench[0].iid);
    assert.equal(tentLogs(s).length, 1, '補完位後冰冷之帳放一次');
    assert.equal(s.players[0].bench[1].damage, 10);
    assert.equal(s.activePlayerIndex, 1);
  };
  C.F8 = () => {
    const s = endTurn(board({ active: inst(KOKO), bench: [inst(FROS)] },
                            { active: inst(CACNEA, { status: 'poisoned', damage: hp(CACNEA) - 10 }), bench: [inst(KISS, { damage: hp(KISS) - 10 })] }));
    assert.equal(s.phase, 'game-over', '對手最後一隻備戰被冰冷之帳打倒 ⇒ 直接判定');
    assert.equal(s.winner, 0);
  };
  // ── Fable 審查補充 ──
  C.F9 = () => {
    // 結束回合的一方（aIdx）自己的戰鬥寶可夢中毒昏厥：對手的雪妖女照樣在補位前對我方備戰放
    let s = endTurn(board({ active: inst(CACNEA, { status: 'poisoned', damage: hp(CACNEA) - 10 }), bench: [inst(KISS)] },
                          { active: inst(KOKO), bench: [inst(FROS)] }));
    assert.ok(s.players[0].discard.some(c => c.cardId === CACNEA), '前置：自己中毒昏厥');
    assert.equal(s.players[0].bench[0].damage, 10, '補位前我方備戰波克基斯已被放 1 個');
    assert.equal(s.endTurnContinueAfterKO, 0);
    s = send(s, 0, s.players[0].bench[0].iid);
    assert.equal(s.activePlayerIndex, 1); assert.equal(s.players[0].active.damage, 10);
    assert.equal(tentLogs(s).length, 1);
  };
  C.F10 = () => {
    // 雙方都要補，換另一個順序（0 先補）
    let s = endTurn(board({ active: inst(KISS, { damage: hp(KISS) - 10 }), bench: [inst(FROS)] },
                          { active: inst(CACNEA, { status: 'poisoned', damage: hp(CACNEA) - 10 }), bench: [inst(KOKO)] }));
    assert.equal(s.players[0].active, null, '前置：冰冷之帳已在檢查中打倒 0 的波克基斯');
    s = send(s, 0, s.players[0].bench[0].iid);
    assert.equal(s.players[0].active?.cardId, FROS, '0 先補上雪妖女');
    assert.equal(s.activePlayerIndex, 0, '0 先補 ⇒ 等 1'); assert.equal(s.endTurnContinueAfterKO, 0);
    s = send(s, 1, s.players[1].bench[0].iid);
    assert.equal(s.activePlayerIndex, 1); assert.equal(tentLogs(s).length, 1);
  };
  C.F11 = () => {
    // 等補位時重送 END_TURN ⇒ 不可以再跑一次檢查（中毒再扣、冰冷之帳再放）
    let s = endTurn(board({ active: inst(CACNEA, { status: 'poisoned', damage: hp(CACNEA) - 10 }), bench: [inst(KOKO)] },
                          { active: inst(KISS, { status: 'poisoned' }), bench: [inst(FROS)] }));
    const dmg = s.players[1].active.damage;
    assert.equal(dmg, 20, '前置：對手的波克基斯中毒 10＋冰冷之帳 10');
    const s2 = endTurn(s);
    assert.equal(s2.players[1].active.damage, dmg, '重送的 END_TURN 是 no-op');
    assert.equal(tentLogs(s2).length, 1);
  };
  return C;
}

let pass = 0, fail = 0;
const CUR = makeCases(await loadEngine(ROOT));
const NAMES = {
  F1: '使用者情境：對手中毒昏厥後，END_TURN 當下冰冷之帳已放、波克基斯昏厥，雙方停下來等補位',
  F2: '雙方都要補：先補的一方等待；兩邊補完才換回合；冰冷之帳只放一次',
  F3: '對戰圓形競技場：檢查時受保護的備戰，補上戰鬥場後仍是 0',
  F4: '灼傷昏厥後，冰冷之帳同樣在補位之前放（log 順序正確）',
  F5: '已昏厥的那隻略過',
  F6: '正對照：沒有狀態昏厥 ⇒ 冰冷之帳照常、直接換回合',
  F7: '正面朝上獎賞的取獎視窗開著時維持舊流程，補完位後放一次',
  F8: '冰冷之帳打倒昏厥方最後一隻備戰 ⇒ 直接判勝負（由出口的中央終局判定判出）',
  F9: '結束回合的一方自己中毒昏厥：對手的冰冷之帳在補位前放',
  F10: '雙方都要補，0 先補也正確',
  F11: '等補位時重送 END_TURN 不會再跑一次檢查',
};
for (const [k, f] of Object.entries(CUR)) {
  try { f(); pass++; console.log('  OK', k, NAMES[k]); } catch (e) { fail++; console.log('  FAIL', k, NAMES[k], '::', e.message); }
}

// F12 補位提示：先補完的一方看得到「等待對手送出」（modal-slots.ts）
async function loadSlots(srcRoot) {
  const dir = mkdtempSync(join(tmpdir(), 'v6500s-')); tmpFiles.push(dir);
  await build({ entryPoints: [join(srcRoot, 'src/lib/game/modal-slots.ts')], outfile: join(dir, 'm.mjs'), bundle: true, format: 'esm', platform: 'node', logLevel: 'error' });
  return await import(pathToFileURL(join(dir, 'm.mjs')).href);
}
const F12 = (M) => {
  const pa = M.promoteAlerts;
  const players = [{ active: null, bench: [{}] }, { active: {}, bench: [] }];
  const base = { phase: 'playing', players, hasPendingSelection: false, defenderIdx: 1, myIdx: 1, defenderTurnMine: false, isMyTurn: false, oppIdx: 0, turnPhase: 'end' };
  assert.equal(pa({ ...base, checkupPromoteWait: true }).waitSeat, 0, '檢查後等補位 ⇒ 顯示等待座位 0');
  assert.equal(pa({ ...base, checkupPromoteWait: false }).waitSeat, null, '正對照：一般回合結束 ⇒ 維持原判準');
};
try { F12(await loadSlots(ROOT)); pass++; console.log('  OK F12 補位提示：先補完的一方看得到等待對手'); } catch (e) { fail++; console.log('  FAIL F12 :: ' + e.message); }

console.log('── HEAD-FAIL（v6.499 引擎）──');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const bdir = mkdtempSync(join(tmpdir(), 'v6500-base-')); tmpFiles.push(bdir);
  execSync(`git -C "${ROOT}" archive ${BASE_SHA} src | tar -x -C "${bdir}"`);
  const B = makeCases(await loadEngine(bdir));
  const red = [];
  for (const [k, f] of Object.entries(B)) { try { f(); } catch (e) { if (e instanceof assert.AssertionError) red.push(k); else throw e; } }
  try { F12(await loadSlots(bdir)); } catch (e) { if (e instanceof assert.AssertionError) red.push('F12'); else throw e; }
  console.log('  （v6.499 紅了：' + red.join('、') + '）');
  const expectRed = ['F1', 'F2', 'F3', 'F4', 'F8', 'F9', 'F10', 'F11', 'F12'];   // F8：舊版要先補位、補上去的那隻再被冰冷之帳打倒才判定
  const expectGreen = ['F5', 'F6', 'F7'];
  if (expectRed.every(k => red.includes(k)) && expectGreen.every(k => !red.includes(k))) { pass++; console.log('  OK S0 HEAD-FAIL：F1～F4、F8～F12 在 v6.499 紅，F5～F7（不變的行為）在 v6.499 綠'); }
  else { fail++; console.log('  FAIL S0 HEAD-FAIL 分佈不符 :: 紅＝' + red.join(',')); }
} else shallowSkip('v6500 S0：HEAD-FAIL', '需要 BASE commit');

console.log(`\n=== v6.500 冰冷之帳在狀態昏厥後照常結算：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
