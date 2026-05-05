# J 標效果實裝 Audit

Generated: 2026-05-05T08:00:24.942Z

## Summary

- J cards: 355
- Total records: 545
- Abilities: 58
- Attacks: 416
- Card-only/no structured attacks: 71
- Implemented: 306
- Needs review: 19
- Missing candidates: 23
- Not needed: 197

## By Status

- implemented: 306
- missing: 23
- needs-review: 19
- not-needed: 197

## By Priority

- P0-none: 126
- P1: 124
- P2: 108
- P3: 60
- P4: 127

## By Category

- ability-other: 29
- active-ability: 15
- attack-other: 27
- bench-damage: 15
- cannot-retreat: 5
- coin-flip: 32
- cross-turn-effect: 31
- deck-search-or-deck-op: 41
- discard-pile-op: 6
- energy-op: 34
- field-passive: 8
- hand-op: 27
- heal: 9
- no-structured-effect: 71
- passive-damage-reduce: 4
- passive-max-hp: 2
- pure-damage: 126
- status-condition: 32
- variable-damage: 31

## First 100 Missing Candidates

| Priority | Set | ID | Card | Kind | Name | Category | Text |
|---|---:|---:|---|---|---|---|---|
| P3 | M-P-J | 18073 | 超級呆殼獸ex | Attack | 殼捲風旋轉 | cross-turn-effect | 180 在下個對手的回合，這隻寶可夢受到招式的傷害時，在使用招式的寶可夢身上放置12個傷害指示物。 |
| P4 | M3 | 17989 | 狙射樹梟ex | Ability | 狙擊手之眼 | ability-other | 若對手的手牌為4張，則這隻寶可夢使用招式所需的【無】能量全部消除。 |
| P4 | M3 | 17996 | 白海獅 | Ability | 沖刷 | ability-other | 在自己的回合時，可不限次數使用。選擇1個自己的備戰寶可夢身上附加的【水】能量，改附於戰鬥寶可夢身上。 |
| P4 | M3 | 18003 | 勒克貓 | Ability | 鬥志戰吼 | ability-other | 若對手的戰鬥寶可夢為「寶可夢【ex】」，則這隻寶可夢就算在自己的最初回合或者剛使出的回合，也可進化。 |
| P4 | M3 | 18007 | 超級皮可西ex | Ability | 光之翼 | ability-other | 這隻寶可夢不會受到對手的寶可夢特性效果的影響。 |
| P4 | M3 | 18017 | 土地雲 | Attack | 巨岩墜落 | attack-other | 50 這個招式的傷害不計算抵抗力。 |
| P4 | M3 | 18026 | 耿鬼 | Ability | 無限之影 | ability-other | 這隻寶可夢受到對手的寶可夢招式的傷害而【昏厥】時，不丟棄這隻寶可夢，而是放回手牌。（寶可夢以外的卡全部丟棄。） |
| P4 | M3 | 18029 | 伊裴爾塔爾ex | Attack | 死亡靈魂 | attack-other | 將對手所有剩餘HP為「50」以下的寶可夢【昏厥】。 |
| P4 | M3 | 18030 | 古劍豹 | Attack | 狡兔三窟 | attack-other | 20 若希望，將這隻寶可夢與備戰寶可夢互換。 |
| P4 | M3 | 18396 | 狙射樹梟ex | Ability | 狙擊手之眼 | ability-other | 若對手的手牌為4張，則這隻寶可夢使用招式所需的【無】能量全部消除。 |
| P4 | M3 | 18399 | 超級皮可西ex | Ability | 光之翼 | ability-other | 這隻寶可夢不會受到對手的寶可夢特性效果的影響。 |
| P4 | M3 | 18401 | 伊裴爾塔爾ex | Attack | 死亡靈魂 | attack-other | 將對手所有剩餘HP為「50」以下的寶可夢【昏厥】。 |
| P4 | M3 | 18415 | 超級皮可西ex | Ability | 光之翼 | ability-other | 這隻寶可夢不會受到對手的寶可夢特性效果的影響。 |
| P4 | M4 | 18429 | 九尾 | Attack | 九尾狐搬動 | attack-other | 選擇1隻自己的備戰寶可夢，將所選的寶可夢身上放置的傷害指示物，全部改放於對手的戰鬥寶可夢身上。 |
| P2 | M4 | 18438 | 信使鳥 | Attack | 幸福禮物 | hand-op | 雙方玩家若希望，各自從自己的手牌選擇最多3張基本能量卡，以任意方式附於自己的寶可夢身上。（對手先選擇。） |
| P4 | M4 | 18481 | 堅果啞鈴 | Ability | 整人擊落 | ability-other | 在對手的回合，這張卡因對手的招式・特性・物品卡・支援者卡的效果而從牌庫被丟棄時，將對手的牌庫上方8張卡丟棄。 |
| P4 | M4 | 18482 | 勾帕路翁ex | Ability | 金屬之路 | ability-other | 在自己的回合，從備戰區將這隻寶可夢放置於戰鬥場時，可使用1次。選擇自己的場上寶可夢身上附加的任意數量的【鋼】能量卡，改附於這隻寶可夢身上。 |
| P3 | M4 | 18488 | 探探鼠 | Ability | 監視之眼 | field-passive | 只要這隻寶可夢在場上，雙方的所有寶可夢身上放置的傷害指示物，無法改放於其他寶可夢身上。 |
| P4 | 083 | 18538 | 勾帕路翁ex | Ability | 金屬之路 | ability-other | 在自己的回合，從備戰區將這隻寶可夢放置於戰鬥場時，可使用1次。選擇自己的場上寶可夢身上附加的任意數量的【鋼】能量卡，改附於這隻寶可夢身上。 |
| P4 | MC | 16768 | 瑪力露麗ex | Ability | 收集泡泡 | ability-other | 在自己的回合時，可不限次數使用。選擇1個自己的場上寶可夢身上附加的能量，改附於這隻寶可夢身上。 |
| P3 | MC | 16871 | 小碎鑽 | Ability | 雙重屬性 | field-passive | 只要這隻寶可夢在場上，改為【鬥】與【超】2種屬性。 |
| P3 | MC | 17090 | 青木的樹枕尾熊 | Ability | 無力充能 | active-ability | 若這隻寶可夢在備戰區，則在自己的回合時可使用1次。從自己的手牌選擇1張能量卡，附於戰鬥場的「青木的寶可夢」身上。 |
| P3 | MC | 18343 | 小碎鑽 | Ability | 雙重屬性 | field-passive | 只要這隻寶可夢在場上，改為【鬥】與【超】2種屬性。 |

