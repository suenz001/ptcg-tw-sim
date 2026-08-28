// v6.250 守衛：「場上視角的【基礎】寶可夢」一律走中央述詞 isBasicPokemonOnField。
//
// 站長回報：場上有「險惡廢墟」時，用烈箭鷹ex 的特性「激動俯衝」把它放到備戰區，
//           被放了 2 個傷害指示物 —— 但烈箭鷹ex 是 2 階進化寶可夢，不是【基礎】。
// 真因：applyBenchPlaceSideEffects（effects/_shared.ts）只濾【惡】、完全沒判【基礎】。
//
// 卡面逐字（static/cards/M1L.json id 14020，Stadium，I 標）：
//   「雙方玩家每次在自己的回合將【基礎】寶可夢（【惡】寶可夢除外）放置於備戰區時，
//     在那隻寶可夢身上放置2個傷害指示物。」
//
// ⭐ 二分法紀律（官方裁定，PTCG RULES/PTCG_RULES.json 的 qa[].id）：
//   ・手牌／牌庫／棄牌區視角 → isBasicPokemonCard（化石＝物品卡）
//       id 789 禿鷹娜｜瞄準獵物 選對手手牌的化石 → 不可以（「在手牌中時視為『物品』卡」）
//       id 795 保母曼波｜溫柔鰭 從棄牌區拿化石 → 不可以（「在棄牌區時視為『物品』卡」）
//       id 572 配樂之笛 翻對手牌庫頂看到化石 → 不可以
//   ・場上 instance 視角 → isBasicPokemonOnField（化石＝【基礎】寶可夢）
//       id 783 治癒襁褓 可以恢復場上化石的 HP
//       id 787 斧擊衝撞 可以把對手戰鬥場的化石【昏厥】
//
// ⚠ 站長裁定（v6.250）：「放到對手備戰區時不觸發險惡廢墟」＝ 維持現行行為
//   （卡面：「每次在自己的回合將…放置於備戰區時」，解讀為自己的回合、自己的備戰區）。
//   本檔把它做成明示的現況鎖，日後若要翻案必須先改這裡的斷言。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.v6250-s.js'), E = join(ROOT, '.v6250-e.ts'), O = join(ROOT, '.v6250-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* noop */ } } });
writeFileSync(S, 'export const base="";');
writeFileSync(E,
  "export { applyAction, createGame, isBasicPokemonOnField, isBasicPokemonCard, getHandActivatableAbilities } from './src/lib/game/engine';\n"
  + "export { isBasicPokemonOnField as sfOnField } from './src/lib/game/selection-filter';\n"
  + "import './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const M = await import(pathToFileURL(O).href);
const { applyAction, createGame } = M;

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}

let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  OK  ', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };
const ok = (c, m) => { if (!c) throw new Error(m); };

// ── 卡片 id（全部從 static/cards 逐字查證）─────────────────────────────────
const RUINS   = '14020'; // 險惡廢墟（Stadium / I）
const TALON   = '19612'; // 烈箭鷹ex（Stage2 / ex /【無】/ J，特性 激動俯衝）
const RAYQ    = '19608'; // 超級烈空坐ex（Basic / ex /【無】超級進化ex — 激動俯衝的前提）
const STAGE2  = '17971'; // 大竺葵（Stage2 / 非 ex）
const BASIC   = '14086'; // 願增猿（Basic / subtype=Basic /【超】）
const BASICEX = '14085'; // 拉普拉斯ex（Basic / subtype=ex /【水】）
const DARK    = '14421'; // 狃拉（Basic /【惡】）
const FOSSIL  = '17128'; // 陳舊的羽毛化石（Item / I）
const OGRE_EX  = '14677'; // 厄鬼椪 碧草面具ex（Basic / ex）— 鬼之假面互換用
const OGRE_EX2 = '16620'; // 厄鬼椪 火灶面具ex（Basic / ex）
const GHOSTMASK = [...pool.values()].find(c => c.name === '鬼之假面')?.id;
const FLUTE     = [...pool.values()].find(c => c.name === '配樂之笛')?.id;

console.log('① 卡面逐字複驗（禁憑印象；全部讀 static/cards）');

T('險惡廢墟 rulesText 同時寫了【基礎】與（【惡】寶可夢除外）', () => {
  const c = pool.get(RUINS);
  ok(c && c.subtype === 'Stadium', '險惡廢墟應為 Stadium');
  ok(c.rulesText.includes('將【基礎】寶可夢'), '卡面應限定【基礎】：' + c.rulesText);
  ok(c.rulesText.includes('【惡】寶可夢除外'), '卡面應排除【惡】：' + c.rulesText);
  ok(c.rulesText.includes('放置2個傷害指示物'), '卡面應為 2 個指示物');
});

T('烈箭鷹ex 是 Stage2 進化寶可夢（不是【基礎】）', () => {
  const c = pool.get(TALON);
  ok(c.stage === 'Stage2', 'stage 應為 Stage2，實得 ' + c.stage);
  ok(c.subtype === 'ex', 'subtype 應為 ex（⇒ 禁用 subtype 判基礎）');
  ok(c.evolvesFrom === '火箭雀', 'evolvesFrom 應為 火箭雀，實得 ' + c.evolvesFrom);
  ok((c.abilities || []).some(a => a.name === '激動俯衝' && a.effect.includes('將這張卡放置於備戰區')),
    '特性激動俯衝應把這張卡放到備戰區');
});

