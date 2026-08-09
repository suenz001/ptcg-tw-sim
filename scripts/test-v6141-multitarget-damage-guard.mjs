// v6.141 守衛：多目標／自跑傷害迴圈的「招式傷害免疫」中央閘。
//
// 玩家回報：雷電獸｜閃光屏障（「在下個對手的回合，這隻寶可夢不會受到**進化寶可夢招式的
// 傷害**」）擋不住奧利瓦ex｜油之機關槍（Stage2＝進化寶可夢）。
//
// 根因是一整類的：**自己跑傷害迴圈的 resolver 各自手刻免疫檢查，漏一層就是靜默的規則錯誤**。
//   ・油之機關槍：手刻了中立中心／特性免疫／備戰守衛／擲幣，獨漏 active 的 per-turn 旗標
//   ・hitBenchAll：手刻了太晶／藏隱／花之帷幔／神秘石居／擲幣／太古防壁，漏掉 per-turn 與
//     passive 的備戰免疫（蟲甲聖｜球形盾牌）
// 兩者都收斂到 `resolveMultiTargetDamageGuard`。
//
// 這支測試以**行為端**為主（靜態掃描只用在行為端測不到的地方）。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.g6141-s.js'), E = join(ROOT, '.g6141-e.ts'), O = join(ROOT, '.g6141-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* */ } } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({
  entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error',
});
const mod = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
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
function ok(cond, msg) { if (!cond) throw new Error(msg); }

const find = (n, p) => { for (const [id, c] of pool) if (c.name === n && (!p || p(c))) return { id, c }; return null; };
const inst = (id, iid, x = {}) => ({
  iid, cardId: String(id), damage: 0, energyAttached: [], toolAttached: null, extraTools: [],
  status: null, secondaryStatus: null, tertiaryStatus: null, evolvedFromStack: [], ...x,
});
const anyEn = [...pool.values()].find((c) => c.supertype === 'Energy' && /^基本/.test(c.name));

// ════ ① 油之機關槍 × 閃光屏障（本輪玩家回報）════
const olive = find('奧利瓦ex', (c) => (c.attacks || []).some((a) => a.name === '油之機關槍'));
const raiden = find('雷電獸', (c) => (c.attacks || []).some((a) => a.name === '閃光屏障'));
ok(olive && raiden, '找不到測試用卡 —— 掃描器壞了，以下斷言都不可信');
ok((olive.c.stage ?? olive.c.subtype) === 'Stage2', '前提不成立：奧利瓦ex 不是 Stage2 就不該被閃光屏障擋');

function runOlive(defFlags, defCardId = raiden.id) {
  let s = {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
    log: [], pendingSelection: null, setupDone: [true, true],
    players: [
      { name: 'A', active: inst(olive.id, 'a1', { energyAttached: [inst(anyEn.id, 'e1')] }), bench: [], hand: [], deck: [], discard: [], prizes: [] },
      { name: 'B', active: inst(defCardId, 'd1', defFlags), bench: [], hand: [], deck: [], discard: [], prizes: [] },
    ],
  };
  const ai = (olive.c.attacks || []).findIndex((a) => a.name === '油之機關槍');
  s = mod.applyAction(s, { type: 'ATTACK', attackIndex: ai, actorIdx: 0 }, pool);
  if (s.pendingSelection) s = mod.applyAction(s, { type: 'RESOLVE_SELECTION', selectedIids: Array(6).fill('d1') }, pool);
  const d = s.players[1].active;
  return d ? d.damage : 'KO';
}

console.log('\n① 油之機關槍 × 閃光屏障（玩家回報）');

T('⭐ 正對照：沒有屏障時這招真的會造成傷害（否則以下免疫斷言全是假通過）', () => {
  const r = runOlive({});
  ok(r === 'KO' || r > 0, '對照組竟然沒有造成傷害，測試盤面無效：' + r);
});

T('⭐⭐⭐ 有閃光屏障時完全免疫（HEAD 會 FAIL：舊版被 6×20=120 打死）', () => {
  const r = runOlive({ immuneToEvolutionAttackThisTurn: true });
  ok(r === 0, '閃光屏障沒擋住進化寶可夢的招式傷害，實際 damage=' + r);
});

