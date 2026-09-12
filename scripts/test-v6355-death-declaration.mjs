// v6.355 守衛 —— 耿鬼ex｜死亡宣告（M6a 076/103，id 19988）
//
// 卡面逐字（static/cards 台灣官方，abilities[].effect）：
//   「這隻寶可夢受到對手的寶可夢招式的傷害而【昏厥】時，自己擲1次硬幣。
//     若為正面，則將使用招式的寶可夢【昏厥】。」
//
// ⚠ 被動特性**沒有 handler** ⇒ 覆蓋率不可以用「registry 有沒有 key」判斷（Rule 33）。
//   本檔一律「真的建盤面 → 跑 ATTACK / RESOLVE_SELECTION / END_TURN → 看 players[] 盤面數字」。
// ⚠ 禁止恆真斷言（chk(..., true)）＝ 安慰劑 #27；跨回合旗標只驗旗標值 ＝ 安慰劑 #28。
//   本檔每一條都是盤面（active/bench/discard/prizes/phase/winner）或 log 次數。
//
// v6.347 撤回的真因與 v6.355 的解法（設計判準，動實作前先讀）：
//   PASSIVE_ON_KO 在兩條 KO 管線中相對 addPendingPrize 的執行點**是相反的**
//     ・engine.ts 主 ATTACK：addPendingPrize → PASSIVE_ON_KO
//     ・effects.ts fireDefenderOnKO 家族：fireDefenderOnKO → addPendingPrize
//   而本特性會發獎賞 / 清掉攻擊方 active / 可能終局 ⇒ 就地執行必然兩邊不等價。
//   v6.355：新增 PASSIVE_ON_KO_AFTER_PRIZE 家族 ——
//     入列 2 點（effects.fireDefenderOnKO ④ ＋ engine 主管線）共用同一支 firePassiveOnKoAfterPrize，
//     出列**只有 1 點**（engine.sanityKOSweep 開頭的 drainOnKoAfterPrize），
//     那個位置必然在該次 action 全部 addPendingPrize 之後 ⇒ 結構上不可能再分岔（B 組行為端釘住）。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.v6355-s.js'), E = join(ROOT, '.v6355-e.ts'), O = join(ROOT, '.v6355-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* noop */ } } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E,
  "export { applyAction, getUsableAbilities } from './src/lib/game/engine';\n"
  + "export { PASSIVE_ON_KO, PASSIVE_KO_PRIZE_ADJUST, PASSIVE_ON_KO_AFTER_PRIZE,\n"
  + "         PASSIVE_ON_KO_BENCH_ALSO, firePassiveOnKoAfterPrize,\n"
  + "         drainOnKoAfterPrize } from './src/lib/game/effects';\n"
  + "import './src/lib/game/effects';\n");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const M = await import(pathToFileURL(O).href);
const { applyAction, getUsableAbilities, PASSIVE_ON_KO, PASSIVE_KO_PRIZE_ADJUST,
        PASSIVE_ON_KO_AFTER_PRIZE, PASSIVE_ON_KO_BENCH_ALSO } = M;

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
const byId = (id) => { const c = pool.get(String(id)); if (!c) throw new Error('卡池抓不到 id ' + id); return c; };
const byName = (n) => { const c = all.find((x) => x.name === n); if (!c) throw new Error('卡池抓不到 ' + n); return c; };

const GENG = byId('19988');   // 耿鬼ex   M6a 076/103  HP280 Stage2【惡】 弱點【鬥】×2 ｜死亡宣告
const ICE  = byId('19924');   // 急凍鳥   M6a          HP120 Basic 【水】非 ex（1 張獎賞）｜冰雹
const PIKA = byId('14704');   // 皮卡丘ex M2a          HP200 Basic 【雷】ex｜勤奮之心（防 KO）｜黃玉伏特 300
const LUCA = byId('13986');   // 超級路卡利歐ex M1L    HP340 【鬥】ex｜波動突刺130（中央 helper）／超級勇氣270（主管線）
const YCHAR = byId('18069');   // 超級噴火龍Yex M-P-J HP360 Stage2【火】超級進化ex
                              //   ｜炎獄狂爆Y：卡面傷害欄為空，全部走 regPost →
                              //     chooseOppPokemonDamage(280) 開 picker ⇒ KO 發生在 RESOLVE_SELECTION
const LAVA = byName('傳說的熔岩洞');   // 場地：雙方場上**進化**寶可夢特性全消除
const PLAIN = all.find((c) => c.supertype === 'Pokemon' && c.stage === 'Basic'
  && !(c.abilities || []).length && !(c.tags || []).includes('太晶')
  && Number(c.hp) >= 60 && c.pokemonType === 'Colorless');

const ZH = { Grass: '草', Fire: '火', Water: '水', Lightning: '雷', Psychic: '超', Fighting: '鬥', Darkness: '惡', Metal: '鋼' };
const EID = {};
for (const c of all) {
  if (c.supertype !== 'Energy') continue;
  for (const [k, z] of Object.entries(ZH)) if (c.name === `基本【${z}】能量` && !EID[k]) EID[k] = String(c.id);
}
EID.Colorless = EID.Water;

let nn = 0;
const inst = (cid, extra = {}) => ({
  iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [],
  abilityUsedThisTurn: false, evolvedThisTurn: false, playedFromHand: false,
  movedToActiveThisTurn: false, evolvedFromStack: [], ...extra,
});
const P = (o = {}) => ({
  name: 'P', active: null, bench: [], hand: [], deck: [], discard: [],
  prizes: [], abilityNamesUsedThisTurn: [], ...o,
});
const prizes = (n) => Array.from({ length: n }, () => inst(PLAIN.id));
const deck3 = () => [inst(PLAIN.id), inst(PLAIN.id), inst(PLAIN.id)];
const mk = (p0, p1, extra = {}) => ({
  phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
  isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
  pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
  coinFlippedThisAttack: false, _attackerActiveBonusDone: false,
  activeStadium: null, activeStadiumOwnerIdx: 0,
  players: [P({ name: 'A', deck: deck3(), prizes: prizes(6), ...p0 }),
            P({ name: 'B', deck: deck3(), prizes: prizes(6), ...p1 })],
  ...extra,
});

