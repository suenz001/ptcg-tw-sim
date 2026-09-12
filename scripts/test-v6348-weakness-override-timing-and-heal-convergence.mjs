// v6.348 守衛：
//   【A】【B】智揮猩｜掌握弱點（v2.78）／皮卡丘｜覆蓋伏特（M6a 034/103）的**跨回合時序**
//        —— 這兩支自 v2.78 起是死碼（旗標只活在「被施加者自己的回合」，施加者輪到自己
//        出招時早就被清掉）。本檔一律用「真的走完 ATTACK → END_TURN → END_TURN → ATTACK」
//        的行為端數字驗證，不看旗標字面（v6.346 wave6 的 D 段就是只看旗標所以抓不到）。
//   【C】Rule 38：promote／clear 各只有一份。
//   【D】「將自己的 1 隻寶可夢恢復 N HP」四張卡收斂到 healOneOwnPokemonPending，
//        並且真的經過 validIids 中央消毒閘（送對手的 iid 進去必須被擋）。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.v6348-s.js'), E = join(ROOT, '.v6348-e.ts'), O = join(ROOT, '.v6348-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* noop */ } } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E,
  "export { applyAction, getUsableAbilities } from './src/lib/game/engine';\n"
  + "import './src/lib/game/effects';\n");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { applyAction, getUsableAbilities } = await import(pathToFileURL(O).href);

// ── 卡池 ─────────────────────────────────────────────────────────────────────
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map(); const all = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
    if (c?.id == null) continue;
    pool.set(String(c.id), c); all.push(c);
  }
}
const findAtk = (n, a, set) => {
  const hits = all.filter((c) => c.name === n && (c.attacks || []).some((x) => x.name === a));
  if (!hits.length) throw new Error(`fixture 找不到 ${n}｜${a}`);
  return (set && hits.find((c) => String(c.setCode) === set)) ?? hits[0];
};
const findAb = (n, ab) => {
  const hits = all.filter((c) => c.name === n && (c.abilities || []).some((x) => x.name === ab));
  if (!hits.length) throw new Error(`fixture 找不到 ${n}｜${ab}`);
  return hits.find((c) => String(c.setCode) === 'M6a') ?? hits[0];
};
const ZH = { Grass: '草', Fire: '火', Water: '水', Lightning: '雷', Psychic: '超', Fighting: '鬥', Darkness: '惡', Metal: '鋼' };
const EID = {};
for (const c of all) { if (c.supertype !== 'Energy') continue;
  for (const [k, z] of Object.entries(ZH)) if (c.name === `基本【${z}】能量` && !EID[k]) EID[k] = String(c.id); }
EID.Colorless = EID.Water;

let nn = 0;
const inst = (cid, extra = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [],
  abilityUsedThisTurn: false, evolvedThisTurn: false, playedFromHand: false,
  movedToActiveThisTurn: false, evolvedFromStack: [], ...extra });
const P = (o = {}) => ({ name: 'P', active: null, bench: [], hand: [], deck: [], discard: [], prizes: [],
  abilityNamesUsedThisTurn: [], ...o });
const mk = (p0, p1, extra = {}) => ({ phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0,
  turn: 5, isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
  pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], coinFlippedThisAttack: false,
  _attackerActiveBonusDone: false, activeStadium: null, activeStadiumOwnerIdx: 0,
  players: [P(p0), P(p1)], ...extra });

let pass = 0, fail = 0;
const chk = (t, c, extra = '') => { if (c) { pass++; console.log('  ✓', t); } else { fail++; console.log('  ❌', t, extra); } };
const heads = (fn) => { const o = Math.random; Math.random = () => 0.1; try { return fn(); } finally { Math.random = o; } };
const act = (st, a) => heads(() => { try { return applyAction(st, a, pool); } catch (e) { return { __err: e.message, log: [], players: st.players }; } });
const A0 = (r) => r?.players?.[0]?.active;
const D0 = (r) => r?.players?.[1]?.active;
const atkIdx = (card, name) => (card.attacks || []).findIndex((a) => a.name === name);
const deckOf = (card, n = 12) => Array.from({ length: n }, () => inst(card.id));

