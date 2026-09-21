/**
 * v6.422 守衛：終局收尾 finalizeEndgameV6422（applyActionImpl 末端，全站唯一一處）
 *
 * 【修的兩件事】（v6.421 列管，fable 5.1 審查提出、我自行重現屬實）
 *   ① 終局盤面殘留選擇視窗：取完最後一張獎賞之後，招式的 postFn 仍開出一般 picker
 *      ⇒ 盤面寫著 game-over 卻留著 pendingSelection（全卡實測 108 招）。applyActionImpl 開頭
 *      對 game-over 早退 ⇒ 那個視窗永遠解不掉。
 *   ② 對戰紀錄先寫「A 取得所有獎賞卡，獲勝！」，效果結算完之後才出現「⚖️ … 平手」。
 *      ⇒ 只改寫**本 action 新增**、且**與最終結果不一致**的勝利宣告：句尾「，…獲勝！」換成
 *        「（勝負待效果結算完畢後判定）」，前半句的事實陳述不變。
 *
 * 【HEAD-FAIL】BASE（v6.421）上 finalizeEndgameV6422 不存在 ⇒ 單元段用哨兵逐條紅（Rule 41）。
 *   實測 PASS 5 / FAIL 21；BASE 也綠的是刻意的：P1（前置）、L4／L5（零回歸）、Z0（下限）、Z1（不丟例外）。
 *   BASE 實測：108 個終局盤面殘留 picker、90 個平手終局的紀錄裡留著勝利宣告。
 * 【突變】有勝方時不改寫／連舊紀錄一起改／不清 picker／只清檯面不清佇列／永遠複製盤面／
 *   名字比對改回 regex 或 indexOf —— 皆紅（fable 5.1 第一輪抓到後兩者原本存活，已補 U1b、U8～U10）。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripCommentsBlankChecked } from './lib/strip-comments.mjs';
import { normEol } from './lib/eol-agnostic.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.v6422-s.js'), E = join(ROOT, '.v6422-e.ts'), O = join(ROOT, '.v6422-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export * as ENG from './src/lib/game/engine';\n"
  + "export { ATTACK_POST } from './src/lib/game/effects/_shared';\n"
  + "import './src/lib/game/effects';\n");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { ENG: M, ATTACK_POST } = await import(pathToFileURL(O).href);
const MISSING = Symbol('missing');
// ⭐ Rule 41：BASE 上沒有這個函式 ⇒ 用哨兵讓每一條各自紅，不整支 throw
const finalize = typeof M.finalizeEndgameV6422 === 'function' ? M.finalizeEndgameV6422 : () => MISSING;

let pass = 0, fail = 0; const failed = [];
const T = (name, fn) => {
  let r = false, d = '';
  try { const o = fn(); r = o === true || (o && o.ok === true); d = (o && o.d) || ''; }
  catch (e) { d = 'throw: ' + String(e && e.message).slice(0, 160); }
  if (r) { pass++; console.log('  PASS', name); } else { fail++; failed.push(name.split(' ')[0]); console.log('  FAIL', name, d ? ' :: ' + d : ''); }
};

// ── 卡池 ──
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map(); const hij = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
    if (!c || c.id == null) continue;
    pool.set(String(c.id), c);
    if (['H', 'I', 'J'].includes(c.regulationMark || '')) hij.push(c);
  }
}
const eid = (n) => { for (const [id, c] of pool) if (c.name === n) return id; return null; };
const EN = { Colorless: eid('基本【惡】能量'), Water: eid('基本【水】能量'), Grass: eid('基本【草】能量'),
  Lightning: eid('基本【雷】能量'), Fighting: eid('基本【鬥】能量'), Darkness: eid('基本【惡】能量'),
  Fire: eid('基本【火】能量'), Psychic: eid('基本【超】能量'), Metal: eid('基本【鋼】能量') };
const isPlainBasic = (c) => c.supertype === 'Pokemon' && !(c.abilities || []).length && !c.evolvesFrom && !/ex\b/.test(c.name || '') && !c.rulesText;
const WEAK = hij.find((c) => isPlainBasic(c) && Number(c.hp) <= 40);
const TANK = hij.filter((c) => c.supertype === 'Pokemon' && !(c.abilities || []).length).sort((a, b) => Number(b.hp) - Number(a.hp))[0];
const findByName = (name, atk) => hij.find((c) => c.name === name && (c.attacks || []).some((a) => a.name === atk));
let n = 0;
const inst = (cid, e = [], x = {}) => ({ iid: 'i' + (++n), cardId: String(cid), damage: 0, energyAttached: e, ...x });
const en = (t) => ({ iid: 'e' + (++n), cardId: String(EN[t] ?? EN.Darkness), damage: 0, energyAttached: [] });
const energiesFor = (card, ai, extra = 4) => { const es = []; for (const t of (card.attacks[ai].cost || [])) es.push(en(t)); for (let i = 0; i < extra; i++) es.push(en('Darkness')); return es; };
const mulberry32 = (a) => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const hashStr = (x) => { let h = 2166136261; for (let i = 0; i < x.length; i++) { h ^= x.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const OLD_LOG = [{ turn: 1, playerIndex: null, message: '上一局的紀錄：Z 取得所有獎賞卡，獲勝！' }];
const baseState = (P0, P1, log = []) => ({ phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
  isFirstTurn: false, log, pendingSelection: null, activeStadium: null, players: [P0, P1] });
const attack = (st, ai) => { const o = M.applyAction(st, { type: 'ATTACK', attackIndex: ai }, pool); return o?.state ?? o; };
const newMsgs = (prev, s) => (s.log || []).slice(prev.log.length).map((e) => e.message);
const winClaims = (msgs) => msgs.filter((m) => typeof m === 'string' && m.endsWith('獲勝！'));
const tag = (s) => JSON.stringify({ ph: s.phase, w: s.winner, d: !!s.isDraw, why: s.winReason, pend: s.pendingSelection?.effectKey ?? null });

console.log('\n【P】前置');
const MIRA = findByName('密勒頓', '打雷'); const MIRA_AI = MIRA ? MIRA.attacks.findIndex((a) => a.name === '打雷') : -1;
const CRIM = findByName('超級炎武王ex', '深紅炸彈'); const CRIM_AI = CRIM ? CRIM.attacks.findIndex((a) => a.name === '深紅炸彈') : -1;
T('P1 測資卡都找得到（密勒頓｜打雷、超級炎武王ex｜深紅炸彈、WEAK、TANK）', () => ({ ok: !!MIRA && !!CRIM && !!WEAK && !!TANK
  && /這隻寶可夢也受到30點傷害/.test(MIRA.attacks[MIRA_AI].effect) && /這隻寶可夢也受到60點傷害/.test(CRIM.attacks[CRIM_AI].effect) }));

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【L】對戰紀錄：與最終結果不一致的提早勝利宣告要改寫');
function mira(bBench, aDmg, names = ['A', 'B'], log = []) {
  const P0 = { name: names[0], active: inst(MIRA.id, energiesFor(MIRA, MIRA_AI, 0), { damage: aDmg }), bench: [], hand: [], deck: [inst(WEAK.id)], discard: [], prizes: [inst(WEAK.id)] };
  const P1 = { name: names[1], active: inst(WEAK.id), bench: Array.from({ length: bBench }, () => inst(TANK.id)), hand: [], deck: [inst(WEAK.id)], discard: [], prizes: [inst(WEAK.id), inst(WEAK.id)] };
  const st = baseState(P0, P1, log); return [st, attack(st, MIRA_AI)];
}
T('L1 ⭐⭐⭐【HEAD-FAIL】密勒頓｜打雷 自傷昏厥 ⇒ 平手：本 action 的紀錄裡不得再有任何「…獲勝！」', () => {
  const [st, s] = mira(0, 90); const m = newMsgs(st, s);
  return { ok: s.isDraw === true && winClaims(m).length === 0 && m.some((x) => /⇒ 本局平手！$/.test(x)), d: tag(s) + '\n' + m.join(' / ') };
});
T('L2 ⭐⭐【HEAD-FAIL】改寫只換句尾：「A 取得所有獎賞卡（勝負待效果結算完畢後判定）」—— 事實陳述保留', () => {
  const [st, s] = mira(0, 90); const m = newMsgs(st, s);
  return { ok: m.includes('A 取得所有獎賞卡（勝負待效果結算完畢後判定）') && m.includes('B 沒有可上場的寶可夢（勝負待效果結算完畢後判定）'), d: m.join(' / ') };
});
T('L3 ⭐⭐【HEAD-FAIL】勝方換人（深紅炸彈：A 取完但自傷昏厥、B 也取完、只有 B 可放置 ⇒ B 勝）⇒ 只改寫 A 的宣告、B 的宣告保留', () => {
  const P0 = { name: 'A', active: inst(CRIM.id, energiesFor(CRIM, CRIM_AI, 0), { damage: Number(CRIM.hp) - 10 }), bench: [], hand: [], deck: [inst(WEAK.id)], discard: [], prizes: [inst(WEAK.id)] };
  const P1 = { name: 'B', active: inst(WEAK.id), bench: [inst(TANK.id)], hand: [], deck: [inst(WEAK.id)], discard: [], prizes: [inst(WEAK.id), inst(WEAK.id), inst(WEAK.id)] };
  const st = baseState(P0, P1); const s = attack(st, CRIM_AI); const m = newMsgs(st, s); const c = winClaims(m);
  return { ok: s.winner === 1 && c.length >= 1 && c.every((x) => / B 獲勝！$|^B 取得所有獎賞卡，獲勝！$/.test(x))
    && m.includes('A 取得所有獎賞卡（勝負待效果結算完畢後判定）'), d: tag(s) + '\n' + m.join(' / ') };
});
T('L4 ⭐零回歸：勝負與宣告一致時一個字都不改（密勒頓不昏厥 ⇒ A 勝，「A 取得所有獎賞卡，獲勝！」原樣保留）', () => {
  const [st, s] = mira(0, 0); const m = newMsgs(st, s);
  return { ok: s.winner === 0 && m.includes('A 取得所有獎賞卡，獲勝！') && !m.some((x) => x.includes('勝負待效果結算')), d: m.join(' / ') };
});
T('L5 ⭐⭐之前的紀錄（已推上伺服器）絕不改寫：舊行物件參照不變、文字不變', () => {
  const log = OLD_LOG.slice(); const [st, s] = mira(0, 90, ['A', 'B'], log);
  return { ok: s.isDraw === true && s.log[0] === OLD_LOG[0] && s.log[0].message === OLD_LOG[0].message, d: s.log[0]?.message };
});
T('L6 ⭐⭐【HEAD-FAIL】雙方同名、最終平手 ⇒ 仍然改寫（平手時任何勝利宣告都不成立）', () => {
  const [st, s] = mira(0, 90, ['玩家', '玩家']); const m = newMsgs(st, s);
  return { ok: s.isDraw === true && winClaims(m).length === 0, d: m.join(' / ') };
});

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【U】finalizeEndgameV6422 單元（直呼中央，避免被上游 gate 遮蔽）');
const mk = (over) => ({ phase: 'game-over', turn: 9, players: [{ name: 'A' }, { name: 'B' }], log: [], ...over });
const L = (m) => ({ turn: 9, playerIndex: null, message: m });
T('U1 ⭐⭐【HEAD-FAIL】終局殘留的 pendingSelection／pendingChainQueue 用 delete 清掉（不是寫 undefined）', () => {
  const r = finalize({ log: [] }, mk({ winner: 0, pendingSelection: { effectKey: 'x', actorIdx: 0 }, pendingChainQueue: [{ effectKey: 'y' }] }));
  return { ok: r !== MISSING && !('pendingSelection' in r) && !('pendingChainQueue' in r) && r.winner === 0, d: r === MISSING ? 'MISSING' : JSON.stringify(Object.keys(r)) };
});
T('U2 ⭐⭐【HEAD-FAIL】平手：新增的兩種宣告句型都改寫；「無法抽牌，…獲勝！」也算', () => {
  const prev = { log: [L('舊：A 取得所有獎賞卡，獲勝！')] };
  const r = finalize(prev, mk({ isDraw: true, log: [prev.log[0], L('A 取得所有獎賞卡，獲勝！'), L('B 沒有可上場的寶可夢，A 獲勝！'), L('B 無法抽牌，A 獲勝！'), L('⚖️ X ⇒ 本局平手！')] }));
  if (r === MISSING) return { ok: false, d: 'MISSING' };
  const m = r.log.map((e) => e.message);
  return { ok: m[0] === '舊：A 取得所有獎賞卡，獲勝！' && m[1] === 'A 取得所有獎賞卡（勝負待效果結算完畢後判定）'
    && m[2] === 'B 沒有可上場的寶可夢（勝負待效果結算完畢後判定）' && m[3] === 'B 無法抽牌（勝負待效果結算完畢後判定）' && m[4] === '⚖️ X ⇒ 本局平手！', d: m.join(' / ') };
});
T('U3 ⭐⭐【HEAD-FAIL】有勝方：只改寫宣告別人獲勝的那幾行', () => {
  const r = finalize({ log: [] }, mk({ winner: 1, log: [L('A 取得所有獎賞卡，獲勝！'), L('B 取得所有獎賞卡，獲勝！'), L('A 沒有可上場的寶可夢，B 獲勝！')] }));
  if (r === MISSING) return { ok: false, d: 'MISSING' };
  const m = r.log.map((e) => e.message);
  return { ok: m[0] === 'A 取得所有獎賞卡（勝負待效果結算完畢後判定）' && m[1] === 'B 取得所有獎賞卡，獲勝！' && m[2] === 'A 沒有可上場的寶可夢，B 獲勝！', d: m.join(' / ') };
});
T('U4 ⭐反安慰劑：U3 的輸入若勝方是 A ⇒ 改寫的必須換成 B 的兩行（證明勝方真的被讀到，不是固定改第一行）', () => {
  const r = finalize({ log: [] }, mk({ winner: 0, log: [L('A 取得所有獎賞卡，獲勝！'), L('B 取得所有獎賞卡，獲勝！'), L('A 沒有可上場的寶可夢，B 獲勝！')] }));
  if (r === MISSING) return { ok: false, d: 'MISSING' };
  const m = r.log.map((e) => e.message);
  return { ok: m[0] === 'A 取得所有獎賞卡，獲勝！' && m[1].endsWith('（勝負待效果結算完畢後判定）') && m[2].endsWith('（勝負待效果結算完畢後判定）'), d: m.join(' / ') };
});
T('U5 ⭐雙方同名＋有勝方 ⇒ 分不出宣告的是誰 ⇒ 不改寫', () => {
  const r = finalize({ log: [] }, { ...mk({ winner: 1, log: [L('玩家 取得所有獎賞卡，獲勝！')] }), players: [{ name: '玩家' }, { name: '玩家' }] });
  return { ok: r !== MISSING && r.log[0].message === '玩家 取得所有獎賞卡，獲勝！', d: r === MISSING ? 'MISSING' : r.log[0].message };
});
T('U1b ⭐⭐【HEAD-FAIL】只有佇列殘留（檯面沒有 picker）也要清掉（applyEndgameVerdictV6361 只清檯面）', () => {
  const r = finalize({ log: [] }, mk({ winner: 0, pendingChainQueue: [{ effectKey: 'y' }] }));
  return { ok: r !== MISSING && !('pendingChainQueue' in r) && !('pendingSelection' in r), d: r === MISSING ? 'MISSING' : JSON.stringify(Object.keys(r)) };
});
T('U1c ⭐⭐【HEAD-FAIL】值為 undefined 但 key 還在 ⇒ 也 delete（v6.417 同理由）；null 不動', () => {
  const r = finalize({ log: [] }, mk({ winner: 0, pendingSelection: undefined }));
  const r2 = finalize({ log: [] }, mk({ winner: 0, pendingSelection: null }));
  return { ok: r !== MISSING && !('pendingSelection' in r) && r2 !== MISSING && r2.pendingSelection === null };
});
T('U8 ⭐⭐【HEAD-FAIL】玩家名稱含全形逗號、宣告正確 ⇒ 一字不改（審查者實測：舊的 regex 會把名字切斷）', () => {
  const nm = ['小明，大王', 'B'];
  const r = finalize({ log: [] }, { ...mk({ winner: 0, log: [L('小明，大王 取得所有獎賞卡，獲勝！'), L('B 沒有可上場的寶可夢，小明，大王 獲勝！')] }), players: [{ name: nm[0] }, { name: nm[1] }] });
  return { ok: r !== MISSING && r.log[0].message === '小明，大王 取得所有獎賞卡，獲勝！' && r.log[1].message === 'B 沒有可上場的寶可夢，小明，大王 獲勝！', d: r === MISSING ? 'MISSING' : r.log.map((e) => e.message).join(' / ') };
});
T('U9 ⭐⭐【HEAD-FAIL】名字含逗號、最終平手 ⇒ 改寫時名字完整保留（只切掉已知後綴）', () => {
  const r = finalize({ log: [] }, { ...mk({ isDraw: true, log: [L('小明，大王 取得所有獎賞卡，獲勝！'), L('B 沒有可上場的寶可夢，小明，大王 獲勝！')] }), players: [{ name: '小明，大王' }, { name: 'B' }] });
  return { ok: r !== MISSING && r.log[0].message === '小明，大王 取得所有獎賞卡（勝負待效果結算完畢後判定）' && r.log[1].message === 'B 沒有可上場的寶可夢（勝負待效果結算完畢後判定）', d: r === MISSING ? 'MISSING' : r.log.map((e) => e.message).join(' / ') };
});
T('U10 ⭐⭐一個名字是另一個的後綴（「大王」vs「小明，大王」）⇒ 取較長的那個判定宣告者', () => {
  const pl = [{ name: '大王' }, { name: '小明，大王' }];
  const r = finalize({ log: [] }, { ...mk({ winner: 1, log: [L('大王 沒有可上場的寶可夢，小明，大王 獲勝！'), L('小明，大王 沒有可上場的寶可夢，大王 獲勝！')] }), players: pl });
  return { ok: r !== MISSING && r.log[0].message === '大王 沒有可上場的寶可夢，小明，大王 獲勝！'
    && r.log[1].message === '小明，大王 沒有可上場的寶可夢（勝負待效果結算完畢後判定）', d: r === MISSING ? 'MISSING' : r.log.map((e) => e.message).join(' / ') };
});
T('U6 ⭐沒有要改的東西時回傳同一個物件（不製造無謂的盤面差分）', () => {
  const nx = mk({ winner: 0, log: [L('A 取得所有獎賞卡，獲勝！')] });
  const r = finalize({ log: [] }, nx); return { ok: r === nx, d: r === MISSING ? 'MISSING' : '' };
});
T('U7 ⭐非勝利宣告的行不動（含「獲勝」但不是句尾宣告的敘述）', () => {
  const r = finalize({ log: [] }, mk({ isDraw: true, log: [L('若擲出正面則獲勝的招式失敗了'), L('A 使出「必勝」')] }));
  return { ok: r !== MISSING && r.log[0].message === '若擲出正面則獲勝的招式失敗了' && r.log[1].message === 'A 使出「必勝」' };
});

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【Z】全卡掃描：終局盤面不得留有 picker');
{
  const PUNK = eid('龐克頭盔');
  const byName = new Map();
  for (const c of hij) if (c.supertype === 'Pokemon') { if (!byName.has(c.name)) byName.set(c.name, []); byName.get(c.name).push(c); }
  let tried = 0, over = 0; const pend = [], thrown = [], claimBad = [];
  const orig = Math.random;
  for (const key of ATTACK_POST.keys()) {
    const [cn, an] = key.split('|'); const c = (byName.get(cn) || []).find((x) => x.attacks.some((a) => a.name === an)); if (!c) continue;
    const ai = c.attacks.findIndex((a) => a.name === an);
    for (const aBench of [0, 1]) {
      Math.random = mulberry32(hashStr('G' + key)); tried++;
      try {
        const P0 = { name: 'A', active: inst(c.id, energiesFor(c, ai), { damage: Math.max(0, Number(c.hp) - 10) }), bench: aBench ? [inst(WEAK.id)] : [], hand: [], deck: [inst(WEAK.id), inst(WEAK.id), inst(WEAK.id)], discard: [], prizes: [inst(WEAK.id)] };
        const P1 = { name: 'B', active: inst(WEAK.id, [], PUNK ? { toolAttached: inst(PUNK) } : {}), bench: [inst(TANK.id)], hand: [], deck: [inst(WEAK.id)], discard: [], prizes: [inst(WEAK.id), inst(WEAK.id)] };
        const st = baseState(P0, P1); const s = attack(st, ai);
        if (s.phase !== 'game-over') continue;
        over++;
        if (s.pendingSelection || (s.pendingChainQueue ?? []).length) pend.push(key + ' aBench=' + aBench + ' ' + tag(s));
        // 紀錄一致性：最終平手 ⇒ 本 action 不得留有任何「…獲勝！」
        if (s.isDraw === true && winClaims(newMsgs(st, s)).length) claimBad.push(key + ' aBench=' + aBench);
      } catch (e) { thrown.push(key + ' :: ' + String(e && e.message).slice(0, 80)); }
    }
  }
  Math.random = orig;
  T('Z0 ⭐掃描器下限：真的走到大量終局盤面', () => ({ ok: tried > 2000 && over > 800, d: JSON.stringify({ tried, over }) }));
  T('Z1 ⭐⭐⭐0 個丟例外', () => ({ ok: thrown.length === 0, d: thrown.slice(0, 6).join('\n') }));
  T('Z2 ⭐⭐⭐【HEAD-FAIL】終局盤面 0 個殘留 picker（BASE 實測數十個）', () => ({ ok: pend.length === 0, d: pend.length + '\n' + pend.slice(0, 6).join('\n') }));
  T('Z3 ⭐⭐【HEAD-FAIL】最終平手的終局：本 action 的紀錄 0 個勝利宣告', () => ({ ok: claimBad.length === 0, d: claimBad.length + '\n' + claimBad.slice(0, 6).join('\n') }));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【K】結構');
{
  const ENGs = normEol(readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8'));
  const ENGc = stripCommentsBlankChecked(ENGs);
  const cnt = (re) => (ENGc.match(re) || []).length;
  T('K1 ⭐⭐【HEAD-FAIL】finalizeEndgameV6422 恰好一個呼叫點，且在 applyActionImpl 的 return 之前', () => {
    const i = ENGc.indexOf('next = finalizeEndgameV6422(state, next);');
    const tail = i >= 0 ? ENGc.slice(i, ENGc.indexOf('\n}', i)) : '';
    return { ok: cnt(/finalizeEndgameV6422\(/g) === 2 && i > 0 && /\n\s*return next;\s*$/.test(tail), d: String(cnt(/finalizeEndgameV6422\(/g)) };
  });
  T('K2 ⭐⭐【HEAD-FAIL】哨兵成對（2 組）', () => ({ ok: (ENGs.match(/>>> v6422-/g) || []).length === 2 && (ENGs.match(/<<< v6422-/g) || []).length === 2 }));
  T('K3 ⭐收尾區塊裡不寫 undefined 給 pending 兩個 key（v6.417 同理由）', () => {
    const b = (ENGs.match(/\/\/ >>> v6422-endgame-finalize-helper\n[\s\S]*?\/\/ <<< v6422-endgame-finalize-helper/) || [''])[0];
    const bc = stripCommentsBlankChecked(b);
    return { ok: b.length > 500 && !/pending(Selection|ChainQueue)\s*:\s*undefined/.test(bc) && /delete \(c as \{ pendingSelection\?: unknown \}\)\.pendingSelection;/.test(bc) };
  });
}

console.log(`\nv6.422 守衛：PASS ${pass} / FAIL ${fail}` + (fail ? '（紅：' + failed.join('、') + '）' : ''));
if (fail) process.exit(1);