let pass = 0, fail = 0;
const chk = (t, c, extra = '') => { if (c) { pass++; console.log('  ✓', t); } else { fail++; console.log('  ❌', t, extra); } };

const withCoin = (heads, fn) => {
  const orig = Math.random;
  Math.random = () => (heads ? 0.1 : 0.9);
  try { return fn(); } finally { Math.random = orig; }
};
/**
 * ⭐⭐⭐ v6.355 不變量追蹤：本檔跑過的**每一次** action 結束後，
 *   state._onKoAfterPrize 都必須是空的（undefined 或 length 0）。
 *   —— 「drain 只放在 sanityKOSweep」成立的前提是「每一條會入列的 dispatch，
 *      最後一定會跑到某個 sanityKOSweep」。萬一有缺口，佇列會殘留到**下一個 action**
 *      才觸發（時機錯、甚至換人了才觸發），而且是**無聲**的。
 *   ⚠ 這是**補充**不變量，不取代任何行為端斷言（旗標層斷言單獨存在＝安慰劑 #28）。
 *      非恆真由 __m6a/mutcheck_v6355.mjs 的 M16 證明（drain 變 no-op ⇒ 這組翻紅）。
 */
const RUNS = [];
const act = (st, a, heads) => withCoin(heads !== false, () => {
  let r;
  try { r = applyAction(st, a, pool); } catch (e) { r = { __err: e.message, log: [], players: [P(), P()] }; }
  RUNS.push({ type: a?.type ?? '?', q: (r?._onKoAfterPrize ?? []).length });
  return r;
});
/** 不變量：這一次 action 結束後，待觸發佇列必須已經被 drain 乾淨 */
const QEMPTY = (r) => !r?._onKoAfterPrize || r._onKoAfterPrize.length === 0;
const QLEN = (r) => (r?._onKoAfterPrize ?? []).length;
const LOGS = (r) => (r?.log ?? []).map((l) => String(l?.message ?? l?.text ?? l));
const nLog = (r, s) => LOGS(r).filter((x) => x.includes(s)).length;
const A0 = (r) => r?.players?.[0]?.active;
const D0 = (r) => r?.players?.[1]?.active;
const PZ = (r, i) => r?.players?.[i]?.prizes?.length;
const atkIdx = (card, name) => (card.attacks || []).findIndex((a) => a.name === name);
const energyFor = (card, atkName) =>
  ((card.attacks || []).find((a) => a.name === atkName)?.cost ?? []).map((t) => inst(EID[t] ?? EID.Water));

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【0】harness 自驗（fixture 抓錯 ⇒ 後面全是假綠）');
{
  chk('0a 耿鬼ex = M6a 076/103、HP280、Stage2、【惡】、弱點【鬥】×2',
    String(GENG.setCode) === 'M6a' && Number(GENG.hp) === 280 && GENG.stage === 'Stage2'
    && GENG.pokemonType === 'Darkness' && GENG.weakness?.type === 'Fighting',
    JSON.stringify([GENG.setCode, GENG.hp, GENG.stage, GENG.pokemonType, GENG.weakness]));
  chk('0b ⭐卡面逐字錨（abilities[].effect；卡面改版／抓錯印刷會紅）',
    (GENG.abilities || []).find((a) => a.name === '死亡宣告')?.effect
      === '這隻寶可夢受到對手的寶可夢招式的傷害而【昏厥】時，自己擲1次硬幣。若為正面，則將使用招式的寶可夢【昏厥】。',
    String((GENG.abilities || []).find((a) => a.name === '死亡宣告')?.effect));
  chk('0c 卡面**沒有**「在戰鬥場」⇒ 備戰也要觸發（本檔 A4 行為端釘住）',
    !((GENG.abilities || []).find((a) => a.name === '死亡宣告')?.effect ?? '').includes('在戰鬥場'));
  chk('0d 攻擊方 fixture：急凍鳥（非 ex，1 張獎賞）／皮卡丘ex（ex，2 張獎賞＋勤奮之心）／超級路卡利歐ex',
    ICE.subtype !== 'ex' && PIKA.subtype === 'ex' && LUCA.subtype === 'ex'
    && (PIKA.abilities || []).some((a) => a.name === '勤奮之心')
    && atkIdx(LUCA, '波動突刺') === 0 && atkIdx(LUCA, '超級勇氣') === 1,
    JSON.stringify([ICE.subtype, PIKA.subtype, LUCA.subtype]));
  chk('0e 能量 id 依名稱查得到（硬編會付不出費用 → ATTACK 靜默 return → 假綠）',
    !!EID.Water && !!EID.Grass && !!EID.Lightning && !!EID.Metal && !!EID.Fighting && !!EID.Darkness,
    JSON.stringify(EID));
  chk('0f 中立填充卡（Basic／無特性／非太晶／HP≥60／【無】）抓得到', !!PLAIN, String(PLAIN?.name));
  chk('0g ⭐反安慰劑：死亡宣告是**純被動**，不可以被誤登記成主動特性（getUsableAbilities 不該列它）',
    !getUsableAbilities(
      mk({ active: inst(GENG.id) }, { active: inst(PLAIN.id) }), pool,
    ).some((u) => u.abilityName === '死亡宣告'));
}

// ── 共用盤面 ────────────────────────────────────────────────────────────────
/** 急凍鳥（非 ex）用冰雹 30 打 耿鬼ex（damage 250）⇒ 招式傷害 KO 戰鬥位 */
const boardIceVsGengActive = (extra = {}, p0Prize = 6, p1Prize = 6) => mk(
  { active: inst(ICE.id, { energyAttached: energyFor(ICE, '冰雹') }),
    bench: [inst(PLAIN.id)], prizes: prizes(p0Prize) },
  { active: inst(GENG.id, { damage: Number(GENG.hp) - 30 }),
    bench: [inst(PLAIN.id)], prizes: prizes(p1Prize) },
  extra);