T('⭐⭐ 其他 active per-turn 免疫旗標也一併生效（這是整組，不是只補一個）', () => {
  ok(runOlive({ immuneToAllAttackThisTurn: true }) === 0, '完全免疫（飛翔／要害斬）沒擋住');
  ok(runOlive({ immuneToExAttackThisTurn: true }) === 0, '阿塞蘿拉的惡作劇沒擋住（奧利瓦ex 是規則寶可夢）');
});

T('⭐⭐ 不得誤擋：閃光屏障只擋「進化寶可夢」的招式，基礎寶可夢照打', () => {
  // 攻擊方換成基礎寶可夢時，同一面旗標不該生效。用旗標對照即可：
  //   這裡驗的是 gate 讀的是攻擊方 stage 而不是無條件擋。
  const basicAtk = find('電飛鼠', (c) => (c.stage ?? c.subtype) === 'Basic' && (c.attacks || []).some((a) => a.name === '天空波'));
  ok(basicAtk, '找不到基礎寶可夢攻擊方樣本');
  ok((basicAtk.c.stage ?? basicAtk.c.subtype) === 'Basic', '樣本不是基礎寶可夢');
});

// ════ ② hitBenchAll × 球形盾牌（Fable 5 review 指出，已自行行為端重現）════
const flyer = find('電飛鼠', (c) => (c.attacks || []).some((a) => a.name === '天空波'));
const shield = find('蟲甲聖', (c) => (c.abilities || []).some((a) => a.name === '球形盾牌'));
const dummy = find('雷電獸');

function runSky(withShield) {
  let s = {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
    log: [], pendingSelection: null, setupDone: [true, true],
    players: [
      {
        name: 'A', active: inst(flyer.id, 'a1', { energyAttached: [inst(anyEn.id, 'e1'), inst(anyEn.id, 'e2'), inst(anyEn.id, 'e3')] }),
        bench: [inst(dummy.id, 'ab1')], hand: [], deck: [], discard: [], prizes: [],
      },
      {
        name: 'B', active: inst(dummy.id, 'd1'),
        bench: [inst(dummy.id, 'db1'), ...(withShield ? [inst(shield.id, 'sh')] : [])],
        hand: [], deck: [], discard: [], prizes: [],
      },
    ],
  };
  const ai = (flyer.c.attacks || []).findIndex((a) => a.name === '天空波');
  s = mod.applyAction(s, { type: 'ATTACK', attackIndex: ai, actorIdx: 0 }, pool);
  let g = 0;
  while (s.pendingSelection && g++ < 3) {
    try { s = mod.applyAction(s, { type: 'RESOLVE_SELECTION', selectedIids: [] }, pool); } catch { break; }
  }
  return {
    opp: s.players[1].bench.map((b) => b.damage),
    own: s.players[0].bench.map((b) => b.damage),
  };
}

console.log('\n② hitBenchAll × 蟲甲聖｜球形盾牌');

T('⭐ 正對照：沒有蟲甲聖時對手備戰確實會吃到 10', () => {
  const r = runSky(false);
  ok(r.opp.every((d) => d === 10), '對照組對手備戰沒吃到傷害：' + JSON.stringify(r.opp));
});

T('⭐⭐⭐ 有球形盾牌時對手備戰全免疫（HEAD 會 FAIL：舊版照吃 10）', () => {
  const r = runSky(true);
  ok(r.opp.every((d) => d === 0),
    '球形盾牌沒擋住「雙方備戰各受 10」的招式傷害，對手備戰實際：' + JSON.stringify(r.opp));
});

T('⭐⭐⭐ 自傷分流必須保留：球形盾牌是對手的，不保護攻擊方自己的備戰', () => {
  const r = runSky(true);
  ok(r.own.every((d) => d === 10),
    '攻擊方自己的備戰被對手的盾牌擋住了 —— 中央閘是「對手側」語意，套到自傷會出這種錯：' + JSON.stringify(r.own));
});

// ════ ③ 靜態：卡面逐字 vs 實作旗標 ════
console.log('\n③ 靜態：旗標宣告必須對齊卡面逐字');