## First 50 Needs Review (same effect name exists; verify exact card behavior)

| Priority | Set | ID | Card | Kind | Name | Category | Evidence |
|---|---:|---:|---|---|---|---|---|
| P4 | M-P-J | 18517 | 電龍 | Ability | 同步脈衝 | ability-other | 同步脈衝 |
| P1 | M3 | 18041 | 掘地兔 | Attack | 地震 | bench-damage | \|地震', 地震 |
| P3 | M4 | 18422 | 鐵殼蛹 | Ability | 堅硬身軀 | passive-damage-reduce | 堅硬身軀 |
| P4 | M4 | 18427 | 布里卡隆 | Ability | 尖刺盔甲 | ability-other | 尖刺盔甲 |
| P4 | M4 | 18449 | 電龍 | Ability | 同步脈衝 | ability-other | 同步脈衝 |
| P2 | M4 | 18450 | 電飛鼠 | Attack | 小使者 | deck-search-or-deck-op | \|小使者', 小使者 |
| P2 | M4 | 18457 | 超能妙喵 | Attack | 戲法舞步 | energy-op | \|戲法舞步', 戲法舞步 |
| P4 | M4 | 18463 | 樹才怪 | Attack | 岩石投擲 | attack-other | \|岩石投擲', 岩石投擲 |
| P4 | M4 | 18471 | 千針魚 | Ability | 毒刺 | ability-other | 毒刺 |
| P1 | M4 | 18471 | 千針魚 | Attack | 毒液衝擊 | status-condition | \|毒液衝擊', 毒液衝擊 |
| P3 | M4 | 18475 | 灰塵山 | Ability | 垃圾洩氣 | field-passive | 垃圾洩氣 |
| P3 | M4 | 18478 | 金屬怪 | Attack | 防守壓制 | cross-turn-effect | \|防守壓制', 防守壓制 |
| P3 | M4 | 18482 | 勾帕路翁ex | Attack | 力量衝撞 | cross-turn-effect | \|力量衝撞', 力量衝撞 |
| P4 | 083 | 18525 | 電龍 | Ability | 同步脈衝 | ability-other | 同步脈衝 |
| P3 | 083 | 18529 | 金屬怪 | Attack | 防守壓制 | cross-turn-effect | \|防守壓制', 防守壓制 |
| P3 | 083 | 18538 | 勾帕路翁ex | Attack | 力量衝撞 | cross-turn-effect | \|力量衝撞', 力量衝撞 |
| P1 | MC | 16638 | 藍鱷 | Attack | 咬碎 | coin-flip | \|咬碎', 咬碎 |
| P2 | MC | 17061 | 青木的姆克兒 | Attack | 小使者 | deck-search-or-deck-op | \|小使者', 小使者 |
| P4 | MC | 17080 | 青木的勇士雄鷹 | Attack | 勇鳥猛攻 | attack-other | \|勇鳥猛攻', 勇鳥猛攻 |