const runIce = (st, heads) => act(st, { type: 'ATTACK', attackIndex: atkIdx(ICE, '冰雹') }, heads);

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【A】行為端主線：正面 ⇒ 使用招式的寶可夢【昏厥】；反面 ⇒ 完好（同一盤面只差擲幣）');
{
  const H = runIce(boardIceVsGengActive());
  const T = runIce(boardIceVsGengActive(), false);
  chk('A0 哨兵：耿鬼ex 確實因**招式傷害**昏厥（正／反面都一樣）',
    D0(H) == null && D0(T) == null, JSON.stringify([D0(H), D0(T)]));
  chk('A0 哨兵：攻擊方（急凍鳥）確實取得 2 張獎賞（耿鬼ex 是 ex）⇒ 6 − 2 = 4',
    PZ(H, 0) === 4 && PZ(T, 0) === 4, JSON.stringify([PZ(H, 0), PZ(T, 0)]));

  chk('A1 ⭐正面 ⇒ 使用招式的寶可夢（急凍鳥）真的【昏厥】（離場）',
    A0(H) == null, JSON.stringify([!!A0(H), A0(H)?.damage]));
  chk('A1 ⭐正面 ⇒ 急凍鳥本體進了攻擊方棄牌區',
    H.players[0].discard.some((c) => String(c.cardId) === String(ICE.id)),
    JSON.stringify(H.players[0].discard.map((c) => c.cardId)));
  chk('A1 ⭐正面 ⇒ **耿鬼ex 那一側**取得 1 張獎賞（急凍鳥非 ex）⇒ 6 − 1 = 5',
    PZ(H, 1) === 5, String(PZ(H, 1)));
  chk('A1 ⭐「死亡宣告」恰好啟動 1 次（雙觸發／重複 drain 會變 ≥2）',
    nLog(H, '「死亡宣告」啟動') === 1, String(nLog(H, '「死亡宣告」啟動')));

  chk('A2 ⭐反對照（同一盤面只差擲幣結果）：反面 ⇒ 攻擊方仍在場且 0 點',
    !!A0(T) && A0(T).damage === 0, JSON.stringify([!!A0(T), A0(T)?.damage]));
  chk('A2 ⭐反對照：反面 ⇒ 耿鬼ex 那一側**不取得**獎賞（仍是 6）',
    PZ(T, 1) === 6, String(PZ(T, 1)));
  chk('A2 ⭐反對照：反面也要留下 log（玩家看得到「擲到反面」）',
    nLog(T, '「死亡宣告」啟動：硬幣反面') === 1, LOGS(T).filter((x) => x.includes('死亡宣告')).join(' / '));
  chk('A2 ⭐不變量（補充，不取代上面的行為端斷言）：ATTACK 結束後待觸發佇列已清空',
    QEMPTY(H) && QEMPTY(T), JSON.stringify([QLEN(H), QLEN(T)]));
}

console.log('\n【A-ex】攻擊方是不是「寶可夢ex」⇒ 耿鬼ex 那一側拿到的獎賞張數要分開驗');
{
  // 皮卡丘ex（ex，2 張獎賞）＋ 身上有防 KO 特性「勤奮之心」（HP 全滿時受**招式傷害**不昏厥）
  const st = mk(
    { active: inst(PIKA.id, { energyAttached: energyFor(PIKA, '黃玉伏特') }), bench: [inst(PLAIN.id)] },
    { active: inst(GENG.id), bench: [inst(PLAIN.id)] });
  const r = act(st, { type: 'ATTACK', attackIndex: atkIdx(PIKA, '黃玉伏特') });
  chk('A3 哨兵：黃玉伏特 300 確實把 HP280 的耿鬼ex 打昏厥、攻擊方取 2 張（6 − 2 = 4）',
    D0(r) == null && PZ(r, 0) === 4, JSON.stringify([D0(r), PZ(r, 0)]));
  chk('A3 ⭐攻擊方是 ex ⇒ 耿鬼ex 那一側取得 **2** 張獎賞（6 − 2 = 4）',
    PZ(r, 1) === 4, String(PZ(r, 1)));
  chk('A3 ⭐攻擊方（皮卡丘ex）確實離場', A0(r) == null, JSON.stringify([!!A0(r), A0(r)?.damage]));

  // ⭐ 同一張卡也是【8】防 KO 不該被效果昏厥套用 的主角：
  chk('A4 ⭐⭐防 KO 特性（勤奮之心：卡面「受到**招式的傷害**而昏厥時」）**不該**擋住效果昏厥'
    + ' ⇒ 皮卡丘ex 仍然離場、也沒有留下 10 HP',
    A0(r) == null && !r.players[0].discard.some((c) => String(c.cardId) === String(PIKA.id) && c.damage === Number(PIKA.hp) - 10),
    JSON.stringify([!!A0(r), A0(r)?.damage]));
  // 正對照：同一張卡對**招式傷害**時，勤奮之心確實會擋（證明 harness 偵測得到防 KO）
  const st2 = mk(
    { active: inst(LUCA.id, { energyAttached: energyFor(LUCA, '超級勇氣') }), bench: [inst(PLAIN.id)] },
    { active: inst(PIKA.id), bench: [inst(PLAIN.id)] });
  const r2 = act(st2, { type: 'ATTACK', attackIndex: atkIdx(LUCA, '超級勇氣') });
  chk('A4 ⭐正對照：同一張皮卡丘ex 受到**招式傷害**時，勤奮之心確實生效（留 10 HP ⇒ damage = 190）',
    !!D0(r2) && D0(r2).damage === Number(PIKA.hp) - 10,
    JSON.stringify([!!D0(r2), D0(r2)?.damage]));
}

