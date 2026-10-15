// v6.571 對戰紀錄「昏厥」那一行整行標紅：對戰頁（+page.svelte）的「逐位元還原表」（單一來源；IRON_RULES Rule 38）
//   v6.571 新增 .log-line.log-ko-line 樣式（判準在 log_format.ts lineClass）。
//   test-v6441 先用這張表還原成 v6.570（16e5e75e），再接更早的表；其餘仍必須逐位元相同（Rule 40，不放寬）。
//   表由 difflib 產生、當場驗證可逐位元還原 v6.570；行為由 test-v6571 守。
export const V6571_GAME_PAIRS = [
  ["  }\n  /* ⭐v6.571（站長：「讓『昏厥』那行變紅」）：有寶可夢真的昏厥的那一行（判準在 log_format.ts lineClass） */\n  .log-line.log-ko-line {\n    background:rgba(255,90,90,.10); border-left:3px solid #ff6b6b; padding-left:.3rem; color:#ffb4b4;\n  }\n  .log-line.log-private {", "  }\n  .log-line.log-private {"],
];
