// 診斷（不進 CI）：電腦對手怎麼用「老大的指令」（Gust 系支援者）？
//
// 背景：訓練家階段「支援者一律先打、同是支援者照手牌順序」⇒ 老大的指令排在前面就會打出去，
//   拉誰上來則是「剩餘 HP 最少」的那隻，不管自己打不打得倒、打不打得動牠。
// 用法：node scripts/diag-ai-gust.mjs [每組局數=2] [--out 報告.md]
//   含老大的指令的預組 × 3 個對手 × 局數；兩邊都用工作樹 AI。
// 量的東西（全部從引擎盤面讀）：
//   - 打出老大的指令的次數；拉上來的那隻**這回合**有沒有被打倒、有沒有受到傷害；打完有沒有出招
//   - 自己回合開始時手上有老大的指令、這回合還沒用過支援者的回合數（機會）
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildAiBundle, loadLivePool, playGame, firstPlayerOf } from './lib/ai-sim-harness.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GAMES = Number(process.argv[2] ?? 2);
const oi = process.argv.indexOf('--out');
const OUT = oi >= 0 ? process.argv[oi + 1] : null;
const mod = await buildAiBundle(ROOT);
const pool = loadLivePool(ROOT);
const ai = (st, i) => mod.aiNew(st, pool, i);
const GUST = new Set(['老大的指令']);
const isGust = (c) => GUST.has(pool.get(String(c?.cardId))?.name);
const presets = mod.PRESET_DECKS.filter((d) => d.entries.some((e) => GUST.has(pool.get(String(e.cardId))?.name)));

const T = { games: 0, wins: 0, oppTurns: 0, plays: 0, ko: 0, dmg: 0, noDmg: 0, attacked: 0, playsWhenOtherSup: 0 };
const t0 = Date.now();
for (let a = 0; a < presets.length; a++) for (const off of [1, 7, 19]) {
  const b = (a + off) % mod.PRESET_DECKS.length;
  for (let g = 0; g < GAMES; g++) {
    const seat = g % 2;
    const decks = seat === 0 ? [presets[a], mod.PRESET_DECKS[b]] : [mod.PRESET_DECKS[b], presets[a]];
    const seed = 515151 + a * 1009 + off * 97 + g;
    let cur = null;   // 這回合打出的老大的指令：{ turn, target, hpBefore, attacked }
    let lastTurnSeen = null;
    const finalize = () => { cur = null; };
    const r = playGame({ mod, pool, decks, agents: [ai, ai], seed, firstPlayer: firstPlayerOf(seed), onStep: (prev, act, next, actor) => {
      if (prev.phase !== 'playing') return;
      if (prev.activePlayerIndex === seat && prev.turn !== lastTurnSeen && prev.turnPhase === 'main' && !prev.pendingSelection) {
        lastTurnSeen = prev.turn; finalize();
        const me = prev.players[seat];
        if (!me.supporterPlayedThisTurn && me.hand.some(isGust)) T.oppTurns++;
      }
      if (actor !== seat) return;
      const me = prev.players[seat];
      if (act.type === 'PLAY_TRAINER') {
        const h = me.hand.find((c) => c.iid === act.iid);
        if (h && isGust(h)) {
          T.plays++;
          if (me.hand.some((c) => c.iid !== h.iid && pool.get(String(c.cardId))?.subtype === 'Supporter')) T.playsWhenOtherSup++;
          cur = { turn: prev.turn, target: null, attacked: false, scored: false };
        }
      }
      if (act.type === 'RESOLVE_SELECTION' && prev.pendingSelection?.effectKey === 'gust-opp' && cur && !cur.target) {
        cur.target = act.selectedIids?.[0] ?? null;
      }
      if (act.type === 'ATTACK' && cur && cur.target && !cur.scored) {
        cur.attacked = true; cur.scored = true; T.attacked++;
        const opp = (st) => st.players[1 - seat];
        const before = [opp(prev).active, ...opp(prev).bench].find((c) => c?.iid === cur.target);
        const after = [opp(next).active, ...opp(next).bench].find((c) => c?.iid === cur.target);
        if (before && !after) T.ko++;
        else if (before && after && (after.damage ?? 0) > (before.damage ?? 0)) T.dmg++;
        else T.noDmg++;
      }
      if (act.type === 'END_TURN' && cur && cur.target && !cur.scored) { T.noDmg++; cur.scored = true; }
    } });
    T.games++; if (r.winner === seat) T.wins++;
  }
}
const pct = (x, n) => (n ? (100 * x / n).toFixed(1) + '%' : '—');
const L = [];
const P = (s = '') => { L.push(s); console.log(s); };
P(`# 診斷：老大的指令（${presets.length} 副含老大的指令的預組 × 3 個對手 × ${GAMES} 局 = ${T.games} 局，${((Date.now() - t0) / 1000).toFixed(0)} 秒）`);
P(`- 受測方勝率：${T.wins}/${T.games}（${pct(T.wins, T.games)}）`);
P(`- 機會（回合開始手上有老大的指令、還沒用支援者）：${T.oppTurns} 回合`);
P(`- 打出老大的指令：${T.plays} 次（其中手上另有別的支援者：${T.playsWhenOtherSup}）`);
P(`  - 拉上來的那隻這回合被打倒：${T.ko}（${pct(T.ko, T.plays)}）`);
P(`  - 受到傷害但沒倒：${T.dmg}（${pct(T.dmg, T.plays)}）`);
P(`  - 沒受到任何傷害（含沒出招）：${T.noDmg}（${pct(T.noDmg, T.plays)}）；打完有出招：${T.attacked}`);
if (OUT) writeFileSync(OUT, L.join('\n') + '\n');