T('三首惡龍ex｜貪婪食客 卡面逐字＝對手【基礎】被傷害 KO → 多 1 張獎賞', () => {
  const c = [...pool.values()].find(x => x.name === '三首惡龍ex' && (x.abilities || []).some(a => a.name === '貪婪食客'));
  ok(c, '找不到帶貪婪食客的三首惡龍ex');
  const eff = c.abilities.find(a => a.name === '貪婪食客').effect;
  ok(eff === '若對手的【基礎】寶可夢因這隻寶可夢使用的招式的傷害而【昏厥】了，則多獲得1張獎賞卡。', eff);
});

T('阿羅拉 椰蛋樹ex｜嗡嗡榍石 卡面逐字＝將對手【基礎】昏厥（是招式，不是特性）', () => {
  const c = [...pool.values()].find(x => x.name === '阿羅拉 椰蛋樹ex');
  ok(c, '找不到 阿羅拉 椰蛋樹ex（⚠ 官方譯名中間有半形空格）');
  const at = (c.attacks || []).find(a => a.name === '嗡嗡榍石');
  ok(at, '嗡嗡榍石應為招式（前置調查若寫成特性即為錯）');
  ok(at.effect.includes('對手的戰鬥場的【基礎】寶可夢【昏厥】'), at.effect);
  ok(at.effect.includes('對手的備戰區的【基礎】寶可夢'), at.effect);
});

T('火箭隊的班基拉斯｜揚沙 卡面逐字＝對手所有【基礎】各放 2 個指示物', () => {
  const c = [...pool.values()].find(x => x.name === '火箭隊的班基拉斯');
  const ab = (c.abilities || []).find(a => a.name === '揚沙');
  ok(ab && ab.effect === '只要這隻寶可夢在戰鬥場上，每次寶可夢檢查時，在對手的所有【基礎】寶可夢身上各放置2個傷害指示物。',
    ab && ab.effect);
});

T('資料面：live H/I/J 的 stage 恆有值，且 stage===Basic 等價於沒有 evolvesFrom（零歧異）', () => {
  const HIJ = new Set(['H', 'I', 'J']);
  let n = 0, basicByStage = 0, basicByEvo = 0, diff = 0, exOverwrite = 0;
  for (const c of pool.values()) {
    if (c.supertype !== 'Pokemon' || !HIJ.has(c.regulationMark)) continue;
    n++;
    ok(c.stage, `stage 為空：${c.name}`);
    const a = c.stage === 'Basic', b = !c.evolvesFrom;
    if (a) basicByStage++;
    if (b) basicByEvo++;
    if (a !== b) diff++;
    if (c.subtype === 'ex' && c.stage !== 'Basic') exOverwrite++;
  }
  ok(n > 3000, `只掃到 ${n} 隻，掃描器壞了？`);
  ok(diff === 0, `stage/evolvesFrom 歧異 ${diff} 筆`);
  ok(basicByStage === basicByEvo && basicByStage > 2000, `${basicByStage} vs ${basicByEvo}`);
  ok(exOverwrite > 100, `subtype 被 ex 覆蓋的進化寶可夢只有 ${exOverwrite} 隻？（禁用 subtype 判基礎的證據）`);
});

console.log('② 中央述詞：下沉到 selection-filter，engine re-export（同一個函式）');

T('⭐ isBasicPokemonOnField 已在 selection-filter，且 engine 的就是同一份（re-export）', () => {
  ok(typeof M.sfOnField === 'function', 'selection-filter 沒有匯出 isBasicPokemonOnField（未下沉）');
  ok(M.isBasicPokemonOnField === M.sfOnField, 'engine 那份不是 re-export ⇒ 兩份會漂移');
});

T('⭐ 述詞語意：化石(場上)=true／化石(手牌)=false／Stage2=false／Basic=true', () => {
  const fossilCard = pool.get(FOSSIL);
  ok(fossilCard.supertype === 'Trainer' && !fossilCard.stage, '化石在 DB 是 Trainer 且 stage 為空');
  ok(M.isBasicPokemonOnField({ fossilOnField: true }, fossilCard) === true, '場上化石應算【基礎】');
  ok(M.isBasicPokemonOnField({}, fossilCard) === false, '手牌化石不算（是物品卡）');
  ok(M.isBasicPokemonOnField({}, pool.get(TALON)) === false, 'Stage2 不是【基礎】');
  ok(M.isBasicPokemonOnField({}, pool.get(BASICEX)) === true, 'Basic ex 是【基礎】（subtype=ex）');
  ok(M.isBasicPokemonCard(fossilCard) === false, '手牌/牌庫視角的化石必須不是【基礎】寶可夢卡');
});

console.log('③ 險惡廢墟 7 項矩陣（★＝ HEAD 應為紅）');

