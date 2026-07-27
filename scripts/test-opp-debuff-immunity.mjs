// 守衛：「對手戰鬥位跨回合 debuff 旗標」一律要過招式效果免疫 gate（v6.046）。
//
// 起因：玩家回報「迷唇姐｜強烈之吻 可以把附有【薄霧能量】的寶可夢丟棄」，且是**攻擊前**
// 就已經附上薄霧能量。查證卡面：
//   薄霧能量  ：「附有這張卡的寶可夢不會受到對手的寶可夢使用招式的效果的影響。」
//   強烈之吻  ：「在下個對手的回合結束時，將**受到這個招式的寶可夢**與附加的卡全部丟棄。」
// → 是招式效果，必須被薄霧能量完全擋下。
//
// 根因是**結構性**的，不是單卡筆誤：這類招式的實作方式是「在對手 active 的 CardInstance
// 上寫一個跨回合旗標」，而 anti-pattern-lint 的 Check H 只認得 5 種改動樣態
// （換位／備戰增減／能量／道具／狀態三槽），**寫自訂旗標不在其中**，所以整整一類招式
// 都從免疫檢查底下溜過去。掃完全部 H/I/J 共 11 張卡漏 gate，全部收斂到中央
// `applyOppActiveDebuffPost`（v5.806 就已存在且內含 gate，只是這些卡沒接上）。
//
// 每張卡都測兩組，缺一不可：
//   ① 目標附薄霧能量 → 旗標**不可**被設（修的就是這個）
//   ② 目標無薄霧能量 → 旗標**必須**被設（證明招式本身沒被我改壞；只有 ① 的話，
//      把整個 regPost 刪掉也會 PASS）
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x-od-s.js'), E = join(ROOT, '.x-od-e.ts'), O = join(ROOT, '.x-od-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { applyAction } = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}

const MIST = '12462';          // 薄霧能量 (SV8a) — 特殊能量
const TARGET_BASIC = '14069';  // 超級拉帝亞斯ex：HP280、**無弱點也無特性**，怎麼打都不會被 KO
//   ⚠靶必須是真正的【基礎】（無 evolvesFrom）—— 障礙踩踏卡面只對「受到這個招式的【基礎】寶可夢」
//   生效。第一版選了超級快龍ex（HP370），但它 evolvesFrom='哈克龍' 是進化寶可夢，
//   對照組因此不施加旗標而 FAIL。這正是雙向測試的價值：單測免疫那半邊不會抓到選錯靶。
const TARGET_EVO   = '12487';  // 吼鯨王 Stage1 HP240（冷卻噴射只打進化寶可夢；弱點是雷，水招不會加倍）
const BASIC_ENERGY = {         // 各屬性基本能量（【無】用同一張支付即可）
  Grass: '18382', Lightning: '18383', Psychic: '14128', Darkness: '14152',
  Fire: '13185', Fighting: '14104', Metal: '14434', Water: '18519',
};

// 全部 11 張卡的卡面都查證自 static/cards（台灣官方中文卡面），主詞一律是
// 「受到這個招式的寶可夢」＝對受招者施加的招式效果。
const CASES = [
  { card: '19174', atk: 0, name: '迷唇姐｜強烈之吻',        flag: 'strongKissDiscardPending' },
  { card: '12817', atk: 0, name: '火箭隊的臭泥｜浸蝕污泥',  flag: 'strongKissDiscardPending' },
  { card: '14053', atk: 0, name: '帕奇利茲｜麻痺門牙',      flag: 'paralyzeFangPending' },
  { card: '13978', atk: 0, name: '穿山王｜潑沙',            flag: 'attackFailureFlipCountPending' },
  { card: '11270', atk: 0, name: '智揮猩｜掌握弱點',        flag: 'weaknessOverrideTypeNextTurn' },
  { card: '18000', atk: 0, name: '冰雪巨龍｜冰冷寒氣',      flag: 'cantAttackPending' },
  { card: '12192', atk: 0, name: '飄香豚｜芬香踩踏',        flag: 'cantAttackPending', heads: true },
  { card: '10250', atk: 0, name: '凱羅斯｜慢嚼碎',          flag: 'koAtMyNextEndOfTurn' },
  { card: '10268', atk: 0, name: '冰伊布｜滲透寒氣',        flag: 'damageAtMyNextEndOfTurn' },
  { card: '12353', atk: 0, name: '鐵包袱｜冷卻噴射',        flag: 'cantAttackPending', target: TARGET_EVO },
  { card: '11243', atk: 1, name: '帕底亞 肯泰羅｜障礙踩踏', flag: 'cantAttackPending' },
  // ⭐這兩張是 lint Check U 自己抓出來、我手動枚舉時漏掉的（共用 helper pothaPost）：
  //   卡面與穿山王｜潑沙一字不差。我的臨時掃描腳本用「往上 60 行內有無 gate 關鍵字」判斷，
  //   而它上方剛好有別張卡的 defCantRetreatNextPost → 誤判成已 gate。
  { card: '10467', atk: 0, name: '沙丘娃｜潑沙',            flag: 'attackFailureFlipCountPending' },
  { card: '10468', atk: 0, name: '噬沙堡爺｜潑沙',          flag: 'attackFailureFlipCountPending' },
];