console.log('\n【B】卡面**沒有**「在戰鬥場」⇒ 耿鬼ex 在**備戰**被狙擊 KO 照樣觸發');
{
  const mkBench = (p1Prize = 6) => mk(
    { active: inst(ICE.id, { energyAttached: energyFor(ICE, '冰雹') }), bench: [inst(PLAIN.id)] },
    { active: inst(PLAIN.id),
      bench: [inst(GENG.id, { damage: Number(GENG.hp) - 30 }), inst(PLAIN.id)], prizes: prizes(p1Prize) });
  const H = runIce(mkBench());
  const T = runIce(mkBench(), false);
  chk('B0 哨兵：備戰的耿鬼ex 真的被冰雹（全體 30）打昏厥（正／反面都一樣）',
    !H.players[1].bench.some((b) => String(b.cardId) === String(GENG.id))
    && !T.players[1].bench.some((b) => String(b.cardId) === String(GENG.id)),
    JSON.stringify([H.players[1].bench.map((b) => b.cardId), T.players[1].bench.map((b) => b.cardId)]));
  chk('B0 哨兵：攻擊方取得 2 張獎賞（6 − 2 = 4）', PZ(H, 0) === 4, String(PZ(H, 0)));
  chk('B1 ⭐備戰被 KO + 正面 ⇒ 使用招式的寶可夢（急凍鳥）照樣【昏厥】',
    A0(H) == null, JSON.stringify([!!A0(H), A0(H)?.damage]));
  chk('B1 ⭐備戰被 KO + 正面 ⇒ 耿鬼ex 那一側取得 1 張獎賞（6 − 1 = 5）',
    PZ(H, 1) === 5, String(PZ(H, 1)));
  chk('B2 ⭐反對照：備戰被 KO + 反面 ⇒ 攻擊方完好（0 點）、獎賞不變',
    !!A0(T) && A0(T).damage === 0 && PZ(T, 1) === 6,
    JSON.stringify([!!A0(T), A0(T)?.damage, PZ(T, 1)]));
  chk('B2 ⭐不變量：全體傷害（addPendingPrize **排在** fireDefenderOnKO 前面的那條路徑）'
    + '結束後佇列一樣要清空',
    QEMPTY(H) && QEMPTY(T), JSON.stringify([QLEN(H), QLEN(T)]));
}

console.log('\n【C】⭐⭐★兩條 KO 管線等價（v6.347 撤回的就是這個判準）');
{
  // 同一盤面，只換招式：
  //   超級勇氣（attackIndex 1）走 engine.ts 主 ATTACK 管線（addPendingPrize → PASSIVE_ON_KO）
  //   波動突刺（attackIndex 0）走 effects.ts 中央 helper dealAttackDamageToTarget
  //                              （fireDefenderOnKO → addPendingPrize，順序相反）
  const mkLuca = () => mk(
    { active: inst(LUCA.id, { energyAttached: energyFor(LUCA, '超級勇氣') }), bench: [inst(PLAIN.id)] },
    { active: inst(GENG.id, { damage: 20 }), bench: [inst(PLAIN.id)] });
  const P1 = act(mkLuca(), { type: 'ATTACK', attackIndex: atkIdx(LUCA, '超級勇氣') });
  const P2 = act(mkLuca(), { type: 'ATTACK', attackIndex: atkIdx(LUCA, '波動突刺') });
  chk('C0 哨兵：兩條路徑都真的把耿鬼ex 打昏厥了（fixture 沒打死 ⇒ 整組無效）',
    D0(P1) == null && D0(P2) == null, JSON.stringify([D0(P1), D0(P2)]));
  chk('C0 哨兵：兩條路徑**真的是不同管線**（主管線寫「…取得 N 張獎賞卡。」；'
    + '中央 helper 寫「<招式名>：… 被擊倒！+N 張獎賞卡。」）',
    LOGS(P1).some((x) => x.includes('被擊倒！') && x.includes('取得 2 張獎賞卡'))
    && LOGS(P2).some((x) => x.includes('波動突刺：') && x.includes('被擊倒！+2 張獎賞卡')),
    JSON.stringify([LOGS(P1).filter((x) => x.includes('被擊倒')), LOGS(P2).filter((x) => x.includes('被擊倒'))]));

  chk('C1 ⭐⭐攻擊方剩餘獎賞兩條管線相同（v6.347：主管線 4、中央 helper 6 ⇒ 不等價）',
    PZ(P1, 0) === PZ(P2, 0) && PZ(P1, 0) === 4, JSON.stringify([PZ(P1, 0), PZ(P2, 0)]));
  // ⚠ 超級路卡利歐ex 是「超級進化」寶可夢ex ⇒ 被擊倒時對手取得 **3** 張獎賞（prizesForKO）。
  chk('C2 ⭐⭐耿鬼ex 那一側剩餘獎賞兩條管線相同（攻擊方是超級進化ex ⇒ 6 − 3 = 3）',
    PZ(P1, 1) === PZ(P2, 1) && PZ(P1, 1) === 3, JSON.stringify([PZ(P1, 1), PZ(P2, 1)]));
  chk('C3 ⭐⭐兩條管線都真的把攻擊方（超級路卡利歐ex）弄昏厥了',
    A0(P1) == null && A0(P2) == null, JSON.stringify([!!A0(P1), !!A0(P2)]));
  chk('C4 ⭐⭐兩條管線的「死亡宣告」啟動次數相同且恰為 1',
    nLog(P1, '「死亡宣告」啟動') === 1 && nLog(P2, '「死亡宣告」啟動') === 1,
    JSON.stringify([nLog(P1, '「死亡宣告」啟動'), nLog(P2, '「死亡宣告」啟動')]));
  chk('C5 ⭐⭐兩條管線攻擊方手牌張數相同（獎賞進手牌 ⇒ 差一張就是順序分岔）',
    P1.players[0].hand.length === P2.players[0].hand.length,
    JSON.stringify([P1.players[0].hand.length, P2.players[0].hand.length]));
  chk('C6 ⭐不變量：兩條管線結束後佇列都要清空',
    QEMPTY(P1) && QEMPTY(P2), JSON.stringify([QLEN(P1), QLEN(P2)]));
}