let nn = 0;
const inst = (cid, e = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [],
  status: null, secondaryStatus: null, tertiaryStatus: null, ...e });
/** 獎賞卡必須是真的 CardInstance —— 取獎流程會把它們搬進手牌，用數字會量不到張數。 */
const prizeSet = () => Array.from({ length: 6 }, () => inst(BASIC));
function mk({ stadium = true, hand = [], discard = [], bench = [], active = null,
              oppDeck = [], oppBench = [], pending = null } = {}) {
  return {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
    isFirstTurn: false, log: [], setupDone: [true, true], pendingMulliganDraw: [0, 0],
    pendingPrizes: [0, 0], pendingSelection: pending,
    activeStadium: stadium ? { cardId: RUINS, iid: 'stad' } : null,
    players: [
      { name: 'P1', active: active ?? inst(BASIC), bench, hand, deck: [], discard, prizes: prizeSet() },
      { name: 'P2', active: inst(BASIC), bench: oppBench, hand: [], deck: oppDeck, discard: [], prizes: prizeSet() },
    ],
  };
}
/** 走 bench-from-discard-samename（v5.866 守衛用的同一條通用「放備戰」路徑）把任一張卡放到自己備戰 */
function benchFromDiscard(cardId, { stadium = true } = {}) {
  const d = inst(cardId);
  const st = mk({ stadium, discard: [d],
    pending: { type: 'discard-search', actorIdx: 0, sourcePlayerIdx: 0,
      effectKey: 'bench-from-discard-samename', minCount: 0, maxCount: 1,
      params: { validIids: [d.iid], targetName: pool.get(String(cardId))?.name, label: 'test' } } });
  const out = applyAction(st, { type: 'RESOLVE_SELECTION', selectedIids: [d.iid] }, pool);
  const b = out.players[0].bench.find(c => c.cardId === String(cardId));
  ok(b, '應放到備戰（放備戰路徑本身壞了）');
  return b.damage;
}

T('★(1) Stage2 ex（烈箭鷹ex｜激動俯衝）放備戰 → 不放指示物', () => {
  const s0 = createGame({ name: 'P1', entries: [{ cardId: RAYQ, count: 1 }] },
                        { name: 'P2', entries: [{ cardId: BASIC, count: 1 }] }, pool);
  const talon = inst(TALON);
  const st = { ...s0, ...mk({ hand: [talon], active: inst(RAYQ) }) };
  st.players[0] = { ...s0.players[0], active: inst(RAYQ), bench: [], hand: [talon], deck: [], discard: [] };
  st.players[1] = { ...s0.players[1], active: inst(BASIC), bench: [], hand: [], deck: [], discard: [] };
  const list = M.getHandActivatableAbilities(st, 0, pool);
  ok(list.some(a => a.iid === talon.iid && a.abilityName === '激動俯衝'), '激動俯衝應可發動：' + JSON.stringify(list));
  const ai = list.find(a => a.iid === talon.iid);
  const out = applyAction(st, { type: 'USE_HAND_ABILITY', cardIid: talon.iid, abilityIndex: ai.abilityIndex, actorIdx: 0 }, pool);
  const b = out.players[0].bench.find(c => c.cardId === TALON);
  ok(b, '烈箭鷹ex 應在備戰');
  ok(b.damage === 0, `Stage2 進化不該吃險惡廢墟，實得 damage=${b.damage}`);
});

T('★(2) Stage2 非 ex（大竺葵）放備戰 → 不放指示物', () => {
  const d = benchFromDiscard(STAGE2);
  ok(d === 0, `Stage2 不該吃險惡廢墟，實得 damage=${d}`);
});

T('(3) Basic（願增猿 subtype=Basic）放備戰 → 20', () => {
  const d = benchFromDiscard(BASIC);
  ok(d === 20, `應 20，實得 ${d}`);
});

T('(4) Basic + subtype=ex（拉普拉斯ex）放備戰 → 20（禁用 subtype 判基礎）', () => {
  const d = benchFromDiscard(BASICEX);
  ok(d === 20, `應 20，實得 ${d}`);
});

T('(5) 化石（PLAY_FOSSIL）放備戰 → 20（官方 id 783/787：場上化石＝【基礎】寶可夢）', () => {
  const f = inst(FOSSIL);
  const st = mk({ hand: [f] });
  const out = applyAction(st, { type: 'PLAY_FOSSIL', iid: f.iid }, pool);
  const b = out.players[0].bench.find(c => c.cardId === FOSSIL);
  ok(b, '化石應在備戰');
  ok(b.fossilOnField === true, '化石上場應標 fossilOnField');
  ok(b.damage === 20, `化石應吃 20（不可被「改判基礎」順手關掉），實得 ${b.damage}`);
});

T('(6) 【惡】屬性 Basic（狃拉）放備戰 → 不放指示物', () => {
  const d = benchFromDiscard(DARK);
  ok(d === 0, `【惡】除外，實得 ${d}`);
});