let nn = 0;
const inst = (cid, energy = []) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: energy });
const en = (cid) => ({ iid: 'e' + (++nn), cardId: String(cid), damage: 0, energyAttached: [] });

/** 依招式 cost 給足能量：【無】可用任何能量支付，故一律配該招的第一個有色屬性。 */
function energyFor(card, atkIdx) {
  const cost = card.attacks?.[atkIdx]?.cost ?? [];
  const colored = cost.find((c) => c !== 'Colorless') ?? 'Psychic';
  const id = BASIC_ENERGY[colored] ?? BASIC_ENERGY.Psychic;
  return cost.map(() => en(id));
}

function mk(c, withMist) {
  const atkCard = pool.get(c.card);
  const targetId = c.target ?? TARGET_BASIC;
  return {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
    isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
    pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], winner: null,
    players: [
      { name: 'P1', active: inst(c.card, energyFor(atkCard, c.atk)), bench: [inst(c.card)],
        hand: [], deck: [inst(c.card)], discard: [], prizes: [inst(c.card)] },
      { name: 'P2', active: inst(targetId, withMist ? [en(MIST)] : []), bench: [inst(targetId)],
        hand: [], deck: [inst(targetId)], discard: [], prizes: [inst(targetId)] },
    ],
  };
}

/** 打一次，回傳 { flagged, targetSurvived }。heads=true 時強制擲幣正面。 */
function attackOnce(c, withMist) {
  const st0 = mk(c, withMist);
  const targetIid = st0.players[1].active.iid;
  const orig = Math.random;
  if (c.heads) Math.random = () => 0.01;   // < 0.5 = 正面
  let st;
  try { st = applyAction(st0, { type: 'ATTACK', attackIndex: c.atk, actorIdx: 0 }, pool); }
  finally { Math.random = orig; }
  const def = st.players[1].active;
  return {
    flagged: !!(def && def.iid === targetIid && def[c.flag]),
    targetSurvived: !!(def && def.iid === targetIid),
  };
}

let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

T('前提：薄霧能量的卡面文字仍是「不會受到對手的寶可夢使用招式的效果的影響」', () => {
  const mist = pool.get(MIST);
  assert.ok(mist, '找得到薄霧能量');
  assert.ok((mist.rulesText ?? '').includes('不會受到對手的寶可夢使用招式的效果的影響'),
    '薄霧能量卡面若改版，本測試的前提就不成立了');
});

T('前提：測試用的靶不會被打死（被 KO 的話旗標無從觀察，測試會假綠）', () => {
  for (const c of CASES) {
    const r = attackOnce(c, false);
    assert.ok(r.targetSurvived, `${c.name}：靶被 KO 了，請換 HP 更高的靶`);
  }
});

for (const c of CASES) {
  T(`⭐⭐${c.name}：目標附【薄霧能量】→ 不可施加 ${c.flag}`, () => {
    const r = attackOnce(c, true);
    assert.equal(r.flagged, false,
      `附有薄霧能量仍被施加「${c.flag}」—— 卡面主詞是「受到這個招式的寶可夢」＝招式效果，`
      + '必須走 applyOppActiveDebuffPost（內含 canApplyAttackEffectToTarget gate）');
  });
  T(`${c.name}：目標無薄霧能量 → 仍必須正常施加 ${c.flag}`, () => {
    const r = attackOnce(c, false);
    assert.equal(r.flagged, true,
      `沒有免疫來源時卻沒施加「${c.flag}」—— 招式本體壞了（只測免疫那半邊會讓「整個效果刪掉」也 PASS）`);
  });
}

T('⭐中央管線本身必須含免疫 gate（被拿掉的話上面每一條都會靜默失效）', () => {
  const src = readFileSync(join(ROOT, 'src/lib/game/effects.ts'), 'utf8');
  const i = src.indexOf('export function applyOppActiveDebuffPost');
  assert.ok(i > 0, 'applyOppActiveDebuffPost 應存在於 effects.ts');
  const body = src.slice(i, i + 1400);
  assert.ok(/canApplyAttackEffectToTarget|canApplyEffectToTarget/.test(body),
    '中央 debuff 管線內必須呼叫招式效果免疫 helper');
  assert.ok(/guard\.blocked/.test(body), '必須在 blocked 時 early-return（且要 log 原因給玩家看）');
});

// ══ 枚舉守衛：新增跨回合旗標時，必須表態它是不是「對手施加的 debuff」════════════
//   這是本輪真正的「一勞永逸」。前面 11 張卡的修正只解決了現況；讓這類 bug 不再發生的，
//   是「新增欄位時逼作者歸類」——沒歸類就 FAIL，而不是安靜地漏掉免疫檢查。
//   （引擎兜底 sweep 也讀同一份 OPP_ATTACK_DEBUFF_FLAGS，所以歸類即自動生效。）

