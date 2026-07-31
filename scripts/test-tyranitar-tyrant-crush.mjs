/**
 * 班基拉斯ex|暴君粉碎 — 固定 150 傷害（v5.686）
 * 卡面（SVM 12148, static/cards 權威）：傷害固定 150，效果「在不看正面的情況下，從對手的手牌選擇1張，將其丟棄」。
 * 原 bug：regPre 誤植硬寫 `damage: 50`（殘留「50×」錯誤註解，台灣無 50× 版）→ 暴君粉碎只打 50。
 * 修：移除 regPre，改由引擎讀卡面 150；regPost 棄對手手牌 1 張。
 * v6.065 更新：卡面是「**選擇**1張」→ 改走 concealed picker（玩家看卡背盲選），不再是隨機直接丟。
 *   本測試同步從「手牌立刻 2→1」改為「開 hand-discard + concealed picker、選 1 張」。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.tc-s.mjs'), E = join(ROOT, '.tc-e.ts'), O = join(ROOT, '.tc-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { createGame, applyAction } from './src/lib/game/engine';\nexport { ATTACK_PRE } from './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction, ATTACK_PRE } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }

const TYRANITAR = '12148' /*班基拉斯ex 暴君粉碎=attackIndex 1*/,
      DRAGON = '14425' /*超級噴火龍Xex HP360 弱點水(非惡)→暴君粉碎無弱抗,精確150不KO*/,
      DARK_E = '14430' /*基本惡能量*/, DEF2 = '14705';
let nn = 0;
const inst = (cid, x = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], ...x });

let pass = 0, fail = 0;
const T = (nm, f) => { try { f(); console.log('  OK', nm); pass++; } catch (e) { console.log('  FAIL', nm, '::', e.message); fail++; } };

function runTyrantCrush() {
  const s = createGame({ name: 'P1', entries: [{ cardId: TYRANITAR, count: 1 }] }, { name: 'P2', entries: [{ cardId: DRAGON, count: 1 }] }, pool);
  const st = { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 1, isFirstTurn: false,
    setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], pendingSelection: null,
    players: [
      { ...s.players[0], active: inst(TYRANITAR, { energyAttached: [inst(DARK_E), inst(DARK_E), inst(DARK_E)] }),
        bench: [], deck: [inst(DEF2)], discard: [], prizes: Array.from({ length: 6 }, () => inst(DEF2)) },
      { ...s.players[1], active: inst(DRAGON), bench: [], hand: [inst(DEF2), inst(DEF2)],
        deck: [inst(DEF2)], discard: [], prizes: Array.from({ length: 6 }, () => inst(DEF2)) }] };
  return applyAction(st, { type: 'ATTACK', attackIndex: 1 }, pool);
}

T('★暴君粉碎固定 150 傷害（HEAD 硬寫 50 → FAIL）', () => {
  const out = runTyrantCrush();
  assert.equal(out.players[1].active.damage, 150, '對手應受 150 傷害（非 50）');
});
T('暴君粉碎開 concealed picker 選 1 張對手手牌（v6.065：卡面是「選擇」不是隨機）', () => {
  const out = runTyrantCrush();
  const p = out.pendingSelection;
  assert.equal(p?.type, 'hand-discard', '應開 hand-discard picker');
  assert.equal(p?.params?.concealed, true, '應為 concealed（看卡背、不揭示卡名）');
  assert.equal(p?.minCount, 1, '應選剛好 1 張');
  assert.equal(p?.maxCount, 1, '應選剛好 1 張');
  // ⚠ picker 尚未 resolve → 對手手牌此時不得被動到
  assert.equal(out.players[1].hand.length, 2, 'picker 未選完前，對手手牌應維持 2 張');
  assert.equal(out.players[1].discard.length, 0, 'picker 未選完前，棄牌區應為 0');
});
T('暴君粉碎不再註冊 regPre（base 由卡面 150 決定）', () => {
  assert.ok(!ATTACK_PRE.has('班基拉斯ex|暴君粉碎'), '應移除誤植的 regPre');
});

console.log('\n暴君粉碎固定150:PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