T('(7) 鬼之假面互換（保留 iid）→ 不觸發（不是「新放置」）', () => {
  ok(GHOSTMASK, '找不到 鬼之假面');
  const onField = inst(OGRE_EX, { damage: 0 });
  const inDiscard = inst(OGRE_EX2);
  const mask = inst(GHOSTMASK);
  const st = mk({ hand: [mask], bench: [onField], discard: [inDiscard] });
  let out = applyAction(st, { type: 'PLAY_TRAINER', iid: mask.iid }, pool);
  ok(out.pendingSelection, '鬼之假面應開 picker：' + JSON.stringify(out.log.slice(-2)));
  // 兩段：先選棄牌區那張，再選場上那隻
  out = applyAction(out, { type: 'RESOLVE_SELECTION', selectedIids: [inDiscard.iid] }, pool);
  ok(out.pendingSelection, '第二段 picker（選場上）應開啟');
  out = applyAction(out, { type: 'RESOLVE_SELECTION', selectedIids: [onField.iid] }, pool);
  const b = out.players[0].bench.find(c => c.iid === onField.iid);
  ok(b, '互換後應仍在備戰（iid 保留）');
  ok(b.cardId === String(OGRE_EX2), `應換成另一張，實得 ${b.cardId}`);
  ok(b.damage === 0, `互換保留 iid ⇒ 不是新放置 ⇒ 不該吃險惡廢墟，實得 ${b.damage}`);
});

console.log('④ 現況鎖：放到「對手」備戰區不觸發（站長裁定，維持現行行為）');

T('⭐ 現況鎖：配樂之笛把【基礎】放到對手備戰 → 對手那隻不吃指示物', () => {
  ok(FLUTE, '找不到 配樂之笛');
  const flute = inst(FLUTE);
  const topBasic = inst(BASIC);
  const st = mk({ hand: [flute], oppDeck: [topBasic, inst(BASIC), inst(BASIC), inst(BASIC), inst(BASIC)] });
  let out = applyAction(st, { type: 'PLAY_TRAINER', iid: flute.iid }, pool);
  ok(out.pendingSelection, '配樂之笛應開 picker');
  out = applyAction(out, { type: 'RESOLVE_SELECTION', selectedIids: [topBasic.iid] }, pool);
  const b = out.players[1].bench.find(c => c.iid === topBasic.iid);
  ok(b, '應放到對手備戰：' + JSON.stringify(out.log.slice(-2)));
  ok(b.damage === 0, `現況鎖：放到對手備戰不觸發，實得 ${b.damage}`);
});