console.log('\n【D】卡面「受到…**傷害**而【昏厥】」⇒ 效果昏厥／檢查時昏厥 都不觸發');
{
  // D1 效果昏厥：耿鬼ex 的招式「渾沌傷痛」＝ 放 13 個傷害指示物（**不是**招式的傷害）
  const st = mk(
    { active: inst(GENG.id, { energyAttached: energyFor(GENG, '渾沌傷痛') }), bench: [inst(PLAIN.id)] },
    { active: inst(GENG.id, { damage: 150 }), bench: [inst(PLAIN.id)] });
  const victimIid = st.players[1].active.iid;
  let r = act(st, { type: 'ATTACK', attackIndex: atkIdx(GENG, '渾沌傷痛') });
  let g = 0;
  while (r.pendingSelection && g++ < 4) {
    r = act(r, { type: 'RESOLVE_SELECTION', effectKey: r.pendingSelection.effectKey,
      selectedIids: [victimIid], actorIdx: r.pendingSelection.actorIdx });
  }
  chk('D0 哨兵：渾沌傷痛（13 個指示物＝130）確實讓 damage 150 的耿鬼ex 昏厥',
    D0(r) == null, JSON.stringify([D0(r)?.damage, r.pendingSelection?.effectKey]));
  chk('D1 ⭐效果昏厥（放指示物）⇒ 死亡宣告**不**觸發：攻擊方仍在場且 0 點',
    !!A0(r) && A0(r).damage === 0, JSON.stringify([!!A0(r), A0(r)?.damage]));
  chk('D1 ⭐效果昏厥 ⇒ 被 KO 的那一側**不**取得獎賞（仍是 6）', PZ(r, 1) === 6, String(PZ(r, 1)));
  chk('D1 ⭐效果昏厥 ⇒ 完全沒有「死亡宣告」的 log', nLog(r, '死亡宣告') === 0,
    LOGS(r).filter((x) => x.includes('死亡宣告')).join(' / '));

  // D2 中毒檢查階段昏厥（寶可夢檢查，不是招式的傷害）
  const st2 = mk(
    { active: inst(ICE.id, { energyAttached: energyFor(ICE, '冰雹') }), bench: [inst(PLAIN.id)] },
    { active: inst(GENG.id, { damage: Number(GENG.hp) - 10, status: 'poisoned' }), bench: [inst(PLAIN.id)] });
  let r2 = act(st2, { type: 'END_TURN', actorIdx: 0 });
  let g2 = 0;
  while (r2.pendingSelection && g2++ < 6) {
    r2 = act(r2, { type: 'RESOLVE_SELECTION', effectKey: r2.pendingSelection.effectKey,
      selectedIids: [], actorIdx: r2.pendingSelection.actorIdx });
  }
  chk('D2 哨兵：中毒在寶可夢檢查中確實把耿鬼ex 打昏厥', D0(r2) == null,
    JSON.stringify([D0(r2)?.damage, D0(r2)?.status]));
  chk('D2 ⭐中毒檢查昏厥 ⇒ 死亡宣告**不**觸發（急凍鳥仍在場且 0 點）',
    !!A0(r2) && A0(r2).damage === 0, JSON.stringify([!!A0(r2), A0(r2)?.damage]));
  chk('D2 ⭐中毒檢查昏厥 ⇒ 完全沒有「死亡宣告」的 log', nLog(r2, '死亡宣告') === 0,
    LOGS(r2).filter((x) => x.includes('死亡宣告')).join(' / '));
  chk('D2 ⭐不變量：不該入列的路徑（效果昏厥／中毒檢查）結束後佇列當然也是空的',
    QEMPTY(r) && QEMPTY(r2), JSON.stringify([QLEN(r), QLEN(r2)]));
}

console.log('\n【E】特性被消除（【傳說的熔岩洞】：雙方場上**進化**寶可夢特性全消）⇒ 不觸發 ＋ 正對照');
{
  const R = runIce(boardIceVsGengActive({ activeStadium: inst(LAVA.id), activeStadiumOwnerIdx: 0 }));
  const C = runIce(boardIceVsGengActive());   // 正對照：同一盤面、沒有場地
  chk('E0 哨兵：兩邊的耿鬼ex（Stage2）都確實被招式傷害打昏厥',
    D0(R) == null && D0(C) == null, JSON.stringify([D0(R), D0(C)]));
  chk('E1 ⭐熔岩洞在場 ⇒ 死亡宣告被消除：攻擊方仍在場且 0 點',
    !!A0(R) && A0(R).damage === 0, JSON.stringify([!!A0(R), A0(R)?.damage]));
  chk('E1 ⭐熔岩洞在場 ⇒ 連硬幣都不該擲（完全沒有「死亡宣告」的 log）',
    nLog(R, '死亡宣告') === 0, LOGS(R).filter((x) => x.includes('死亡宣告')).join(' / '));
  chk('E1 ⭐熔岩洞在場 ⇒ 耿鬼ex 那一側不取得獎賞（仍是 6）', PZ(R, 1) === 6, String(PZ(R, 1)));
  chk('E2 ⭐正對照（差別只有場地）：沒有熔岩洞時照樣觸發（攻擊方昏厥、獎賞 6 − 1 = 5）',
    A0(C) == null && PZ(C, 1) === 5, JSON.stringify([!!A0(C), PZ(C, 1)]));
  chk('E3 ⭐不變量：特性被消除（不入列）與正對照（入列後已 drain）結束後佇列都是空的',
    QEMPTY(R) && QEMPTY(C), JSON.stringify([QLEN(R), QLEN(C)]));
}

