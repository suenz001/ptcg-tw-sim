# J 標效果實裝 Audit

Generated: 2026-05-04T12:22:25.854Z

## Summary

- J cards: 355
- Total records: 545
- Abilities: 58
- Attacks: 416
- Card-only/no structured attacks: 71
- Implemented: 207
- Needs review: 54
- Missing candidates: 87
- Not needed: 197

## By Status

- implemented: 207
- missing: 87
- needs-review: 54
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
| P2 | M-P-J | 18065 | 大嘴娃 | Attack | 雙重食客 | hand-op | 60× 從自己的手牌將最多2張能量卡丟棄，造成其張數×60點傷害。 |
| P3 | M-P-J | 18071 | 怪顎龍 | Ability | 暴龍根性 | passive-max-hp | 若這隻寶可夢身上附有特殊能量卡，則這隻寶可夢的最大HP「+150」。 |
| P3 | M-P-J | 18073 | 超級呆殼獸ex | Attack | 殼捲風旋轉 | cross-turn-effect | 180 在下個對手的回合，這隻寶可夢受到招式的傷害時，在使用招式的寶可夢身上放置12個傷害指示物。 |
| P3 | M-P-J | 18505 | 黏美龍 | Ability | 黏滑失足 | field-passive | 只要這隻寶可夢在場上，對手的戰鬥寶可夢【撤退】時，對手擲1次硬幣。若為反面，則【撤退】所需的能量不丟棄，不用進行互換。這個特性的效果不會重複。 |
| P3 | M-P-J | 18513 | 小木靈 | Ability | 怨恨進化 | active-ability | 在自己的回合時可使用1次。從自己的手牌選擇1張從這隻寶可夢進化而來的卡，放置於這隻寶可夢身上完成進化。然後，在完成進化的寶可夢身上放置2個傷害指示物。（無法在自己的最初回合使用。） |
| P3 | M3 | 17986 | 彩粉蝶 | Ability | 大飛翅 | active-ability | 在自己的回合時可使用1次。對手將對手自己的手牌全部翻回反面並重洗，放回牌庫下方。然後，對手從牌庫抽出4張卡。 |
| P4 | M3 | 17989 | 狙射樹梟ex | Ability | 狙擊手之眼 | ability-other | 若對手的手牌為4張，則這隻寶可夢使用招式所需的【無】能量全部消除。 |
| P3 | M3 | 17991 | 烈箭鷹 | Ability | 穹天狩獵 | active-ability | 在自己的回合時可使用1次。擲1次硬幣若為正面，則在不看正面的情況下，從對手的手牌選擇1張，將其丟棄。 |
| P2 | M3 | 17993 | 焰后蜥ex | Attack | 詭計 | deck-search-or-deck-op | 從自己的牌庫任意選擇最多2張卡加入手牌。並且重洗牌庫。 |
| P4 | M3 | 17996 | 白海獅 | Ability | 沖刷 | ability-other | 在自己的回合時，可不限次數使用。選擇1個自己的備戰寶可夢身上附加的【水】能量，改附於戰鬥寶可夢身上。 |
| P3 | M3 | 18000 | 冰雪巨龍 | Ability | 凍原堡壘 | field-passive | 只要這隻寶可夢在場上，自己的所有身上附有【水】能量卡的寶可夢，受到對手的寶可夢招式的傷害「-50」點。這個特性的效果不會重複。 |
| P4 | M3 | 18003 | 勒克貓 | Ability | 鬥志戰吼 | ability-other | 若對手的戰鬥寶可夢為「寶可夢【ex】」，則這隻寶可夢就算在自己的最初回合或者剛使出的回合，也可進化。 |
| P2 | M3 | 18005 | 咚咚鼠 | Attack | 擺尾發電 | discard-pile-op | 從自己的棄牌區選擇最多與對手的所有寶可夢身上附加的能量的數量相同數量的「基本【雷】能量」卡，以任意方式附於自己的【雷】寶可夢身上。 |
| P4 | M3 | 18007 | 超級皮可西ex | Ability | 光之翼 | ability-other | 這隻寶可夢不會受到對手的寶可夢特性效果的影響。 |
| P2 | M3 | 18007 | 超級皮可西ex | Attack | 射攻月亮 | hand-op | 120+ 若希望，從自己的手牌將最多4張能量卡丟棄，增加其張數×40點傷害。 |
| P2 | M3 | 18008 | 大嘴娃 | Attack | 雙重食客 | hand-op | 60× 從自己的手牌將最多2張能量卡丟棄，造成其張數×60點傷害。 |
| P2 | M3 | 18016 | 河馬獸 | Attack | 龍捲風噴射 | deck-search-or-deck-op | 80 在這個回合，若從手牌使出了「塔拉剛」，則將對手的牌庫上方3張卡丟棄。 |
| P4 | M3 | 18017 | 土地雲 | Attack | 巨岩墜落 | attack-other | 50 這個招式的傷害不計算抵抗力。 |
| P2 | M3 | 18017 | 土地雲 | Attack | 螺旋關節 | hand-op | 120 選擇1個這隻寶可夢身上附加的能量，放回手牌。 |
| P3 | M3 | 18021 | 怪顎龍 | Ability | 暴龍根性 | passive-max-hp | 若這隻寶可夢身上附有特殊能量卡，則這隻寶可夢的最大HP「+150」。 |
| P4 | M3 | 18025 | 鬼斯通 | Attack | 纏擾 | attack-other | 在對手的戰鬥寶可夢身上放置3個傷害指示物。 |
| P4 | M3 | 18026 | 耿鬼 | Ability | 無限之影 | ability-other | 這隻寶可夢受到對手的寶可夢招式的傷害而【昏厥】時，不丟棄這隻寶可夢，而是放回手牌。（寶可夢以外的卡全部丟棄。） |
| P4 | M3 | 18029 | 伊裴爾塔爾ex | Attack | 死亡靈魂 | attack-other | 將對手所有剩餘HP為「50」以下的寶可夢【昏厥】。 |
| P4 | M3 | 18030 | 古劍豹 | Attack | 狡兔三窟 | attack-other | 20 若希望，將這隻寶可夢與備戰寶可夢互換。 |
| P2 | M3 | 18033 | 雙劍鞘 | Attack | 劍武備 | hand-op | 60× 從自己的手牌將任意數量的「獨劍鞘」「雙劍鞘」「堅盾劍怪」給對手看過後，造成其張數×60點傷害。 |
| P3 | M3 | 18035 | 鑰圈兒 | Attack | 記憶之鎖 | cross-turn-effect | 30 選擇1個對手的戰鬥寶可夢持有的招式。在下個對手的回合，受到這個招式的寶可夢無法使用被選擇的招式。 |
| P2 | M3 | 18042 | 小箭雀 | Attack | 鳥笛 | deck-search-or-deck-op | 從自己的牌庫選擇最多2張抵抗力為【鬥】屬性的寶可夢卡，在給對手看過後加入手牌。並且重洗牌庫。 |
| P2 | M3 | 18043 | 多麗米亞 | Attack | 手部造型 | hand-op | 在不看正面的情況下，將對手的手牌丟棄直到張數變為5張為止。 |
| P3 | M3 | 18386 | 烈箭鷹 | Ability | 穹天狩獵 | active-ability | 在自己的回合時可使用1次。擲1次硬幣若為正面，則在不看正面的情況下，從對手的手牌選擇1張，將其丟棄。 |
| P3 | M3 | 18387 | 冰雪巨龍 | Ability | 凍原堡壘 | field-passive | 只要這隻寶可夢在場上，自己的所有身上附有【水】能量卡的寶可夢，受到對手的寶可夢招式的傷害「-50」點。這個特性的效果不會重複。 |
| P2 | M3 | 18388 | 咚咚鼠 | Attack | 擺尾發電 | discard-pile-op | 從自己的棄牌區選擇最多與對手的所有寶可夢身上附加的能量的數量相同數量的「基本【雷】能量」卡，以任意方式附於自己的【雷】寶可夢身上。 |
| P2 | M3 | 18394 | 雙劍鞘 | Attack | 劍武備 | hand-op | 60× 從自己的手牌將任意數量的「獨劍鞘」「雙劍鞘」「堅盾劍怪」給對手看過後，造成其張數×60點傷害。 |
| P4 | M3 | 18396 | 狙射樹梟ex | Ability | 狙擊手之眼 | ability-other | 若對手的手牌為4張，則這隻寶可夢使用招式所需的【無】能量全部消除。 |
| P2 | M3 | 18397 | 焰后蜥ex | Attack | 詭計 | deck-search-or-deck-op | 從自己的牌庫任意選擇最多2張卡加入手牌。並且重洗牌庫。 |
| P4 | M3 | 18399 | 超級皮可西ex | Ability | 光之翼 | ability-other | 這隻寶可夢不會受到對手的寶可夢特性效果的影響。 |
| P2 | M3 | 18399 | 超級皮可西ex | Attack | 射攻月亮 | hand-op | 120+ 若希望，從自己的手牌將最多4張能量卡丟棄，增加其張數×40點傷害。 |
| P4 | M3 | 18401 | 伊裴爾塔爾ex | Attack | 死亡靈魂 | attack-other | 將對手所有剩餘HP為「50」以下的寶可夢【昏厥】。 |
| P4 | M3 | 18415 | 超級皮可西ex | Ability | 光之翼 | ability-other | 這隻寶可夢不會受到對手的寶可夢特性效果的影響。 |
| P2 | M3 | 18415 | 超級皮可西ex | Attack | 射攻月亮 | hand-op | 120+ 若希望，從自己的手牌將最多4張能量卡丟棄，增加其張數×40點傷害。 |
| P4 | M4 | 18429 | 九尾 | Attack | 九尾狐搬動 | attack-other | 選擇1隻自己的備戰寶可夢，將所選的寶可夢身上放置的傷害指示物，全部改放於對手的戰鬥寶可夢身上。 |
| P2 | M4 | 18430 | 鳳王 | Attack | 復生火焰 | discard-pile-op | 從自己的棄牌區選擇最多3張【基礎】寶可夢卡，放置於備戰區。 |
| P2 | M4 | 18438 | 信使鳥 | Attack | 幸福禮物 | hand-op | 雙方玩家若希望，各自從自己的手牌選擇最多3張基本能量卡，以任意方式附於自己的寶可夢身上。（對手先選擇。） |
| P3 | M4 | 18446 | 具甲武者 | Attack | 要害斬 | cross-turn-effect | 30 若對手的寶可夢因這個招式的傷害而【昏厥】了，則在下個對手的回合，這隻寶可夢不會受到招式的傷害與效果的影響。 |
| P2 | M4 | 18448 | 茸茸羊 | Attack | 電磁干擾 | hand-op | 40 在下個對手的回合，對手無法從手牌使出物品卡。 |
| P2 | M4 | 18450 | 電飛鼠 | Attack | 天空迴旋 | hand-op | 30 將這隻寶可夢與附加的卡，全部放回手牌。 |
| P3 | M4 | 18453 | 代歐奇希斯 | Attack | 精神防護 | cross-turn-effect | 80 在下個對手的回合，這隻寶可夢不會受到擁有特性的寶可夢招式的傷害。 |
| P2 | M4 | 18455 | 超級花葉蒂ex | Attack | 永生綻放 | deck-search-or-deck-op | 200 從自己的牌庫選擇最多4張「基本【超】能量」卡，以任意方式附於備戰寶可夢身上。並且重洗牌庫。 |
| P2 | M4 | 18456 | 妙喵 | Attack | 拍檔攻擊 | hand-op | 10+ 在這個回合，若從手牌使出了「瑪琪艾兒」，則增加60點傷害。 |
| P3 | M4 | 18458 | 小木靈 | Ability | 怨恨進化 | active-ability | 在自己的回合時可使用1次。從自己的手牌選擇1張從這隻寶可夢進化而來的卡，放置於這隻寶可夢身上完成進化。然後，在完成進化的寶可夢身上放置2個傷害指示物。（無法在自己的最初回合使用。） |
| P2 | M4 | 18459 | 朽木妖 | Attack | 詛咒根 | hand-op | 30 在下個對手的回合，受到這個招式的寶可夢，無法附上從手牌使出的能量卡。 |
| P2 | M4 | 18461 | 南瓜怪人ex | Attack | 幽靈之觸 | hand-op | 140 在不看正面的情況下，從對手的手牌選擇1張，將其丟棄。 |
| P2 | M4 | 18462 | 哲爾尼亞斯 | Attack | 大地風暴 | energy-op | 30× 造成自己的所有寶可夢身上附加的【超】能量的數量×30點傷害。 |
| P2 | M4 | 18463 | 樹才怪 | Attack | 考驗之旅 | deck-search-or-deck-op | 從自己的牌庫選擇最多2張「變化之書」，在給對手看過後加入手牌。並且重洗牌庫。 |
| P3 | M4 | 18465 | 頓甲 | Attack | 接二連三 | cross-turn-effect | 20 在下個自己的回合，這隻寶可夢使用的招式，對對手的戰鬥寶可夢造成的傷害「+120」點。 |
| P2 | M4 | 18467 | 念力土偶 | Attack | 退化光線 | hand-op | 50 從對手的進化的戰鬥寶可夢身上，移除1張「進化卡」使其退化。將移除的卡放回對手的手牌。 |
| P3 | M4 | 18469 | 大嘴蝠 | Attack | 隱密飛行 | cross-turn-effect | 30 在下個對手的回合，這隻寶可夢不會受到【基礎】寶可夢招式的傷害。 |
| P4 | M4 | 18473 | 坦克臭鼬 | Attack | 粉碎迴轉 | attack-other | 100 將這隻寶可夢與備戰寶可夢互換。 |
| P4 | M4 | 18481 | 堅果啞鈴 | Ability | 整人擊落 | ability-other | 在對手的回合，這張卡因對手的招式・特性・物品卡・支援者卡的效果而從牌庫被丟棄時，將對手的牌庫上方8張卡丟棄。 |
| P4 | M4 | 18482 | 勾帕路翁ex | Ability | 金屬之路 | ability-other | 在自己的回合，從備戰區將這隻寶可夢放置於戰鬥場時，可使用1次。選擇自己的場上寶可夢身上附加的任意數量的【鋼】能量卡，改附於這隻寶可夢身上。 |
| P2 | M4 | 18483 | 超級毒藻龍ex | Attack | 腐蝕液 | energy-op | 將對手的所有寶可夢身上附加的「寶可夢道具」卡與「特殊能量」卡全部丟棄。 |
| P3 | M4 | 18486 | 黏美龍 | Ability | 黏滑失足 | field-passive | 只要這隻寶可夢在場上，對手的戰鬥寶可夢【撤退】時，對手擲1次硬幣。若為反面，則【撤退】所需的能量不丟棄，不用進行互換。這個特性的效果不會重複。 |
| P3 | M4 | 18488 | 探探鼠 | Ability | 監視之眼 | field-passive | 只要這隻寶可夢在場上，雙方的所有寶可夢身上放置的傷害指示物，無法改放於其他寶可夢身上。 |
| P2 | 083 | 18526 | 哲爾尼亞斯 | Attack | 大地風暴 | energy-op | 30× 造成自己的所有寶可夢身上附加的【超】能量的數量×30點傷害。 |
| P2 | 083 | 18527 | 念力土偶 | Attack | 退化光線 | hand-op | 50 從對手的進化的戰鬥寶可夢身上，移除1張「進化卡」使其退化。將移除的卡放回對手的手牌。 |
| P2 | 083 | 18536 | 超級花葉蒂ex | Attack | 永生綻放 | deck-search-or-deck-op | 200 從自己的牌庫選擇最多4張「基本【超】能量」卡，以任意方式附於備戰寶可夢身上。並且重洗牌庫。 |
| P2 | 083 | 18537 | 南瓜怪人ex | Attack | 幽靈之觸 | hand-op | 140 在不看正面的情況下，從對手的手牌選擇1張，將其丟棄。 |
| P4 | 083 | 18538 | 勾帕路翁ex | Ability | 金屬之路 | ability-other | 在自己的回合，從備戰區將這隻寶可夢放置於戰鬥場時，可使用1次。選擇自己的場上寶可夢身上附加的任意數量的【鋼】能量卡，改附於這隻寶可夢身上。 |
| P2 | 083 | 18539 | 超級毒藻龍ex | Attack | 腐蝕液 | energy-op | 將對手的所有寶可夢身上附加的「寶可夢道具」卡與「特殊能量」卡全部丟棄。 |
| P2 | 083 | 18552 | 超級花葉蒂ex | Attack | 永生綻放 | deck-search-or-deck-op | 200 從自己的牌庫選擇最多4張「基本【超】能量」卡，以任意方式附於備戰寶可夢身上。並且重洗牌庫。 |
| P2 | 083 | 18553 | 超級毒藻龍ex | Attack | 腐蝕液 | energy-op | 將對手的所有寶可夢身上附加的「寶可夢道具」卡與「特殊能量」卡全部丟棄。 |
| P3 | MC | 16474 | 莉佳的霸王花ex | Ability | 動人香氣 | active-ability | 在自己的回合時可使用1次。將自己的所有寶可夢各恢復「30」HP。 |
| P3 | MC | 16478 | 莉佳的口呆花 | Attack | 葉子旋風 | cross-turn-effect | 70 在下個自己的回合，這隻寶可夢無法使用招式。 |
| P2 | MC | 16663 | 雷吉艾斯ex | Attack | 雷吉充能 | discard-pile-op | 從自己的棄牌區選擇最多2張「基本【水】能量」卡，附於這隻寶可夢身上。 |
| P4 | MC | 16768 | 瑪力露麗ex | Ability | 收集泡泡 | ability-other | 在自己的回合時，可不限次數使用。選擇1個自己的場上寶可夢身上附加的能量，改附於這隻寶可夢身上。 |
| P2 | MC | 16768 | 瑪力露麗ex | Attack | 能量氣球 | energy-op | 60+ 增加這隻寶可夢身上附加的【超】能量的數量×40點傷害。 |
| P2 | MC | 16838 | 戰舞郎 | Attack | 旋轉抽出 | deck-search-or-deck-op | 將自己的手牌全部放回牌庫並重洗。然後，從牌庫抽出6張卡。 |
| P3 | MC | 16871 | 小碎鑽 | Ability | 雙重屬性 | field-passive | 只要這隻寶可夢在場上，改為【鬥】與【超】2種屬性。 |
| P2 | MC | 16946 | 禿鷹娜ex | Attack | 禿鷹爪 | hand-op | 160 在不看正面的情況下，從對手的手牌選擇1張，將其丟棄。 |
| P2 | MC | 16970 | 雷吉斯奇魯ex | Attack | 雷吉充能 | discard-pile-op | 從自己的棄牌區選擇最多2張「基本【鋼】能量」卡，附於這隻寶可夢身上。 |
| P3 | MC | 16970 | 雷吉斯奇魯ex | Attack | 防護鋼鐵 | cross-turn-effect | 140 在下個對手的回合，這隻寶可夢受到招式的傷害「-50」點。 |
| P2 | MC | 17057 | 優雅貓 | Attack | 能量粉碎 | energy-op | 40× 造成對手的所有寶可夢身上附加的能量的數量×40點傷害。 |
| P2 | MC | 17073 | 超級差不多娃娃ex | Attack | 耳之力 | energy-op | 20+ 增加對手的戰鬥寶可夢身上附加的能量的數量×80點傷害。 |
| P3 | MC | 17090 | 青木的樹枕尾熊 | Ability | 無力充能 | active-ability | 若這隻寶可夢在備戰區，則在自己的回合時可使用1次。從自己的手牌選擇1張能量卡，附於戰鬥場的「青木的寶可夢」身上。 |
| P3 | MC | 17092 | 老翁龍 | Attack | 龍之強襲 | cross-turn-effect | 120 在下個自己的回合，這隻寶可夢無法使用「龍之強襲」。 |
| P2 | MC | 18342 | 戰舞郎 | Attack | 旋轉抽出 | deck-search-or-deck-op | 將自己的手牌全部放回牌庫並重洗。然後，從牌庫抽出6張卡。 |
| P3 | MC | 18343 | 小碎鑽 | Ability | 雙重屬性 | field-passive | 只要這隻寶可夢在場上，改為【鬥】與【超】2種屬性。 |
| P2 | MC | 18350 | 超級差不多娃娃ex | Attack | 耳之力 | energy-op | 20+ 增加對手的戰鬥寶可夢身上附加的能量的數量×80點傷害。 |