T('⭐ 現況鎖（靜態）：中央偵測只掃 before.activePlayerIndex 自己那一側，且註解寫明是裁定', () => {
  const eng = readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8');
  const i = eng.indexOf('function applyRuggedRuinsBenchPlace');
  ok(i > 0, '找不到 applyRuggedRuinsBenchPlace');
  const win = eng.slice(i, i + 1400);
  ok(/const idx = before\.activePlayerIndex;/.test(win), '不再以 before.activePlayerIndex 單側掃描 ⇒ 現況鎖被破壞');
  ok(!/for \(const .* of \[0, 1\]/.test(win), '出現雙側掃描 ⇒ 現況鎖被破壞');
  const head = eng.slice(Math.max(0, i - 1800), i);
  ok(/自己的回合[^\n]*自己的備戰區/.test(head), '註解沒寫明「自己的回合、自己的備戰區」這條裁定解讀');
});

T('⭐ 現況鎖（枚舉）：卡面「放置於對手的備戰區」的卡剛好 5 張，全部列名', () => {
  const HIJ = new Set(['H', 'I', 'J']);
  const names = new Set();
  for (const c of pool.values()) {
    if (!HIJ.has(c.regulationMark)) continue;
    const texts = [c.rulesText || '', ...(c.abilities || []).map(a => a.effect || a.text || ''),
                   ...(c.attacks || []).map(a => a.effect || '')];
    if (texts.some(t => t.includes('放置於對手的備戰區'))) names.add(c.name);
  }
  const expect = ['勾魂眼', '莉莉艾的蝶結萌虻', '禿鷹娜', '大舌頭', '配樂之笛'];
  ok(names.size === 5, `枚舉到 ${names.size} 張（期待 5）：${[...names].join('、')}`);
  for (const n of expect) ok(names.has(n), `漏掉 ${n}`);
});

console.log('⑤ 另外 3 個 outlier：場上視角的【基礎】必須含化石');

// ⚠ v6.008 教訓：基本能量卡的 pokemonType 在 DB 全是 null ⇒ 只能用卡名的【X】對應。
const ZH_OF = { Grass: '草', Fire: '火', Water: '水', Lightning: '雷', Psychic: '超',
                Fighting: '鬥', Darkness: '惡', Metal: '鋼' };
const ENERGY_ID = {};
for (const c of pool.values()) {
  if (c.supertype !== 'Energy' || c.subtype !== 'Basic') continue;
  for (const [k, zh] of Object.entries(ZH_OF)) {
    if (!ENERGY_ID[k] && c.name === `基本【${zh}】能量`) ENERGY_ID[k] = String(c.id);
  }
}
ENERGY_ID.Colorless = ENERGY_ID.Colorless ?? ENERGY_ID.Water;
const logText = (l) => String(l?.message ?? l?.text ?? l);

T('★ 三首惡龍ex｜貪婪食客：招式 KO 對手的化石 → 多拿 1 張獎賞（共 2）', () => {
  const GG = [...pool.values()].find(x => x.name === '三首惡龍ex' && (x.abilities || []).some(a => a.name === '貪婪食客'));
  const idx = GG.attacks.length - 1;
  const atk = GG.attacks[idx];
  const a = inst(GG.id);
  a.energyAttached = (atk.cost || []).map(t => inst(ENERGY_ID[t] ?? ENERGY_ID.Darkness ?? ENERGY_ID.Water));
  const fossil = inst(FOSSIL, { fossilOnField: true, damage: 50 });
  const st = mk({ stadium: false, active: a });
  st.players[1] = { ...st.players[1], active: fossil, bench: [inst(BASIC)] };
  const out = applyAction(st, { type: 'ATTACK', attackIndex: idx, actorIdx: 0 }, pool);
  ok(out.players[1].active?.iid !== fossil.iid, '化石應被 KO（傷害不足？）log=' + JSON.stringify(out.log.slice(-3).map(logText)));
  const took = 6 - out.players[0].prizes.length + out.pendingPrizes[0];
  ok(took === 2, `化石(非 ex)base 1 ＋貪婪食客 1 ＝ 2 張，實得 ${took}\n` + out.log.map(logText).slice(-3).join('\n'));
});

T('貪婪食客正對照：KO 對手的 Stage2 → 只有 2 張（沒有 +1）', () => {
  const GG = [...pool.values()].find(x => x.name === '三首惡龍ex' && (x.abilities || []).some(a => a.name === '貪婪食客'));
  const idx = GG.attacks.length - 1;
  const atk = GG.attacks[idx];
  const a = inst(GG.id);
  a.energyAttached = (atk.cost || []).map(t => inst(ENERGY_ID[t] ?? ENERGY_ID.Darkness ?? ENERGY_ID.Water));
  const s2card = pool.get(STAGE2);
  const victim = inst(STAGE2, { damage: (s2card.hp ?? 150) - 10 });
  const st = mk({ stadium: false, active: a });
  st.players[1] = { ...st.players[1], active: victim, bench: [inst(BASIC)] };
  const out = applyAction(st, { type: 'ATTACK', attackIndex: idx, actorIdx: 0 }, pool);
  ok(out.players[1].active?.iid !== victim.iid, 'Stage2 應被 KO');
  const took = 6 - out.players[0].prizes.length + out.pendingPrizes[0];
  ok(took === 1, `Stage2 非 ex 且非【基礎】⇒ 只有 1 張，實得 ${took}\n` + out.log.map(logText).slice(-3).join('\n'));
});

// ⚠⚠ v6.251：原本這一條只斷言「log 沒有出現『非基礎』」——**硬幣反面時它恆真**
//   （反面走的是備戰那一支，本來就不會印那句話）⇒ 約 50% 的執行是安慰劑，
//   實測 M1 突變下跑 6 次只紅 4 次。改成：**固定硬幣為正面**，並斷言化石**真的被昏厥**。
function withCoin(heads, fn) {
  const orig = Math.random;
  Math.random = () => (heads ? 0.0 : 0.99);   // <0.5 = 正面（flipCoinsWithLog 的判準）
  try { return fn(); } finally { Math.random = orig; }
}

T('★ 阿羅拉 椰蛋樹ex｜嗡嗡榍石（固定正面）：對手戰鬥場的化石應被【昏厥】', () => {
  const AE = [...pool.values()].find(x => x.name === '阿羅拉 椰蛋樹ex');
  const idx = AE.attacks.findIndex(x => x.name === '嗡嗡榍石');
  const a = inst(AE.id);
  a.energyAttached = (AE.attacks[idx].cost || []).map(t => inst(ENERGY_ID[t] ?? ENERGY_ID.Grass));
  const fossil = inst(FOSSIL, { fossilOnField: true });
  const st = mk({ stadium: false, active: a });
  st.players[1] = { ...st.players[1], active: fossil, bench: [inst(BASIC)] };
  const out = withCoin(true, () => applyAction(st, { type: 'ATTACK', attackIndex: idx, actorIdx: 0 }, pool));
  const txt = out.log.map(logText).join('\n');
  // ⚠ 先驗「硬幣真的固定住了」（用 flipCoinsWithLog 自己印的那一行，不受後續分支影響），
  //   再驗判準，最後驗盤面 —— 順序錯了會給出誤導的失敗訊息。
  ok(/嗡嗡榍石：擲硬幣 — 正面/.test(txt), '硬幣沒有被固定成正面（覆寫 Math.random 失效）：\n'
    + txt.split('\n').slice(-4).join('\n'));
  ok(!/嗡嗡榍石：對手戰鬥場非基礎/.test(txt), '把場上化石判成「非基礎」了：\n' + txt.split('\n').slice(-4).join('\n'));
  ok(out.players[1].active?.iid !== fossil.iid, '化石應被昏厥（只看 log 沒有那句話是不夠的）：\n'
    + txt.split('\n').slice(-4).join('\n'));
});

T('嗡嗡榍石正對照（固定正面）：對手戰鬥場是 Stage2 → 不昏厥且寫「非基礎」', () => {
  const AE = [...pool.values()].find(x => x.name === '阿羅拉 椰蛋樹ex');
  const idx = AE.attacks.findIndex(x => x.name === '嗡嗡榍石');
  const a = inst(AE.id);
  a.energyAttached = (AE.attacks[idx].cost || []).map(t => inst(ENERGY_ID[t] ?? ENERGY_ID.Grass));
  const victim = inst(STAGE2);
  const st = mk({ stadium: false, active: a });
  st.players[1] = { ...st.players[1], active: victim, bench: [inst(BASIC)] };
  const out = withCoin(true, () => applyAction(st, { type: 'ATTACK', attackIndex: idx, actorIdx: 0 }, pool));
  const txt = out.log.map(logText).join('\n');
  ok(/嗡嗡榍石：擲硬幣 — 正面/.test(txt), '硬幣沒有被固定成正面：\n' + txt.split('\n').slice(-4).join('\n'));
  ok(/嗡嗡榍石：對手戰鬥場非基礎/.test(txt), 'Stage2 應被判成非基礎：\n' + txt.split('\n').slice(-4).join('\n'));
  ok(out.players[1].active?.iid === victim.iid, 'Stage2 不該被嗡嗡榍石昏厥');
});

T('★ 火箭隊的班基拉斯｜揚沙：對手備戰的化石也要吃 2 個指示物', () => {
  const TY = [...pool.values()].find(x => x.name === '火箭隊的班基拉斯');
  const a = inst(TY.id);
  const fossil = inst(FOSSIL, { fossilOnField: true });
  const st = mk({ stadium: false, active: a });
  st.players[1] = { ...st.players[1], active: inst(STAGE2), bench: [fossil] };
  const out = applyAction(st, { type: 'END_TURN' }, pool);
  const b = out.players[1].bench.find(c => c.iid === fossil.iid);
  ok(b, '化石應仍在備戰：' + JSON.stringify(out.log.slice(-3).map(logText)));
  ok(b.damage === 20, `揚沙對場上化石應放 2 個指示物，實得 ${b.damage}`);
});

T('揚沙正對照：對手備戰的 Stage2 不吃指示物（判準沒有變成無差別）', () => {
  const TY = [...pool.values()].find(x => x.name === '火箭隊的班基拉斯');
  const a = inst(TY.id);
  const s2 = inst(STAGE2);
  const st = mk({ stadium: false, active: a });
  st.players[1] = { ...st.players[1], active: inst(BASIC), bench: [s2] };
  const out = applyAction(st, { type: 'END_TURN' }, pool);
  const b = out.players[1].bench.find(c => c.iid === s2.iid);
  ok(b && b.damage === 0, `Stage2 不該吃揚沙，實得 ${b && b.damage}`);
});


T('★ 雙斧戰龍｜斧擊衝撞：對手戰鬥場是化石 → 昏厥（官方 PTCG_RULES.json id 787 明文「可以」）', () => {
  const AX = [...pool.values()].find(x => x.name === '雙斧戰龍'
    && (x.attacks || []).some(a => a.name === '斧擊衝撞'));
  ok(AX, '找不到帶「斧擊衝撞」的雙斧戰龍');
  const idx = AX.attacks.findIndex(a => a.name === '斧擊衝撞');
  ok(AX.attacks[idx].effect === '若對手的戰鬥寶可夢為【基礎】寶可夢，則將那隻寶可夢【昏厥】。',
    AX.attacks[idx].effect);
  const a = inst(AX.id);
  a.energyAttached = (AX.attacks[idx].cost || []).map(t => inst(ENERGY_ID[t] ?? ENERGY_ID.Fighting));
  const fossil = inst(FOSSIL, { fossilOnField: true });
  const st = mk({ stadium: false, active: a });
  st.players[1] = { ...st.players[1], active: fossil, bench: [inst(BASIC)] };
  const out = applyAction(st, { type: 'ATTACK', attackIndex: idx, actorIdx: 0 }, pool);
  const txt = out.log.map(logText).join('\n');
  ok(!/斧擊衝撞：對手戰鬥場非基礎/.test(txt), '把場上化石判成「非基礎」了（違反官方 id 787）：\n'
    + txt.split('\n').slice(-4).join('\n'));
  ok(out.players[1].active?.iid !== fossil.iid, '化石應被昏厥：\n' + txt.split('\n').slice(-4).join('\n'));
});

T('斧擊衝撞正對照：對手戰鬥場是 Stage2 → 不昏厥（判準沒變成無差別）', () => {
  const AX = [...pool.values()].find(x => x.name === '雙斧戰龍'
    && (x.attacks || []).some(a => a.name === '斧擊衝撞'));
  const idx = AX.attacks.findIndex(a => a.name === '斧擊衝撞');
  const a = inst(AX.id);
  a.energyAttached = (AX.attacks[idx].cost || []).map(t => inst(ENERGY_ID[t] ?? ENERGY_ID.Fighting));
  const victim = inst(STAGE2);
  const st = mk({ stadium: false, active: a });
  st.players[1] = { ...st.players[1], active: victim, bench: [inst(BASIC)] };
  const out = applyAction(st, { type: 'ATTACK', attackIndex: idx, actorIdx: 0 }, pool);
  ok(out.players[1].active?.iid === victim.iid, 'Stage2 不該被斧擊衝撞昏厥');
  ok(/斧擊衝撞：對手戰鬥場非基礎/.test(out.log.map(logText).join('\n')), '應寫「非基礎」的原因 log');
});

console.log("⑥ lint：場上 instance 不得手刻 stage==='Basic'");

/** 剝掉 // 與 block 註解（說明文字會引用舊寫法，不剝會誤判） */
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

// 掃描器：全站手刻「<card>.stage === 'Basic'」（含 !==）的樣式。
// ⚠ 逐行 regex（剝註解後）＋ 正對照樣本；不用「往後找第一個括號」那種脆弱定位（Rule 25）。
// ⚠ 不掃 subtype === 'Basic'：那個字面在**基本能量卡**上大量合法出現（雜訊 > 訊號）；
//   「禁用 subtype 判基礎」改由行為端矩陣 (4) 與資料面斷言（338 張基礎 ex）把關。
const HANDROLL_RE = /\.\s*stage\s*[!=]==\s*'Basic'/;

/**
 * 白名單：**非場上視角**（手牌／牌庫／棄牌區）或「判是否為進化」的合法用法。
 * 每筆＝[相對路徑, 該行剝註解後 trim 的完整內容, 理由]。
 * ⚠ 每一筆都必須在原始碼中**真的找得到**（下方有死條目檢查）—— 防止換寫法後白名單變成
 *   永遠放行的隱形通道（Rule 28 的死條目教訓）。
 */
const ALLOW = [
  ['src/lib/game/selection-filter.ts', "return card?.stage === 'Basic';",
   '中央述詞 isBasicPokemonOnField 本體'],
  ['src/lib/game/effects/cards/v2353_j_mark_batch.ts', "return card?.supertype === 'Pokemon' && card.stage === 'Basic';",
   '鳳王｜復生火焰＝從**棄牌區**選基礎放備戰（官方 id 795：棄牌區的化石是物品卡）'],
  ['src/lib/game/effects/cards/v2355_j_mark_batch.ts', "card.stage === 'Basic' &&",
   '哲爾尼亞斯｜大地之門＝從**牌庫**選【超】基礎（牌庫視角）'],
  ['src/lib/game/effects/cards/v2750_h_wave2_full.ts', "return card?.supertype === 'Pokemon' && (card.subtype === 'Basic' || card.stage === 'Basic');",
   '大舌頭｜舌引＝看對手**手牌**（官方 id 789：手牌的化石是物品卡）'],
  ['src/lib/game/effects/cards/v2750_h_wave2_full.ts', "if (!(card.subtype === 'Basic' || card.stage === 'Basic')) continue;",
   '同上，舌引 resolver 端 re-validate（手牌視角）'],
  ['src/lib/game/effects/cards/v2760_h_wave3_complex.ts', "return card?.stage && card.stage !== 'Basic';",
   '超能豔鴕｜奧密之眼＝判「是不是**進化**寶可夢」；化石 stage=null ⇒ 正確地不算進化（現行行為正確，v6.250 不動）'],
  ['src/lib/game/effects/cards/v2996_g4_wave2.ts', "const isBasic = c.subtype === 'Basic' || c.stage === 'Basic';",
   'isBasicPokemonHPLE70（保母曼波｜溫柔鰭 / 禿鷹娜）＝棄牌區・對手手牌視角（官方 id 789/795）'],
  ['src/lib/game/effects/cards/v2998_g2.ts', "return cc.subtype === 'Basic' || cc.stage === 'Basic';",
   '莉莉艾的蝶結萌虻＝看對手**手牌**（官方 id 789）'],
  ['src/lib/game/effects/cards/v2998_g2.ts', "const isBasic = card.subtype === 'Basic' || card.stage === 'Basic';",
   '同上，resolver 端 re-validate（手牌視角）'],
  ['src/lib/game/engine.ts', "const isBasic = cc.subtype === 'Basic' || cc.stage === 'Basic';",
   '溫柔鰭 gate＝掃自己**棄牌區**（官方 id 795）'],
];

function scanGameSrc() {
  const files = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.ts')) files.push(p);
    }
  };
  walk(join(ROOT, 'src/lib/game'));
  return files;
}
const GAME_FILES = scanGameSrc();

