// 守衛：「這隻寶可夢當下是否**擁有特性**」的判定（v6.049）。
//
// Wilson 回報兩件事，方向剛好相反，一起釘住才不會改壞其中一邊：
//   ①【火箭隊的監視塔】（Stadium，卡面：「雙方場上所有【無】寶可夢的特性全部消除。」）在場時，
//     【無】寶可夢的特性被**消除** → 它當下就**不是「擁有特性的寶可夢」**，
//     不該再被【雪妖女｜冰冷之帳】（「…在雙方的**擁有特性的**所有寶可夢…身上各放置1個傷害指示物」）打到。
//   ②【探探鼠｜監視之眼】（「雙方的所有寶可夢身上放置的傷害指示物，無法改放於其他寶可夢身上」）
//     只是**阻擋一個效果**，被它擋住的【願增猿｜腎上腺腦力】**仍然是「擁有特性的寶可夢」**——
//     冰冷之帳照樣要打它，特性也照樣可以發動（發動之後才失效）。
//
// 也就是：**「特性被消除 ⇒ 沒有特性」** vs **「效果被阻擋 ⇒ 仍然有特性」**，兩者不可混為一談。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x-ha-s.js'), E = join(ROOT, '.x-ha-e.ts'), O = join(ROOT, '.x-ha-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { applyAction, getUsableAbilities } from './src/lib/game/engine';\n"
  + "export { hasAnyEffectiveAbility } from './src/lib/game/effects/cards/v3001_g3_wave3';\n"
  + "import './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { applyAction, getUsableAbilities, hasAnyEffectiveAbility } = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}

// 全部查證自 static/cards（台灣官方中文卡面）
const FROSMOTH = '10447';  // 雪妖女（SV6, H）｜冰冷之帳
const OAK = '18488';       // 探探鼠（M4, J）｜監視之眼；pokemonType='Colorless' 且有特性
const APE = '10469';       // 願增猿（SV6, H）｜腎上腺腦力（需身上有【惡】能量）
const TOWER = '14849';     // 火箭隊的監視塔（M2a, I）
const DARK = '14152';      // 基本【惡】能量
const JYNX = '19174';

let nn = 0;
const inst = (cid, e = [], x = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: e, ...x });
const en = (cid) => ({ iid: 'e' + (++nn), cardId: String(cid), damage: 0, energyAttached: [] });
const mkP = (name, active, bench = []) => ({ name, active, bench, hand: [],
  deck: [inst(JYNX), inst(JYNX)], discard: [], prizes: [inst(JYNX)] });
const mk = (p0, p1, stadium) => ({ phase: 'playing', turnPhase: 'end', activePlayerIndex: 0, firstPlayerIdx: 0,
  turn: 5, isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
  pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], winner: null,
  activeStadium: stadium ? inst(stadium) : null, players: [p0, p1] });

/** 雙方各一隻雪妖女 → 檢查階段對 targetId 放的指示物量。 */
function frosmothDamage(stadium, targetId) {
  const target = inst(targetId);
  const st = mk(mkP('P1', inst(FROSMOTH), [inst(FROSMOTH)]), mkP('P2', target, [inst(JYNX)]), stadium);
  const after = applyAction(st, { type: 'END_TURN', actorIdx: 0 }, pool);
  const t = [after.players[1].active, ...after.players[1].bench].find((c) => c && c.iid === target.iid);
  return t ? t.damage : null;
}

let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

T('前提：四張卡的卡面文字沒變', () => {
  assert.ok((pool.get(TOWER)?.rulesText ?? '').includes('【無】寶可夢的特性全部消除'), '監視塔');
  assert.ok((pool.get(FROSMOTH)?.abilities ?? []).some((a) => a.name === '冰冷之帳'
    && a.effect.includes('擁有特性的所有寶可夢')), '冰冷之帳');
  assert.ok((pool.get(OAK)?.abilities ?? []).some((a) => a.name === '監視之眼'), '監視之眼');
  assert.equal(pool.get(OAK)?.pokemonType, 'Colorless', '探探鼠必須是【無】屬性（否則測不到監視塔）');
  assert.ok((pool.get(APE)?.abilities ?? []).some((a) => a.name === '腎上腺腦力'), '腎上腺腦力');
});

T('⭐⭐火箭隊的監視塔在場 → 特性被消除的【無】寶可夢不該被冰冷之帳打', () => {
  assert.equal(frosmothDamage(TOWER, OAK), 0,
    '監視塔在場時【無】寶可夢已經沒有特性了，冰冷之帳卡面是「擁有特性的所有寶可夢」，不該放指示物');
});

T('沒有監視塔時，同一隻寶可夢仍要被打（否則把整段效果刪掉也會 PASS）', () => {
  assert.equal(frosmothDamage(null, OAK), 20, '雙方各一隻雪妖女 → 各放 1 個指示物 = 20');
});

T('監視塔只消除【無】寶可夢的特性 —— 其他屬性照打', () => {
  assert.equal(frosmothDamage(TOWER, APE), 20, '願增猿是【超】屬性，不受監視塔影響');
});

T('⭐⭐被監視之眼「擋住效果」的寶可夢，仍然是「擁有特性的寶可夢」', () => {
  // 探探鼠在場 → 腎上腺腦力的效果會被擋，但願增猿的特性沒有被消除 → 冰冷之帳照打
  const ape = inst(APE);
  const st = mk(mkP('P1', inst(FROSMOTH), [inst(FROSMOTH)]), mkP('P2', ape, [inst(OAK)]), null);
  const after = applyAction(st, { type: 'END_TURN', actorIdx: 0 }, pool);
  const t = after.players[1].active;
  assert.equal(t?.damage, 20,
    '效果被阻擋 ≠ 特性被消除 —— 願增猿仍是「擁有特性的寶可夢」，冰冷之帳照樣要打它');
});

