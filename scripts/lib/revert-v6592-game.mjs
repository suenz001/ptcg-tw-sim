// v6.592：僅還原六組已宣告的遊戲頁新增內容，額外差異一律保留。
import assert from 'node:assert/strict';
import { normEol } from './eol-agnostic.mjs';
export const V6592_GAME_PAIRS = [
  [
    "  import PlayerClockNotice from \"./PlayerClockNotice.svelte\";\n  import type { PlayerClockState } from \"$lib/tournament/player-clock\";\n  let tPlayerClock = $state<PlayerClockState | null>(null);\n  let playerClockSeen = { room: '', version: -1, revision: -1, at: -1 };\n  function adoptPlayerClock(r: any) {\n    if (!r || typeof r.version !== 'number' || r.version < tVersion) return;\n    if (playerClockSeen.room !== tActiveRoom) playerClockSeen = { room: tActiveRoom, version: -1, revision: -1, at: -1 };\n    const revision = Number(r.playerClockRevision ?? 0), at = Number(r.serverNow ?? 0);\n    if (r.version < playerClockSeen.version || revision < playerClockSeen.revision || at < playerClockSeen.at) return;\n    playerClockSeen = { room: tActiveRoom, version: r.version, revision, at };\n    tPlayerClock = r.playerClock ?? null;\n  }\n\n",
    ""
  ],
  [
    "      adoptPlayerClock(sst);\n",
    ""
  ],
  [
    "    tPlayerClock = null; playerClockSeen = { room: '', version: -1, revision: -1, at: -1 };\n",
    ""
  ],
  [
    "      adoptPlayerClock(fr);\n",
    ""
  ],
  [
    "      adoptPlayerClock(r);\n",
    ""
  ],
  [
    "\n{#if isTournament && !isTournSpectator && game?.phase === \"playing\" && tPlayerClock && tPlayerClock.gameStart === game.gameStartTime && (mySeatIdx === 0 || mySeatIdx === 1)}\n  <PlayerClockNotice clock={tPlayerClock} seat={mySeatIdx} now={tNow} />\n{/if}\n",
    ""
  ]
];
export function revertV6592Game(source) {
  let s = normEol(source);
  for (const [current, previous] of V6592_GAME_PAIRS) {
    assert.equal(s.split(current).length - 1, 1, 'v6592遊戲頁還原錨點必須唯一');
    s = s.replace(current, previous);
  }
  return s;
}
