// ══════════════════════════════════════════════════════════════════════════════
// v6.258 守衛 — PASSIVE_ATTACK_BONUS 的「主詞」維度（自指 vs 全場）
//
// 真 bug（v6.257 的 lint 白名單判錯而放行）：
//   PASSIVE_ATTACK_BONUS 的 dispatch 迴圈掃的是**整個己方場**找「印著這個特性的卡」，
//   加成卻套在 attackerCard 身上。四個「自指型」條目（卡面主詞＝這隻寶可夢）卻只用
//   `att.name === '卡名'` 當 gate ⇒ **同名不同印刷、其中一版沒印這個特性**時誤加成。
//
//   BASE e0c80a56（v6.257）實測：
//     ・仆斬將軍【MC 473/742・H】（無「大將」）肘擊      40 → 100（log「+60(大將)」）
//     ・棄世猴  【M5 039/081・J】（無「憤怒穴」）幽靈打擊 100 → 220（直接 KO）
//     ・電蜘蛛  【SV11W・I】（無「複眼」）放電            50 → 100
//
// 卡面逐字（static/cards，abilities[].effect）：
//   自指型（主詞＝持有者本人）4 個：大將／複眼／憤怒穴／激動力量
//   全場型（主詞＝自己的〈某類〉寶可夢）8 個：
//     輝煌聲援／力之鹽／皇家聲援／鈷藍指令／大方／原始心得／大晴天／勝利聲援
//
// 修法（中央收斂，不是三處各補 if）：
//   effects.ts 新增 PASSIVE_ATTACK_SELF_SUBJECT（宣告式主詞表）＋
//   collectPassiveAttackBonuses（唯一 dispatch），engine.ts／effects.ts／mega_decks.ts
//   三個消費點全部改接同一份。
//
// ⚠ 本檔所有 lint 都配「正對照（合成違規樣本必須被抓到）」＋「下限斷言」。
// ══════════════════════════════════════════════════════════════════════════════
import { build } from 'esbuild';
import { readFileSync, readdirSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
import { stripCommentsBlankChecked, stripCommentsBlank } from './lib/strip-comments.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.v6258-s.js'), E = join(ROOT, '.v6258-e.ts'), O = join(ROOT, '.v6258-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* noop */ } } });
writeFileSync(S, 'export const base="";');
writeFileSync(E,
  "export { applyAction, getUsableAbilities } from './src/lib/game/engine';\n"
+ "export { PASSIVE_ATTACK_BONUS, PASSIVE_ATTACK_NO_STACK, PASSIVE_ATTACK_SELF_SUBJECT,\n"
+ "  collectPassiveAttackBonuses } from './src/lib/game/effects';\n"
+ "import './src/lib/game/effects';\n");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const mod = await import(pathToFileURL(O).href);
const { applyAction, getUsableAbilities, PASSIVE_ATTACK_BONUS, PASSIVE_ATTACK_NO_STACK,
        PASSIVE_ATTACK_SELF_SUBJECT, collectPassiveAttackBonuses } = mod;

// ── 卡池（live H/I/J）────────────────────────────────────────────────────────
const DIR = join(ROOT, 'static/cards');
const LIVE = new Set(JSON.parse(readFileSync(join(DIR, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(DIR)) {
  if (!f.endsWith('.json') || f === 'index.json' || !LIVE.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(DIR, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
assert.ok(pool.size > 3000, `卡池只讀到 ${pool.size} 張 — 掃描器壞了？`);

let pass = 0; const fails = [];
const T = (label, fn) => {
  try { fn(); pass++; console.log('  ✅ ' + label); }
  catch (e) {
    // ⚠ 只吞 assert.AssertionError；TypeError/ReferenceError 照丟（禁無差別 try/catch）
    if (!(e instanceof assert.AssertionError)) throw e;
    fails.push(label + ' — ' + e.message); console.log('  ❌ ' + label + '\n      ' + e.message);
  }
};

// ── 卡片 id（逐一查證過的印刷）──────────────────────────────────────────────
const ID = {
  BUSHIN_MC:   '16944',  // 仆斬將軍【MC 473/742・H】無特性
  BUSHIN_M2A:  '14778',  // 仆斬將軍【M2a・I】｜大將
  MONKEY_M5:   '19183',  // 棄世猴【M5 039/081・J】｜不朽身軀（**沒有**憤怒穴）
  MONKEY_SV10: '12797',  // 棄世猴【SV10・I】｜憤怒穴
  SPIDER_W:    '13388',  // 電蜘蛛【SV11W・I】無特性
  SPIDER_6A:   '10584',  // 電蜘蛛【SV6a・H】｜複眼
  ROSE:        '16504',  // 竹蘭的羅絲雷朵｜輝煌聲援（全場型，應疊加）
  SNORLAX:     '14796',  // 赫普的卡比獸｜大方（全場型 + 明文不重複）
  SKIRT_SVM:   '12078',  // 裙兒小姐【SVM・H】｜大晴天（全場型）
  SKIRT_11B:   '12949',  // 裙兒小姐【SV11B・I】**無特性**（全場型的關鍵反例）
  SERPERIOR:   '16513',  // 君主蛇ex｜皇家聲援（全場型，無條件 +20；HP320 當靶）
  SALT:        '13993',  // 鹽石巨靈｜力之鹽（自己【鬥】+30）
  LUCARIO:     '13986',  // 超級路卡利歐ex 波動突刺（走 effects.ts 中央 helper 路徑）
  SNAKE:       '14370',  // 飯匙蛇｜激動力量
  ABSOL:       '13995',  // 超級阿勃梭魯ex（【惡】Mega ex，激動力量的條件）
  OLIVA:       '16542',  // 奧利瓦ex 油之機關槍（走 mega_decks.ts 路徑）
  PIDGEY:      '14797',  // 咕咕（中性填充）
  E_DARK: '14430', E_PSY: '14103', E_FIGHT: '14104', E_GRASS: '14102', E_LIGHT: '18520',
};
T('0. 下限斷言：本檔依賴的每一張卡都抓得到（抓不到＝安慰劑綠燈）', () => {
  const miss = Object.entries(ID).filter(([, v]) => !pool.get(v)).map(([k]) => k);
  assert.deepStrictEqual(miss, [], '卡池抓不到：' + miss.join(','));
});

// ── fixtures ────────────────────────────────────────────────────────────────
let seq = 0;
const I = (cardId, extra = {}) => ({ iid: 'i' + (++seq), cardId, damage: 0, energyAttached: [], ...extra });
const EN = id => ({ iid: 'e' + (++seq), cardId: id });
const mk = (p0, p1, prizesB = 6) => ({
  phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
  isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true], activeStadium: null,
  players: [
    { name: 'A', active: p0.active, bench: p0.bench ?? [], hand: [], deck: p0.deck ?? [], discard: [], prizes: Array.from({ length: 6 }, () => I(ID.PIDGEY)) },
    { name: 'B', active: p1.active, bench: p1.bench ?? [], hand: [], deck: p1.deck ?? [], discard: [], prizes: Array.from({ length: prizesB }, () => I(ID.PIDGEY)) },
  ],
});
/** 打一發，回傳「對手戰鬥位這一發吃到的傷害」（KO 時回 Infinity）與 log 全文 */
function hit(st, attackIndex = 0) {
  const before = st.players[1].active.damage;
  const after = applyAction(st, { type: 'ATTACK', attackIndex, actorIdx: 0 }, pool);
  const logs = after.log.map(l => (typeof l === 'string' ? l : l.message ?? '')).join('\n');
  const dmg = after.players[1].active ? after.players[1].active.damage - before : Infinity;
  return { dmg, logs, state: after };
}

// ══ A. 卡面逐字（主詞判定的唯一依據）══════════════════════════════════════════
console.log('\n── A. 卡面逐字（static/cards abilities[].effect）──');
const abEffect = (cardId, abName) =>
  (pool.get(cardId).abilities ?? []).find(a => a.name === abName)?.effect;

T('A1 自指型 4 個特性的 effect 逐字都含「這隻寶可夢使用的招式」', () => {
  assert.strictEqual(abEffect(ID.BUSHIN_M2A, '大將'),
    '這隻寶可夢使用的招式，對對手的戰鬥寶可夢造成的傷害，依對手已經獲得的獎賞卡每1張「+30」點。');
  assert.strictEqual(abEffect(ID.SPIDER_6A, '複眼'),
    '這隻寶可夢使用的招式，對對手的戰鬥場的擁有特性的寶可夢造成的傷害「+50」點。');
  assert.strictEqual(abEffect(ID.MONKEY_SV10, '憤怒穴'),
    '若這隻寶可夢身上放置有2個以上的傷害指示物，則這隻寶可夢使用的招式，對對手的戰鬥寶可夢造成的傷害「+120」點。');
  assert.strictEqual(abEffect(ID.SNAKE, '激動力量'),
    '若自己的場上有【惡】屬性的「超級進化寶可夢【ex】」，則這隻寶可夢使用的招式，對對手的戰鬥寶可夢造成的傷害「+120」點。');
});
T('A2 全場型的 effect 逐字是「只要這隻寶可夢在場上，自己的…使用的招式」', () => {
  assert.strictEqual(abEffect(ID.ROSE, '輝煌聲援'),
    '只要這隻寶可夢在場上，自己的「竹蘭的寶可夢」使用的招式，對對手的戰鬥寶可夢造成的傷害「+30」點。');
  assert.strictEqual(abEffect(ID.SKIRT_SVM, '大晴天'),
    '只要這隻寶可夢在場上，自己的【草】或者【火】寶可夢使用的招式，對對手的戰鬥寶可夢造成的傷害「+20」點。');
  assert.strictEqual(abEffect(ID.SNORLAX, '大方'),
    '只要這隻寶可夢在場上，自己的「赫普的寶可夢」使用的招式，對對手的戰鬥寶可夢造成的傷害「+30」點。無論有多少隻擁有這個特性的寶可夢，這個效果也不會重複。');
});
T('A3 三組「同名不同印刷、其中一版沒印該特性」確實存在（bug 的前提）', () => {
  assert.deepStrictEqual(pool.get(ID.BUSHIN_MC).abilities ?? [], [], '仆斬將軍 MC 版竟然有特性');
  assert.strictEqual(pool.get(ID.BUSHIN_MC).name, pool.get(ID.BUSHIN_M2A).name);
  assert.deepStrictEqual((pool.get(ID.MONKEY_M5).abilities ?? []).map(a => a.name), ['不朽身軀']);
  assert.strictEqual(pool.get(ID.MONKEY_M5).name, pool.get(ID.MONKEY_SV10).name);
  assert.deepStrictEqual(pool.get(ID.SPIDER_W).abilities ?? [], []);
  assert.strictEqual(pool.get(ID.SPIDER_W).name, pool.get(ID.SPIDER_6A).name);
  assert.deepStrictEqual(pool.get(ID.SKIRT_11B).abilities ?? [], []);
});

// ══ B. 根因重現（BASE 必紅，各項各自紅）════════════════════════════════════
console.log('\n── B. 誤加成必須消失（HEAD-FAIL；各項各自紅）──');
T('B1 仆斬將軍【MC】肘擊：備戰有 M2a（大將）也只能 40（BASE = 100）', () => {
  const r = hit(mk({ active: I(ID.BUSHIN_MC, { energyAttached: [EN(ID.E_DARK)] }), bench: [I(ID.BUSHIN_M2A)] },
                   { active: I(ID.SERPERIOR) }, 4));
  assert.strictEqual(r.dmg, 40, '誤加成仍在\n' + r.logs);
  assert.ok(!/大將/.test(r.logs), 'log 仍出現「大將」啟動');
});
T('B2 棄世猴【M5】幽靈打擊：備戰有 SV10（憤怒穴）也只能 100（BASE = 220 直接 KO）', () => {
  const r = hit(mk({ active: I(ID.MONKEY_M5, { damage: 20, energyAttached: [EN(ID.E_PSY), EN(ID.E_PSY)] }), bench: [I(ID.MONKEY_SV10, { damage: 20 })] },
                   { active: I(ID.SERPERIOR), bench: [I(ID.PIDGEY)] }));
  assert.strictEqual(r.dmg, 100, '誤加成仍在\n' + r.logs);
  assert.ok(!/憤怒穴/.test(r.logs), 'log 仍出現「憤怒穴」啟動');
});
T('B3 電蜘蛛【SV11W】放電：備戰有 SV6a（複眼）也只能 50（BASE = 100）', () => {
  const r = hit(mk({ active: I(ID.SPIDER_W, { energyAttached: [EN(ID.E_LIGHT)] }), bench: [I(ID.SPIDER_6A)] },
                   { active: I(ID.SERPERIOR) }));
  assert.strictEqual(r.dmg, 50, '誤加成仍在\n' + r.logs);
});
T('B4 憤怒穴不在 NO_STACK：兩隻 SV10（都有指示物）以前會 +240，現在只 +120', () => {
  const r = hit(mk({ active: I(ID.MONKEY_SV10, { damage: 20, energyAttached: [EN(ID.E_FIGHT), EN(ID.E_FIGHT)] }), bench: [I(ID.MONKEY_SV10, { damage: 20 })] },
                   { active: I(ID.SERPERIOR) }));
  assert.strictEqual(r.dmg, 280, '衝擊打擊 160 + 憤怒穴 120 應為 280\n' + r.logs);
});
T('B5 中央閘單元：自指型持有者在備戰時，dispatch 不得產出加成', () => {
  const atk = I(ID.BUSHIN_MC), bench = I(ID.BUSHIN_M2A);
  const st = mk({ active: atk, bench: [bench] }, { active: I(ID.SERPERIOR) }, 4);
  const got = collectPassiveAttackBonuses(st, st.players[0], 0, atk, pool.get(ID.BUSHIN_MC), pool.get(ID.SERPERIOR), pool);
  assert.deepStrictEqual(got, [], '中央 dispatch 仍回傳加成：' + JSON.stringify(got));
});
T('B6 憤怒穴讀的是**持有者實體**，不是 state.players[i].active（引擎傳的是本地可變副本）', () => {
  // 引擎主管線的 `attacker` 是 `{ ...players[aIdx] }` 本地副本，ATTACK_PRE 期間可能與
  // workingState.players[aIdx] 分岔 ⇒ 卡面主詞「這隻寶可夢身上的指示物」必須讀 holderInst。
  const holder = I(ID.MONKEY_SV10, { damage: 20 });        // 持有者：2 個指示物
  const stale  = I(ID.MONKEY_SV10, { damage: 0 });         // state 內那份：0 個
  const st = mk({ active: stale }, { active: I(ID.SERPERIOR) });
  const attackerState = { ...st.players[0], active: holder, bench: [] };
  const got = collectPassiveAttackBonuses(st, attackerState, 0, holder, pool.get(ID.MONKEY_SV10), pool.get(ID.SERPERIOR), pool);
  assert.deepStrictEqual(got, [{ name: '憤怒穴', bonus: 120 }],
    '憤怒穴沒讀持有者實體的指示物：' + JSON.stringify(got));
});

// ══ C. 正對照（證明沒有把功能關掉）══════════════════════════════════════════
console.log('\n── C. 正對照：有印該特性的印刷自己攻擊時，加成照常生效 ──');
T('C1 仆斬將軍【M2a】自己攻擊：雙刃斬 180 + 大將 60 = 240', () => {
  const r = hit(mk({ active: I(ID.BUSHIN_M2A, { energyAttached: [EN('14434'), EN('14434')] }) },
                   { active: I(ID.SERPERIOR) }, 4));
  assert.strictEqual(r.dmg, 240, r.logs);
});
T('C2 棄世猴【SV10】自己攻擊（2 指示物）：衝擊打擊 160 + 憤怒穴 120 = 280', () => {
  const r = hit(mk({ active: I(ID.MONKEY_SV10, { damage: 20, energyAttached: [EN(ID.E_FIGHT), EN(ID.E_FIGHT)] }) },
                   { active: I(ID.SERPERIOR) }));
  assert.strictEqual(r.dmg, 280, r.logs);
});
T('C2b 棄世猴【SV10】只有 1 個指示物 ⇒ 憤怒穴不生效（讀的是持有者自己的指示物）', () => {
  const r = hit(mk({ active: I(ID.MONKEY_SV10, { damage: 10, energyAttached: [EN(ID.E_FIGHT), EN(ID.E_FIGHT)] }) },
                   { active: I(ID.SERPERIOR) }));
  assert.strictEqual(r.dmg, 160, r.logs);
});
T('C3 電蜘蛛【SV6a】自己攻擊，對「擁有特性」的對手：麻麻羅網 50 + 複眼 50 = 100', () => {
  const r = hit(mk({ active: I(ID.SPIDER_6A, { energyAttached: [EN(ID.E_GRASS), EN(ID.E_GRASS)] }) },
                   { active: I(ID.SERPERIOR) }));
  assert.strictEqual(r.dmg, 100, r.logs);
});
T('C4 飯匙蛇｜激動力量：場上有【惡】Mega ex ⇒ 漆黑之牙 120 + 120 = 240', () => {
  const base = hit(mk({ active: I(ID.SNAKE, { energyAttached: [EN(ID.E_DARK), EN(ID.E_DARK), EN(ID.E_DARK)] }) },
                      { active: I(ID.SERPERIOR) }));
  assert.strictEqual(base.dmg, 120, '【正對照】沒有 Mega ex 時應為 120\n' + base.logs);
  const r = hit(mk({ active: I(ID.SNAKE, { energyAttached: [EN(ID.E_DARK), EN(ID.E_DARK), EN(ID.E_DARK)] }), bench: [I(ID.ABSOL)] },
                   { active: I(ID.SERPERIOR) }));
  assert.strictEqual(r.dmg, 240, r.logs);
});
T('C5 全場型仍 per-holder 疊加：3 隻竹蘭的羅絲雷朵 ⇒ 綠葉舞步 80 + 90 = 170', () => {
  const one = hit(mk({ active: I(ID.ROSE, { energyAttached: [EN(ID.E_GRASS), EN(ID.E_GRASS), EN(ID.E_GRASS)] }) },
                     { active: I(ID.SERPERIOR) }));
  assert.strictEqual(one.dmg, 110, '1 隻應為 80+30\n' + one.logs);
  const three = hit(mk({ active: I(ID.ROSE, { energyAttached: [EN(ID.E_GRASS), EN(ID.E_GRASS), EN(ID.E_GRASS)] }), bench: [I(ID.ROSE), I(ID.ROSE)] },
                       { active: I(ID.SERPERIOR) }));
  assert.strictEqual(three.dmg, 170, '3 隻應為 80+90（疊加被這次修正弄壞了？）\n' + three.logs);
});
T('C6 ⭐全場型不受主詞閘影響：裙兒小姐【SV11B】（無大晴天）攻擊 + 備戰 SVM（有大晴天）⇒ 仍 +20', () => {
  const r = hit(mk({ active: I(ID.SKIRT_11B, { energyAttached: [EN(ID.E_GRASS), EN(ID.E_GRASS), EN(ID.E_GRASS)] }), bench: [I(ID.SKIRT_SVM)] },
                   { active: I(ID.SERPERIOR) }), 1);
  assert.strictEqual(r.dmg, 90, '居合斬 70 + 大晴天 20 應為 90（全場型被誤關）\n' + r.logs);
});
T('C7 大方仍 NO_STACK：2 隻赫普的卡比獸 ⇒ 極限壓制 140 + 30（不是 +60）', () => {
  const r = hit(mk({ active: I(ID.SNORLAX, { energyAttached: [EN(ID.E_DARK), EN(ID.E_DARK), EN(ID.E_DARK)] }), bench: [I(ID.SNORLAX)] },
                   { active: I(ID.SERPERIOR) }));
  assert.strictEqual(r.dmg, 170, r.logs);
});

// ══ D. 三個消費點行為端證明（中央述詞寫好 ≠ 消費點有接）════════════════════
console.log('\n── D. 三個消費點都真的接上中央 dispatch ──');
T('D1 engine.ts 主管線：君主蛇ex 在備戰 ⇒ 裙兒小姐 居合斬也吃到皇家聲援 +20', () => {
  const g3 = () => [EN(ID.E_GRASS), EN(ID.E_GRASS), EN(ID.E_GRASS)];
  const without = hit(mk({ active: I(ID.SKIRT_11B, { energyAttached: g3() }) }, { active: I(ID.SERPERIOR) }), 1);
  assert.strictEqual(without.dmg, 70, '【正對照】居合斬基礎應為 70\n' + without.logs);
  const withS = hit(mk({ active: I(ID.SKIRT_11B, { energyAttached: g3() }), bench: [I(ID.SERPERIOR)] }, { active: I(ID.SERPERIOR) }), 1);
  assert.strictEqual(withS.dmg, 90, '主管線沒接上中央 dispatch\n' + withS.logs);
});
T('D2 effects.ts applyAttackerActiveDamageBonuses（波動突刺走中央 helper）：力之鹽 +30', () => {
  const without = hit(mk({ active: I(ID.LUCARIO, { energyAttached: [EN(ID.E_FIGHT)] }) }, { active: I(ID.SERPERIOR) }));
  assert.strictEqual(without.dmg, 130, '【正對照】波動突刺基礎應為 130\n' + without.logs);
  const withSalt = hit(mk({ active: I(ID.LUCARIO, { energyAttached: [EN(ID.E_FIGHT)] }), bench: [I(ID.SALT)] }, { active: I(ID.SERPERIOR) }));
  assert.strictEqual(withSalt.dmg, 160, 'effects.ts 那份消費點沒接上中央 dispatch\n' + withSalt.logs);
});
T('D3 mega_decks.ts computeOliveOilBuff（油之機關槍）：皇家聲援 +20 有進到每個目標', () => {
  const run = bench => {
    const foe = I(ID.SERPERIOR);
    let st = mk({ active: I(ID.OLIVA, { energyAttached: [EN(ID.E_GRASS)] }), bench, deck: [I(ID.PIDGEY)] },
                { active: foe, bench: [], deck: [I(ID.PIDGEY)] });
    st = applyAction(st, { type: 'ATTACK', attackIndex: 0, actorIdx: 0 }, pool);
    assert.ok(st.pendingSelection, '油之機關槍沒開 picker（fixture 壞了）');
    st = applyAction(st, { type: 'RESOLVE_SELECTION', selectedIids: Array(6).fill(foe.iid), actorIdx: 0 }, pool);
    return st.players[1].active ? st.players[1].active.damage : Infinity;
  };
  //   ⚠ 卡面/實作語意：buff 對「每個目標」一次性套（不是每個指示物都加），見 regR('olive-oil-distribute')
  const a = run([]), b = run([I(ID.SERPERIOR)]);
  assert.strictEqual(a, 120, '【正對照】6×20 應為 120');
  assert.strictEqual(b, 140, 'mega_decks 那份消費點沒接上中央 dispatch（120 + 皇家聲援 20 = 140），實得 ' + b);
});

// ══ L. 靜態 lint（全部配正對照 + 下限斷言）═════════════════════════════════
console.log('\n── L. lint ──');
// ⭐v6.325 批2：區塊註解剝除改走中央 helper（scripts/lib/strip-comments.mjs 的行級狀態機）。
//   ⚠ 原本的 `/\/\*[\s\S]*?\*\//g` 會被**行註解裡的** `cards/*.ts` 這種字樣騙開假區塊：
//     effects.ts 有兩處（:27 的 `effects/cards/*.ts` 吃到 :147、:7905 的 `cards/*.ts` 吃到 :8203），
//     合計把 273 行真程式碼變成空白 ⇒ 掃在那段裡的違規一律靜默漏掉。
//   ⚠ 一律用**等長留白**版（不是刪行版）：本檔靠行號／位移回報，刪行會讓行號整體位移。
//   ⚠ 行尾 `//` 的處理**保留在這裡** —— 中央 helper 只剝行首 `//`，正向斷言目標若落在
//     行尾註解裡會假綠。行尾正則是單行、不跨行 ⇒ 不會像區塊正則那樣開洞。
//   ⛔ 本檔 L2 是**今天就存在的假綠**：`effects.ts:8125`（假區塊 :7905→:8203 之內）插一行
//      `const _dup = PASSIVE_ATTACK_BONUS.get("x");`，舊剝除器只數到 1 ⇒ 31 PASS / 0 FAIL、rc=0。
//      同一行插在 `:9000`（洞外）才數到 2 ⇒ 紅。遷移後兩處都紅。
const stripComments = (s, label = '') => stripCommentsBlankChecked(
  s.replace(/[​-‍﻿]/g, ''),                                   // 剝零寬（v6.117 教訓）
  { label },
).split('\n').map(l => l.split('//')[0]).join('\n');
/** 合成樣本專用：無護欄版（片段可能 100% 是註解，護欄①「整份吐空」偵測不適用）。 */
const stripSnippet = s => stripCommentsBlank(s.replace(/[​-‍﻿]/g, ''))
  .split('\n').map(l => l.split('//')[0]).join('\n');

/** 依卡面 effect 判「主詞是不是持有者本人」；回傳 'self' | 'field' | 'unknown' */
function classifySubject(effect) {
  if (!effect) return 'unknown';
  if (effect.includes('這隻寶可夢使用的招式')) return 'self';      // ⚠ 必須先判 self：
  if (effect.includes('自己的') && effect.includes('使用的招式')) return 'field'; //   激動力量兩者都含
  return 'unknown';
}
T('L0【正對照】主詞分類器餵合成樣本必須分對（否則它只是安慰劑）', () => {
  assert.strictEqual(classifySubject('這隻寶可夢使用的招式，對對手的戰鬥寶可夢造成的傷害「+30」點。'), 'self');
  assert.strictEqual(classifySubject('若自己的場上有X，則這隻寶可夢使用的招式，造成的傷害「+120」點。'), 'self',
    '「自己的…則這隻寶可夢使用的招式」必須判 self（激動力量型）');
  assert.strictEqual(classifySubject('只要這隻寶可夢在場上，自己的【草】寶可夢使用的招式，造成的傷害「+20」點。'), 'field');
  assert.strictEqual(classifySubject('這隻寶可夢不會受到對手的寶可夢特性效果的影響。'), 'unknown');
});
T('L1 每個 PASSIVE_ATTACK_BONUS 條目的「卡面主詞」與 PASSIVE_ATTACK_SELF_SUBJECT 一致', () => {
  const names = [...PASSIVE_ATTACK_BONUS.keys()];
  // ⭐v6.325：下限自 12 收緊到 12（實測 12；已在實測值上、slack 0）。
  assert.ok(names.length >= 12, `下限失敗：只註冊了 ${names.length} 個被動加成（預期 ≥12）— 掃描器/註冊壞了？`);
  // 從卡池撈每個特性名的 effect（同名多印刷時 effect 必須一致，否則這裡也要紅）
  const effByAb = new Map();
  for (const c of pool.values()) {
    if (!['H', 'I', 'J'].includes(c.regulationMark)) continue;
    for (const a of (c.abilities ?? [])) {
      if (!names.includes(a.name)) continue;
      if (!effByAb.has(a.name)) effByAb.set(a.name, new Set());
      effByAb.get(a.name).add(a.effect);
    }
  }
  const problems = [];
  for (const n of names) {
    const effs = effByAb.get(n);
    if (!effs) { problems.push(`${n}：卡池找不到這個特性（死條目？卡名/特性名打錯？）`); continue; }
    // 同名特性可能有措辭變體（例：鈷藍指令「鐵頭殼ex」vs「鐵頭殼【ex】」）——
    // 允許變體，但**每個變體的主詞分類必須一致**，否則要人工逐張重判。
    const kinds = new Set([...effs].map(classifySubject));
    if (kinds.size > 1) { problems.push(`${n}：不同印刷的 effect 主詞分類不一致（${[...kinds].join('/')}）⇒ 逐張重判`); continue; }
    const kind = [...kinds][0];
    if (kind === 'unknown') { problems.push(`${n}：分類器判不出主詞 ⇒ 人工判定並更新分類器/白名單`); continue; }
    const declared = PASSIVE_ATTACK_SELF_SUBJECT.has(n);
    if (kind === 'self' && !declared) problems.push(`${n}：卡面是「這隻寶可夢使用的招式」⇒ 必須列入 PASSIVE_ATTACK_SELF_SUBJECT`);
    if (kind === 'field' && declared) problems.push(`${n}：卡面是「自己的…使用的招式」（全場型）⇒ 不可列入 PASSIVE_ATTACK_SELF_SUBJECT`);
  }
  assert.deepStrictEqual(problems, [], '\n  ' + problems.join('\n  ') + '\n');
});
T('L1b PASSIVE_ATTACK_SELF_SUBJECT 不得有死條目（每一條都要有 producer）', () => {
  const dead = [...PASSIVE_ATTACK_SELF_SUBJECT].filter(n => !PASSIVE_ATTACK_BONUS.has(n));
  assert.deepStrictEqual(dead, [], '死條目：' + dead.join(','));
  assert.ok(PASSIVE_ATTACK_SELF_SUBJECT.size === 4,
    `自指型應為 4 個（大將/複眼/憤怒穴/激動力量），實得 ${PASSIVE_ATTACK_SELF_SUBJECT.size}`);
});
// ── L2：唯一 dispatch（消費點不得自己再寫一份迴圈）─────────────────────────
const srcFiles = [];
(function walk(p) {
  for (const e of readdirSync(p)) {
    if (e === 'node_modules' || e === '.git') continue;
    const q = join(p, e);
    if (statSync(q).isDirectory()) walk(q);
    else if (/\.(ts|svelte)$/.test(e)) srcFiles.push(q);
  }
})(join(ROOT, 'src'));
const countGet = (text, label = '') => (stripComments(text, label).match(/PASSIVE_ATTACK_BONUS\s*\.\s*get\s*\(/g) || []).length;
const countGetSnippet = text => (stripSnippet(text).match(/PASSIVE_ATTACK_BONUS\s*\.\s*get\s*\(/g) || []).length;
T('L2【正對照】`.get(` 掃描器餵合成違規樣本必須抓到', () => {
  assert.strictEqual(countGetSnippet('const fn = PASSIVE_ATTACK_BONUS.get(ab.name);'), 1);
  assert.strictEqual(countGetSnippet('// const fn = PASSIVE_ATTACK_BONUS.get(ab.name);'), 0, '註解沒被剝掉');
  assert.strictEqual(countGetSnippet('a\nPASSIVE_ATTACK_BONUS.get(x)\nPASSIVE_ATTACK_BONUS .get( y )'), 2);
  // ⭐v6.325【洞內正對照】：把違規樣本放在「行註解提到 cards/*.ts」之後 —— 舊的區塊正則
  //   會從那個 `/*` 一路吃到下一個 `*/`，違規行整段消失（=今天 L2 的假綠成因）。
  assert.strictEqual(countGetSnippet(
    '// 見 effects/cards/*.ts\nconst fn = PASSIVE_ATTACK_BONUS.get(ab.name);\n/* 收尾 */\n'), 1,
    '行註解裡的 `cards/*.ts` 又把後面的真程式碼吃掉了（第 13 種安慰劑回歸）');
});
T('L2 全站 `PASSIVE_ATTACK_BONUS.get(` 只出現在 collectPassiveAttackBonuses 內', () => {
  // ⭐v6.325：下限自 100 收緊到 193（實測 194）。
  assert.ok(srcFiles.length >= 193, `掃描器下限失敗：只找到 ${srcFiles.length} 個原始檔`);
  const sites = [];
  for (const p of srcFiles) {
    const n = countGet(readFileSync(p, 'utf8'), relative(ROOT, p).replace(/\\/g, '/'));
    if (n > 0) sites.push([relative(ROOT, p).replace(/\\/g, '/'), n]);
  }
  assert.deepStrictEqual(sites, [['src/lib/game/effects.ts', 1]],
    'dispatch 不再唯一：' + JSON.stringify(sites));
  // 錨點：那一處必須在 collectPassiveAttackBonuses 的函式體內
  const lines = stripComments(readFileSync(join(ROOT, 'src/lib/game/effects.ts'), 'utf8')).split('\n');
  const start = lines.findIndex(l => l.includes('export function collectPassiveAttackBonuses'));
  assert.ok(start > 0, '找不到中央 dispatch ⇒ 錨點失效');
  const end = lines.findIndex((l, i) => i > start && /^\}/.test(l));
  assert.ok(end > start && end - start < 60, `函式界線異常（${start}→${end}）`);
  const at = lines.findIndex(l => /PASSIVE_ATTACK_BONUS\s*\.\s*get\s*\(/.test(l));
  assert.ok(at > start && at < end, `.get( 在函式外（行 ${at + 1}，函式 ${start + 1}~${end + 1}）`);
  // 主詞閘必須在同一個函式體內
  const gateAt = lines.findIndex(l => l.includes('PASSIVE_ATTACK_SELF_SUBJECT.has('));
  assert.ok(gateAt > start && gateAt < end, '主詞閘不在中央 dispatch 內');
});
T('L3 三個消費點都呼叫中央 dispatch（少一個就是漏接）', () => {
  const want = ['src/lib/game/engine.ts', 'src/lib/game/effects.ts', 'src/lib/game/effects/cards/mega_decks.ts'];
  const got = srcFiles
    .filter(p => /collectPassiveAttackBonuses\s*\(/.test(stripComments(readFileSync(p, 'utf8'), relative(ROOT, p).replace(/\\/g, '/'))))
    .map(p => relative(ROOT, p).replace(/\\/g, '/')).sort();
  assert.deepStrictEqual(got, [...want].sort(), '呼叫端清單不符：' + JSON.stringify(got));
});

// ══ W. v6.257 lint 白名單的「行為端」證明（不可只有文字理由）═══════════════
//   v6.257 就是因為白名單條目的文字理由推論錯誤而讓真 bug 合法通過 ⇒ 每一條都要有實跑證據。
console.log('\n── W. v6.257 白名單條目的行為端證明 ──');
const findId = (name, pred) => { for (const [id, c] of pool) if (c.name === name && ['H','I','J'].includes(c.regulationMark) && (!pred || pred(c))) return id; return null; };
T('W1 電氣球：卡面條件是**卡名**「皮卡丘【ex】」⇒ 無特性的印刷附上也要 +50', () => {
  const ball = findId('電氣球');
  assert.strictEqual(pool.get(ball).rulesText,
    '附有這張卡的「皮卡丘【ex】」使用的招式，對對手的戰鬥場的「寶可夢【ex】」造成的傷害「+50」點。');
  const noAb = findId('皮卡丘ex', c => (c.abilities ?? []).length === 0);
  const withAb = findId('皮卡丘ex', c => (c.abilities ?? []).some(a => a.name === '勤奮之心'));
  assert.ok(noAb && withAb, '找不到「有特性 / 無特性」兩種皮卡丘ex 印刷');
  const EBY = { Grass: ID.E_GRASS, Lightning: ID.E_LIGHT, Metal: '14434', Fighting: ID.E_FIGHT,
                Psychic: ID.E_PSY, Darkness: ID.E_DARK, Colorless: ID.E_GRASS };
  const shoot = (pid, tool) => {
    const cost = pool.get(pid).attacks[0].cost;
    const inst = I(pid, { energyAttached: cost.map(c => EN(EBY[c] ?? ID.E_GRASS)),
                          ...(tool ? { toolAttached: I(ball) } : {}) });
    return hit(mk({ active: inst }, { active: I(ID.SERPERIOR) }));
  };
  for (const pid of [noAb, withAb]) {
    const a = shoot(pid, false), b = shoot(pid, true);
    assert.ok(!/電氣球/.test(a.logs), `【正對照】沒附道具卻出現電氣球 log（${pid}）`);
    assert.ok(/電氣球.*\+50/.test(b.logs), `皮卡丘ex ${pid}（abilities=${JSON.stringify((pool.get(pid).abilities ?? []).map(x => x.name))}）附電氣球沒 +50\n${b.logs}`);
  }
});
T('W2 大力鱷：沒印「奔流之心」的印刷不得出現特性按鈕（by-name fallback 不會誤放行）', () => {
  const noAb = findId('大力鱷', c => (c.abilities ?? []).length === 0);
  const withAb = findId('大力鱷', c => (c.abilities ?? []).some(a => a.name === '奔流之心'));
  assert.ok(noAb && withAb, '找不到兩種大力鱷印刷');
  const usable = pid => {
    const inst = I(pid);
    const st = mk({ active: inst, deck: [I(ID.PIDGEY), I(ID.PIDGEY)] }, { active: I(ID.SERPERIOR) });
    return (getUsableAbilities(st, pool) ?? []).filter(u => u.iid === inst.iid).map(u => u.abilityName);
  };
  assert.ok(!usable(noAb).includes('奔流之心'), '沒印該特性的印刷竟然出現按鈕');
  assert.ok(usable(withAb).includes('奔流之心'), '【正對照】有印該特性的印刷竟然沒有按鈕（守衛失去鑑別力）');
});
T('W3 願增猿ex｜鬆口氣：條件是**卡名**「桃歹郎ex」（PASSIVE_ON_KO）⇒ 非 ex 的「桃歹郎」不算', () => {
  const ape = findId('願增猿ex', c => (c.abilities ?? []).some(a => a.name === '鬆口氣'));
  const tox = findId('桃歹郎ex');
  const nonEx = findId('桃歹郎', c => c.subtype !== 'ex');
  assert.ok(ape && tox && nonEx, '找不到 願增猿ex / 桃歹郎ex / 桃歹郎');
  assert.notStrictEqual(pool.get(tox).subtype, pool.get(nonEx).subtype, 'fixture 壞了：兩張 subtype 相同');
  // 願增猿ex（HP210・弱點【鬥】×2）被 超級路卡利歐ex 超級勇氣 270×2 KO ⇒ 對手拿 2 張獎賞；
  // 場上有「桃歹郎ex」時 claw-back 1 張 ⇒ 只拿到 1 張。
  const prizesTakenWith = benchId => {
    const st = mk({ active: I(ID.LUCARIO, { energyAttached: [EN(ID.E_FIGHT), EN(ID.E_FIGHT)] }) },
                  { active: I(ape), bench: [I(benchId), I(ID.PIDGEY)], deck: [I(ID.PIDGEY)] });
    const after = applyAction(st, { type: 'ATTACK', attackIndex: 1, actorIdx: 0 }, pool);
    return 6 - after.players[0].prizes.length;
  };
  const withEx = prizesTakenWith(tox), withNonEx = prizesTakenWith(nonEx);
  assert.strictEqual(withNonEx, 2, '【正對照】非 ex 的桃歹郎不該觸發鬆口氣（應拿滿 2 張），實得 ' + withNonEx);
  assert.strictEqual(withEx, 1, '場上有桃歹郎ex 時獎賞應 -1，實得 ' + withEx);
});
T('W4 爆炸頭水牛｜捲牆：夥伴依**卡名**計數（SV8 無特性版也算），但至少要有 1 隻有效持有者', () => {
  const withAb = findId('爆炸頭水牛', c => (c.abilities ?? []).some(a => a.name === '捲牆'));
  const noAb = findId('爆炸頭水牛', c => (c.abilities ?? []).length === 0);
  assert.ok(withAb && noAb, '找不到「有捲牆 / 無捲牆」兩種爆炸頭水牛印刷');
  //   ⚠ 攻擊必須打不死（爆炸頭水牛 HP 100 / SV8 版 130）：用居合斬 70。
  const takeHit = (activeId, benchIds) => {
    const st = mk({ active: I(ID.SKIRT_11B, { energyAttached: [EN(ID.E_GRASS), EN(ID.E_GRASS), EN(ID.E_GRASS)] }) },
                  { active: I(activeId), bench: benchIds.map(x => I(x)) });
    return hit(st, 1).dmg;
  };
  const solo = takeHit(withAb, []);                 // 只有 1 隻 ⇒ 不成立
  const pair = takeHit(withAb, [noAb]);             // 持有者 + 無特性同名夥伴 ⇒ -60
  const bothNoAb = takeHit(noAb, [noAb]);           // 兩隻都沒特性 ⇒ 不成立
  assert.strictEqual(solo - pair, 60, `夥伴依卡名計數失效（solo=${solo} pair=${pair}）`);
  assert.strictEqual(bothNoAb, solo, `兩隻都沒印捲牆卻減傷了（${bothNoAb} vs ${solo}）`);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log(`\nv6.258 被動加成主詞守衛：PASS ${pass} / FAIL ${fails.length}`);
if (fails.length) { for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