/** 已確認**不是**對手 debuff 的跨回合旗標：自身增益、自身罰則、各種免疫旗標。 */
const SELF_OR_BUFF_FLAGS = new Set([
  'damageBonusPending',                 // 自身加傷
  'cantRetreatPendingSelf',             // 自身罰則（招式副作用，寫在攻擊方身上）
  'pointySpinNextTurn',                 // 自身加傷條件（v5.967 已被 attackUsedLastSelfTurn 取代）
  'immuneToAttackEffectsNextTurn',      // 以下皆為「自己給自己」的免疫/減傷 buff
  'immuneToExAttackTagNextTurn', 'weaknessDisabledNextTurn', 'immuneToBasicAttackNextTurn',
  'blockAttackDamageIfLTENextTurn', 'immuneToAncientAttackNextTurn', 'immuneToExAttackNextTurn',
  'immuneToAbilityPokemonNextTurn', 'immuneToAllAttackNextTurn', 'immuneToAttackDamageNextTurn',
  'immuneToEvolutionAttackNextTurn', 'evolutionDamageReduceNextTurn', 'immuneToBurnedAttackerNextTurn',
]);

T('⭐⭐每個跨回合旗標都必須被歸類（新增旗標忘了歸類 = 又一個強烈之吻）', () => {
  const types = readFileSync(join(ROOT, 'src/lib/game/types.ts'), 'utf8');
  const i = types.indexOf('export interface CardInstance');
  assert.ok(i > 0, '找得到 CardInstance');
  const body = types.slice(i, types.indexOf('\n}', i));
  const fields = [...body.matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1]);
  assert.ok(fields.length > 50, `CardInstance 欄位數異常（${fields.length}）—— 解析方式可能失效了`);

  const flagsSrc = readFileSync(join(ROOT, 'src/lib/game/instance-flags.ts'), 'utf8');
  const j = flagsSrc.indexOf('OPP_ATTACK_DEBUFF_FLAGS');
  assert.ok(j > 0, 'instance-flags.ts 應有 OPP_ATTACK_DEBUFF_FLAGS');
  const listSrc = flagsSrc.slice(flagsSrc.indexOf('[', j), flagsSrc.indexOf('];', j));
  const oppFlags = new Set([...listSrc.matchAll(/'([^']+)'/g)].map((m) => m[1]));
  assert.ok(oppFlags.size >= 15, `OPP_ATTACK_DEBUFF_FLAGS 只解析到 ${oppFlags.size} 個，解析方式可能失效`);

  // 「跨回合」的命名慣例：…NextTurn / …Pending / …AtMyNextEndOfTurn
  const crossTurn = fields.filter((f) => /(NextTurn|Pending)$|NextEndOfTurn$/.test(f));
  const unclassified = crossTurn.filter((f) => !oppFlags.has(f) && !SELF_OR_BUFF_FLAGS.has(f));
  assert.deepEqual(unclassified, [],
    '這些跨回合旗標沒有被歸類：' + unclassified.join('、')
    + '\n  → 若它是「對手招式加在受招者身上」的，加進 instance-flags.ts 的 OPP_ATTACK_DEBUFF_FLAGS'
    + '（引擎免疫 sweep 與 lint Check U 都吃這份清單）；'
    + '\n  → 若它是自身增益/自身罰則，加進本測試的 SELF_OR_BUFF_FLAGS 並在此留下判斷依據。');
  console.log(`   跨回合旗標 ${crossTurn.length} 個：對手 debuff ${crossTurn.filter((f) => oppFlags.has(f)).length} 個／自身 ${crossTurn.filter((f) => SELF_OR_BUFF_FLAGS.has(f)).length} 個`);
});

T('⭐兩份清單不可重疊（同一個旗標不能既是對手 debuff 又是自身 buff）', () => {
  const flagsSrc = readFileSync(join(ROOT, 'src/lib/game/instance-flags.ts'), 'utf8');
  const j = flagsSrc.indexOf('OPP_ATTACK_DEBUFF_FLAGS');
  const listSrc = flagsSrc.slice(flagsSrc.indexOf('[', j), flagsSrc.indexOf('];', j));
  const oppFlags = [...listSrc.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const dup = oppFlags.filter((f) => SELF_OR_BUFF_FLAGS.has(f));
  assert.deepEqual(dup, [], '重疊的旗標：' + dup.join('、'));
});

T('⭐引擎的免疫兜底 sweep 必須讀清單、而不是硬編欄位名（硬編就會再漏一次）', () => {
  const eng = readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8');
  assert.ok(/OPP_ATTACK_DEBUFF_FLAGS/.test(eng), 'engine.ts 應 import 並使用 OPP_ATTACK_DEBUFF_FLAGS');
  const k = eng.indexOf('for (const _f of OPP_ATTACK_DEBUFF_FLAGS)');
  assert.ok(k > 0, '免疫 sweep 應以清單迴圈還原');
  // 三個狀態槽也要掃（三槽制下只掃兩槽會漏第三槽）
  assert.ok(/'status', 'secondaryStatus', 'tertiaryStatus'/.test(eng.slice(k - 900, k)),
    '免疫 sweep 的狀態還原必須涵蓋三個狀態槽');
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
