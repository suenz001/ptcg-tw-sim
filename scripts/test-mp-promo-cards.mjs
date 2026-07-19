// M-P J 標 6 招 HEAD-FAIL 回歸測試（v5.990）
// HEAD 未註冊這些 key → ATTACK_PRE/POST.get(...) 為 undefined → 直接 throw，證明 HEAD-FAIL。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.xm-s.js'), E = join(ROOT, '.xm-e.ts'), O = join(ROOT, '.xm-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { ATTACK_POST, ATTACK_PRE } from './src/lib/game/effects/_shared';\n"
              + "export { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const mod = await import(pathToFileURL(O).href);
const { ATTACK_PRE, ATTACK_POST } = mod;

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }

let iidN = 0;
const inst = (cardId, extra = {}) => ({ iid: 'i' + (++iidN), cardId: String(cardId), damage: 0, energyAttached: [], toolAttached: null, ...extra });
const mkState = (p0, p1) => ({
  phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
  isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
  players: [
    { name: 'A', active: null, bench: [], hand: [], deck: [], discard: [], prizes: [], ...p0 },
    { name: 'B', active: null, bench: [], hand: [], deck: [], discard: [], prizes: [], ...p1 },
  ],
});
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log('  ✗ FAIL:', name); } };
const heads = (s) => ({ ...s, _retryInjectedFlipsQueue: ['正面'] });
const tails = (s) => ({ ...s, _retryInjectedFlipsQueue: ['反面'] });

// 存在性（HEAD-FAIL 核心）
for (const k of ['新葉喵|嬉鬧', '魔幻假面喵ex|魔法子彈', '索羅亞克ex|狂暴亂打', '索羅亞克ex|猛擊在地', '伊布ex|呼喚', '伊布ex|勇氣衝刺']) {
  const has = ATTACK_PRE.has(k) || ATTACK_POST.has(k);
  ok('已註冊 ' + k, has);
}

// 1. 新葉喵|嬉鬧 10+：正面 30、反面 10
{
  const base = mkState({ active: inst(19378) }, { active: inst(1) });
  const rh = ATTACK_PRE.get('新葉喵|嬉鬧')(heads(base), 0, pool, {});
  ok('嬉鬧 正面=30', rh.damage === 30);
  const rt = ATTACK_PRE.get('新葉喵|嬉鬧')(tails(base), 0, pool, {});
  ok('嬉鬧 反面=10', rt.damage === 10);
}

// 2. 魔幻假面喵ex|魔法子彈：主 regPre=120；regPost 只對受傷備戰開 picker，validIids 僅受傷者
{
  ok('魔法子彈 regPre=120', ATTACK_PRE.get('魔幻假面喵ex|魔法子彈')(mkState({active:inst(19380)},{active:inst(1)}),0,pool,{}).damage === 120);
  const b0 = inst(1, { damage: 0 }), b1 = inst(2, { damage: 30 }), b2 = inst(3, { damage: 0 });
  const st = mkState({ active: inst(19380) }, { active: inst(4), bench: [b0, b1, b2] });
  const s = ATTACK_POST.get('魔幻假面喵ex|魔法子彈')(st, 0, pool, {});
  ok('魔法子彈 開 opp-bench-choose', s.pendingSelection?.type === 'opp-bench-choose');
  const vi = s.pendingSelection?.params?.validIids ?? [];
  ok('魔法子彈 validIids 僅受傷備戰(b1)', vi.length === 1 && vi[0] === b1.iid);
  ok('魔法子彈 傷害參數=120', s.pendingSelection?.params?.amount === 120);
  // 無受傷備戰 → 無 pending
  const st2 = mkState({ active: inst(19380) }, { active: inst(4), bench: [inst(1,{damage:0})] });
  const s2 = ATTACK_POST.get('魔幻假面喵ex|魔法子彈')(st2, 0, pool, {});
  ok('魔法子彈 無受傷備戰→不開 picker', s2.pendingSelection == null);
}

// 3. 索羅亞克ex|狂暴亂打：場上數(active+bench)×20
{
  const st = mkState({ active: inst(19382), bench: [inst(1), inst(2)] }, { active: inst(3) });
  ok('狂暴亂打 3隻×20=60', ATTACK_PRE.get('索羅亞克ex|狂暴亂打')(st, 0, pool, {}).damage === 60);
  const st1 = mkState({ active: inst(19382) }, { active: inst(3) });
  ok('狂暴亂打 僅戰鬥場1隻=20', ATTACK_PRE.get('索羅亞克ex|狂暴亂打')(st1, 0, pool, {}).damage === 20);
}

// 4. 索羅亞克ex|猛擊在地：單鎖 blockedAttackNamesNextTurn
{
  const st = mkState({ active: inst(19382) }, { active: inst(1) });
  const s = ATTACK_POST.get('索羅亞克ex|猛擊在地')(st, 0, pool, {});
  const blk = s.players[0].active.blockedAttackNamesNextTurn ?? [];
  ok('猛擊在地 單鎖含自己', blk.includes('猛擊在地'));
  ok('猛擊在地 非全鎖(無 cantAttackPending)', !s.players[0].active.cantAttackPending && !s.players[0].cantAttackPending);
}

// 5. 伊布ex|呼喚：抽 3
{
  const st = mkState({ active: inst(19383), hand: [inst(1)], deck: [inst(2), inst(3), inst(4), inst(5)] }, { active: inst(6) });
  const s = ATTACK_POST.get('伊布ex|呼喚')(st, 0, pool, {});
  ok('呼喚 手牌+3', s.players[0].hand.length === 4);
  ok('呼喚 牌庫-3', s.players[0].deck.length === 1);
}

// 6. 伊布ex|勇氣衝刺：反面自身受30、正面無
{
  const st = mkState({ active: inst(19383) }, { active: inst(1) });
  const sT = ATTACK_POST.get('伊布ex|勇氣衝刺')(tails(st), 0, pool, {});
  ok('勇氣衝刺 反面 自身+30', sT.players[0].active.damage === 30);
  const sH = ATTACK_POST.get('伊布ex|勇氣衝刺')(heads(st), 0, pool, {});
  ok('勇氣衝刺 正面 自身無傷', (sH.players[0].active.damage ?? 0) === 0);
}

console.log(`\nM-P 特典卡測試：PASS ${pass} / FAIL ${fail}`);
if (fail > 0) process.exit(1);
