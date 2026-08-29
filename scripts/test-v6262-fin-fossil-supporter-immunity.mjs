// ⭐⭐⭐ v6.262 守衛：陳舊的鰭之化石｜鰭之守護 —— 支援者免疫的**範圍**（兩個方向都改了）。
//
// 卡面逐字（唯一權威＝`static/cards` 台灣官方卡面）：
//   陳舊的鰭之化石（M3 069/080，J，Trainer/Item，id=18046）
//     ⚠⚠ 那句免疫在 **abilities[0]＝特性「鰭之守護」的 effect**，**不在 rulesText**。
//        「對手從手牌使出支援者卡時，這隻寶可夢不會受到那個效果的影響。」
//        （scripts/test-v6251 的舊註解寫「現行卡面沒有那句」是**錯的**，v6.262 已更正。）
//     rulesText 是另一段：「這張卡可作為HP60的【無】屬性的【基礎】寶可夢放置於場上。
//        這張卡不會陷入特殊狀態，無法撤退。\n若在自己的回合中，則可將場上的這張卡丟棄。」
//
// v6.262 修了三個缺口（全部行為端實測出來的）：
//   【1】鏽蝕組手下（J）漏免疫 —— 化石是唯一候選時能量照樣被丟。
//   【2】古歷（J）漏免疫 —— 雙方全體回 50HP 時，對手的化石也被回血。
//        ⭐ 站長裁定「要擋（依卡面全稱）」：卡面沒有「有利／不利」的概念。
//   【3】**反向過度**免疫 —— 九尾｜靈怪變化、魔牆人偶｜相仿秀 是
//        「將那個效果**作為這個招式的效果**使用」，**不是**「從手牌使出支援者卡」
//        ⇒ 這兩條路徑不該套用免疫（化石變成可以被它們拉出來）。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.v6262-s.js'), E = join(ROOT, '.v6262-e.ts'), O = join(ROOT, '.v6262-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* noop */ } } });
writeFileSync(S, 'export const base="";');
writeFileSync(E,
  "export { applyAction } from './src/lib/game/engine';\n"
  + "export { TRAINER_EFFECTS, TRAINER_GUARDS, ATTACK_POST } from './src/lib/game/effects';\n"
  + "export { isImmuneToOppSupporter } from './src/lib/game/effects/cards/v3080_deferred_wave_c';\n"
  + "export { getSupporterEffectSource, runAsCopiedSupporterEffect } from './src/lib/game/supporter-effect-source';\n"
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

let pass = 0, fail = 0;
// ⚠ 突變測試紀律：只有 `assert.AssertionError` 才算「守衛真的抓到」。
//   其他例外（TypeError/ReferenceError…）是**程式崩了**，那不等於守衛有測到這件事 —— 分開標示。
const T = (n, f) => {
  try { f(); console.log('  OK  ', n); pass++; }
  catch (e) {
    const kind = (e instanceof assert.AssertionError) ? 'FAIL' : 'CRASH';
    console.log(`  ${kind}`, n, '::', e.message);
    fail++;
  }
};
const ok = (c, m) => assert.ok(c, m);
const byName = (n) => { for (const c of pool.values()) if (c.name === n) return c; return null; };

// ── 卡片 id（全部逐字從 static/cards 查得，禁憑印象）──────────────────────
const FIN = '18046';                       // 陳舊的鰭之化石（Item / J）
const GUST = byName('老大的指令');
const LUCIA = byName('琉琪亞的展示');
const SAKAKI = byName('火箭隊的坂木');
const CREEPY = byName('可怕的哥哥');
const RUST = byName('鏽蝕組手下');
const OLDREC = byName('古歷');
const NINETALES = byName('九尾');
const MRMIME = byName('魔牆人偶');
const CRUSH = byName('粉碎之錘');           // 非支援者（Item）正對照

let nn = 0;
const inst = (cid, e = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], ...e });
const pick = (pred) => { for (const c of pool.values()) if (pred(c)) return String(c.id); return null; };
const BASIC = pick(c => c.supertype === 'Pokemon' && c.stage === 'Basic' && !c.evolvesFrom
  && c.subtype !== 'ex' && (c.hp | 0) >= 100 && c.regulationMark === 'H');
const WATER = pick(c => c.supertype === 'Energy' && c.subtype === 'Basic' && c.name === '基本【水】能量');
const SPEC = pick(c => c.supertype === 'Energy' && c.subtype === 'Special');
const TOOL = pick(c => c.supertype === 'Trainer' && c.subtype === 'PokemonTool');
const ITEM = pick(c => c.supertype === 'Trainer' && c.subtype === 'Item' && c.name !== '陳舊的鰭之化石');

console.log('① 卡面逐字複驗（特性讀 abilities[].effect，訓練家讀 rulesText —— 禁只讀一邊）');

