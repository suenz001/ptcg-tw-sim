// v6.112 守衛：化石在場上是一隻普通的【基礎】寶可夢 —— 道具／場地的 HP 加成照常生效。
//
// 玩家回報：「英雄斗篷附在化石變成的寶可夢身上，沒有作用。」
// 舊實作 `getEffectiveHP` 開頭是 `if (inst.fossilOnField) return 60;`
//（v2.187 註解：「不吃任何 Tool/能量/Stadium 加減」）。查證結論：
//   ・現行台灣官方卡面**只有兩個限制** —— 「不會陷入特殊狀態」「無法撤退」。
//   ・官方規則 1031 條 Q&A 查不到任何「化石不受寶可夢道具影響／HP 固定 60」的條文；
//     反而 §17.39.I 明示治癒襁褓**可以**恢復場上化石的 HP、§17.38.B 化石可被效果KO、
//     §17.37.C 化石可被進化。§128：「處於附加狀態時，寶可夢道具的效果皆為有效狀態。」
//   ・⭐ 舊寫法的來源已查出：`static/cards/M5_jp_legacy.json`（日文預覽版舊文本）曾寫
//     「無法被附加能量，也不受弱點和抵抗力的影響」—— 現行卡面已刪除，程式沒跟上。
//   ・舊行為還是最糟的組合：UI 讓你附、log 說附上了，只有 HP 加成被吞。
// Wilson 裁定（v6.112）：**依現行卡面，加成生效**。
//
// ⚠ 只測 H/I/J 標的卡（勇氣護符／豪華斗篷是 G 標，不在維護範圍）。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.v6112-s.js'), E = join(ROOT, '.v6112-e.ts'), O = join(ROOT, '.v6112-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { getEffectiveHP, isBasicPokemonOnField, FOSSIL_BASE_HP, applyAction } from './src/lib/game/engine';\n"
              + "import './src/lib/game/effects';");
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
const byName = (n, pred) => [...pool.values()].find(c => c.name === n && (!pred || pred(c)));

let seq = 0;
const inst = (id, extra) => ({ iid: 'i' + (++seq), cardId: String(id), damage: 0, energyAttached: [], ...(extra || {}) });
const mk = (me, stadium) => ({
  phase: 'playing', turnPhase: 'main', turn: 5, activePlayerIndex: 0, firstPlayerIdx: 0,
  isFirstTurn: false, setupDone: [true, true], log: [], pendingSelection: null,
  activeStadium: stadium ? inst(stadium.id) : null,
  players: [{ name: 'P1', active: null, bench: [], hand: [], deck: [], discard: [], prizes: [], ...me },
            { name: 'P2', active: null, bench: [], hand: [], deck: [], discard: [], prizes: [] }],
});

let pass = 0, fail = 0;
function T(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e && e.message)); fail++; }
}
function ok(cond, msg) { if (!cond) throw new Error(msg); }

const FOSSIL = byName('陳舊的背蓋化石');
const CLOAK = byName('英雄斗篷');            // H, PokemonTool, 最大HP+100
const ARENA = byName('激動競技場');           // H, Stadium, 【基礎】最大HP+30
const GRAVITY = byName('引力山岳');           // H, Stadium, 【2階進化】最大HP-30
const JAMMER = byName('阻礙之塔');            // H, Stadium, 道具效果全部無效
const GRASSPP = byName('增強【草】能量');      // J, Special Energy, 【草】最大HP+20

console.log('① 卡面查證（防我自己記錯）');

T('化石卡面只有「不會陷入特殊狀態」「無法撤退」兩個限制', () => {
  ok(FOSSIL, '找不到陳舊的背蓋化石');
  const t = FOSSIL.rulesText || '';
  ok(t.includes('HP60') && t.includes('【基礎】寶可夢'), '卡面文字變了：' + t);
  ok(t.includes('不會陷入特殊狀態') && t.includes('無法撤退'), '卡面限制變了：' + t);
  ok(!t.includes('無法被附加能量') && !t.includes('不受弱點'),
    '⚠ 現行卡面出現了舊日文預覽版的限制文字，請重新檢視本守衛的前提：' + t);
});

T('英雄斗篷卡面沒有任何持有者限制', () => {
  ok(CLOAK, '找不到英雄斗篷');
  ok((CLOAK.rulesText || '').includes('最大HP'), '卡面文字變了：' + CLOAK.rulesText);
});

console.log('② 化石身上的加成該生效的都生效');

T('⭐ 裸化石 = 60（守住既有行為）', () => {
  const f = inst(FOSSIL.id, { fossilOnField: true });
  ok(M.getEffectiveHP(f, pool, mk({ active: f })) === 60, '裸化石不是 60');
});

T('⭐⭐ 化石 + 英雄斗篷 = 160（玩家回報的那一項）', () => {
  const f = inst(FOSSIL.id, { fossilOnField: true, toolAttached: inst(CLOAK.id) });
  const got = M.getEffectiveHP(f, pool, mk({ active: f }));
  ok(got === 160, '應為 160，實得 ' + got);
});

T('⭐⭐ 化石 + 激動競技場 = 90（【基礎】判定必須認得化石）', () => {
  const f = inst(FOSSIL.id, { fossilOnField: true });
  const got = M.getEffectiveHP(f, pool, mk({ active: f }, ARENA));
  ok(got === 90, '應為 90，實得 ' + got
    + '　←【基礎】的判準若寫成 card.stage===\'Basic\'，化石的 card 是 Trainer、stage 恆 null，永遠不會命中');
});