// ── fixtures ────────────────────────────────────────────────────────────────
const PIKA = findAtk('皮卡丘', '覆蓋伏特', 'M6a');     // Lightning, 覆蓋伏特 10
const SIMI = findAtk('智揮猩', '掌握弱點');            // Colorless, 掌握弱點 0 / 掌擊 80
/** 靶：Basic／無特性／HP 夠高吃得下 160／原生弱點**不是**【雷】也不是【無】。 */
const TGT = all.find((c) => c.supertype === 'Pokemon' && c.stage === 'Basic' && !(c.abilities || []).length
  && !(c.tags || []).includes('太晶') && Number(c.hp) >= 200
  && c.weakness?.type !== 'Lightning' && c.weakness?.type !== 'Colorless');
const PLAIN = all.find((c) => c.supertype === 'Pokemon' && c.stage === 'Basic' && !(c.abilities || []).length
  && !(c.tags || []).includes('太晶') && Number(c.hp) >= 60 && c.pokemonType === 'Colorless');

console.log('\n【0】harness 自驗');
chk('0a 抓得到 皮卡丘｜覆蓋伏特（M6a）', String(PIKA.setCode) === 'M6a' && PIKA.pokemonType === 'Lightning',
  `${PIKA.setCode}/${PIKA.pokemonType}`);
chk('0b 抓得到 智揮猩（掌握弱點＋掌擊）', atkIdx(SIMI, '掌擊') >= 0 && SIMI.pokemonType === 'Colorless');
chk('0c 靶的原生弱點不是【雷】也不是【無】（否則對照組就已經 ×2）',
  !!TGT && TGT.weakness?.type !== 'Lightning' && TGT.weakness?.type !== 'Colorless',
  `${TGT?.name}/${TGT?.weakness?.type}/HP${TGT?.hp}`);
chk('0d 有乾淨的【無】屬性對照靶', !!PLAIN, String(PLAIN?.name));

