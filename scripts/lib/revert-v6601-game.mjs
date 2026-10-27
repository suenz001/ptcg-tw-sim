import { revertV6602Game } from './revert-v6602-game.mjs';
// v6.601 我的錦標賽對戰標勝敗：對戰頁的「逐位元還原表」（單一來源；IRON_RULES Rule 38）
//   釘住對戰頁位元組的舊守衛先用這裡還原成 v6.600（ac3f40a4）。表由 difflib 產生、當場驗證可逐位元還原；行為由 test-v6601 守。
import assert from 'node:assert/strict';
import { normEol } from './eol-agnostic.mjs';
export const V6601_GAME_PAIRS = [["                <li>\n                  <ReplayRowLabel meta={{ kind: 'tournament', p1name: tm.p1name, p2name: tm.p2name, result: tm.result }} />   <!-- ⭐v6.601 勝／敗／雙敗（伺服器 v1.74 起才有） -->\n                  <div class=\"muted replay-hint\">{myTournMatchLine(tm)}</div>\n", "                <li>\n                  <div class=\"replay-names\"><b>{tm.p1name || '?'}</b> vs <b>{tm.p2name || '?'}</b></div>\n                  <div class=\"muted replay-hint\">{myTournMatchLine(tm)}</div>\n"]];
export function revertV6601Game(source) {
  let s = normEol(revertV6602Game(source));
  for (const [current, previous] of V6601_GAME_PAIRS) {
    assert.equal(s.split(current).length - 1, 1, 'v6601 對戰頁還原錨點必須唯一');
    s = s.replace(current, previous);
  }
  return s;
}