function collectHits() {
  const hits = [];
  let lines = 0;
  for (const f of GAME_FILES) {
    const src = stripComments(readFileSync(f, 'utf8')).split('\n');
    lines += src.length;
    src.forEach((line, i) => {
      if (HANDROLL_RE.test(line)) hits.push({ rel: f.replace(ROOT, '').replace(/\\/g, '/'), n: i + 1, text: line.trim() });
    });
  }
  return { hits, lines };
}

T("⭐ lint：src/lib/game/** 對場上 instance 手刻 stage==='Basic' 的樣式數 = 0", () => {
  ok(GAME_FILES.length > 100, `只掃到 ${GAME_FILES.length} 個 .ts，掃描器壞了？`);   // 下限斷言
  const { hits, lines } = collectHits();
  ok(lines > 70000, `只掃到 ${lines} 行，掃描器壞了？`);                              // 下限斷言
  ok(hits.length >= ALLOW.length, `只找到 ${hits.length} 筆 stage==='Basic'（白名單有 ${ALLOW.length} 筆）⇒ 掃描器壞了？`);
  const bad = hits.filter(h => !ALLOW.some(a => a[0] === h.rel && a[1] === h.text));
  ok(bad.length === 0,
    `場上視角手刻【基礎】判定 ${bad.length} 處（必須改走 isBasicPokemonOnField）：\n`
    + bad.map(h => `${h.rel}:${h.n}  ${h.text.slice(0, 120)}`).join('\n'));
});