// ════════════════════════════════════════════════════════════════════════════
// 【A】皮卡丘｜覆蓋伏特（M6a 034/103）
//   卡面：「在下個自己的回合結束前，受到這個招式的寶可夢弱點改為【雷】屬性。[弱點以「×2」計算傷害。]」
// ════════════════════════════════════════════════════════════════════════════
console.log('\n【A】覆蓋伏特 — 施加者的**下一個自己的回合**，弱點真的變成【雷】（×2）');
{
  const mkSt = () => {
    const a = inst(PIKA.id, { energyAttached: [inst(EID.Lightning), inst(EID.Lightning)] });
    return mk({ active: a, bench: [inst(PLAIN.id)], deck: deckOf(PLAIN), prizes: Array.from({ length: 6 }, () => inst(PLAIN.id)) },
      { active: inst(TGT.id), bench: [inst(PLAIN.id)], deck: deckOf(PLAIN), prizes: Array.from({ length: 6 }, () => inst(PLAIN.id)) });
  };
  const ai = atkIdx(PIKA, '覆蓋伏特');
  const ATK = { type: 'ATTACK', attackIndex: ai };
  const ET = { type: 'END_TURN' };

  // 反對照：完全不先用覆蓋伏特，兩輪之後才打第一次 ⇒ 只有 10
  let c0 = mkSt();
  c0 = act(act(c0, ET), ET);
  const ctl = act(c0, ATK);
  chk('A1 ⭐反對照：沒有先施加過覆蓋伏特時，同一招同一靶只有 10', D0(ctl)?.damage === 10, String(D0(ctl)?.damage));

  // 正路徑
  const s0 = mkSt();
  const r1 = act(s0, ATK);
  chk('A2 哨兵：第一次覆蓋伏特造成 10（證明靶原本不弱【雷】、能量付得出來）',
    D0(r1)?.damage === 10 && A0(r1)?.attackUsedThisTurn === '覆蓋伏特',
    JSON.stringify([D0(r1)?.damage, A0(r1)?.attackUsedThisTurn]));
  const s1 = act(r1, ET);                 // 施加者 END_TURN
  chk('A3 ⭐時序：施加者 END_TURN 之後**還不能**升級成 ThisTurn（升了就會在對手回合被清掉）',
    D0(s1)?.weaknessOverrideTypeNextTurn === 'Lightning' && !D0(s1)?.weaknessOverrideTypeThisTurn,
    JSON.stringify([D0(s1)?.weaknessOverrideTypeNextTurn, D0(s1)?.weaknessOverrideTypeThisTurn]));
  const s2 = act(s1, ET);                 // 擁有者（對手）END_TURN ⇒ promote
  chk('A4 ⭐時序：擁有者自己的 END_TURN 才升級成 ThisTurn',
    !D0(s2)?.weaknessOverrideTypeNextTurn && D0(s2)?.weaknessOverrideTypeThisTurn === 'Lightning',
    JSON.stringify([D0(s2)?.weaknessOverrideTypeNextTurn, D0(s2)?.weaknessOverrideTypeThisTurn]));
  const r2 = act(s2, ATK);
  chk('A5 ⭐⭐⭐行為端：施加者的下一個回合，同一招造成 20（10×2）⇒ 弱點覆寫真的生效',
    D0(r2)?.damage === 10 + 20, String(D0(r2)?.damage));
  // 期限：卡面「在下個自己的回合**結束前**」⇒ 施加者這一回合結束時舊的那一份就該清掉
  //   ⚠ r2 是「再打一次覆蓋伏特」⇒ 同一個 action 會**重新**掛上一份 NextTurn（正確行為）。
  //     所以這裡要驗的是「舊的 ThisTurn 沒了、而且新的那份還停在 NextTurn」。
  const s3 = act(r2, ET);
  chk('A6 ⭐期限：施加者的回合結束時舊的 ThisTurn 必須清掉（卡面「結束前」）',
    !D0(s3)?.weaknessOverrideTypeThisTurn && D0(s3)?.weaknessOverrideTypeNextTurn === 'Lightning',
    JSON.stringify([D0(s3)?.weaknessOverrideTypeThisTurn, D0(s3)?.weaknessOverrideTypeNextTurn]));
  const r3 = act(act(s3, ET), ATK);
  chk('A7 ⭐不疊加：第三次仍是 ×2（+20，累計 50），不會變成 ×4',
    D0(r3)?.damage === 10 + 20 + 20, String(D0(r3)?.damage));
  // ⭐⭐ 真正的期限（行為端）：施加之後**不再出招**，過完施加者那一回合就該失效
  const e1 = act(mkSt(), ATK);              // T：施加（10）
  const e2 = act(act(e1, ET), ET);          // T+1：擁有者 END_TURN ⇒ promote
  const e3 = act(act(e2, ET), ET);          // T+2：施加者**不出招**直接結束 ⇒ 應清掉
  chk('A8 ⭐⭐期限（行為端）：施加者那一回合不出招、過完之後旗標失效',
    !D0(e3)?.weaknessOverrideTypeThisTurn && !D0(e3)?.weaknessOverrideTypeNextTurn,
    JSON.stringify([D0(e3)?.weaknessOverrideTypeThisTurn, D0(e3)?.weaknessOverrideTypeNextTurn]));
  const e4 = act(e3, ATK);
  chk('A9 ⭐⭐期限（行為端）：T+4 再打只有 10（累計 20），證明不是永久 ×2',
    D0(e4)?.damage === 20, String(D0(e4)?.damage));
}

// ════════════════════════════════════════════════════════════════════════════
// 【B】智揮猩｜掌握弱點（v2.78 既有卡）—— 同一支中央管線，數字更大更難假綠
// ════════════════════════════════════════════════════════════════════════════
console.log('\n【B】掌握弱點（既有卡正對照）— 掌擊 80 → 160');
{
  const mkSt = () => {
    const a = inst(SIMI.id, { energyAttached: Array.from({ length: 4 }, () => inst(EID.Water)) });
    return mk({ active: a, bench: [inst(PLAIN.id)], deck: deckOf(PLAIN), prizes: Array.from({ length: 6 }, () => inst(PLAIN.id)) },
      { active: inst(TGT.id), bench: [inst(PLAIN.id)], deck: deckOf(PLAIN), prizes: Array.from({ length: 6 }, () => inst(PLAIN.id)) });
  };
  const GRASP = { type: 'ATTACK', attackIndex: atkIdx(SIMI, '掌握弱點') };
  const PALM = { type: 'ATTACK', attackIndex: atkIdx(SIMI, '掌擊') };
  const ET = { type: 'END_TURN' };

  let c0 = mkSt(); c0 = act(act(c0, ET), ET);
  const ctl = act(c0, PALM);
  chk('B1 ⭐反對照：沒先用掌握弱點時掌擊 = 80', D0(ctl)?.damage === 80, String(D0(ctl)?.damage));

  const g1 = act(mkSt(), GRASP);
  chk('B2 哨兵：掌握弱點本身 0 傷害（卡面沒有數字）', D0(g1)?.damage === 0, String(D0(g1)?.damage));
  const g3 = act(act(g1, ET), ET);
  const r = act(g3, PALM);
  chk('B3 ⭐⭐⭐行為端：掌握弱點 → 兩次 END_TURN → 掌擊 = 160（80×2）',
    D0(r)?.damage === 160, String(D0(r)?.damage));
  const r2 = act(act(act(r, ET), ET), PALM);
  chk('B4 ⭐期限（行為端）：再一輪之後掌擊回到 80（累計 160+80 = 240）',
    D0(r2)?.damage === 240, String(D0(r2)?.damage));
}