console.log('\n【F】game-over 順序（獎賞先給攻擊方，再輪到死亡宣告）');
{
  // F1 耿鬼ex 那一側只剩 1 張獎賞 ⇒ 死亡宣告讓它取完 ⇒ 該側獲勝
  const F1 = runIce(boardIceVsGengActive({}, 6, 1));
  chk('F1 ⭐耿鬼ex 那一側剩 1 張獎賞 + 正面 ⇒ 取完獎賞、該側獲勝',
    F1.phase === 'game-over' && F1.winner === 1 && PZ(F1, 1) === 0,
    JSON.stringify([F1.phase, F1.winner, PZ(F1, 1)]));
  // F2 雙方都只剩 1 張：攻擊方的獎賞**先**結算完（addPendingPrize 在前）⇒ 攻擊方取完獲勝，
  //    死亡宣告不再結算（drain 遇到 game-over 就停）。⚠ 這條是**待站長裁示**的判例
  //    （官方 §17.2/§17.3/§17.19：雙方同時取完時改由「能不能從備戰放上戰鬥場」決勝／平手），
  //    目前引擎沒有平手概念 ⇒ 先把**現行行為**釘住，避免無聲漂移。
  const F2 = runIce(boardIceVsGengActive({}, 1, 1));
  chk('F2 ⭐雙方都剩 1 張獎賞 ⇒ 攻擊方先取完獲勝、死亡宣告不再結算（攻擊方仍在場）',
    F2.phase === 'game-over' && F2.winner === 0 && !!A0(F2) && PZ(F2, 0) === 0,
    JSON.stringify([F2.phase, F2.winner, !!A0(F2), PZ(F2, 0)]));
  // F3/F4 ⭐⭐ v6.347 症狀的直接重現條件：耿鬼ex 那一側只剩 1 張獎賞時，
  //   若 on-KO 效果跑在 addPendingPrize **之前**，該側會先取完獎賞 → game-over →
  //   攻擊方那一次 KO 的獎賞就整個被吞掉（v6.347 實測：中央 helper 攻擊方取 0 張）。
  //   正確行為：攻擊方先取 2 張（6 − 2 = 4），之後才輪到死亡宣告 ⇒ 耿鬼ex 那一側取完獲勝。
  const mkLuca1 = () => mk(
    { active: inst(LUCA.id, { energyAttached: energyFor(LUCA, '超級勇氣') }), bench: [inst(PLAIN.id)] },
    { active: inst(GENG.id, { damage: 20 }), bench: [inst(PLAIN.id)], prizes: prizes(1) });
  const F3 = act(mkLuca1(), { type: 'ATTACK', attackIndex: atkIdx(LUCA, '波動突刺') });   // 中央 helper
  const F4 = act(mkLuca1(), { type: 'ATTACK', attackIndex: atkIdx(LUCA, '超級勇氣') });   // 主管線
  chk('F3 ⭐⭐中央 helper 管線：耿鬼ex 那一側剩 1 張 ⇒ 攻擊方**仍然先**取得 2 張獎賞（6 − 2 = 4）'
    + '，之後死亡宣告讓該側取完而獲勝',
    PZ(F3, 0) === 4 && F3.phase === 'game-over' && F3.winner === 1,
    JSON.stringify([PZ(F3, 0), F3.phase, F3.winner]));
  chk('F4 ⭐⭐主管線同一盤面結果完全相同（攻擊方剩 4 張／game-over／winner=1）',
    PZ(F4, 0) === PZ(F3, 0) && F4.phase === F3.phase && F4.winner === F3.winner,
    JSON.stringify([PZ(F4, 0), F4.phase, F4.winner]));
  chk('F5 ⭐不變量：終局（game-over）路徑結束後佇列也要清空 —— drain 的 break 只是不再結算，'
    + '不可以把待觸發項留在 state 裡帶到下一個 action',
    QEMPTY(F1) && QEMPTY(F2) && QEMPTY(F3) && QEMPTY(F4),
    JSON.stringify([QLEN(F1), QLEN(F2), QLEN(F3), QLEN(F4)]));
}

console.log('\n【H】⭐⭐不是「主 ATTACK handler 直接結算」的 dispatch —— RESOLVE_SELECTION 路徑');
{
  // 超級噴火龍Yex｜炎獄狂爆Y（M-P-J 18069）：卡面傷害欄是空的，全部走 regPost
  //   → chooseOppPokemonDamage(280) 開 opp-poke-choose picker，
  //   **真正的傷害與 KO 發生在下一個 dispatch（RESOLVE_SELECTION 的 snipe-variable resolver）**。
  //   ⇒ 入列在 effects.fireDefenderOnKO ④，出列在 RESOLVE_SELECTION 末端的 sanityKOSweep（engine L3438）。
  //   這一組就是在釘「死亡宣告在**同一個 RESOLVE_SELECTION 內**結算完，沒有被拖到下一個 action」。
  const mkY = (gengWhere, p1Prize = 6) => {
    const g = inst(GENG.id);
    return mk(
      { active: inst(YCHAR.id, { energyAttached: energyFor(YCHAR, '炎獄狂爆Y') }), bench: [inst(PLAIN.id)] },
      gengWhere === 'active'
        ? { active: g, bench: [inst(PLAIN.id)], prizes: prizes(p1Prize) }
        : { active: inst(PLAIN.id), bench: [g, inst(PLAIN.id)], prizes: prizes(p1Prize) });
  };
  const runY = (where, heads) => {
    const st = mkY(where);
    const gIid = where === 'active' ? st.players[1].active.iid
      : st.players[1].bench.find((b) => String(b.cardId) === String(GENG.id)).iid;
    const afterAtk = act(st, { type: 'ATTACK', attackIndex: atkIdx(YCHAR, '炎獄狂爆Y') }, heads);
    const afterSel = act(afterAtk, { type: 'RESOLVE_SELECTION',
      effectKey: afterAtk.pendingSelection?.effectKey, selectedIids: [gIid],
      actorIdx: afterAtk.pendingSelection?.actorIdx ?? 0 }, heads);
    return { afterAtk, afterSel, gIid };
  };

  const HA = runY('active');
  chk('H0 哨兵：ATTACK 這一個 dispatch 只開了 picker、還沒造成傷害（耿鬼ex 仍在場且 0 點）',
    HA.afterAtk.pendingSelection?.effectKey === 'snipe-variable'
    && !!D0(HA.afterAtk) && D0(HA.afterAtk).damage === 0,
    JSON.stringify([HA.afterAtk.pendingSelection?.effectKey, D0(HA.afterAtk)?.damage]));
  chk('H0 哨兵：ATTACK 這一個 dispatch 沒有入列（還沒 KO）', QEMPTY(HA.afterAtk), String(QLEN(HA.afterAtk)));
  chk('H1 ⭐⭐RESOLVE_SELECTION 內耿鬼ex 被招式傷害 KO（280 ≥ HP280）',
    D0(HA.afterSel) == null, JSON.stringify(D0(HA.afterSel)));
  chk('H1 ⭐⭐死亡宣告在**同一個 RESOLVE_SELECTION** 內就結算完（攻擊方離場，沒有被拖到下一個 action）',
    A0(HA.afterSel) == null, JSON.stringify([!!A0(HA.afterSel), A0(HA.afterSel)?.damage]));
  chk('H1 ⭐攻擊方取得 2 張獎賞（耿鬼ex 是 ex）⇒ 6 − 2 = 4',
    PZ(HA.afterSel, 0) === 4, String(PZ(HA.afterSel, 0)));
  chk('H1 ⭐耿鬼ex 那一側取得 3 張獎賞（超級噴火龍Yex 是超級進化ex）⇒ 6 − 3 = 3',
    PZ(HA.afterSel, 1) === 3, String(PZ(HA.afterSel, 1)));
  chk('H1 ⭐「死亡宣告」恰好啟動 1 次', nLog(HA.afterSel, '「死亡宣告」啟動') === 1,
    String(nLog(HA.afterSel, '「死亡宣告」啟動')));
  chk('H1 ⭐不變量：RESOLVE_SELECTION 結束後佇列已清空（沒有殘留到下一個 action）',
    QEMPTY(HA.afterSel), String(QLEN(HA.afterSel)));

  const HT = runY('active', false);
  chk('H2 ⭐反對照（同一條 RESOLVE_SELECTION 路徑，只差擲幣結果）：反面 ⇒ 攻擊方仍在場且 0 點',
    !!A0(HT.afterSel) && A0(HT.afterSel).damage === 0 && PZ(HT.afterSel, 1) === 6,
    JSON.stringify([!!A0(HT.afterSel), A0(HT.afterSel)?.damage, PZ(HT.afterSel, 1)]));
  chk('H2 ⭐哨兵：反面時耿鬼ex 一樣被 KO（差異只來自擲幣）', D0(HT.afterSel) == null,
    JSON.stringify(D0(HT.afterSel)));

  const HB = runY('bench');
  chk('H3 ⭐⭐RESOLVE_SELECTION ＋ **備戰**被狙擊 KO ⇒ 照樣在同一個 dispatch 內觸發',
    !HB.afterSel.players[1].bench.some((b) => String(b.cardId) === String(GENG.id))
    && A0(HB.afterSel) == null && PZ(HB.afterSel, 1) === 3 && QEMPTY(HB.afterSel),
    JSON.stringify([HB.afterSel.players[1].bench.map((b) => b.cardId), !!A0(HB.afterSel),
      PZ(HB.afterSel, 1), QLEN(HB.afterSel)]));
}