T('⭐ lint：白名單不得有死條目（每一筆都要真的還存在）', () => {
  const { hits } = collectHits();
  const dead = ALLOW.filter(a => !hits.some(h => h.rel === a[0] && h.text === a[1]));
  ok(dead.length === 0, '白名單死條目（寫法已改，該重新判定視角）：\n'
    + dead.map(a => `${a[0]}  ${a[1]}`).join('\n'));
});

T('⭐ lint 正對照：判準抓得到真的違規樣本，且不會誤抓中央述詞用法', () => {
  const bad = [
    "if (card?.stage !== 'Basic') return addLog(st, 'x', idx);",
    "const basics = st.players[i].bench.filter(b => pool.get(b.cardId)?.stage === 'Basic');",
    "if (c.stage === 'Basic' && c.supertype === 'Pokemon') return true;",
  ];
  for (const b of bad) ok(HANDROLL_RE.test(b), '判準抓不到違規樣本 ⇒ 安慰劑：' + b);
  const good = [
    'if (!isBasicPokemonOnField(inst, pool.get(inst.cardId))) return c;',
    'const basics = top.filter(c => isBasicPokemonCard(pool.get(c.cardId)));',
  ];
  for (const g of good) ok(!HANDROLL_RE.test(g), '誤抓中央述詞用法：' + g);
  ok(!HANDROLL_RE.test(stripComments("// 舊寫法：card?.stage === 'Basic'")), '註解沒被剝掉 ⇒ 會誤報');
  ok(HANDROLL_RE.test(stripComments("x = card?.stage === 'Basic'; // 說明")), '剝註解把程式也吃掉了');
});