T('⭐⭐探探鼠在場時，腎上腺腦力仍然可以發動（效果被擋是發動之後的事）', () => {
  const ape = inst(APE, [en(DARK)]);
  const hurt = inst(JYNX, [], { damage: 30 });   // 腎上腺腦力需要己方有受傷的寶可夢
  const withOak = { ...mk(mkP('P1', ape, [hurt]), mkP('P2', inst(OAK), [inst(JYNX)]), null), turnPhase: 'main' };
  const names = getUsableAbilities(withOak, pool).map((u) => u.abilityName);
  assert.ok(names.includes('腎上腺腦力'),
    `探探鼠在場時特性按鈕不該消失（Wilson 裁定：可以發動，發動後才被擋下失效），實得：${names.join('、')}`);
});

T('對照：場上沒有探探鼠時當然也可以發動', () => {
  const ape = inst(APE, [en(DARK)]);
  const hurt = inst(JYNX, [], { damage: 30 });
  const st = { ...mk(mkP('P1', ape, [hurt]), mkP('P2', inst(JYNX), [inst(JYNX)]), null), turnPhase: 'main' };
  assert.ok(getUsableAbilities(st, pool).map((u) => u.abilityName).includes('腎上腺腦力'));
});

T('⭐中央述詞本身：監視塔在場時【無】寶可夢回 false、其他屬性回 true', () => {
  const oakInst = inst(OAK);
  const st = mk(mkP('P1', inst(JYNX), []), mkP('P2', oakInst, []), TOWER);
  assert.equal(hasAnyEffectiveAbility(st, oakInst, pool.get(OAK), 1, 'active', pool), false);
  const st2 = mk(mkP('P1', inst(JYNX), []), mkP('P2', oakInst, []), null);
  assert.equal(hasAnyEffectiveAbility(st2, oakInst, pool.get(OAK), 1, 'active', pool), true);
  // 沒有特性的卡一律 false
  assert.equal(hasAnyEffectiveAbility(st2, inst(JYNX), pool.get(JYNX), 1, 'active', pool), false);
});

T('⭐⭐中央述詞絕不可把「監視之眼擋效果」算成「沒有特性」', () => {
  const src = readFileSync(join(ROOT, 'src/lib/game/effects/cards/v3001_g3_wave3.ts'), 'utf8');
  const i = src.indexOf('export function hasAnyEffectiveAbility');
  assert.ok(i > 0, '找得到中央述詞');
  const body = src.slice(i, i + 1200);
  assert.ok(!/OakEye|監視之眼/.test(body),
    '中央述詞內出現了監視之眼判定 —— 那是「效果被阻擋」，不是「特性被消除」，混進來會讓願增猿被誤判成沒有特性');
});

T('⭐⭐判「牌庫/手牌/棄牌區的卡片屬性」的地方不可以套用場上特性有效性', () => {
  // 賽吉卡面「（擁有特性的寶可夢除外）」指的是**牌庫裡拿的那張進化卡**；
  // 火箭隊的阿柏怪｜瞪眼效用判的是**手牌**候選卡。這些是卡片的固有屬性，
  // 監視塔的「雙方**場上**」消除對它們沒有意義，誤套會製造新 bug。
  const eff = readFileSync(join(ROOT, 'src/lib/game/effects.ts'), 'utf8');
  const i = eff.indexOf("regG('賽吉'");
  assert.ok(i > 0, '找得到賽吉');
  assert.ok(!/hasAnyEffectiveAbility/.test(eff.slice(i, i + 1500)),
    '賽吉判的是牌庫裡那張進化卡的固有屬性，不可套用場上特性有效性');
  const w3 = readFileSync(join(ROOT, 'src/lib/game/effects/cards/v3001_g3_wave3.ts'), 'utf8');
  const j = w3.indexOf('export function isOppEvilEyeBlocking');
  assert.ok(j > 0, '找得到瞪眼效用');
  assert.ok(!/hasAnyEffectiveAbility/.test(w3.slice(j, j + 800)),
    '瞪眼效用判的是手牌候選卡的固有屬性，不可套用場上特性有效性');
});

T('⭐「擁有特性的寶可夢」判定點都已接上中央述詞（新增判定點忘了接會漂移）', () => {
  const files = {
    'engine.ts': 'src/lib/game/engine.ts',
    'defense.ts': 'src/lib/game/defense.ts',
    'effects.ts': 'src/lib/game/effects.ts',
    'v2750_h_wave2_full.ts': 'src/lib/game/effects/cards/v2750_h_wave2_full.ts',
  };
  for (const [name, rel] of Object.entries(files)) {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    assert.ok(src.includes('hasAnyEffectiveAbility'), `${name} 應使用中央述詞`);
  }
  // 冰冷之帳的發動者自己也要判有效性（雪妖女被消除特性時整個效果不生效）
  const eng = readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8');
  const k = eng.indexOf('const countFrosmoth');
  assert.ok(k > 0 && /isAbilityHolderEffective/.test(eng.slice(k, k + 700)),
    '冰冷之帳的持有者計數也要過 isAbilityHolderEffective');
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