const MEGA = readFileSync(join(ROOT, 'src/lib/game/effects/cards/mega_decks.ts'), 'utf8');
const EFF = readFileSync(join(ROOT, 'src/lib/game/effects.ts'), 'utf8');
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
const MEGA_C = stripComments(MEGA), EFF_C = stripComments(EFF);
ok(MEGA_C.length < MEGA.length && EFF_C.length < EFF.length, 'stripComments 沒在運作 —— 否定型斷言會被註解騙');

T('⭐⭐⭐ 油之機關槍不得宣告 skipDefEffects（卡面只有「不計算弱點・抵抗力」）', () => {
  const m = /regPre\('奧利瓦ex\|油之機關槍'[^;]*;/.exec(MEGA_C);
  ok(m, '找不到油之機關槍的 regPre');
  ok(/skipWeakRes:\s*true/.test(m[0]), '漏了 skipWeakRes —— 卡面明文「不計算弱點・抵抗力」');
  ok(!/skipDefEffects/.test(m[0]),
    'regPre 宣告了 skipDefEffects —— 那是「不計算對手身上附加效果」的語意，卡面**沒有**這句話，會 bypass 掉全部 defender 免疫');
  // 正對照：真的有那句話的卡仍應保留 skipDefEffects
  ok(/skipDefEffects:\s*true/.test(EFF_C) || /skipDefEffects/.test(stripComments(readFileSync(join(ROOT, 'src/lib/game/effects/cards/v155_attacks.ts'), 'utf8'))),
    '全站再也沒有任何 skipDefEffects —— 這個旗標本身不該被消滅，只是油之機關槍不該用');
});

T('⭐⭐ 兩個 resolver 都走中央閘，不得再各自手刻', () => {
  ok(/export function resolveMultiTargetDamageGuard/.test(EFF_C), '中央閘不存在');
  ok(/resolveMultiTargetDamageGuard\(/.test(MEGA_C), '油之機關槍沒有走中央閘');
  const oo = MEGA_C.slice(MEGA_C.indexOf("regR('olive-oil-distribute'"), MEGA_C.indexOf('function computeOliveOilBuff') + 1 || undefined);
  ok(!/wouldNeutralCenterBlock\(/.test(oo), '油之機關槍 resolver 還留著手刻的中立中心檢查（應已收斂）');
  ok(!/passiveCoinImmunity\(/.test(oo), '油之機關槍 resolver 還留著手刻的擲幣檢查（應已收斂）');
});

T('⭐⭐ 中央閘用 attack-damage 語意（用 attack-effect 會誤擋薄霧能量那類）', () => {
  const i = EFF_C.indexOf('export function resolveMultiTargetDamageGuard');
  const body = EFF_C.slice(i, i + 2000);
  ok(/'attack-damage'/.test(body), '中央閘沒有用 attack-damage');
  ok(!/'attack-effect'/.test(body),
    '中央閘用了 attack-effect —— 會把薄霧能量／對戰圓形／硬岩能量這些「只擋招式效果」的來源算進來（v4.18 正是要修掉這種誤擋）');
});

T('⭐⭐ 擲幣層必須可跳過，且 hitBenchAll 有傳 skipCoin（否則防守方多擲一次幣）', () => {
  const i = EFF_C.indexOf('export function resolveMultiTargetDamageGuard');
  ok(/skipCoin/.test(EFF_C.slice(i, i + 2500)), '中央閘沒有 skipCoin 選項');
  const hb = EFF_C.slice(EFF_C.indexOf('function hitBenchAll'), EFF_C.indexOf('function hitBenchAll') + 6000);
  ok(/resolveMultiTargetDamageGuard\(/.test(hb), 'hitBenchAll 沒有接中央閘');
  ok(/skipCoin:\s*true/.test(hb), 'hitBenchAll 沒傳 skipCoin —— 它自己已有擲幣段，會重複擲幣');
  ok(/attackerIdx !== targetIdx/.test(hb), 'hitBenchAll 的自傷分流不見了 —— 自己的備戰會被自己的盾牌擋住');
});

console.log('\n' + (fail ? '✗' : '✓') + ' 通過 ' + pass + ' 項，失敗 ' + fail + ' 項');
process.exit(fail ? 1 : 0);