console.log('\n【G】中央性（呼叫點數量／不得掛錯表／禁令）');
{
  const eff = readFileSync(join(ROOT, 'src/lib/game/effects.ts'), 'utf8');
  const eng = readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8');
  const cnt = (s, re) => (s.match(re) || []).length;

  chk('G1 ⭐入列只有 2 個呼叫點（effects.fireDefenderOnKO ④ ＋ engine 主管線），且都走同一支 gate',
    cnt(eff, /firePassiveOnKoAfterPrize\(/g) === 2   // 1 宣告 + 1 呼叫
    && cnt(eng, /firePassiveOnKoAfterPrize\(/g) === 1,
    JSON.stringify([cnt(eff, /firePassiveOnKoAfterPrize\(/g), cnt(eng, /firePassiveOnKoAfterPrize\(/g)]));
  chk('G2 ⭐⭐出列**只有 1 個**呼叫點（engine.sanityKOSweep）—— 多一個就可能在 addPendingPrize 之前跑',
    cnt(eng, /drainOnKoAfterPrize\(/g) === 1 && cnt(eff, /drainOnKoAfterPrize\(/g) === 1,
    JSON.stringify([cnt(eng, /drainOnKoAfterPrize\(/g), cnt(eff, /drainOnKoAfterPrize\(/g)]));
  chk('G3 ⭐drain 點在 sanityKOSweep **函式開頭**（在 `let s = state` 之前 ⇒ !anyKO 的 early return 也吃得到）',
    eng.indexOf('state = drainOnKoAfterPrize(state, pool);') > 0
    && eng.indexOf('state = drainOnKoAfterPrize(state, pool);')
       < eng.indexOf('  const dIdx = (1 - attackerIdx) as 0 | 1;\r\n  let s = state;'.replace(/\r\n/g, eng.includes('\r\n') ? '\r\n' : '\n')),
    String(eng.indexOf('state = drainOnKoAfterPrize(state, pool);')));

  chk('G4 三張 on-KO 表的名字不可相交（相交＝同一效果掛兩個 hook＝雙觸發）',
    [...PASSIVE_ON_KO_AFTER_PRIZE.keys()].filter((n) => PASSIVE_ON_KO.has(n) || PASSIVE_KO_PRIZE_ADJUST.has(n)).length === 0,
    [...PASSIVE_ON_KO_AFTER_PRIZE.keys()].join('、'));
  chk('G5 下限斷言：PASSIVE_ON_KO_AFTER_PRIZE 必須含「死亡宣告」（表被清空＝守衛變安慰劑）',
    PASSIVE_ON_KO_AFTER_PRIZE.has('死亡宣告') && PASSIVE_ON_KO_AFTER_PRIZE.size >= 1,
    [...PASSIVE_ON_KO_AFTER_PRIZE.keys()].join('、'));
  chk('G6 卡面沒有「在戰鬥場」⇒「死亡宣告」必須登記進 PASSIVE_ON_KO_BENCH_ALSO',
    PASSIVE_ON_KO_BENCH_ALSO.has('死亡宣告'),
    [...PASSIVE_ON_KO_BENCH_ALSO].join('、'));

  // 禁令掃描（v6.347 註解裡的三條）
  const s0 = eff.indexOf('export const PASSIVE_ON_KO_AFTER_PRIZE = new Map');
  const s1 = eff.indexOf('\n]);', s0);
  const block = s0 > 0 && s1 > s0 ? eff.slice(s0, s1) : '';
  chk('G7 ⭐禁令掃描器自身有效（真的切到 PASSIVE_ON_KO_AFTER_PRIZE 區塊）',
    block.length > 200 && block.includes('死亡宣告'), String(block.length));
  chk('G8 ⭐禁令①②③：區塊內不得出現 markFaintByEffect／selfKOInstance／PASSIVE_KO_RETALIATION'
    + '（那三種寫法會把「效果昏厥」偽裝成「招式傷害昏厥」）',
    !/markFaintByEffect|selfKOInstance|PASSIVE_KO_RETALIATION/.test(block),
    block.match(/markFaintByEffect|selfKOInstance|PASSIVE_KO_RETALIATION/g)?.join('、') ?? '');
  chk('G9 ⭐效果昏厥要走既有中央路徑 koTargetByAttackEffect（獎賞走 koByAttackDamage=false）',
    /koTargetByAttackEffect\(/.test(block), 'block 內找不到 koTargetByAttackEffect');
}

console.log('\n【I】⭐⭐佇列不變量 ＋ 「每一條入列路徑最後都會跑到 sanityKOSweep」的結構前提');
{
  // I1 本檔跑過的**每一次** action（含 ATTACK / RESOLVE_SELECTION / END_TURN / ATTACH_ENERGY）
  //    結束後，待觸發佇列都必須是空的。殘留＝下一個 action 才觸發（時機錯、甚至換人了），而且無聲。
  const dirty = RUNS.map((x, i) => ({ ...x, i })).filter((x) => x.q > 0);
  chk('I1 ⭐⭐不變量：本檔每一次 action 結束後 _onKoAfterPrize 都必須是空的（有殘留＝drain 有缺口）',
    dirty.length === 0,
    JSON.stringify(dirty.slice(0, 5)));
  chk('I2 下限斷言：真的有在追蹤（action 次數 ≥ 20，否則 I1 是空真）',
    RUNS.length >= 20, String(RUNS.length));

  // I3 ⭐反安慰劑：直接把一筆**合法的**待觸發項塞進 state，再跑一個**普通** action
  //    （ATTACH_ENERGY，不是 ATTACK / RESOLVE_SELECTION）——
  //    驗證 engine dispatcher 末端那個**條件式**雙邊 sweep 真的會把它 drain 掉。
  //    這同時證明 I1 不是「因為佇列從來沒東西」而恆真。
  const seedBase = mk(
    { active: inst(ICE.id), bench: [inst(PLAIN.id)], hand: [inst(EID.Water)] },
    { active: inst(PLAIN.id), bench: [inst(PLAIN.id)] });
  const ghost = inst(GENG.id);   // 假裝「剛剛被招式傷害 KO」的耿鬼ex 快照
  const seeded = { ...seedBase, _onKoAfterPrize: [{
    ability: '死亡宣告', dIdx: 1, aIdx: 0, koInst: ghost,
    attackerIid: seedBase.players[0].active.iid }] };
  chk('I3 哨兵：塞進去的那一筆真的在 state 裡（長度 1）', QLEN(seeded) === 1, String(QLEN(seeded)));
  const rI3 = act(seeded, { type: 'ATTACH_ENERGY',
    energyIid: seedBase.players[0].hand[0].iid, targetIid: seedBase.players[0].active.iid });
  chk('I3 ⭐反安慰劑：普通 action（ATTACH_ENERGY）的 dispatcher 末端 sweep 真的 drain 了那一筆'
    + ' ⇒ 急凍鳥被死亡宣告效果昏厥、耿鬼ex 那一側取得 1 張獎賞（6 − 1 = 5）',
    A0(rI3) == null && PZ(rI3, 1) === 5 && nLog(rI3, '「死亡宣告」啟動') === 1,
    JSON.stringify([!!A0(rI3), PZ(rI3, 1), nLog(rI3, '「死亡宣告」啟動')]));
  chk('I3 ⭐反安慰劑：drain 之後佇列必須被清空（不清空＝下一個 action 會再觸發一次）',
    QEMPTY(rI3), String(QLEN(rI3)));

  // I4/I5 結構前提：I1 之所以能成立，是因為**所有會入列的路徑都只長在 ATTACK / RESOLVE_SELECTION
  //   這兩個 handler 上**，而這兩個 handler 都有**無條件**的 sanityKOSweep。
  //   （engine dispatcher 末端那個雙邊 sweep 是條件式的 `phase==='playing' && !pendingSelection`，
  //     不能當成 tail 保證 —— 所以必須把前提本身釘住，哪天有新卡打破就翻紅，而不是無聲。）
  const eng2 = readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8');
  chk('I4 ⭐⭐ATTACK handler 與 RESOLVE_SELECTION handler 都有**無條件**的 sanityKOSweep'
    + '（入列路徑的唯一兩個宿主；少一個 drain 就有缺口）',
    eng2.includes('newState = sanityKOSweep(newState, aIdx, pool);')
    && eng2.includes('newState = sanityKOSweep(newState, actorIdx, pool);'),
    JSON.stringify([eng2.includes('newState = sanityKOSweep(newState, aIdx, pool);'),
      eng2.includes('newState = sanityKOSweep(newState, actorIdx, pool);')]));

  // I5：掃描全站，確認「會入列」的中央 helper 沒有長在**特性／訓練家** handler 上
  //   （那些 handler 沒有無條件 sanityKOSweep ⇒ 會變成 drain 缺口）。
  const SRC = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const q = join(d, e.name);
      if (e.isDirectory()) walk(q); else if (e.name.endsWith('.ts')) SRC.push(q);
    }
  };
  walk(join(ROOT, 'src/lib/game'));
  const OWNER = /^\s*(regPost|regPre|regR|regA|regAByName|TRAINER_EFFECTS\.set|ABILITY_EFFECTS\.set|export function|function|const)\b/;
  const ENQ = /(dealAttackDamageToTarget\(|fireDefenderOnKO\(|hitBenchAll\(|firePassiveOnKoAfterPrize\()/;
  const bad = []; let scanned = 0;
  for (const f of SRC) {
    const L = readFileSync(f, 'utf8').split(/\r?\n/);
    for (let i = 0; i < L.length; i++) {
      if (!ENQ.test(L[i])) continue;
      scanned++;
      let owner = '(top-level)';
      for (let j = i; j >= 0 && j > i - 200; j--) {
        if (OWNER.test(L[j]) && L[j].trim().length > 0) { owner = L[j].trim().slice(0, 100); break; }
      }
      if (/^(regA|regAByName|TRAINER_EFFECTS\.set|ABILITY_EFFECTS\.set)/.test(owner)) {
        bad.push(`${f.split(/[\\/]/).pop()}:${i + 1} ← ${owner}`);
      }
    }
  }
  chk('I5 掃描器自身有效（真的掃到會入列的中央 helper 呼叫點；≥ 60 處）', scanned >= 60, String(scanned));
  chk('I5 ⭐⭐「會入列」的中央 helper 不得掛在特性／訓練家 handler 上'
    + '（那些 handler 沒有無條件 sanityKOSweep ⇒ 佇列會殘留到下一個 action 才無聲觸發）',
    bad.length === 0, bad.slice(0, 4).join(' / '));
}

console.log(`\n=== v6.355 耿鬼ex｜死亡宣告：PASS ${pass} / FAIL ${fail} ===`);
process.exit(fail === 0 ? 0 : 1);