T('陳舊的鰭之化石：live 印刷剛好 1 張（M3 069/080，J，Trainer/Item）', () => {
  const all = [...pool.values()].filter(c => c.name === '陳舊的鰭之化石');
  ok(all.length === 1, `印刷張數應為 1，實得 ${all.length}`);
  const c = all[0];
  ok(String(c.id) === FIN && c.setCode === 'M3' && c.collectorNumber === '069/080', JSON.stringify(c.id));
  ok(c.regulationMark === 'J' && c.supertype === 'Trainer' && c.subtype === 'Item', 'J / Trainer / Item');
});

T('⭐⭐ 免疫那句在特性「鰭之守護」的 effect，**不在 rulesText**（逐字）', () => {
  const c = pool.get(FIN);
  const ab = (c.abilities || [])[0];
  ok(ab && ab.label === '特性' && ab.name === '鰭之守護', '找不到特性「鰭之守護」');
  ok(ab.effect === '對手從手牌使出支援者卡時，這隻寶可夢不會受到那個效果的影響。',
    '鰭之守護 effect 逐字不符：' + ab.effect);
  ok(!/支援者/.test(c.rulesText), 'rulesText 不該提到支援者（只讀 rulesText 會得到相反結論）');
  ok(c.rulesText.includes('這張卡不會陷入特殊狀態，無法撤退。'), c.rulesText);
});

T('⭐⭐⭐ 四個「對支援者免疫」的來源，卡面**全部**逐字寫「對手從手牌使出」', () => {
  const cases = [
    ['陳舊的鰭之化石', '鰭之守護'], ['斧牙龍', '緊張感'],
    ['浩大鯨ex', '融合為雪'], ['超甲狂犀', '廣域堡壘'],
  ];
  for (const [cn, an] of cases) {
    const hit = [...pool.values()].find(c => c.name === cn && (c.abilities || []).some(a => a.name === an));
    ok(hit, `找不到 ${cn}｜${an}`);
    const ab = hit.abilities.find(a => a.name === an);
    ok(ab.effect.includes('對手從手牌使出'), `${cn}｜${an} 卡面沒有「對手從手牌使出」：${ab.effect}`);
    ok(ab.effect.includes('支援者卡'), `${cn}｜${an}：${ab.effect}`);
  }
});

T('九尾｜靈怪變化 與 魔牆人偶｜相仿秀 卡面逐字＝「作為這個招式的效果使用」（非從手牌使出）', () => {
  const a1 = (NINETALES.attacks || []).find(a => a.name === '靈怪變化');
  ok(a1 && a1.effect === '將自己的牌庫上方1張卡丟棄，若那張卡為支援者卡，則將那個效果作為這個招式的效果使用。', a1 && a1.effect);
  const a2 = (MRMIME.attacks || []).find(a => a.name === '相仿秀');
  ok(a2 && a2.effect === '查看對手的手牌。若希望，選擇1張其中的支援者卡，將那個效果作為這個招式的效果使用。', a2 && a2.effect);
  for (const e of [a1.effect, a2.effect]) ok(!/從手牌使出/.test(e), '卡面沒有「從手牌使出」⇒ 四個免疫的前提不成立');
});

T('鏽蝕組手下／古歷 卡面逐字', () => {
  ok(RUST && RUST.regulationMark === 'J' && RUST.subtype === 'Supporter', '鏽蝕組手下');
  ok(RUST.rulesText.includes('選擇1個對手的場上寶可夢身上附加的能量，將其丟棄。'), RUST.rulesText);
  ok(OLDREC && OLDREC.regulationMark === 'J' && OLDREC.subtype === 'Supporter', '古歷');
  ok(OLDREC.rulesText === '將雙方的所有寶可夢各恢復「50」HP。', OLDREC.rulesText);
  ok(!/有利|不利/.test(OLDREC.rulesText), '⚠ 卡面沒有「有利／不利」的概念，實作端也不准加');
});

// ── 盤面 fixture ───────────────────────────────────────────────────────────
const mkFossil = (e = {}) => inst(FIN, { fossilOnField: true, damage: 30,
  energyAttached: [inst(WATER), inst(SPEC)], toolAttached: inst(TOOL), ...e });
