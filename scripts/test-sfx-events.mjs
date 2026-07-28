// 守衛：對戰音效的「決策規則」（v6.048）。
//
// Wilson 回報兩件事：
//   ① 傷害音效在「不會造成傷害的招式」也會響 —— 應該只在真的造成傷害時響，
//      沒有傷害的純效果招式要用別的音。
//   ② 用土龍節節的特性「逃跑抽出」把自己收回牌庫，會聽到**昏厥音**。
//
// 這支測的是 `src/lib/audio/sfx-events.ts` 的純決策函式（不碰 AudioContext），
// 所以每條規則都能用**真的走一次引擎**來驗，而不是看程式碼長相。
//
// ⚠每條「不該播」的規則都配一條「該播時要播」的對照：只測前者的話，
//   把整個音效關掉也會 PASS。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x-se-s.js'), E = join(ROOT, '.x-se-e.ts'), O = join(ROOT, '.x-se-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { computeSfxEvents, detectFaintedIids, attackDealtDamage } from './src/lib/audio/sfx-events';\n"
  + "export { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { computeSfxEvents, applyAction } = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}

// 卡面查證自 static/cards（台灣官方中文卡面）：
const DRILBUR = '9827';    // 土龍節節（SV5K, H）特性「逃跑抽出」：抽3張，然後「將這隻寶可夢與附加的卡，全部放回自己的牌庫並重洗」
const JYNX = '19174';      // 迷唇姐（M5, J）招式[0]「強烈之吻」無傷害 / 招式[1]「念力」50
const SMOLIV = '19149';    // 斯魔茶（M5, J）HP30
const MIST = '12462';      // 薄霧能量：「附有這張卡的寶可夢不會受到對手的寶可夢使用招式的效果的影響」
const PSY = '14128', FIGHT = '14104';
const RADIANT = '14069';   // 超級拉帝亞斯ex：HP280、無弱點無特性（當不會被打死的靶）

let nn = 0;
const inst = (cid, e = [], x = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: e, ...x });
const en = (cid) => ({ iid: 'e' + (++nn), cardId: String(cid), damage: 0, energyAttached: [] });
const mkP = (name, active, bench = []) => ({ name, active, bench, hand: [],
  deck: [inst(JYNX), inst(JYNX), inst(JYNX), inst(JYNX)], discard: [], prizes: [inst(JYNX), inst(JYNX)] });
const mk = (p0, p1) => ({ phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
  isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true], pendingMulliganDraw: [0, 0],
  pendingPrizes: [0, 0], winner: null, players: [p0, p1] });
const names = (evts) => evts.map((e) => e.name);

let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

T('前提：土龍節節的特性卡面仍是「放回自己的牌庫」（不是昏厥也不是丟棄）', () => {
  const ab = (pool.get(DRILBUR)?.abilities ?? []).find((a) => a.name === '逃跑抽出');
  assert.ok(ab, '找得到「逃跑抽出」');
  assert.ok(ab.effect.includes('放回自己的牌庫'), '卡面應為放回牌庫');
});

T('⭐⭐土龍節節｜逃跑抽出（把自己收回牌庫）不可以播昏厥音', () => {
  const drill = inst(DRILBUR);
  const prev = mk(mkP('P1', drill, [inst(JYNX)]), mkP('P2', inst(JYNX), [inst(JYNX)]));
  const action = { type: 'USE_ABILITY', iid: drill.iid, abilityIndex: 0 };
  const next = applyAction(prev, action, pool);
  assert.notEqual(next, prev, '前提：特性應該有生效');
  assert.equal(next.players[0].active, null, '前提：戰鬥位應該空了（這正是舊判準誤判的原因）');
  const evts = names(computeSfxEvents(prev, next, action, pool, {}));
  assert.ok(!evts.includes('ko'),
    `聽到昏厥音了：${evts.join('、')} —— 戰鬥位變空不等於昏厥，它可能是回牌庫/回手牌`);
  assert.ok(evts.includes('ability'), '特性發動音仍應該有');
});

T('⭐⭐真的被打死時必須播昏厥音（否則上一條把音效關掉也會過）', () => {
  const prev = mk(mkP('P1', inst(JYNX, [en(PSY), en(FIGHT)]), [inst(JYNX)]),
                  mkP('P2', inst(SMOLIV), [inst(SMOLIV)]));   // 斯魔茶 HP30，念力 50 必死
  const action = { type: 'ATTACK', attackIndex: 1, actorIdx: 0 };
  const next = applyAction(prev, action, pool);
  const evts = names(computeSfxEvents(prev, next, action, pool, {}));
  assert.ok(evts.includes('ko'), `真 KO 卻沒有昏厥音：${evts.join('、')}`);
});