// ════════════════════════════════════════════════════════════════════════════
// 【C】Rule 38：promote／clear 各只有一份
// ════════════════════════════════════════════════════════════════════════════
console.log('\n【C】Rule 38 — weaknessOverride 的 promote／clear 各只有一份');
{
  const eng = readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8');
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const src = strip(eng);
  const promotes = src.split('weaknessOverrideTypeThisTurn: c.weaknessOverrideTypeNextTurn').length - 1;
  chk('C1 ⭐全檔只有一處把 NextTurn 升級成 ThisTurn', promotes === 1, `${promotes} 處`);
  chk('C2 ⭐掃描器正對照：樣本裡有這段字面時必須算得到',
    ('x weaknessOverrideTypeThisTurn: c.weaknessOverrideTypeNextTurn y'
      .split('weaknessOverrideTypeThisTurn: c.weaknessOverrideTypeNextTurn').length - 1) === 1);
  chk('C3 ⭐promote 位在 promoteWeaknessOverride 內（不是 promotePending）',
    /const promoteWeaknessOverride[\s\S]{0,400}weaknessOverrideTypeThisTurn: c\.weaknessOverrideTypeNextTurn/.test(src));
  const consumers = src.split('weaknessOverrideTypeThisTurn').length - 1;
  chk('C4 ⭐掃描器有掃到東西（下限：ThisTurn 這個名字至少出現 4 次：promote／clear／保險／消費）',
    consumers >= 4, `${consumers} 次`);
}