const deckOf = () => Array.from({ length: 20 }, () => inst(BASIC));
const prizeSet = () => Array.from({ length: 6 }, () => inst(BASIC));
function mk(p0 = {}, p1 = {}, extra = {}) {
  const st = {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
    isFirstTurn: false, log: [], setupDone: [true, true], pendingMulliganDraw: [0, 0],
    pendingPrizes: [0, 0], pendingSelection: null, activeStadium: null,
    supporterUsedThisTurn: [false, false], supporterTagsUsedThisTurn: { p1: [], p2: [] },
    oppAttackKOdMeInLastOppTurn: [1, 1], oppAbilityKOdMeInLastOppTurn: [1, 1],
    players: [
      { name: 'P1', active: null, bench: [], hand: [], deck: deckOf(), discard: [], prizes: prizeSet(), ...p0 },
      { name: 'P2', active: null, bench: [], hand: [], deck: deckOf(), discard: [], prizes: prizeSet(), ...p1 },
    ],
    ...extra,
  };
  return st;
}
/** 化石現在在哪、身上還有什麼（找不到＝gone）。 */
function snap(st, fiid) {
  for (let pi = 0; pi < 2; pi++) {
    const p = st.players[pi];
    const zones = [['active', p.active ? [p.active] : []], ['bench', p.bench], ['hand', p.hand],
                   ['deck', p.deck], ['discard', p.discard], ['prizes', p.prizes]];
    for (const [z, arr] of zones) for (const c of (arr || [])) if (c && c.iid === fiid) {
      return { pi, z, damage: c.damage, en: (c.energyAttached || []).length,
        tool: c.toolAttached ? 1 : 0, extra: (c.extraTools || []).length,
        status: c.status ?? null, sec: c.secondaryStatus ?? null, ter: c.tertiaryStatus ?? null };
    }
  }
  return { gone: true };
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const texts = (st) => st.log.map(l => String(l?.message ?? l?.text ?? l));

console.log('\n② ⭐⭐⭐ 枚舉守衛：live H/I/J 支援者 × 化石在備戰／戰鬥 × 三種 picker 優先序');

// ⚠⚠ Rule 25：**探測器自身要先被驗證會不會漏**。
//   第二段 picker 常常沒有 validIids（鏽蝕組手下的 active-energy-discard 只帶 targetIid），
//   若一律優先送「化石本體 iid」，能量永遠選不中 → 假 PASS（我第一版就是這樣漏掉【1】的）。
//   ⇒ 每張卡跑 3 種優先序（本體 / 能量 / 道具）取聯集。
const ORDERS = ['self', 'energy', 'tool'];
const HIJ = new Set(['H', 'I', 'J']);
const SUPS = [];
{
  const seen = new Set();
  for (const c of pool.values()) {
    if (c.supertype !== 'Trainer' || c.subtype !== 'Supporter') continue;
    if (!HIJ.has(c.regulationMark) || seen.has(c.name)) continue;
    seen.add(c.name); SUPS.push(c);
  }
  SUPS.sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function runSupporter(card, layout, order) {
  const fossil = mkFossil();
  const supIid = inst(card.id);
  const other = inst(BASIC, { damage: 40, energyAttached: [inst(WATER), inst(SPEC)], toolAttached: inst(TOOL) });
  const st = mk(
    { active: inst(BASIC, { damage: 30, energyAttached: [inst(WATER), inst(WATER)] }),
      bench: [inst(BASIC, { damage: 20, energyAttached: [inst(WATER)] })],
      hand: [supIid, inst(ITEM), inst(ITEM), inst(ITEM)],
      discard: [inst(BASIC), inst(ITEM), inst(WATER)] },
    { active: layout === 'active' ? fossil : other,
      bench: layout === 'active' ? [other] : [fossil],
      hand: [inst(ITEM), inst(BASIC)], discard: [inst(BASIC), inst(WATER)] });
  const before = snap(st, fossil.iid);
  const selfI = [fossil.iid], enI = fossil.energyAttached.map(e => e.iid), toolI = [fossil.toolAttached.iid];
  const pri = order === 'self' ? [...selfI, ...enI, ...toolI]
            : order === 'energy' ? [...enI, ...toolI, ...selfI]
            : [...toolI, ...enI, ...selfI];
  let out = st, err = null; const seenValid = [];
  const rnd = Math.random; Math.random = () => 0.1;   // 全部正面（擲幣型也走到效果）
  try {
    out = M.applyAction(st, { type: 'PLAY_TRAINER', iid: supIid.iid }, pool);
    let g = 0;
    while (out && out.pendingSelection && g++ < 12) {
      const ps = out.pendingSelection;
      const valid = (ps.params && ps.params.validIids) || null;
      seenValid.push(valid);
      let sel = pri.filter(i => !valid || valid.includes(i));
      if (sel.length === 0 && valid && valid.length > 0) sel = [valid[0]];
      sel = sel.slice(0, Math.max(0, ps.maxCount ?? 1));
      const nxt = M.applyAction(out, { type: 'RESOLVE_SELECTION', selectedIids: sel }, pool);
      if (nxt === out || !nxt) break;
      out = nxt;
    }
  } catch (e) { err = e.message; }
  Math.random = rnd;
  return { fossil, before, after: snap(out || st, fossil.iid), out: out || st, err, seenValid };
}

const touched = new Map();   // 卡名 → [{layout, order, before, after}]
let _runs = 0;
for (const c of SUPS) for (const layout of ['bench', 'active']) for (const order of ORDERS) {
  const r = runSupporter(c, layout, order);
  _runs++;
  if (r.err) throw new Error(`${c.name}/${layout}/${order} 丟例外：${r.err}`);
  if (eq(r.before, r.after)) continue;
  if (!touched.has(c.name)) touched.set(c.name, []);
  touched.get(c.name).push({ layout, order, before: r.before, after: r.after });
}

T(`⚠ 掃描器下限斷言：live H/I/J 支援者 ${SUPS.length} 張、實跑 ${_runs} 次`, () => {
  ok(SUPS.length >= 80, `只枚舉到 ${SUPS.length} 張支援者 —— 枚舉器壞了？`);
  ok(_runs === SUPS.length * 2 * 3, `實跑 ${_runs} 次，應為 ${SUPS.length * 2 * 3}`);
  for (const c of SUPS) ok(M.TRAINER_EFFECTS.has(c.name), `${c.name} 沒有 TRAINER_EFFECTS ⇒ 這一輪等於沒測到它`);
});

T('⭐⭐⭐ 只有經站長裁定的白名單會動到化石（其餘 H/I/J 支援者一律零改動）', () => {
  const names = [...touched.keys()].sort();
  console.log('        實際動到化石的：', names.join('、') || '(無)');
  for (const [n, rows] of touched) {
    console.log(`        · ${n}:`, rows.map(r => `${r.layout}/${r.order} ${JSON.stringify(r.before)}→${JSON.stringify(r.after)}`).join(' | '));
  }
  ok(eq(names, ['琉琪亞的展示', '老大的指令'].sort()),
    '白名單以外的支援者動到了化石（或白名單卡不再動它）：' + names.join('、'));
});

// ⚠⚠ 白名單的**行為端證明**（不是文字理由）：
//   老大的指令／琉琪亞的展示 的 picker **候選裡沒有化石**（＝化石不是效果的目標，
//   免疫有生效）；化石之所以離開戰鬥場，是因為玩家指定的是**對手備戰的另一隻**，
//   那一隻被呼叫上場，戰鬥場的化石被換下來 —— C-05 換位語意
//   （reference-c05-swap-target-immunity-v5995 ＋ PTCG_RULES.md §17.3.D）。
for (const nm of ['老大的指令', '琉琪亞的展示']) {
  T(`⭐⭐ 白名單行為端證明：${nm} 的候選**不含**化石，化石只是被「換下場」的一方`, () => {
    const rows = touched.get(nm);
    ok(rows && rows.length === 3, `${nm} 應只在「化石在戰鬥場」時被記到（3 種優先序各一）`);
    ok(rows.every(r => r.layout === 'active'), `${nm} 在化石**備戰**時就不該動到它：` + JSON.stringify(rows));
    ok(rows.every(r => r.before.z === 'active' && r.after.z === 'bench'),
      `${nm} 對化石的唯一改動必須是「戰鬥場→備戰」：` + JSON.stringify(rows));
    ok(rows.every(r => r.before.damage === r.after.damage && r.before.en === r.after.en
      && r.before.tool === r.after.tool), `${nm} 不該改到化石的傷害／能量／道具`);
    // 行為端證明：picker 的 validIids 不含化石 iid
    const r = runSupporter(byName(nm), 'active', 'self');
    const v = r.seenValid.find(x => Array.isArray(x));
    ok(v && v.length > 0, `${nm} 沒開出帶 validIids 的 picker，證明不成立`);
    ok(!v.includes(r.fossil.iid), `${nm} 的候選**含**化石 iid ⇒ 免疫沒生效：` + JSON.stringify(v));
  });
  T(`⭐ 反面對照：${nm} 在化石**備戰**（唯一備戰）時完全不能指定它`, () => {
    const fossil = mkFossil();
    const st = mk({ active: inst(BASIC), hand: [inst(byName(nm).id)] },
                  { active: inst(BASIC), bench: [fossil] });
    ok(M.TRAINER_GUARDS.get(nm)(st, 0, pool) === false, `${nm} 的 gate 應為 false（唯一備戰是免疫的化石）`);
  });
}

console.log('\n③ 缺口【1】鏽蝕組手下（J）—— 化石的能量不可以被丟');

function rustState(onlyFossil) {
  const fossil = mkFossil({ energyAttached: [inst(WATER)] });
  const st = mk({ active: inst(BASIC, { energyAttached: [inst(WATER)] }), hand: [inst(RUST.id)] },
                { active: onlyFossil ? fossil : inst(BASIC, { energyAttached: [inst(WATER)] }),
                  bench: onlyFossil ? [] : [fossil] });
  return { st, fossil };
}
T('gate：對手場上只有免疫的化石帶能量 → 鏽蝕組手下不能使用（判準①/Rule 26a）', () => {
  const { st } = rustState(true);
  ok(M.TRAINER_GUARDS.get('鏽蝕組手下')(st, 0, pool) === false, 'gate 應為 false');
});
T('⭐ 行為端：化石是唯一候選時，picker 不該開、能量不可被丟', () => {
  const { st, fossil } = rustState(true);
  const out = M.applyAction(st, { type: 'PLAY_TRAINER', iid: st.players[0].hand[0].iid }, pool);
  const f = out.players[1].active;
  ok(f && f.iid === fossil.iid && f.energyAttached.length === 1, '化石的能量被丟掉了！');
  ok(!out.pendingSelection || !((out.pendingSelection.params?.validIids) || []).includes(fossil.iid),
    'picker 候選含化石');
});
T('⭐ 行為端：對手還有別隻時，picker 候選**不含**化石（只含那一隻）', () => {
  const { st, fossil } = rustState(false);
  const out = M.applyAction(st, { type: 'PLAY_TRAINER', iid: st.players[0].hand[0].iid }, pool);
  const v = out.pendingSelection?.params?.validIids || [];
  ok(v.length === 1 && !v.includes(fossil.iid), '候選應只有非化石那一隻：' + JSON.stringify(v));
});
T('正對照：對手是普通寶可夢時，鏽蝕組手下照常丟掉 1 個能量（沒有被改壞）', () => {
  const target = inst(BASIC, { energyAttached: [inst(WATER), inst(WATER)] });
  const st = mk({ active: inst(BASIC), hand: [inst(RUST.id)] }, { active: target });
  ok(M.TRAINER_GUARDS.get('鏽蝕組手下')(st, 0, pool) === true, 'gate 應為 true');
  let out = M.applyAction(st, { type: 'PLAY_TRAINER', iid: st.players[0].hand[0].iid }, pool);
  out = M.applyAction(out, { type: 'RESOLVE_SELECTION', selectedIids: [target.iid] }, pool);
  out = M.applyAction(out, { type: 'RESOLVE_SELECTION', selectedIids: [target.energyAttached[0].iid] }, pool);
  ok(out.players[1].active.energyAttached.length === 1, '正常目標應被丟掉 1 個能量');
});

console.log('\n④ 缺口【2】古歷（J）—— 對手的化石不回血（站長裁定：依卡面全稱）');

T('⭐ 行為端：對手的化石有傷害也不回血；對手的其他寶可夢照回', () => {
  const fossil = mkFossil({ damage: 30 });
  const mate = inst(BASIC, { damage: 60 });
  const st = mk({ active: inst(BASIC, { damage: 50 }), hand: [inst(OLDREC.id)] },
                { active: mate, bench: [fossil] });
  const out = M.applyAction(st, { type: 'PLAY_TRAINER', iid: st.players[0].hand[0].iid }, pool);
  ok(out.players[1].bench[0].damage === 30, '對手的化石被回血了：' + out.players[1].bench[0].damage);
  ok(out.players[1].active.damage === 10, '對手的其他寶可夢應回 50（60→10）');
  ok(out.players[0].active.damage === 0, '自己的寶可夢應回 50（50→0）');
});
T('⭐ 方向性：**自己**的化石照樣回血（免疫的前提是「對手從手牌使出」）', () => {
  const mine = mkFossil({ damage: 30 });
  const st = mk({ active: inst(BASIC, { damage: 50 }), bench: [mine], hand: [inst(OLDREC.id)] },
                { active: inst(BASIC, { damage: 20 }) });
  const out = M.applyAction(st, { type: 'PLAY_TRAINER', iid: st.players[0].hand[0].iid }, pool);
  ok(out.players[0].bench[0].damage === 0, '自己的化石應回血（30→0），實得 ' + out.players[0].bench[0].damage);
});
T('gate：唯一有傷害的是對手的化石 → 古歷不能使用（判準①）', () => {
  const st = mk({ active: inst(BASIC, { damage: 0 }), hand: [inst(OLDREC.id)] },
                { active: inst(BASIC, { damage: 0 }), bench: [mkFossil({ damage: 30 })] });
  ok(M.TRAINER_GUARDS.get('古歷')(st, 0, pool) === false, 'gate 應為 false');
});
T('gate 正對照：對手有別隻受傷 → 古歷可以使用', () => {
  const st = mk({ active: inst(BASIC, { damage: 0 }), hand: [inst(OLDREC.id)] },
                { active: inst(BASIC, { damage: 30 }), bench: [mkFossil({ damage: 30 })] });
  ok(M.TRAINER_GUARDS.get('古歷')(st, 0, pool) === true, 'gate 應為 true');
});
T('⚠ 實作端不准出現「有利／不利」的概念（卡面沒有這個概念）', () => {
  const src = readFileSync(join(ROOT, 'src/lib/game/effects/cards/v2370_mp_promo.ts'), 'utf8');
  const i = src.indexOf('function healAllOnField');
  const j = src.indexOf("reg('古歷'");
  ok(i > 0 && j > i, '找不到 healAllOnField / 古歷 註冊');
  const body = src.slice(i, src.indexOf('});', j));
  ok(/isImmuneToOppSupporter/.test(body), '古歷沒有接上中央免疫述詞');
  // ⚠ 只禁「有利／不利」這種**卡面沒有的概念**；`damage > 0` 之類是 gate 的正常判斷。
  ok(!/有利|不利|beneficial|harmful/.test(body.replace(/^\s*\/\/.*$/gm, '')),
    '古歷實作出現「有利／不利」型的分支 —— 卡面沒有這個概念');
});

console.log('\n⑤ 缺口【3】反向過度免疫 —— 複製成招式效果時，化石**可以**被指定');

function copyPathValidIids(which) {
  const fossil = mkFossil();
  if (which === 'nine') {
    const nine = inst(NINETALES.id, { energyAttached: [inst(WATER), inst(WATER)] });
    const st = mk({ active: nine, deck: [inst(GUST.id), ...deckOf()] },
                  { active: inst(BASIC), bench: [fossil] });
    const ai = (NINETALES.attacks || []).findIndex(a => a.name === '靈怪變化');
    const out = M.applyAction(st, { type: 'ATTACK', attackIndex: ai, actorIdx: 0 }, pool);
    return { out, fossil };
  }
  const mm = inst(MRMIME.id, { energyAttached: [inst(WATER), inst(WATER)] });
  const gust = inst(GUST.id);
  const st = mk({ active: mm }, { active: inst(BASIC), bench: [fossil], hand: [gust] });
  const ai = (MRMIME.attacks || []).findIndex(a => a.name === '相仿秀');
  let out = M.applyAction(st, { type: 'ATTACK', attackIndex: ai, actorIdx: 0 }, pool);
  out = M.applyAction(out, { type: 'RESOLVE_SELECTION', selectedIids: [gust.iid] }, pool);
  return { out, fossil };
}
for (const [k, label] of [['nine', '九尾｜靈怪變化'], ['mm', '魔牆人偶｜相仿秀']]) {
  T(`⭐ ${label} 複製老大的指令：化石**在**候選裡（不再被免疫擋掉）`, () => {
    const { out, fossil } = copyPathValidIids(k);
    ok(out.pendingSelection, `${label} 沒開出 picker（免疫仍把候選清空了？）log=` + texts(out).slice(-3).join(' / '));
    const v = out.pendingSelection.params?.validIids || [];
    ok(v.includes(fossil.iid), `${label} 的候選不含化石：` + JSON.stringify(v));
  });
  T(`⭐ ${label}：真的把化石呼叫到對手戰鬥場（走完 RESOLVE）`, () => {
    const { out, fossil } = copyPathValidIids(k);
    const done = M.applyAction(out, { type: 'RESOLVE_SELECTION', selectedIids: [fossil.iid] }, pool);
    ok(done.players[1].active?.iid === fossil.iid, '化石沒有被換到戰鬥場');
  });
}
T('⭐⭐⭐ 跨 applyAction：坂木在「被複製」情境下，第二段（resolver 端）也不該免疫', () => {
  // 火箭隊的坂木是站內**唯一**在 resolver（跨一次 applyAction）才算免疫候選的消費點 ——
  // 模組層級的環境值到那時早就還原了 ⇒ 靠 pending params 的 __suppSrc 帶過去。
  // ⚠ 這裡用「直接把效果放進 runAsCopiedSupporterEffect」來測**機制本身**：
  //   目前 live 的兩張複製卡（九尾／魔牆人偶）自己都不是「火箭隊的」寶可夢，走不到自換那一半，
  //   但只要將來有火箭隊寶可夢拿到複製類招式（或複製到靈怪變化）就會走到 ⇒ 機制必須先對。
  const rocketA = pick(c => c.supertype === 'Pokemon' && (c.name || '').includes('火箭隊的'));
  ok(rocketA, '找不到火箭隊寶可夢');
  const a = inst(rocketA), b = inst(rocketA);
  const fossil = mkFossil();
  const st = mk({ active: a, bench: [b] }, { active: inst(BASIC), bench: [fossil] });
  const opened = M.runAsCopiedSupporterEffect(() => M.TRAINER_EFFECTS.get('火箭隊的坂木')(st, 0, pool));
  ok(opened.pendingSelection?.effectKey === 'sakaki-self-swap',
    '應先開坂木自換 picker，實得 ' + opened.pendingSelection?.effectKey);
  ok(opened.pendingSelection.params?.__suppSrc === 'copied-effect',
    '⚠ pending 沒帶上來源 ⇒ resolver 端會 fall back 成 from-hand、化石又被免疫掉');
  // 解第一段時環境值早已還原成 from-hand（模擬真實的下一次 applyAction）
  ok(M.getSupporterEffectSource() === 'from-hand', '環境值應已還原');
  const done = M.applyAction(opened, { type: 'RESOLVE_SELECTION', selectedIids: [b.iid] }, pool);
  const v = done.pendingSelection?.params?.validIids || [];
  ok(v.includes(fossil.iid),
    '⚠ 坂木的第二段（gust 半）仍把化石排除 —— 來源沒有跨 applyAction 傳過去：' + JSON.stringify(v));
});
T('⭐ 正對照：坂木**從手牌使出**時，第二段仍然把化石排除（v6.261 行為不變）', () => {
  const rocketA = pick(c => c.supertype === 'Pokemon' && (c.name || '').includes('火箭隊的'));
  const a = inst(rocketA), b = inst(rocketA);
  const fossil = mkFossil();
  const st = mk({ active: a, bench: [b], hand: [inst(SAKAKI.id)] },
                { active: inst(BASIC), bench: [fossil] });
  let out = M.applyAction(st, { type: 'PLAY_TRAINER', iid: st.players[0].hand[0].iid }, pool);
  ok(out.pendingSelection?.params?.__suppSrc === 'from-hand', '從手牌使出時來源應為 from-hand');
  out = M.applyAction(out, { type: 'RESOLVE_SELECTION', selectedIids: [b.iid] }, pool);
  ok(!out.pendingSelection, '對手備戰只有免疫的化石 ⇒ gust 半段應 no-op，不該開 picker');
  ok(texts(out).some(t => t.includes('沒有可呼叫的寶可夢')), '應照實 log');
});
T('⚠⚠ fail-closed：來源預設是 from-hand（沒人宣告過就是免疫照舊生效）', () => {
  ok(M.getSupporterEffectSource() === 'from-hand', '預設值不是 from-hand');
  const fossil = mkFossil();
  const st = mk({ active: inst(BASIC) }, { active: inst(BASIC), bench: [fossil] });
  ok(M.isImmuneToOppSupporter(st, 1, fossil, pool) === true, '省略 source 時應免疫');
  ok(M.isImmuneToOppSupporter(st, 1, fossil, pool, 'from-hand') === true, "明寫 'from-hand' 應免疫");
  ok(M.isImmuneToOppSupporter(st, 1, fossil, pool, 'copied-effect') === false, "'copied-effect' 不該免疫");
  // 環境值離開包裹後必須還原（不可洩漏到下一張從手牌使出的支援者）
  const inside = M.runAsCopiedSupporterEffect(() => M.getSupporterEffectSource());
  ok(inside === 'copied-effect', '包裹內應為 copied-effect');
  ok(M.getSupporterEffectSource() === 'from-hand', '⚠ 包裹結束後沒還原 ⇒ 之後的支援者會整批失去免疫（公平性漏洞）');
  try { M.runAsCopiedSupporterEffect(() => { throw new Error('boom'); }); } catch { /* expected */ }
  ok(M.getSupporterEffectSource() === 'from-hand', '⚠ 例外路徑沒還原（finally 沒生效）');
});

console.log('\n⑥ 正對照：已查證正確的行為逐一不變');

T('老大的指令：對手備戰只有化石 → gate=false、log 據實說明（v6.261 行為不變）', () => {
  const st = mk({ active: inst(BASIC), hand: [inst(GUST.id)] },
                { active: inst(BASIC), bench: [mkFossil()] });
  ok(M.TRAINER_GUARDS.get('老大的指令')(st, 0, pool) === false, 'gate 應 false');
});
T('火箭隊的坂木：對手備戰只有化石時仍可使出（自換那半段能執行 ⇒ 判準①的多部效果例外）', () => {
  const a = inst(pick(c => c.supertype === 'Pokemon' && (c.name || '').includes('火箭隊的')) ?? BASIC);
  const b = inst(pick(c => c.supertype === 'Pokemon' && (c.name || '').includes('火箭隊的')) ?? BASIC);
  ok(pool.get(a.cardId).name.includes('火箭隊的'), '找不到火箭隊寶可夢');
  const st = mk({ active: a, bench: [b], hand: [inst(SAKAKI.id)] },
                { active: inst(BASIC), bench: [mkFossil()] });
  ok(M.TRAINER_GUARDS.get('火箭隊的坂木')(st, 0, pool) === true, 'gate 應 true（自換半段能執行）');
  const out = M.applyAction(st, { type: 'PLAY_TRAINER', iid: st.players[0].hand[0].iid }, pool);
  ok(out.pendingSelection?.effectKey === 'sakaki-self-swap', '應先開自換 picker');
  const done = M.applyAction(out, { type: 'RESOLVE_SELECTION', selectedIids: [b.iid] }, pool);
  ok(texts(done).some(t => t.includes('沒有可呼叫的寶可夢')), 'gust 半段應 no-op 並照實 log');
});
T('可怕的哥哥：化石帶道具＋特殊能量仍被排除（v6.261 行為不變）', () => {
  const st = mk({ active: inst(BASIC), hand: [inst(CREEPY.id)] },
                { active: inst(BASIC), bench: [mkFossil()] });
  ok(M.TRAINER_GUARDS.get('可怕的哥哥')(st, 0, pool) === false, 'gate 應 false');
});
T('非支援者（粉碎之錘 Item）不受支援者免疫影響 —— 化石的能量照樣可丟', () => {
  ok(CRUSH && CRUSH.subtype === 'Item', '粉碎之錘應為 Item');
  const fossil = mkFossil({ energyAttached: [inst(WATER)] });
  const st = mk({ active: inst(BASIC), hand: [inst(CRUSH.id)] }, { active: fossil });
  const g = M.TRAINER_GUARDS.get('粉碎之錘');
  ok(!g || g(st, 0, pool) === true, '粉碎之錘不該被支援者免疫擋住');
});
T('「這張卡不會陷入特殊狀態」「無法撤退」不變（engine 事後 sweep ＋ 中央撤退閘）', () => {
  const fossil = mkFossil();
  const st = mk({ active: inst(BASIC) }, { active: fossil, bench: [inst(BASIC)] });
  const st2 = M.applyAction({ ...st, activePlayerIndex: 1, players: [st.players[0], st.players[1]] },
    { type: 'RETREAT', benchIndex: 0, actorIdx: 1 }, pool);
  ok(st2.players[1].active?.iid === fossil.iid, '化石不該撤退成功');
});

console.log('\n⑦ 收斂與死碼（靜態確認：中央述詞是唯一入口）');

T('engine.ts 的死碼 isFinFossilSupporterImmune 已刪除（全 repo 零呼叫端）', () => {
  const eng = readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8');
  ok(!/export function isFinFossilSupporterImmune/.test(eng), 'isFinFossilSupporterImmune 還在');
});
T('supporters_gust.ts 的內聯化石檢查已收斂（會繞過 v6.262 的來源前提）', () => {
  const g = readFileSync(join(ROOT, 'src/lib/game/effects/cards/supporters_gust.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(!/陳舊的鰭之化石/.test(g), 'supporters_gust 仍有內聯化石卡名比對');
  ok(/isImmuneToOppSupporter/.test(g), 'supporters_gust 沒接中央述詞');
});
T('化石免疫的卡名字面量只出現在中央述詞一處（其餘卡檔不得再手刻）', () => {
  const files = [
    'src/lib/game/effects.ts',
    'src/lib/game/effects/cards/supporters_gust.ts', 'src/lib/game/effects/cards/v172_hij_batch.ts',
    'src/lib/game/effects/cards/m5_preview.ts', 'src/lib/game/effects/cards/v2370_mp_promo.ts',
  ];
  for (const f of files) {
    const s2 = readFileSync(join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    ok(!/'陳舊的鰭之化石'/.test(s2), `${f} 出現手刻的化石卡名比對（免疫只准走 isImmuneToOppSupporter）`);
  }
  // ⚠ engine.ts 保留的那一處是 FOSSIL_ITEM_NAMES（化石**物品**登錄表，7 張化石一起列），
  //   與支援者免疫無關 ⇒ 斷言它剛好只有那一處，且不在任何 supporter/immune 語境裡。
  const eng = readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const engHits = eng.match(/'陳舊的鰭之化石'/g) || [];
  ok(engHits.length === 1, `engine.ts 應剛好 1 處（FOSSIL_ITEM_NAMES），實得 ${engHits.length}`);
  const k = eng.indexOf("'陳舊的鰭之化石'");
  ok(eng.slice(Math.max(0, k - 400), k).includes('FOSSIL_ITEM_NAMES'),
    'engine.ts 的化石卡名不在 FOSSIL_ITEM_NAMES 登錄表裡 ⇒ 可能是新的手刻免疫');
  ok(!/supporter|immune|Immune/i.test(eng.slice(k - 200, k + 200)), 'engine.ts 的化石卡名附近出現免疫語境');
  const c = readFileSync(join(ROOT, 'src/lib/game/effects/cards/v3080_deferred_wave_c.ts'), 'utf8');
  ok((c.match(/'陳舊的鰭之化石'/g) || []).length === 1, '中央述詞應剛好一處判化石卡名');
});
T('lint Check H 已能認「物件字面量」樣式與 RESOLVERS.set 寫法（v6.262 兩個掃描器盲點）', () => {
  const l = readFileSync(join(ROOT, 'scripts/anti-pattern-lint.mjs'), 'utf8');
  ok(/energyAttached\\s\*:/.test(l) || /energyAttached\s*\\s\*:/.test(l) || /energyAttached\\s\*:\(\?!/.test(l)
     || /\(\?:\^\|\[\{,\(\\s\]\)energyAttached/.test(l), 'Check H 沒有物件字面量樣式');
  ok(/RESOLVERS\\\.set/.test(l), 'enclosingResolverKey 沒認 RESOLVERS.set 寫法');
  ok(/function updatePlayerSecondArg/.test(l), 'mutatedIdx 沒修巢狀第一參數');
  ok(/H_OBJLIT_PENDING/.test(l) && /待審清單死條目/.test(l), '待審清單或死條目斷言不見了');
});

console.log('\n=== v6.262 鰭之化石支援者免疫範圍：PASS ' + pass + ' / FAIL ' + fail + ' ===');
if (fail > 0) process.exit(1);