T('⭐備戰位被擊倒也要有昏厥音（舊判準只看戰鬥位）', () => {
  const dying = inst(SMOLIV, [], { damage: 20 });   // HP30，再放 10 點就死
  const prev = mk(mkP('P1', inst(JYNX), [inst(JYNX)]), mkP('P2', inst(RADIANT), [dying]));
  // 直接模擬「備戰位被打死並進棄牌區」的盤面（狙擊/中毒檢查都會產生這種結果）
  const next = {
    ...prev,
    players: [
      { ...prev.players[0], prizes: prev.players[0].prizes.slice(1) },
      { ...prev.players[1], bench: [], discard: [{ ...dying, damage: 30 }] },
    ],
  };
  assert.ok(names(computeSfxEvents(prev, next, null, pool, {})).includes('ko'), '備戰位昏厥應有音');
});

T('⭐⭐實際造成 0 傷害時不可播「打擊」音，要用純效果招式音', () => {
  // 迷唇姐｜強烈之吻：卡面沒有傷害值，是純效果招式
  const prev = mk(mkP('P1', inst(JYNX, [en(PSY)]), [inst(JYNX)]),
                  mkP('P2', inst(RADIANT), [inst(RADIANT)]));
  const action = { type: 'ATTACK', attackIndex: 0, actorIdx: 0 };
  const next = applyAction(prev, action, pool);
  const evts = names(computeSfxEvents(prev, next, action, pool, {}));
  assert.ok(evts.includes('attack-nodamage'), `應播純效果招式音，實得：${evts.join('、')}`);
  assert.ok(!evts.some((n) => n.startsWith('attack-') && n !== 'attack-nodamage'),
    `不該播屬性打擊音：${evts.join('、')}`);
});

T('⭐有造成傷害時要播屬性打擊音', () => {
  const prev = mk(mkP('P1', inst(JYNX, [en(PSY), en(FIGHT)]), [inst(JYNX)]),
                  mkP('P2', inst(RADIANT), [inst(RADIANT)]));   // HP280 不會死，看得到傷害
  const action = { type: 'ATTACK', attackIndex: 1, actorIdx: 0 };   // 念力 50
  const next = applyAction(prev, action, pool);
  const evts = names(computeSfxEvents(prev, next, action, pool, {}));
  assert.ok(evts.some((n) => n.startsWith('attack-') && n !== 'attack-nodamage'),
    `有傷害卻沒播打擊音：${evts.join('、')}`);
});

T('⭐⭐印刷有傷害、但被完全擋下時也算「沒造成傷害」', () => {
  // 判準必須是**實際**傷害，不是卡面印的數字。這裡用「傷害沒有增加」的盤面直接驗規則。
  const target = inst(RADIANT, [en(MIST)]);
  const prev = mk(mkP('P1', inst(JYNX, [en(PSY), en(FIGHT)]), [inst(JYNX)]),
                  mkP('P2', target, [inst(RADIANT)]));
  const next = { ...prev, log: [...prev.log] };    // 盤面完全沒變＝一點傷害都沒造成
  const evts = names(computeSfxEvents(prev, next, { type: 'ATTACK', attackIndex: 1, actorIdx: 0 }, pool, {}));
  assert.ok(evts.includes('attack-nodamage'),
    `印刷 50 傷害但實際 0 傷害，仍應是純效果音，實得：${evts.join('、')}`);
});

T('⭐⭐【麻痺】要有音效（五種特殊狀態裡原本只有它沒有）', () => {
  const before = inst(RADIANT);
  const prev = mk(mkP('P1', inst(JYNX), [inst(JYNX)]), mkP('P2', before, [inst(RADIANT)]));
  const next = { ...prev, players: [prev.players[0],
    { ...prev.players[1], active: { ...before, status: 'paralyzed' } }] };
  assert.ok(names(computeSfxEvents(prev, next, null, pool, {})).includes('paralyze'), '麻痺應有音');
});

T('⭐⭐雙重狀態的第二、三槽也要有音（狀態是三槽制）', () => {
  const before = inst(RADIANT, [], { status: 'asleep' });
  const prev = mk(mkP('P1', inst(JYNX), [inst(JYNX)]), mkP('P2', before, [inst(RADIANT)]));
  // 已睡眠再中毒 → 中毒被放進第二槽；舊判準只看主格且要求原本沒狀態 → 完全沒聲音
  const next = { ...prev, players: [prev.players[0],
    { ...prev.players[1], active: { ...before, secondaryStatus: 'poisoned' } }] };
  assert.ok(names(computeSfxEvents(prev, next, null, pool, {})).includes('poison'),
    '第二槽的中毒也要有音');
});

T('⭐狀態沒有變化時不要重複播', () => {
  const before = inst(RADIANT, [], { status: 'poisoned' });
  const prev = mk(mkP('P1', inst(JYNX), [inst(JYNX)]), mkP('P2', before, [inst(RADIANT)]));
  const next = { ...prev, players: [prev.players[0],
    { ...prev.players[1], active: { ...before, damage: 10 } }] };
  assert.ok(!names(computeSfxEvents(prev, next, null, pool, {})).includes('poison'), '不該重播');
});

