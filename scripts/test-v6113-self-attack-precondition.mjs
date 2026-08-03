// v6.113 守衛：「只有在…時，這隻寶可夢才可使用招式」型**自身條件 gate** 全部走中央述詞。
//
// Wilson 回報「超級泥偶巨人ex 能在手牌不滿 10 張時使用招式」。用 harness 跑真實
// applyAction 流程逐一重現，**乾淨盤面下引擎是對的**（手牌 5/9 張都被擋、10 張才可用）。
// 但沿著這個維度掃全站 HIJ 卡，抓到同型的**真 bug**：
//
//   卡面「自身條件才可使用招式」的 HIJ 卡共 3 張：
//     ① 火箭隊的超夢ex｜力量抑制者   → 走中央述詞 ✅
//     ② 超級泥偶巨人ex｜啟動限制     → 走中央述詞 ✅
//     ③ 請假王ex｜懶怠個性           → **自己一份 isLazyTraitBlockingAttack** ❌
//
//   ③ 只 gate 了「火箭隊的監視塔」一種特性消除，**漏掉招式版暗夜羽擊／振翼髮 passive／
//   傳說的熔岩洞／鐵荊棘ex 初始化**。特性被消除時限制就該消失，但舊實作照擋。
//   ⚠ 而且它的 ATTACK 分支還會 `turnPhase:'end'` —— 「無法使用招式」不該連回合都耗掉，
//   同維度另兩張都只是拒絕並寫 log。三張已統一。
//
// ⭐ 一勞永逸：本檔最後一條是**枚舉守衛** —— 掃 static/cards 的 HIJ 卡面，
//   凡是「才可使用招式／無法使用招式」型特性，特性名都必須出現在中央述詞裡。
//   新卡漏接會直接紅燈。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.v6113-s.js'), E = join(ROOT, '.v6113-e.ts'), O = join(ROOT, '.v6113-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { applyAction, getAvailableAttacks } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
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
const byName = (n, p) => [...pool.values()].find(c => c.name === n && (!p || p(c)));
let seq = 0;
const inst = (id, ex) => ({ iid: 'i' + (++seq), cardId: String(id), damage: 0, energyAttached: [], ...(ex || {}) });

let pass = 0, fail = 0;
function T(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e && e.message)); fail++; }
}
function ok(cond, msg) { if (!cond) throw new Error(msg); }

const GOLURK = byName('超級泥偶巨人ex');
const LAZY = byName('請假王ex');
const PSY = byName('基本【超】能量'), CE = byName('基本【草】能量');
const FILLER = byName('高級球'), NONEX = byName('泥偶巨人');
const IRON = byName('鐵荊棘ex'), MOON = byName('振翼髮', c => (c.abilities || []).some(a => a.name === '暗夜羽擊'));
const CAVE = byName('傳說的熔岩洞'), WATCH = byName('火箭隊的監視塔');

const board = (selfCard, selfExtra, energy, handN, oppCard, stadium) => ({
  phase: 'playing', turnPhase: 'main', turn: 5, activePlayerIndex: 0, firstPlayerIdx: 0,
  isFirstTurn: false, setupDone: [true, true], log: [], pendingSelection: null,
  activeStadium: stadium ? inst(stadium.id) : null,
  players: [{ name: 'P1', active: inst(selfCard.id, { energyAttached: energy, ...(selfExtra || {}) }),
              bench: [], hand: Array.from({ length: handN }, () => inst(FILLER.id)),
              deck: [], discard: [], prizes: [] },
            { name: 'P2', active: inst((oppCard || NONEX).id), bench: [], hand: [], deck: [], discard: [], prizes: [] }],
});
const usable = (st) => M.getAvailableAttacks(st, pool).length > 0;

console.log('① 超級泥偶巨人ex｜啟動限制（Wilson 回報的那張）');

T('卡面查證：手牌 10 張「以上」才可使用招式', () => {
  const eff = (GOLURK.abilities || []).find(a => a.name === '啟動限制')?.effect ?? '';
  ok(eff.includes('10張以上'), '卡面文字變了：' + eff);
});

const golEnergy = () => [inst(PSY.id), inst(PSY.id)];
T('⭐ 手牌 5 張 → 不可用', () => ok(!usable(board(GOLURK, null, golEnergy(), 5)), '手牌 5 張竟可用'));
T('⭐ 手牌 9 張 → 不可用（邊界）', () => ok(!usable(board(GOLURK, null, golEnergy(), 9)), '手牌 9 張竟可用'));
T('⭐ 手牌 10 張 → 可用（邊界，「以上」含 10）', () => ok(usable(board(GOLURK, null, golEnergy(), 10)), '手牌 10 張竟不可用'));
T('ATTACK 也被擋（不只 UI 反白）', () => {
  const st = board(GOLURK, null, golEnergy(), 5);
  const r = M.applyAction(st, { type: 'ATTACK', attackIndex: 0, actorIdx: 0 }, pool);
  ok((r.players[1].active?.damage ?? 0) === 0, '引擎沒擋住，對手受傷了');
});
T('特性被消除時限制消失（招式版暗夜羽擊）→ 可用', () =>
  ok(usable(board(GOLURK, { abilityNullifiedThisTurn: true }, golEnergy(), 5)), '特性被消除了卻還擋'));

console.log('② 請假王ex｜懶怠個性（同維度，本版收進中央述詞）');

