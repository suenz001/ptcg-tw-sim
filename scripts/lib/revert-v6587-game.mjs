// v6.587：排名本人欄位改用主題 class；僅還原合法改動，原版面鎖保留。
export const V6587_GAME_PAIRS = [
  [
    "                <div class:tourn-standing-self={s.mine} style=\"text-align:center;\">{s.rank}</div>",
    "                <div style=\"text-align:center;{s.mine ? 'color:#ffd56b;font-weight:700;' : ''}\">{s.rank}</div>"
  ],
  [
    "                <div class:tourn-standing-self={s.mine} style=\"overflow:hidden;text-overflow:ellipsis;white-space:nowrap;\">{s.name}{#if s.mine} （你）{/if}</div>",
    "                <div style=\"overflow:hidden;text-overflow:ellipsis;white-space:nowrap;{s.mine ? 'color:#ffd56b;font-weight:700;' : ''}\">{s.name}{#if s.mine} （你）{/if}</div>"
  ],
  [
    "  .tourn-bracket-head { font-weight: 600; color: #cfe0f8; margin-bottom: 8px; }\n  /* v6.587：自己的名次與名字走主題樣式，不依賴動態 style 的色碼序列化。 */\n  .tourn-standing-self { color: #ffd56b; font-weight: 700; }",
    "  .tourn-bracket-head { font-weight: 600; color: #cfe0f8; margin-bottom: 8px; }"
  ]
];