T('⭐ lint 正對照②：白名單放行的是「內容比對」，不是整個檔案放行', () => {
  const fakeHit = { rel: '/src/lib/game/engine.ts', n: 1, text: "if (card?.stage === 'Basic') koIt();" };
  ok(!ALLOW.some(a => a[0] === fakeHit.rel && a[1] === fakeHit.text),
    '同檔的新違規也被放行 ⇒ 白名單粒度錯了');
});

T('⭐ 5 個消費點都真的接上中央述詞（行為端之外再加一道靜態確認）', () => {
  const shared = readFileSync(join(ROOT, 'src/lib/game/effects/_shared.ts'), 'utf8');
  const i = shared.indexOf('export function applyBenchPlaceSideEffects');
  ok(i > 0, '找不到 applyBenchPlaceSideEffects');
  ok(/isBasicPokemonOnField/.test(shared.slice(i, i + 1800)), '險惡廢墟沒走中央述詞');
  const eng = readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8');
  const gg = eng.indexOf("'貪婪食客')");
  ok(gg > 0 && /isBasicPokemonOnField/.test(eng.slice(gg - 300, gg + 400)), '貪婪食客沒走中央述詞');
  const sand = eng.indexOf('hasRocketTyranitarSandstorm({');
  ok(sand > 0 && /isBasicPokemonOnField/.test(eng.slice(sand, sand + 1200)), '揚沙沒走中央述詞');
  const w2 = readFileSync(join(ROOT, 'src/lib/game/effects/cards/v2750_h_wave2_full.ts'), 'utf8');
  const bz = w2.indexOf("regPost('阿羅拉 椰蛋樹ex|嗡嗡榍石'");
  ok(bz > 0, '找不到 嗡嗡榍石');
  ok(((w2.slice(bz, bz + 1800).match(/isBasicPokemonOnField/g) || []).length) >= 2, '嗡嗡榍石兩個判定點沒有都接上');
  const w16 = readFileSync(join(ROOT, 'src/lib/game/effects/cards/v2660_i_wave16_misc9.ts'), 'utf8');
  const ax = w16.indexOf("regPost('雙斧戰龍|斧擊衝撞'");
  ok(ax > 0, '找不到 斧擊衝撞');
  ok(/isBasicPokemonOnField/.test(w16.slice(ax, ax + 900)), '斧擊衝撞沒走中央述詞');
});

console.log('\n=== v6.250 場上【基礎】中央述詞：PASS ' + pass + ' / FAIL ' + fail + ' ===');
if (fail > 0) process.exit(1);