// ════════════════════════════════════════════════════════════════════════════
// 【D】治癒類中央收斂 + validIids 消毒閘
// ════════════════════════════════════════════════════════════════════════════
console.log('\n【D】「將自己的 1 隻寶可夢恢復 N HP」四張卡 — 中央出口 + validIids');
{
  const CREAM = findAb('霜奶仙ex', '甜點之禮');
  const SHUCK = findAb('壺壺', '發酵果汁');
  const LUDI = findAb('樂天河童', '激動治癒');
  const NIDO = findAb('尼多娜', '分享歡樂');
  const MEGA_GRASS = all.find((c) => c.supertype === 'Pokemon' && c.subtype === 'ex'
    && c.name.startsWith('超級') && c.pokemonType === 'Grass');
  chk('D0 四張卡與【草】超級進化ex 都抓得到',
    !!CREAM && !!SHUCK && !!LUDI && !!NIDO && !!MEGA_GRASS,
    JSON.stringify([CREAM?.name, SHUCK?.name, LUDI?.name, NIDO?.name, MEGA_GRASS?.name]));

  /** 建一個「持有者在備戰、戰鬥位受傷 60」的盤面；回傳 {st, holder, hurt, oppIid} */
  const board = (holderCard, opts = {}) => {
    const holder = inst(holderCard.id, opts.holder ?? {});
    const hurt = inst(PLAIN.id, { damage: opts.damage ?? 60 });
    const bench = [holder, ...(opts.extraBench ?? []).map((c) => inst(c.id))];
    const oppA = inst(PLAIN.id);
    return {
      st: mk({ active: hurt, bench, deck: deckOf(PLAIN) }, { active: oppA, bench: [], deck: deckOf(PLAIN) }),
      holder, hurt, oppIid: oppA.iid,
    };
  };
  const CASES = [
    ['甜點之禮', CREAM, 30, {}],
    ['發酵果汁', SHUCK, 30, { holder: { energyAttached: [inst(EID.Grass)] } }],
    ['激動治癒', LUDI, 60, { extraBench: [MEGA_GRASS] }],
    ['分享歡樂', NIDO, 30, {}],
  ];
  for (const [label, card, amount, opts] of CASES) {
    const abIdx = (card.abilities || []).findIndex((a) => a.name === label);
    const { st, holder, hurt, oppIid } = board(card, opts);
    const r1 = act(st, { type: 'USE_ABILITY', iid: holder.iid, abilityIndex: abIdx });
    const pend = r1.pendingSelection;
    chk(`D1 ${label}：開 heal-target picker`, pend?.type === 'heal-target', JSON.stringify(pend?.type));
    const own = new Set([hurt.iid, ...r1.players[0].bench.map((b) => b.iid)]);
    chk(`D1b ⭐${label}：picker 帶 validIids，且內容＝自己場上全部（不含對手）`,
      Array.isArray(pend?.validIids) && pend.validIids.length === own.size
      && pend.validIids.every((x) => own.has(x)),
      JSON.stringify(pend?.validIids));
    chk(`D1c ${label}：log 逐字未變`,
      (r1.log ?? []).some((l) => String(l?.message ?? l?.text ?? l)
        === `${label}：選擇 1 隻自己的寶可夢恢復 ${amount} HP`),
      JSON.stringify((r1.log ?? []).slice(-2)));
    // ⭐ 送**對手**的 iid 進去必須被擋下。
    //   ⚠ 誠實標註：實測 validIids 不是唯一擋它的閘（把對手 iid 塞進 validIids，這一條仍綠）
    //     ⇒ 這條守的是「送別人的 iid 不會回血」這個**行為**；validIids 本身由 D1b 釘住。
    const bad = act(r1, { type: 'RESOLVE_SELECTION', selectedIids: [oppIid], actorIdx: 0 });
    chk(`D2 ⭐⭐${label}：送對手的 iid → 被擋下（不解析、pending 留著、沒有人回血）`,
      !!bad.pendingSelection && A0(bad)?.damage === (opts.damage ?? 60)
      && bad.players[1].active?.damage === 0,
      JSON.stringify([!!bad.pendingSelection, A0(bad)?.damage, bad.players[1].active?.damage]));
    // 正常路徑
    const good = act(r1, { type: 'RESOLVE_SELECTION', selectedIids: [hurt.iid], actorIdx: 0 });
    chk(`D3 ${label}：選自己受傷那隻 → 回 ${amount}（60 → ${60 - amount}）`,
      A0(good)?.damage === 60 - amount && !good.pendingSelection, String(A0(good)?.damage));
  }

  // ⭐ gate 一致：全員滿血時四張卡都不該出現在可用清單；有人受傷時都要出現
  for (const [label, card, , opts] of CASES) {
    const full = board(card, { ...opts, damage: 0 });
    const hurtB = board(card, opts);
    const listed = (b) => getUsableAbilities(b.st, pool).some((u) => u.abilityName === label);
    chk(`D4 ⭐${label}：場上有人受傷 ⇒ 在可用清單裡`, listed(hurtB));
    chk(`D4b ⭐${label}：全員滿血 ⇒ **不**在可用清單（按了也沒效果，不該吃掉特性權）`, !listed(full));
  }

  // ⭐ 靜態：四張卡都指向同一支中央出口（不是各寫一份 withPending）
  const files = ['src/lib/game/effects/cards/v2995_g4_wave1.ts', 'src/lib/game/effects/cards/m6a_wave7.ts'];
  let calls = 0;
  for (const f of files) {
    const s = readFileSync(join(ROOT, f), 'utf8');
    calls += s.split('healOneOwnPokemonPending(').length - 1;
  }
  chk('D5 ⭐四張卡都呼叫中央出口（2 個檔合計 4 次 call + 1 次 import 名）', calls >= 4, `${calls} 次`);
  const shared = readFileSync(join(ROOT, 'src/lib/game/effects/_shared.ts'), 'utf8');
  chk('D6 ⭐中央出口存在且宣告了 validIids',
    /export function healOneOwnPokemonPending[\s\S]{0,900}validIids: ownIids/.test(shared));
  chk('D7 ⭐掃描器正對照：改壞樣本必須抓不到',
    !/export function healOneOwnPokemonPending[\s\S]{0,900}validIids: ownIids/
      .test(shared.replace('validIids: ownIids', 'minCount: 1')));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} v6.348 弱點覆寫時序 / 治癒類收斂：${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