T('⭐⭐拿走自己最後一張獎賞 → 勝利號角（原本判成對手的獎賞堆，所以永遠不會響）', () => {
  const prev = mk(mkP('P1', inst(JYNX), [inst(JYNX)]), mkP('P2', inst(RADIANT), [inst(RADIANT)]));
  const next = { ...prev, players: [{ ...prev.players[0], prizes: [] }, prev.players[1]] };
  const evts = names(computeSfxEvents(prev, next, { type: 'TAKE_PRIZES', playerIdx: 0, count: 2 }, pool, {}));
  assert.ok(evts.includes('victory-fanfare'), `應播勝利號角，實得：${evts.join('、')}`);
  assert.ok(!evts.includes('prize-take'), '不該同時播普通取獎音');
});

T('拿獎賞但還沒拿完 → 普通取獎音', () => {
  const prev = mk(mkP('P1', inst(JYNX), [inst(JYNX)]), mkP('P2', inst(RADIANT), [inst(RADIANT)]));
  const next = { ...prev, players: [{ ...prev.players[0], prizes: [inst(JYNX)] }, prev.players[1]] };
  const evts = names(computeSfxEvents(prev, next, { type: 'TAKE_PRIZES', playerIdx: 0, count: 1 }, pool, {}));
  assert.ok(evts.includes('prize-take') && !evts.includes('victory-fanfare'), evts.join('、'));
});

T('⭐⭐沒有 action 物件時（線上/錦標賽對手的動作）一樣要有音效', () => {
  // 錦標賽對手的動作只會以「盤面」形式進來，原本這條路徑完全沒有音效。
  const prev = mk(mkP('P1', inst(JYNX, [en(PSY), en(FIGHT)]), [inst(JYNX)]),
                  mkP('P2', inst(SMOLIV), [inst(SMOLIV)]));
  const next = applyAction(prev, { type: 'ATTACK', attackIndex: 1, actorIdx: 0 }, pool);
  const evts = names(computeSfxEvents(prev, next, null, pool, {}));
  assert.ok(evts.includes('ko'), `對手擊倒我方寶可夢應該聽得到：${evts.join('、')}`);
});

T('⭐撤退不該播洗牌音（撤退不洗任何牌）', () => {
  const prev = mk(mkP('P1', inst(JYNX), [inst(JYNX)]), mkP('P2', inst(RADIANT), [inst(RADIANT)]));
  const evts = names(computeSfxEvents(prev, prev, { type: 'RETREAT', benchIndex: 0 }, pool, {}));
  assert.ok(!evts.includes('shuffle'), `撤退播了洗牌音：${evts.join('、')}`);
  assert.ok(evts.includes('place-card'), '應為紙牌落桌音');
});

T('⭐音效名稱都必須是 sfx.ts 真的認得的（打錯字會靜默沒聲音）', () => {
  const sfxSrc = readFileSync(join(ROOT, 'src/lib/audio/sfx.ts'), 'utf8');
  const evSrc = readFileSync(join(ROOT, 'src/lib/audio/sfx-events.ts'), 'utf8');
  const used = new Set([...evSrc.matchAll(/name:\s*'([a-z-]+)'/g)].map((m) => m[1]));
  assert.ok(used.size >= 8, `解析到的音效名太少（${used.size}），解析方式可能失效`);
  for (const n of used) {
    assert.ok(sfxSrc.includes(`'${n}'`), `sfx.ts 沒有這個音效：${n}`);
  }
  // 三個新音必須真的有合成實作，不能只加進型別
  for (const [n, fn] of [['paralyze', 'playParalyze'], ['attack-nodamage', 'playAttackNoDamage'],
                         ['coin-tails', 'playCoinTails']]) {
    assert.ok(sfxSrc.includes(`function ${fn}`), `${n} 缺少合成函式 ${fn}`);
    assert.ok(new RegExp(`name === '${n}'`).test(sfxSrc), `${n} 沒有接進 playSfx 的分派`);
  }
  // ⚠'attack-nodamage' 在 playSfx 的**分派鏈**裡必須排在 startsWith('attack-') 之前，
  //   否則會被當成屬性攻擊音（取到 etype='nodamage'）。
  //   ⚠比對範圍要限定在 playSfx 內：classifyBus 也有一個 startsWith('attack-')，
  //     而它的位置更早，拿整份檔案做 indexOf 會誤判（第一版就是這樣 FAIL 的）。
  const iPlay = sfxSrc.indexOf('export function playSfx(');
  assert.ok(iPlay > 0, '找得到 playSfx');
  const dispatchBody = sfxSrc.slice(iPlay, sfxSrc.indexOf('// 音效合成實作', iPlay));
  assert.ok(dispatchBody.indexOf("name === 'attack-nodamage'") > 0
    && dispatchBody.indexOf("name === 'attack-nodamage'") < dispatchBody.indexOf("name.startsWith('attack-')"),
    "'attack-nodamage' 的分派必須排在 startsWith('attack-') 之前，否則永遠走不到");
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