## First 50 Needs Review (same effect name exists; verify exact card behavior)

| Priority | Set | ID | Card | Kind | Name | Category | Evidence |
|---|---:|---:|---|---|---|---|---|
| P2 | M-P-J | 18059 | 木木梟 | Attack | 尋找朋友 | deck-search-or-deck-op | \|尋找朋友', 尋找朋友 |
| P1 | M-P-J | 18071 | 怪顎龍 | Attack | 亂暴 | coin-flip | 亂暴 |
| P2 | M-P-J | 18506 | 火狐狸 | Attack | 呼朋引伴 | deck-search-or-deck-op | \|呼朋引伴', 呼朋引伴 |
| P2 | M-P-J | 18507 | 長尾火狐 | Attack | 噴射火焰 | energy-op | \|噴射火焰', 噴射火焰 |
| P2 | M-P-J | 18512 | 代歐奇希斯 | Attack | 精神強念 | energy-op | \|精神強念', 精神強念 |
| P4 | M-P-J | 18517 | 電龍 | Ability | 同步脈衝 | ability-other | 同步脈衝 |
| P2 | M3 | 17987 | 木木梟 | Attack | 尋找朋友 | deck-search-or-deck-op | \|尋找朋友', 尋找朋友 |
| P3 | M3 | 18000 | 冰雪巨龍 | Attack | 冰冷寒氣 | cross-turn-effect | \|冰冷寒氣', 冰冷寒氣 |
| P2 | M3 | 18004 | 倫琴貓 | Attack | 強力伏特 | energy-op | \|強力伏特', 強力伏特 |
| P1 | M3 | 18005 | 咚咚鼠 | Attack | 電擊 | status-condition | \|電擊', 電擊 |
| P2 | M3 | 18010 | 超能妙喵 | Attack | 精神強念 | energy-op | \|精神強念', 精神強念 |
| P1 | M3 | 18021 | 怪顎龍 | Attack | 亂暴 | coin-flip | 亂暴 |
| P1 | M3 | 18024 | 鬼斯 | Attack | 偷襲 | coin-flip | \|偷襲', 偷襲 |
| P1 | M3 | 18041 | 掘地兔 | Attack | 地震 | bench-damage | \|地震', 地震 |
| P2 | M3 | 18385 | 木木梟 | Attack | 尋找朋友 | deck-search-or-deck-op | \|尋找朋友', 尋找朋友 |
| P3 | M3 | 18387 | 冰雪巨龍 | Attack | 冰冷寒氣 | cross-turn-effect | \|冰冷寒氣', 冰冷寒氣 |
| P1 | M3 | 18388 | 咚咚鼠 | Attack | 電擊 | status-condition | \|電擊', 電擊 |
| P1 | M4 | 18421 | 獨角蟲 | Attack | 偷襲 | coin-flip | \|偷襲', 偷襲 |
| P3 | M4 | 18422 | 鐵殼蛹 | Ability | 堅硬身軀 | passive-damage-reduce | 堅硬身軀 |
| P4 | M4 | 18427 | 布里卡隆 | Ability | 尖刺盔甲 | ability-other | 尖刺盔甲 |
| P2 | M4 | 18431 | 火狐狸 | Attack | 呼朋引伴 | deck-search-or-deck-op | \|呼朋引伴', 呼朋引伴 |
| P2 | M4 | 18432 | 長尾火狐 | Attack | 噴射火焰 | energy-op | \|噴射火焰', 噴射火焰 |
| P3 | M4 | 18446 | 具甲武者 | Attack | 潛力 | cross-turn-effect | \|潛力', 潛力 |
| P1 | M4 | 18447 | 咩利羊 | Attack | 電磁波 | status-condition | \|電磁波', 電磁波 |
| P4 | M4 | 18449 | 電龍 | Ability | 同步脈衝 | ability-other | 同步脈衝 |
| P2 | M4 | 18450 | 電飛鼠 | Attack | 小使者 | deck-search-or-deck-op | \|小使者', 小使者 |
| P2 | M4 | 18451 | 代歐奇希斯 | Attack | 精神強念 | energy-op | \|精神強念', 精神強念 |
| P2 | M4 | 18457 | 超能妙喵 | Attack | 戲法舞步 | energy-op | \|戲法舞步', 戲法舞步 |
| P4 | M4 | 18463 | 樹才怪 | Attack | 岩石投擲 | attack-other | \|岩石投擲', 岩石投擲 |
| P2 | M4 | 18465 | 頓甲 | Attack | 粉碎頭擊 | energy-op | \|粉碎頭擊', 粉碎頭擊 |
| P4 | M4 | 18471 | 千針魚 | Ability | 毒刺 | ability-other | 毒刺 |
| P1 | M4 | 18471 | 千針魚 | Attack | 毒液衝擊 | status-condition | \|毒液衝擊', 毒液衝擊 |
| P3 | M4 | 18475 | 灰塵山 | Ability | 垃圾洩氣 | field-passive | 垃圾洩氣 |
| P3 | M4 | 18478 | 金屬怪 | Attack | 防守壓制 | cross-turn-effect | \|防守壓制', 防守壓制 |
| P3 | M4 | 18482 | 勾帕路翁ex | Attack | 力量衝撞 | cross-turn-effect | \|力量衝撞', 力量衝撞 |
| P1 | M4 | 18484 | 黏黏寶 | Attack | 吸取 | heal | \|吸取', 吸取 |
| P2 | 083 | 18522 | 火狐狸 | Attack | 呼朋引伴 | deck-search-or-deck-op | \|呼朋引伴', 呼朋引伴 |
| P4 | 083 | 18525 | 電龍 | Ability | 同步脈衝 | ability-other | 同步脈衝 |
| P3 | 083 | 18529 | 金屬怪 | Attack | 防守壓制 | cross-turn-effect | \|防守壓制', 防守壓制 |
| P3 | 083 | 18538 | 勾帕路翁ex | Attack | 力量衝撞 | cross-turn-effect | \|力量衝撞', 力量衝撞 |
| P4 | MC | 16472 | 莉佳的走路草 | Attack | 突擊 | attack-other | \|突擊', 突擊 |
| P1 | MC | 16473 | 莉佳的臭臭花 | Attack | 噴毒 | status-condition | \|噴毒', 噴毒 |
| P1 | MC | 16485 | 莉佳的蔓藤怪 | Attack | 綁緊 | status-condition | \|綁緊', 綁緊 |
| P1 | MC | 16638 | 藍鱷 | Attack | 咬碎 | coin-flip | \|咬碎', 咬碎 |
| P2 | MC | 16697 | 雷丘 | Attack | 強力伏特 | energy-op | \|強力伏特', 強力伏特 |
| P1 | MC | 16865 | 泥巴魚ex | Attack | 咬緊 | cannot-retreat | \|咬緊', 咬緊 |
| P3 | MC | 16953 | 胡帕 | Attack | 關節衝擊 | cross-turn-effect | \|關節衝擊', 關節衝擊 |
| P2 | MC | 16966 | 大嘴娃 | Attack | 呼朋引伴 | deck-search-or-deck-op | \|呼朋引伴', 呼朋引伴 |
| P2 | MC | 17061 | 青木的姆克兒 | Attack | 小使者 | deck-search-or-deck-op | \|小使者', 小使者 |
| P1 | MC | 17080 | 青木的勇士雄鷹 | Attack | 緊抓 | cannot-retreat | \|緊抓', 緊抓 |