T('化石 + 英雄斗篷 + 激動競技場 = 190（兩者可疊）', () => {
  const f = inst(FOSSIL.id, { fossilOnField: true, toolAttached: inst(CLOAK.id) });
  const got = M.getEffectiveHP(f, pool, mk({ active: f }, ARENA));
  ok(got === 190, '應為 190，實得 ' + got);
});

console.log('③ 反向對照：不該生效的仍然不生效（證明不是「一律加」）');

T('⭐ 化石 + 增強【草】能量 = 60（化石是【無】屬性，不吃【草】加成）', () => {
  const f = inst(FOSSIL.id, { fossilOnField: true, energyAttached: [inst(GRASSPP.id)] });
  const got = M.getEffectiveHP(f, pool, mk({ active: f }));
  ok(got === 60, '應為 60，實得 ' + got);
});

T('⭐ 化石 + 引力山岳 = 60（那是【2階進化】-30，化石不是）', () => {
  const f = inst(FOSSIL.id, { fossilOnField: true });
  const got = M.getEffectiveHP(f, pool, mk({ active: f }, GRAVITY));
  ok(got === 60, '應為 60，實得 ' + got);
});

T('⭐ 阻礙之塔在場 → 化石身上的道具加成被停用（60）', () => {
  const f = inst(FOSSIL.id, { fossilOnField: true, toolAttached: inst(CLOAK.id) });
  const got = M.getEffectiveHP(f, pool, mk({ active: f }, JAMMER));
  ok(got === 60, '應為 60（道具效果被阻礙之塔停用），實得 ' + got);
});

console.log('④ 中央述詞 + KO 判定真的跟上（只改讀值、sweep 沒跟上＝白改）');

T('⭐ isBasicPokemonOnField：化石為 true、其 Trainer card 的 stage 為 null', () => {
  const f = inst(FOSSIL.id, { fossilOnField: true });
  const card = pool.get(String(FOSSIL.id));
  ok(card.stage === null || card.stage === undefined, '化石的 card.stage 應為空，實得 ' + card.stage);
  ok(M.isBasicPokemonOnField(f, card) === true, '化石在場上應算【基礎】寶可夢');
  ok(M.isBasicPokemonOnField(inst(FOSSIL.id), card) === false, '沒有 fossilOnField 就不是（手牌裡是物品卡）');
});

T('⭐ 附斗篷的化石：受 100 傷不昏厥、受 160 傷才昏厥（跑 applyAction 全流程 sweep）', () => {
  const mkBoard = (dmg) => {
    const f = inst(FOSSIL.id, { fossilOnField: true, toolAttached: inst(CLOAK.id), damage: dmg });
    return { f, st: mk({ active: inst(FOSSIL.id, { fossilOnField: true }) , bench: [] }, null) };
  };
  // 直接驗 getEffectiveHP 與 damage 的關係（KO 判定全站都以此為準）
  const f100 = inst(FOSSIL.id, { fossilOnField: true, toolAttached: inst(CLOAK.id), damage: 100 });
  const st100 = mk({ active: f100 });
  ok(f100.damage < M.getEffectiveHP(f100, pool, st100), '受 100 傷就昏厥了（有效HP 應為 160）');
  const f160 = inst(FOSSIL.id, { fossilOnField: true, toolAttached: inst(CLOAK.id), damage: 160 });
  const st160 = mk({ active: f160 });
  ok(f160.damage >= M.getEffectiveHP(f160, pool, st160), '受 160 傷應該昏厥');
});

console.log('⑤ 靜態：舊的「早退」寫法不得復活');

/** 剝掉 // 與 /* *\/ 註解 —— 修正的說明文字裡會引用舊寫法，不剝會誤判成「復活」。 */
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

T('⭐ getEffectiveHP 不得再出現 `if (inst.fossilOnField) return 60`（剝註解後掃）', () => {
  const eng = stripComments(readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8'));
  ok(!/if \(inst\.fossilOnField\) return 60;/.test(eng), '早退寫法復活了');
  ok(/FOSSIL_BASE_HP/.test(eng), '化石 base HP 應為具名常數，不要再寫死 60');
});

T('正對照：剝註解的判準會抓到真的早退寫法', () => {
  const probe = stripComments('// 舊寫法：if (inst.fossilOnField) return 60;\nif (inst.fossilOnField) return 60;');
  ok(/if \(inst\.fossilOnField\) return 60;/.test(probe), '判準抓不到真的早退 ⇒ 假綠');
  const onlyComment = stripComments('// 舊寫法：if (inst.fossilOnField) return 60;');
  ok(!/if \(inst\.fossilOnField\) return 60;/.test(onlyComment), '註解沒被剝掉 ⇒ 會誤判說明文字');
});

T('⭐ 激動競技場的【基礎】判定走中央述詞（不得手刻 card.stage）', () => {
  const eng = readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8');
  const i = eng.indexOf("=== '激動競技場'");
  ok(i > 0, '找不到激動競技場的判定');
  const win = eng.slice(i, i + 200);
  ok(/isBasicPokemonOnField/.test(win), '沒有走中央述詞');
});

T('正對照：判準抓得到手刻樣本', () => {
  const probe = "if (stadiumNameHP === '激動競技場' && card.stage === 'Basic') {";
  ok(!/isBasicPokemonOnField/.test(probe), '判準抓不到手刻樣本 ⇒ 假綠');
});

console.log('\n=== v6.112 化石身上的 HP 加成：PASS ' + pass + ' / FAIL ' + fail + ' ===');
if (fail > 0) process.exit(1);