const lazyEnergy = () => [inst(CE.id), inst(CE.id), inst(CE.id), inst(CE.id)];
T('卡面查證：對手場上沒有 ex/V 則無法使用招式', () => {
  const eff = (LAZY.abilities || []).find(a => a.name === '懶怠個性')?.effect ?? '';
  ok(eff.includes('無法使用招式'), '卡面文字變了：' + eff);
});
T('⭐ 對手無 ex/V → 不可用', () => ok(!usable(board(LAZY, null, lazyEnergy(), 0, NONEX)), '限制沒生效'));
T('對手是 ex → 可用', () => ok(usable(board(LAZY, null, lazyEnergy(), 0, IRON)), '對手有 ex 卻擋'));
T('⭐ ＋招式版暗夜羽擊 → 可用（HEAD 會 FAIL）', () =>
  ok(usable(board(LAZY, { abilityNullifiedThisTurn: true }, lazyEnergy(), 0, NONEX)), '特性被消除了卻還擋'));
T('⭐ ＋傳說的熔岩洞（進化寶可夢特性消除；請假王ex 是 Stage2）→ 可用（HEAD 會 FAIL）', () =>
  ok(usable(board(LAZY, null, lazyEnergy(), 0, NONEX, CAVE)), '特性被消除了卻還擋'));
T('⭐ ＋對手戰鬥場振翼髮（passive 暗夜羽擊；振翼髮非 ex/V）→ 可用（HEAD 會 FAIL）', () =>
  ok(usable(board(LAZY, null, lazyEnergy(), 0, MOON)), '特性被消除了卻還擋'));
T('＋火箭隊的監視塔（Colorless 特性消除）→ 可用（HEAD 本來就對，守住不回歸）', () =>
  ok(usable(board(LAZY, null, lazyEnergy(), 0, NONEX, WATCH)), '監視塔的 gate 掉了'));

T('⭐ 被擋時不得連回合都結束（「無法使用招式」≠「回合結束」）', () => {
  const st = board(LAZY, null, lazyEnergy(), 0, NONEX);
  const r = M.applyAction(st, { type: 'ATTACK', attackIndex: 0, actorIdx: 0 }, pool);
  ok(r.turnPhase !== 'end', '舊寫法會 turnPhase:\'end\' —— 同維度另兩張都只是拒絕');
});

console.log('③ 中央收斂：三張走同一個述詞，不得再各寫一份');

const ENG = readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8');
function section(src, a, b) {
  const i = src.indexOf(a); if (i < 0) return '';
  const j = b ? src.indexOf(b, i + a.length) : -1;
  return src.slice(i, j > 0 ? j : src.length);
}
const CENTRAL = section(ENG, 'function selfAttackPreconditionBlock', 'export function getAvailableAttacks');

T('⭐ 三個特性名都在中央述詞裡', () => {
  ok(CENTRAL.length > 500, '抓不到 selfAttackPreconditionBlock');
  for (const n of ['力量抑制者', '啟動限制', '懶怠個性']) {
    ok(CENTRAL.includes(`'${n}'`), '中央述詞缺少「' + n + '」');
  }
});

T('⭐ 每一支都過 isAbilityHolderEffective（特性被消除→限制消失）', () => {
  const gates = (CENTRAL.match(/isAbilityHolderEffective\(/g) || []).length;
  ok(gates >= 3, '只有 ' + gates + ' 個特性有效性 gate，應該每張各一個');
});

T('⭐ engine 不得在中央述詞之外自己呼叫 isLazyTraitBlockingAttack', () => {
  const outside = ENG.split('function selfAttackPreconditionBlock');
  const before = outside[0];
  const after = (outside[1] || '').split('export function getAvailableAttacks').slice(1).join('');
  ok(!/isLazyTraitBlockingAttack\(/.test(before.replace(/import[\s\S]*?from '[^']+';/g, '')),
    'ATTACK handler 還留著自己一份');
  ok(!/isLazyTraitBlockingAttack\(/.test(after), 'getAvailableAttacks 之後還留著自己一份');
});

T('⭐ isLazyTraitBlockingAttack 只判卡面條件，不得自己再判特性消除', () => {
  const eff = readFileSync(join(ROOT, 'src/lib/game/effects.ts'), 'utf8');
  const fn = section(eff, 'export function isLazyTraitBlockingAttack', '\n}\n');
  ok(fn.length > 200, '抓不到 isLazyTraitBlockingAttack');
  ok(!/火箭隊的監視塔/.test(fn.replace(/\/\/[^\n]*/g, '')),
    '函式裡還自己 gate 監視塔 —— 兩份判斷遲早漂移，特性有效性交給中央述詞');
});

console.log('④ ⭐ 枚舉守衛：卡面有這型限制的 HIJ 卡，都必須在中央述詞裡');

T('⭐ 掃 static/cards：沒有漏接的卡', () => {
  const re = /才可使用招式|無法使用招式|不能使用招式|才能使用招式/;
  const missing = [];
  const seen = new Set();
  for (const c of pool.values()) {
    if (!['H', 'I', 'J'].includes(c.regulationMark)) continue;
    for (const a of (c.abilities || [])) {
      if (!re.test(a.effect || '')) continue;
      const k = c.name + '｜' + a.name;
      if (seen.has(k)) continue;
      seen.add(k);
      if (!CENTRAL.includes(`'${a.name}'`)) missing.push(k + '　卡面：' + a.effect);
    }
  }
  ok(missing.length === 0,
    '這些卡的「自身條件才可使用招式」沒接進中央述詞（新卡漏接）：\n        ' + missing.join('\n        '));
  console.log('     （本維度 HIJ 共 ' + seen.size + ' 張，全部已接）');
});

T('正對照：枚舉判準抓得到假想的漏接卡', () => {
  const fakeAbility = '假想限制';
  ok(!CENTRAL.includes(`'${fakeAbility}'`), '判準永遠成立 ⇒ 假綠');
});

console.log('\n=== v6.113 自身條件才可使用招式：PASS ' + pass + ' / FAIL ' + fail + ' ===');
if (fail > 0) process.exit(1);
