/**
 * PTCG 對戰引擎 — 型別定義
 *
 * 設計原則：
 * - GameState 是純資料（no methods），引擎函式是純函式
 * - 每個動作產生新的 GameState，方便日誌回放與未來 Firestore 同步
 * - 卡片效果（招式、特性、訓練家）預留 EffectScript 插槽，M3/M4 逐步填入
 */

import type { EnergyType } from '$lib/cards/types';

// ── 遊戲階段 ────────────────────────────────────────────────────────────────

/** 整局遊戲的大階段 */
export type GamePhase =
  | 'setup'      // 雙方同時選出場寶可夢 + 備戰
  | 'playing'    // 正式對戰輪回
  | 'game-over'; // 遊戲結束

/** 正式對戰時，每個回合的小階段 */
export type TurnPhase =
  | 'draw'   // 抽牌（每回合開始）
  | 'main'   // 主階段：附加能量、打出訓練家、進化、撤退…
  | 'end';   // 回合結束清理

// ── 卡片實例 ────────────────────────────────────────────────────────────────

/** 場上或手牌中的一張卡的「執行期實例」（與 Card 資料庫記錄分離） */
export interface CardInstance {
  /** 本場遊戲唯一 ID（每張卡不同，即使同名） */
  iid: string;
  /** 對應 Card.id（用來查牌庫資料） */
  cardId: string;
  /** 傷害計數器（寶可夢用） */
  damage: number;
  /** 附加的能量牌（iid 列表，附在寶可夢上） */
  energyAttached: CardInstance[];
  /** 附加的道具牌（iid，M4 實裝） */
  toolAttached?: CardInstance;
  /**
   * v3.20：第 2 張以上的「寶可夢道具」卡（最多 1 張，使總道具數 = 2）。
   * 由「洛托姆ex｜多重轉接」特性開啟 — 名字含「洛托姆」的自方寶可夢可附 2 張道具。
   * 主道具放 toolAttached（保留 200+ 既有引用），溢出進此 array。
   * 特性消除（離場/初始化/監視塔等）時，extraTools 全部丟到棄牌區。
   */
  extraTools?: CardInstance[];
  /** 進化來源的 iid（用來驗證是否可進化） */
  evolvedFromIid?: string;
  /** 下一次被攻擊時傷害 -N（攻擊後自動清除），用於「下回合受傷減 N」效果。
   *
   * v3.22 重要：此旗標僅由 **defender 端** 消耗（即「這隻寶可夢下次被打時 -N」）。
   * 「對手下次出招 -N」（叫聲/吠/咆哮 系列卡）改用獨立旗標 `nextOwnAttackPenalty`
   * 設給對手 active，避免兩端共用同一 field 導致：自己用招式設下「下次被打 -N」後，
   * 若對手回合沒攻擊 → 自己下回合出招時被 attacker-side check 誤消耗 → 自己招式 -N。
   * （bug 案例：超級雷電獸ex 閃光射線 -100 + 對手沒攻擊 → 下回合自己第一招也 -100）
   */
  damageReduceNextHit?: number;
  /** v3.22：自己下一次攻擊時招式傷害 -N（攻擊後自動清除）。
   * 用於 attacker-side debuff（黑魯加｜大聲咆哮 -100 / 嘎啦嘎啦｜叫聲 -40 /
   * 超級火炎獅ex｜吠 -50 等「對手下回合招式傷害 -N」效果）。
   * 由 defNextAtkReducePost 等 helper 設給對手 active，當對手變成 attacker 時，
   * engine.ts attack pipeline 會檢查 attacker.active.nextOwnAttackPenalty 並消耗。
   */
  nextOwnAttackPenalty?: number;
  /**
   * v2.382：超級呆殼獸ex｜殼捲風旋轉 — 下次受招式傷害時，對攻擊方放 N 個指示物（= N×10 damage）。
   * 一次性 flag，消費後清除。卡面語意「下個對手回合」 — 自己下回合無法被攻擊，
   * 所以等同於「下次受招式時觸發」。
   */
  retaliateCountersOnNextHit?: number;
  /** 下一次輪到自己行動時不能撤退（老匠、關節技等），行動後清除 */
  cantRetreatNextTurn?: boolean;
  /** 受到「下次使用招式前擲硬幣，反面則失敗」類效果的預約擲幣數。 */
  attackFailureFlipCountPending?: number;
  /** 本回合使用招式前需擲硬幣的數量；只要出現反面，招式失敗。 */
  attackFailureFlipCountThisTurn?: number;
  /** 托戈德瑪爾ex｜尖尖回轉：下個自己的回合若再用此招式 +80。 */
  pointySpinNextTurn?: boolean;
  pointySpinThisTurn?: boolean;
  /**
   * 進化鏈：下層被進化掉的 CardInstance 堆疊（由底到頂，不含當前卡）。
   * - 被擊倒時要一併進棄牌區（PTCG 官方規則）
   * - UI zoom modal 顯示進化鏈並可點擊檢視每張
   * 每個元素不保留 energyAttached/toolAttached（已繼承給頂層）。
   */
  evolvedFromStack?: CardInstance[];
  /** 特殊狀態（M4 實裝） */
  status?: SpecialCondition;
  /** 強化中毒每次寶可夢檢查放置的傷害量；未設定則一般中毒 10。 */
  poisonDamagePerCheckup?: number;
  /**
   * v2.163：第二個特殊狀態，專供「同時陷入兩種狀態」的招式使用（例：危險光線
   * 同時灼傷+混亂）。PTCG 規則：行動類狀態（睡眠/混亂/麻痺）三者互斥，傷害類
   * 狀態（中毒/灼傷）兩者互斥，但 1 個行動類 + 1 個傷害類可以共存。
   *
   * 約定：行動類狀態（asleep/confused/paralyzed）放 status；傷害類狀態
   * （poisoned/burned）優先放 status（向下相容單狀態卡），若 status 已被
   * 行動類佔用則改放 secondaryStatus。
   *
   * Engine checkup（中毒/灼傷）會同時掃描 status 與 secondaryStatus 兩格；
   * 攻擊前的睡眠/麻痺/混亂判定只看 status（行動類永遠在主格）。
   */
  secondaryStatus?: SpecialCondition;
  /**
   * 本回合剛從手牌打出到備戰區（PLAY_BASIC），不可進化。
   * 在 END_TURN 時清除。
   */
  justPlaced?: boolean;
  /**
   * 本回合剛從手牌打出放置。
   * 用於區分 Setup 或牌庫特召（不具備此 flag），以判定部分特性（如狂挖、經驗法則）。
   * 在 END_TURN 時清除。
   */
  playedFromHand?: boolean;
  /**
   * 本回合已進化過，不可再次進化。
   * 在 END_TURN 時清除。
   */
  evolvedThisTurn?: boolean;
  /**
   * 本回合無法使用招式（UI 反白禁按）。
   * 由 cantAttackPending 在「擁有者下個回合開始」時自動 promote 而來，
   * 並在該回合 END_TURN 時清除。
   */
  cantAttackThisTurn?: boolean;
  /**
   * 招式效果剛打出時設下的「下個自己回合無法使用招式」預約旗標。
   * 在 END_TURN 切換到擁有者下個回合時，自動 promote 為 cantAttackThisTurn。
   * 設於 ATTACK_POST 階段（攻擊方或防守方皆可）。
   */
  cantAttackPending?: boolean;
  /**
   * 本回合已使用過特性（每回合限 1 次主動特性）。
   * 在 END_TURN 時清除。
   */
  abilityUsedThisTurn?: boolean;
  /**
   * 本回合此寶可夢使用招式時，base damage +N（在 weakness 之前套用）。
   * 由 damageBonusPending 在「擁有者下個回合開始」時自動 promote 而來，
   * 並在該回合 END_TURN 時清除。
   */
  damageBonusThisTurn?: number;
  /**
   * 招式效果剛打出時設下的「下個自己回合招式 +N 傷害」預約旗標。
   * 在 END_TURN 切換到擁有者下個回合時，自動 promote 為 damageBonusThisTurn。
   */
  damageBonusPending?: number;
  /**
   * v2.69 超級赫拉克羅斯ex｜重裝角擊 — 累計上個對手回合此寶可夢受到的招式傷害。
   * 在每次 ATTACK 對 defender 結算後 +baseDamage；於 defender 自己回合的 END_TURN 時清為 0。
   * 攻擊方 PRE 階段讀取此值用於 +N 計算。
   */
  damageTakenLastOppTurn?: number;
  /**
   * v2.69 雙彈瓦斯｜瘋狂炸彈 — 本回合與上個自己回合此寶可夢使用的招式名稱。
   * - attackUsedThisTurn：ATTACK_POST 結算後寫入
   * - attackUsedLastSelfTurn：於攻擊方自己 END_TURN 時 promote thisTurn → lastSelfTurn
   *   並清除 thisTurn（若本回合未攻擊則 lastSelfTurn 變 undefined）
   */
  attackUsedThisTurn?: string;
  attackUsedLastSelfTurn?: string;
  /**
   * v2.69 帕奇利茲｜麻痺門牙 — 設於受擊寶可夢 (defender)；下個對手回合此寶可夢
   * 收到對手附加能量時自動放 8 個傷害指示物（80 點）。於 defender 自己回合
   * END_TURN 時清除。
   */
  paralyzeFangPending?: boolean;
  /**
   * v2.69 火箭隊的臭泥｜浸蝕污泥 — 設於受擊寶可夢 (defender)；於 defender 自己回合
   * END_TURN 時將其昏厥（damage = HP）。於該 END_TURN 觸發後清除。
   */
  koAtMyNextEndOfTurn?: boolean;
  /** v2.78 冰伊布｜滲透寒氣 — 於擁有者 END_TURN 時，自動為此寶可夢加上 N 點傷害。觸發後清除。 */
  damageAtMyNextEndOfTurn?: number;
  /** v2.78 骨紋巨聲鱷｜純樸 — 下回合不受對手寶可使用招式 ATTACK_POST 附加效果（傷害仍結算）。 */
  immuneToAttackEffectsNextTurn?: boolean;
  immuneToAttackEffectsThisTurn?: boolean;
  /** v2.78 轟擂金剛猩｜鼓擊 — 下回合招式所需 +N【無】，撤退所需 +N【無】。 */
  attackCostIncreaseColorlessNextTurn?: number;
  attackCostIncreaseColorlessThisTurn?: number;
  retreatCostIncreaseNextTurn?: number;
  retreatCostIncreaseThisTurn?: number;
  /** v2.78 引夢貘人｜白日夢 — 下回合對手附能量於此 → 對手回合結束。 */
  endTurnOnOppAttachEnergyNextTurn?: boolean;
  endTurnOnOppAttachEnergyThisTurn?: boolean;
  /** v2.78 密勒頓｜防護代碼 — 下回合不受帶指定 tag 的 ex 招式傷害。離開戰鬥場時清除。 */
  immuneToExAttackTagNextTurn?: string;
  immuneToExAttackTagThisTurn?: string;
  /** v2.78 智揮猩｜掌握弱點 — 下回合此寶可的弱點屬性改為指定值（如【無】）。 */
  weaknessOverrideTypeNextTurn?: string;
  weaknessOverrideTypeThisTurn?: string;
  /**
   * 自己寶可夢下個自己回合不可撤退（懶人獺 悠哉）。
   * 設於 ATTACK_POST，於擁有者下回合開始（nextIdx promote）時變成 cantRetreatNextTurn=true，
   * 於該回合 END_TURN 照 clearCantRetreat 規則清除。
   */
  cantRetreatPendingSelf?: boolean;
  /**
   * 本回合剛從備戰區被放置於戰鬥場（RETREAT 交替、SEND_NEW_ACTIVE 送出新戰鬥寶可夢、
   * 或其他將備戰寶可夢移到戰鬥場的效果）。
   * 由 ATTACK_PRE 用來判斷「在這個回合，若從備戰區將這隻寶可夢放置於戰鬥場」條件。
   * 在 END_TURN 時清除（僅在擁有者的回合結束時）。
   * 設此旗標的進入點：RETREAT、SEND_NEW_ACTIVE。
   */
  movedToActiveThisTurn?: boolean;
  /**
   * 跨回合「下個對手（設此旗標的攻擊方）回合本卡受到招式傷害 +N」。
   * 例：超音波幼蟲｜刺耳聲 → 對手下個自己回合，打這隻 +50。
   * - 攻擊方在 ATTACK_POST 設於對手的 active（若仍存在）
   * - 於擁有者下個 END_TURN（= 對手下回合開始前）promote 為 takeExtraDamageThisTurn
   * - 在攻擊方（此卡擁有者的對手）下個 END_TURN 時清除
   */
  takeExtraDamageNextTurn?: number;
  /**
   * 本回合此卡受到招式傷害 +N（由 takeExtraDamageNextTurn promote 而來）。
   * 在對手（攻擊方）的 END_TURN 時清除。
   */
  takeExtraDamageThisTurn?: number;
  /**
   * 卡片層級「下回合此卡無法從手牌附加能量」預約旗標（晶光花｜侵蝕碎塊）。
   * 於擁有者下個 END_TURN 時 promote 為 cantAttachEnergyThisTurn。
   */
  cantAttachEnergyNextTurn?: boolean;
  /**
   * 本回合此卡無法從手牌附加能量（由 cantAttachEnergyNextTurn promote 而來）。
   * 在擁有者 END_TURN 時清除。
   */
  cantAttachEnergyThisTurn?: boolean;
  /**
   * 跨回合「若此卡在攻擊方下個回合被 KO，則 +N 張獎勵牌」預約旗標（蝶結萌虻｜多餘花粉）。
   * 由攻擊方在 ATTACK_POST 設於對手 active；於擁有者下個 END_TURN promote 為 ThisTurn。
   */
  deferredPrizeBonusNextTurn?: number;
  /**
   * 本回合此卡被 KO 時 +N 張獎勵牌（由 deferredPrizeBonusNextTurn promote 而來）。
   * 在對手（攻擊方）的 END_TURN 時清除。
   */
  deferredPrizeBonusThisTurn?: number;
  /**
   * v2.92：**單招下回合禁用**預約旗標（卡片層級）。
   * 卡面範例：「超級勇氣 — 在下個自己的回合，這隻寶可夢無法使用『超級勇氣』」。
   * 設於 ATTACK_POST（用該招時將招式名 push 到此陣列），於擁有者下個 END_TURN
   * 時 promote 為 blockedAttackNamesThisTurn（即下個自己回合開始前）。
   * 多招並存用陣列（未來可能有同一隻寶可夢累積多個禁用招式）。
   */
  blockedAttackNamesNextTurn?: string[];
  /**
   * v2.92：**單招本回合禁用**（由 blockedAttackNamesNextTurn promote 而來）。
   * ATTACK handler / getAvailableAttacks 檢查：若當前要用的招式名 includes 其中 →
   * 禁用。在擁有者 END_TURN 清除。
   */
  blockedAttackNamesThisTurn?: string[];
  /**
   * v2.101：**下個對手回合此卡弱點失效**預約旗標（卡片層級）。
   * 卡面範例：「鋁鋼橋龍ex｜金屬防禦強化 — 在下個對手的回合，這隻寶可夢的弱點全部消除。」
   * 由**攻擊方**在自己 ATTACK_POST 設於自己的 active，於擁有者下個 END_TURN 時
   * promote 為 weaknessDisabledThisTurn（即對手下個回合開始前）。
   * 在對手（攻擊方）下個 END_TURN 時清除（由 attacker 的 END_TURN 負責 ThisTurn 清理）。
   */
  weaknessDisabledNextTurn?: boolean;
  /**
   * v2.101：**本回合此卡弱點失效**（由 weaknessDisabledNextTurn promote）。
   * 於 engine 的 attack pipeline 的 weakness ×2 判定點加入此旗標檢查 —
   * 若 defender.active 有此旗標則跳過 weakness。
   */
  weaknessDisabledThisTurn?: boolean;
  /**
   * v2.101：**下個對手回合此卡不受【基礎】寶可夢招式傷害**預約旗標。
   * 卡面範例：「鋁鋼橋龍｜塗層攻擊 — 在下個對手的回合，這隻寶可夢不會受到【基礎】寶可夢招式的傷害。」
   * 由攻擊方在自己 ATTACK_POST 設於自己的 active，於擁有者下個 END_TURN 時 promote。
   * 注意：只擋「招式的傷害」，招式其他效果仍會觸發（此區別依卡面）。
   */
  immuneToBasicAttackNextTurn?: boolean;
  /**
   * v2.101：**本回合此卡不受【基礎】寶可夢招式傷害**（由 immuneToBasicAttackNextTurn promote）。
   * 於 engine 的 attack pipeline：若 attacker card.stage === 'Basic' 且 defender 有此旗標 →
   * baseDamage 歸零（招式仍會打出、其他效果仍觸發）。
   */
  immuneToBasicAttackThisTurn?: boolean;
  /**
   * v2.174 阿塞蘿拉的惡作劇（Supporter / I）— 「在下個對手的回合，那隻寶可夢不會
   * 受到對手的『寶可夢【ex】』招式的傷害與效果的影響。」
   * 設於 ATTACK_POST 風格（reg 內把卡上立 NextTurn）；於擁有者下個 END_TURN 時 promote。
   * Engine attack pipeline：attacker 是 ex（subtype==='ex' || name.endsWith('ex')）
   * + defender 有 immuneToExAttackThisTurn → baseDamage=0 + 跳過 attack effects。
   * 在對手（攻擊方）下個 END_TURN 時清除 ThisTurn（同 weakness/immune 系列）。
   */
  immuneToExAttackNextTurn?: boolean;
  immuneToExAttackThisTurn?: boolean;
  /** v2.360 代歐奇希斯｜精神防護 — 下個對手回合不受擁有特性的寶可夢招式傷害 */
  immuneToAbilityPokemonNextTurn?: boolean;
  immuneToAbilityPokemonThisTurn?: boolean;
  /** v2.360 具甲武者｜要害斬 — 下個對手回合不受招式的傷害與效果影響 */
  immuneToAllAttackNextTurn?: boolean;
  immuneToAllAttackThisTurn?: boolean;
  /**
   * v2.187：化石上場旗標。標明此 instance 雖 cardId 對應 Item 卡（subtype=Item），
   * 但目前作為 HP60【無】屬性【基礎】寶可夢站在場上（戰鬥場或備戰）。
   *
   * - 設於 PLAY_FOSSIL action（手牌 → 備戰）
   * - getEffectiveHP / 弱抗 / 招式可附條件等 hook 都要 short-circuit
   * - EVOLVE / RETREAT 直接拒絕
   * - 永不持有 status / secondaryStatus（applyAction 末尾 sweep 清除）
   * - 自己回合 main phase 可走 DISCARD_FOSSIL 直接丟棄（非昏厥、對手不抽獎賞）
   * - 被打 KO 時走正常昏厥流程（給對手 1 張獎賞）
   */
  fossilOnField?: boolean;
  /** v2.362 振翼髮｜暗夜羽擊 — 特性被消除旗標（跨回合 promote 模型）
   * NextTurn 由攻擊 ATTACK_POST 設置；END_TURN 時 promotePending 將 NextTurn → ThisTurn。
   * ThisTurn 表示本回合無法使用此寶可夢的主動特性，同時被動封鎖。
   */
  abilityNullifiedNextTurn?: boolean;
  abilityNullifiedThisTurn?: boolean;
}

export type SpecialCondition =
  | 'poisoned' | 'burned' | 'asleep' | 'confused' | 'paralyzed';

// ── 玩家狀態 ────────────────────────────────────────────────────────────────

export interface PlayerState {
  name: string;
  /** 手牌區（未出場） */
  hand: CardInstance[];
  /** 牌組（隨機排序，頂部 = index 0） */
  deck: CardInstance[];
  /** 出場寶可夢（null = 正在等待放置或全滅） */
  active: CardInstance | null;
  /** 備戰區（最多 5 隻） */
  bench: CardInstance[];
  /** 墓地 */
  discard: CardInstance[];
  /** 獎勵牌（6 張，正面朝下） */
  prizes: CardInstance[];
  /** 本回合是否已附加能量 */
  energyAttachedThisTurn: boolean;
  /** 本回合是否已打出支援者 */
  supporterPlayedThisTurn: boolean;
  /** v2.57：本回合是否已打出「名稱含『火箭隊』的支援者」— 火箭隊的工廠 gate 用 */
  rocketSupporterPlayedThisTurn?: boolean;
  /** v2.160：本回合是否已打出「古代」標籤的支援者 — 雄偉牙｜地盤崩壞 條件用 */
  ancientSupporterPlayedThisTurn?: boolean;
  /** v2.306：本回合是否已打出「卡娜莉」支援者 — 光電傘蜥｜頸傘發電 條件用 */
  carnelliPlayedThisTurn?: boolean;
  /** v2.360：瑪琪艾兒 supporter played - 妙喵｜拍檔攻擊 用 */
  magearnaPlayedThisTurn?: boolean;
  /** v2.360：塔拉剛 supporter played - 河馬獸｜龍捲風噴射 用 */
  talarongPlayedThisTurn?: boolean;
  /**
   * v2.174 鐵之防禦強化（Item / I）— 在下個對手的回合，自己的所有【鋼】寶可夢
   * 受到對手寶可夢招式的傷害 -30。打出時設於 self 的 NextTurn flag，於 nextIdx
   * 的 END_TURN promote 為 ThisTurn（即對手回合開始前）。
   * 攻擊計算時：defender 屬性為【鋼】 + defendingPlayer.metalShieldThisTurn → -30。
   * ThisTurn flag 在「使用方」下回合 END_TURN 時清除（同 weakness/immune flag 模式）。
   */
  metalShieldNextTurn?: boolean;
  metalShieldThisTurn?: boolean;
  /**
   * v2.174 霍米加的演奏（Supporter / J）— 在下個對手的回合，對手的【中毒】寶可夢
   * 無法撤退（包含新中毒的）。
   * 設於對手側的 cantRetreatIfPoisonedNextTurn；於該對手 END_TURN 時 promote。
   * RETREAT handler 檢查 attacker.cantRetreatIfPoisonedThisTurn + active.status==='poisoned'
   * → 阻擋撤退。
   */
  cantRetreatIfPoisonedNextTurn?: boolean;
  cantRetreatIfPoisonedThisTurn?: boolean;
  /** 本回合是否已撤退 */
  retreatedThisTurn: boolean;
  /** v3.24 力之沙漏 per-turn flag — 避免 END_TURN 重複觸發 prompt
   *   bug 場景：END_TURN 設 pendingSelection 後 return state，turn 沒真正結束。
   *   resolver 完成後 user 再按結束回合 → END_TURN 又進 hook → 棄牌區還有
   *   基本能量就再 prompt → 無限循環。 */
  lourisToolUsedThisTurn?: boolean;
  /**
   * 招式效果設下的「下個自己回合，自己所有寶可夢（含新上場的）無法使用招式」預約旗標。
   * 例：電擊魔獸｜雷電在地。
   * 在擁有者下個回合開始前（END_TURN 時於 nextIdx 方）promote 為 noAttacksThisTurn。
   */
  noAttacksNextTurn?: boolean;
  /**
   * v2.113 空手道王的演練 — 本回合自己的寶可夢招式對對手戰鬥場的 ex +40 傷害。
   * 打出 Supporter 當下設 true，回合結束時清除。
   */
  karateKingBonusThisTurn?: boolean;
  /**
   * v2.139 烏栗效果 2 — 本回合自己的寶可夢招式對對手戰鬥場的 ex/V +30 傷害。
   * 打出 Supporter 當下設 true，回合結束時清除。
   */
  unrudaBonusThisTurn?: boolean;
  /**
   * v2.228 納莉 — 「在使用了這張卡的回合結束時，若自己的手牌有 5 張以上，則將自己的手牌全部丟棄。」
   * 打出納莉當下設 true；END_TURN 時於 aIdx 方檢查 hand.length >= 5 → 全丟，然後清除旗標。
   */
  nanuDiscardAtTurnEnd?: boolean;
  /**
   * 本回合，此玩家所有寶可夢皆無法使用招式（由 noAttacksNextTurn promote）。
   * 在 END_TURN 時清除（於 aIdx 方）。
   */
  noAttacksThisTurn?: boolean;
  /**
   * Wave 39：玩家級「下個自己回合無法從手牌使出物品卡」預約旗標（例：含羞苞｜癢癢花粉）。
   * 於擁有者下個 END_TURN（= nextIdx 方）promote 為 cantPlayItemThisTurn。
   */
  cantPlayItemNextTurn?: boolean;
  /**
   * 本回合此玩家無法從手牌使出物品卡（由 cantPlayItemNextTurn promote）。
   * 在 END_TURN 時清除（於 aIdx 方）。
   */
  cantPlayItemThisTurn?: boolean;
  /**
   * Wave 39：玩家級「下個自己回合無法從手牌使出支援者卡」預約旗標（例：吼叫尾ex｜絕叫）。
   */
  cantPlaySupporterNextTurn?: boolean;
  cantPlaySupporterThisTurn?: boolean;
  /**
   * Wave 39：玩家級「下個自己回合無法從手牌使出寶可夢並完成進化」預約旗標（例：青銅鐘｜進化妨礙者）。
   */
  cantEvolveNextTurn?: boolean;
  /**
   * v4.33：燒灼大地（古玉魚）— 下回合對手禁出競技場。
   * 設定於對手用 燒灼大地 + 實際丟棄了競技場時；對手 END_TURN 才清除。
   */
  cantPlayStadiumThisTurn?: boolean;
  cantPlayStadiumNextTurn?: boolean;
  cantEvolveThisTurn?: boolean;
  /**
   * Wave 42：玩家級「本回合自己的【鬥】寶可夢招式傷害 +N」累積值（例：力量蛋白飲）。
   * 每使用 1 張 +30。只對 pokemonType==='Fighting' 的攻擊者生效；在 weakness 前套用。
   * 在 END_TURN 時清除（於 aIdx 方）。
   */
  damageBoostFightingThisTurn?: number;
  /**
   * Wave 43：白蕾雅（Supporter）— 本回合，若對手戰鬥寶可夢因自己的「太晶」寶可夢使用的招式而 KO，
   * 則多取 1 張獎勵牌。打出 supporter 時設為 true，KO 路徑於攻擊方獲獎前檢查此旗標 +
   * 攻擊方 active 是否為太晶（card.tags?.includes('太晶')）。
   * 在 END_TURN 時清除（於 aIdx 方）。
   * v2.48：攻擊者太晶偵測從 attacks kludge 改為 tags（scraper 已遷移資料）。
   */
  teraKoBonusPrizeThisTurn?: boolean;
  /**
   * v2.185：巴貝娜與荷蓮娜（Supporter / I）— 本回合，若對手戰鬥寶可夢因自己的「N 的」寶可夢
   * 招式 KO，則多取 3 張獎勵牌。打出時設 true，KO 路徑於攻擊方獲獎前檢查此旗標 +
   * 攻擊方 active.name 以「N的」開頭。在 END_TURN 時清除（於 aIdx 方）。
   * Gate：場上 6 種特定 N 寶可夢（N的達摩狒狒 / N的索羅亞克ex / N的雙倍多多冰 /
   *       N的齒輪怪 / N的萊希拉姆 / N的捷克羅姆）必須**全部**在場（active+bench）。
   */
  bagonElenaThisTurn?: boolean;
  /**
   * v2.91：本回合玩家已經使用過的**主動特性名稱**清單（同名特性一回合限 1 次）。
   * 用於：使者衝刺（超級袋獸ex）/ 月光循環（月石）等卡面明寫「在使用了其他
   * 的『XX』的回合，此特性無法使用」的規則。
   * 與 CardInstance.abilityUsedThisTurn 不同：後者是「此卡實例一回合 1 次」
   * （多隻同名可各用一次），本欄位是「本回合所有同名共享 1 次」。
   * USE_ABILITY handler 於使用前檢查 includes，使用後 push name；END_TURN 清除。
   */
  abilityNamesUsedThisTurn?: string[];
}

// ── 擁有規則的寶可夢（Pokémon with a Rule Box）判定 ─────────────────────────
/**
 * PTCG 規則盒寶可夢 = ex / V / VMAX / VSTAR / GX / EX / Tag Team GX 等
 * （有規則欄位的寶可夢卡）。用於：呆呆王｜耀閃挑戰 判定「擁有規則的寶可夢
 * 除外」不能取它招式來複製。
 *
 * Scraper 目前寫入的 subtype 值：'ex' / 'VSTAR' / 'MegaEvolution' 等。
 * 常見可能出現的都列在這：若官方推出新規則盒寶可夢要加。
 */
export const RULE_BOX_SUBTYPES = new Set<string>([
  'ex', 'EX', 'V', 'VMAX', 'VSTAR', 'GX', 'MegaEvolution',
]);

// ── 待選擇狀態（訓練家/招式效果需要玩家做決定時）──────────────────────────

export interface PendingSelection {
  /** 選擇類型 */
  type: 'deck-search' | 'bench-choose' | 'hand-discard' | 'heal-target'
      | 'opp-bench-choose'  // 選對手備戰寶可夢（老大的指令、頂尖捕捉器）
      | 'opp-poke-choose'   // 選對手任意寶可夢（含出場，例如狙擊羽毛）
      | 'discard-search'    // 從棄牌區選擇（夜間擔架、能量回收器、奇跡修正檔）
      | 'hand-choose'       // 從手牌選擇但不丟棄（神奇糖果第一步）
      | 'damage-distribute' // 傷害指示物自由分配到多隻對手備戰（幻影奇襲、類似機制）
      | 'energy-distribute' // v2.87 同類能量自由分配（+/- 計數器 UI；龐克練肌 / 過度放電 / 合金建造）
      | 'active-energy-discard' // v2.63 撤退時手動選擇要丟哪幾張附加能量（多屬性時詢問）
      | 'modal-choice'      // v2.139 二選一/多選一文字選單（烏栗 swap vs +30 / 火箭隊的工廠 三選一 等）
      | 'reorder-deck-top'; // v2.164 排序牌庫頂 N 張（推理組合 / 蕾荷）— 可選擇允許丟棄
                            //   params.candidateIids: string[] — 要排序的 iid 列表（必填）
                            //   params.allowDiscard?: boolean — 允許在排序時把部分 iid 丟棄（蕾荷）
                            //   params.titleOverride?: string — UI 標題客製
                            //   selectedIids 解讀為「保留並排序的 iid 列表」（index 0 = top of deck）
                            //   未列出的 iid：若 allowDiscard 視為丟棄；否則 resolver 應抑制接受（minCount=候選數）
  /** 需要做選擇的玩家 */
  actorIdx: 0 | 1;
  /** 來源牌堆/目標的玩家（通常等於 actorIdx） */
  sourcePlayerIdx: 0 | 1;
  /** 篩選條件（'Basic', 'Pokemon', 'Energy', 'TOP6', 'Basic:HP70' 等） */
  filter?: string;
  /** 最少選取數 */
  minCount: number;
  /** 最多選取數 */
  maxCount: number;
  /** 效果繼續 key（在 RESOLVERS 登錄表中查找） */
  effectKey: string;
  /** 額外傳遞給 resolver 的參數 */
  params?: Record<string, unknown>;
}

// ── 遊戲狀態 ────────────────────────────────────────────────────────────────

export interface GameState {
  /** 本局唯一 ID */
  id: string;
  phase: GamePhase;
  /** 正式對戰階段的回合小分段 */
  turnPhase: TurnPhase;
  /** 目前行動玩家（0 = P1, 1 = P2） */
  activePlayerIndex: 0 | 1;
  /** v3.85: 本回合是否打過「稜鏡塔」(per-player)，給昂主花葉蒂放置 gate 用。每回合結束時 reset。 */
  prismTowerPlayedThisTurn?: [boolean, boolean];
  /**
   * v4.24 對戰計時器（賽事用）— 由 engine.ts 在 setup→playing transition 設、END_TURN 累計。
   *   gameStartTime: 對戰起算時間戳（Date.now()，第 1 回合 DRAW 階段開始時設）
   *   currentTurnStartTime: 當前回合起算時間戳（每次 END_TURN 切換到下一玩家時重置）
   *   playerTurnTimeMs: 每位玩家累計回合時間（毫秒）[P1, P2]
   * 全為 primitive 或 tuple-of-primitive，Firestore-safe（per Iron Rule 13）。
   */
  gameStartTime?: number;
  currentTurnStartTime?: number;
  playerTurnTimeMs?: [number, number];
  /** 由 createGame 擲硬幣決定的先手方 */
  firstPlayerIdx: 0 | 1;
  players: [PlayerState, PlayerState];
  /** 回合數（從 1 開始，先手第一回合 = 1） */
  turn: number;
  /**
   * 第一回合旗標：先手第一回合不能攻擊也不能進化（Setup 寶可夢限制）
   */
  isFirstTurn: boolean;
  /** 等待 P1 or P2 在 setup 選完備戰區後，另一方是否也已完成 */
  setupDone: [boolean, boolean];
  /**
   * Mulligan 次數：起手 7 張沒有基礎寶可夢時的重抽次數。
   * 對手每次 mulligan 可多抽 1 張作為補償。
   */
  mulliganCounts: [number, number];
  /**
   * 待決定的 mulligan 補抽張數 [P1, P2]：
   * 對手（非我方）mulligan 時我方可補抽 N 張，玩家可選擇抽或不抽。
   * 值 > 0 時 setup 階段顯示選擇 UI；decide 後歸零（不論接不接受）。
   * 無 mulligan 則一開始就是 [0, 0]。
   */
  pendingMulliganDraw: [number, number];
  /**
   * v3.74：每方每次 mulligan 揭示的 7 張手牌 cardIds（給對手確認用，符合 PTCG 規則）。
   * v3.741：改 object 結構 + 每手 cardIds 用 '|' join 成一個字串 — 避開 Firestore
   *   array-of-array 不允許（同 v2.84 supporterTagsUsedThisTurn 修法）。
   * - mulliganRevealedHands.p1[i] = P1 第 i 次重抽失敗前的 7 張 cardIds，用 '|' join
   * - mulliganRevealedHands.p2[i] = P2 同上
   * createGame 時一次性決定；UI setup 期間顯示翻頁式 modal 給對手確認。
   * 沒 mulligan 的方對應陣列為空 []。
   */
  mulliganRevealedHands?: { p1: string[]; p2: string[] };
  /**
   * v3.74：每方是否已確認對方的 mulligan 揭示（看完 modal 按確認）。
   * 對方沒 mulligan 則自動為 true（無需確認）；雙方都 true 才能進 playing phase。
   */
  mulliganRevealConfirmed: [boolean, boolean];
  /** 行動紀錄（給 UI 顯示用） */
  log: LogEntry[];
  /** 勝者（game-over 時填入） */
  winner?: 0 | 1;
  winReason?: string;
  /**
   * v2.98：每側待領獎賞 [P1 owed, P2 owed]。
   * idx 為「應該取走的 owner」。由 addPendingPrize() 統一寫入。
   * M2 只用到 1（一般擊倒），ex 系列為 2（M4 處理）
   */
  pendingPrizes: [number, number];
  /**
   * 待處理的互動選擇（訓練家效果觸發時設定）
   * 設定後 UI 必須顯示選擇介面，玩家透過 RESOLVE_SELECTION 繼續
   */
  pendingSelection?: PendingSelection;
  /**
   * v2.160：上一次招式套用後實際造成的傷害量（含弱抗 / 道具減傷後最終值）。
   * 由 engine ATTACK handler 在傷害套用點寫入；ATTACK_POST 可讀取。
   * 招式效果如「朽木妖｜終極吸取（heal=實際傷害量）」依賴此值。
   * 每次 ATTACK 開始時重置，避免跨 attack 殘留。
   */
  lastDealtDamage?: number;
  /** 目前場上的競技場牌（Stadium） */
  activeStadium?: CardInstance;
  /**
   * v2.244 場上 stadium 的擁有者（0=P1, 1=P2）。
   * PTCG 規則：stadium 從場上移除時（被覆蓋 / 被招式效果丟掉）放回擁有者的棄牌堆。
   * 一律在 activeStadium 被設定時同步設定本欄；activeStadium 被清為 undefined 時亦清掉。
   */
  activeStadiumOwnerIdx?: 0 | 1;
  /** 雙方本回合是否已使用競技場效果 [P1, P2] */
  stadiumUsedThisTurn?: [boolean, boolean];
  /**
   * 雙方本回合是否已打出過場地卡 [P1, P2]。
   * PTCG 規則：一回合每位玩家只能打出一張競技場卡（不論目前場上有無場地）。
   * 於 END_TURN 重置 activePlayerIndex 側為 false。
   */
  stadiumPlayedThisTurn?: [boolean, boolean];
  /**
   * v2.149/v2.335 祭典樂舞：本回合是否已保留/使用「祭典會場 + 祭典樂舞 寶可夢」的第 2 次招式 bonus [P1, P2]。
   * 條件：場上有「祭典會場」+ attacker 有「祭典樂舞」特性。
   * → 第 1 次招式打完先設 flag；若無待選擇/待取獎/待補戰鬥位，turnPhase 維持 'main'。
   * → 若第 1 次招式 KO 對手戰鬥位，待 TAKE_PRIZES + SEND_NEW_ACTIVE 後回到 'main' 使用第 2 次招式。
   * 打完第 2 次後正常切 'end'。
   * END_TURN 重置 activePlayerIndex 側為 false（避免跨回合殘留）。
   */
  festivalDanceUsedThisTurn?: [boolean, boolean];
  /**
   * v2.381 BUG FIX：祭典樂舞「第 2 次招式已用過」flag。
   *
   * 原本只用 festivalDanceUsedThisTurn 控管，但有 bug：第 2 次招式 KO 後，
   * TAKE_PRIZES / SEND_NEW_ACTIVE 觸發 maybeResumeFestivalDanceSecondAttack 時，
   * 看 festivalDanceUsedThisTurn=true + canResume true → 又把 turnPhase 設為 main，
   * 開放第 3 次攻擊。
   *
   * 此 flag 在「第 2 次招式正式進入 main 階段」時 set 為 true，maybeResume 看到此 flag
   * 已 true 就不再開窗。END_TURN 與 festivalDanceUsedThisTurn 一同清除。
   */
  festivalDanceSecondAttackUsed?: [boolean, boolean];
  /**
   * 我方上次結束自己回合時，對手剩餘獎賞張數的快照 [P1 側快照, P2 側快照]。
   * 比較 snapshot vs 目前 opp 獎賞張數差即可得知「對手上個回合是否取得過獎賞（= 自己寶可夢是否在對手回合被擊倒）」。
   * 用於「不公印章」等需要『前一回合對手取過獎賞』判定的卡牌。
   * 初始值 [6, 6]（雙方都還沒結束過自己的回合，視為對手沒取過獎賞）。
   */
  oppPrizesAtMyLastTurnEnd?: [number, number];
  /**
   * 我方「這個回合開始時」對手剩餘獎賞張數的快照 [P1 側快照, P2 側快照]。
   * 與 oppPrizesAtMyLastTurnEnd 對比判定自 KO：
   *   - TurnStart < LastTurnEnd → 對手在他們剛結束的回合取過獎賞（= 對手回合擊倒我方）
   *   - TurnStart == LastTurnEnd 但當下 opp.prizes 更少 → 自己這個回合內自 KO（不該觸發不公印章）
   * 於 END_TURN 時由「下一個 activePlayer」快照 opp.prizes.length。
   * 初始值 [6, 6]。
   */
  oppPrizesAtMyTurnStart?: [number, number];
  /**
   * v2.246：完整 KO cause tracking — 區分「對手用招式 KO」vs「對手用主動特性 KO」。
   *
   * PTCG 規則情境（從 victim 視角）：
   *   - 招式 KO：對手用招式造成的傷害（含弱抗、tool 加成、反彈傷害）使我方寶可夢 KO
   *   - 主動特性 KO：對手用主動特性（如黑夜魔靈|咒詛炸彈、願增猿|腎上腺腦力）KO 我方寶可夢
   *   - checkup KO：寶可夢檢查階段（中毒、灼傷、checkup 觸發特性如冰冷之帳）— **不算**
   *   - 自 KO：自己 KO 自己的寶可夢（攻擊方自爆）— **不算**「對手 KO 我方」
   *
   * 用途：
   *   - 4 張原始觸發條件（扭轉乾坤、不公印章、八朔、阿波羅）：
   *     attackKOd + abilityKOd > 0 → 條件滿足
   *   - 3 張 revenge-damage（復仇刀鋒、捲土重來、嫉妒業火）卡面寫「因招式的傷害昏厥」：
   *     attackKOd > 0（嚴格只算招式）
   *   - 阿波羅另需 rocket 計數（victim 為「火箭隊的」寶可夢）
   *
   * 計數時機：每次 attack/ability KO 在 engine 內呼叫 recordOppKO helper
   *   （效果產生 KO 即記，與 prize 計算同步）。
   * Snapshot：END_TURN handler 開頭（checkup *之前*）將 thisTurn → InLastOppTurn 並 reset。
   */
  oppAttackKOdMeThisTurn?: [number, number];     // 對手用招式 KO 我方寶可夢的計數（victim 視角）
  oppAbilityKOdMeThisTurn?: [number, number];    // 對手用主動特性 KO 我方寶可夢的計數
  oppAttackKOdMyRocketThisTurn?: [number, number];  // 同上但只計火箭隊寶可夢
  oppAbilityKOdMyRocketThisTurn?: [number, number]; // 同上但只計火箭隊寶可夢
  // 對手剛結束回合的 snapshot（在 END_TURN 開頭、checkup 之前 snap）
  oppAttackKOdMeInLastOppTurn?: [number, number];
  oppAbilityKOdMeInLastOppTurn?: [number, number];
  oppAttackKOdMyRocketInLastOppTurn?: [number, number];
  oppAbilityKOdMyRocketInLastOppTurn?: [number, number];
  /**
   * v2.245：對手剛結束回合的「主回合結束時」（寶可夢檢查 *之前*）的對手獎賞張數快照 [P1, P2]。
   *
   * PTCG 規則：「上個對手的回合自己的寶可夢昏厥了才可使用」這類觸發條件
   *   （吉雉雞ex|扭轉乾坤、不公印章、八朔、火箭隊的阿波羅 等）
   * 只計算「對手主動行動 KO」（招式 / 主動特性），不含寶可夢檢查階段的中毒/灼傷/
   * 雪妖女冰冷之帳 等。
   *
   * 因為寶可夢檢查不屬於任何玩家的回合，此 snapshot 必須在 checkup *之前* 取，
   * 才能正確區分「對手主動 KO」vs「checkup 階段被動 KO」。
   *
   * 取點：END_TURN handler 開頭（在 checkup 區塊之前）。
   *   newMainEnd[oppIdx] = players[aIdx].prizes.length
   *   （aIdx = 結束回合的玩家；oppIdx = 即將進入新回合的玩家）
   *
   * 用法：在 oppIdx 視角下，比較 oppPrizesAtMyLastTurnEnd[me] vs oppPrizesAtMainEnd[me]。
   * 若 MainEnd < LastTurnEnd → 對手在他們的主回合中取過獎賞（= 我方寶可夢被對手主動 KO）。
   * 初始值 [6, 6]。
   */
  oppPrizesAtMainEnd?: [number, number];
  /** v2.78 莊嚴之劍 — 本回合自方已使出的支援者卡 tags。END_TURN 重置。
   *  v2.84：改 object 結構（p1/p2）避開 Firestore nested array 不允許的限制。 */
  supporterTagsUsedThisTurn?: { p1: string[]; p2: string[] };
  /** v2.78 帝牙海獅｜凍結獠牙 — 對手能量 ≤2 寶可夢無法用招式（player-level lock）。 */
  lowEnergyCantAttackNextTurn?: [boolean, boolean];
  lowEnergyCantAttackThisTurn?: [boolean, boolean];
  /**
   * v2.70：我方上次結束自己回合時，自己棄牌堆中「火箭隊的」寶可夢數量的快照 [P1, P2]。
   * 與 rocketInMyDiscardAtMyTurnStart 對比，偵測「對手的回合內我方有火箭隊寶可夢被擊倒」。
   * 用於「火箭隊的阿波羅」等 gate 條件（類似不公印章，但只認火箭隊寶可夢）。
   * 只計 supertype === 'Pokemon' 且 name 以「火箭隊的」開頭的卡片。
   * 初始值 [0, 0]（遊戲開始時棄牌堆為空）。
   */
  rocketInMyDiscardAtMyLastTurnEnd?: [number, number];
  /**
   * v2.245：對手主回合結束時（寶可夢檢查 *之前*）我方棄牌堆中火箭隊寶可夢數量快照 [P1, P2]。
   * 與 oppPrizesAtMainEnd 同 pattern；用於火箭隊的阿波羅，排除 checkup 階段 KO。
   * 取點：END_TURN handler 開頭。newRocketMainEnd[oppIdx] = countRocketPokeInDiscard(players[oppIdx]).
   * 初始值 [0, 0]。
   */
  rocketInMyDiscardAtMainEnd?: [number, number];
  /**
   * v2.70：我方「這個回合開始時」自己棄牌堆中「火箭隊的」寶可夢數量的快照 [P1, P2]。
   * 與 rocketInMyDiscardAtMyLastTurnEnd 對比即可判定「對手上個回合造成過火箭隊寶可夢昏厥」：
   *   turnStart > lastEnd → 對手的回合間自己的火箭隊寶可夢被擊倒 → Apollo 可用
   * 於 END_TURN 時由「下一個 activePlayer」快照其棄牌堆的火箭隊寶可夢數。
   * 初始值 [0, 0]。
   */
  rocketInMyDiscardAtMyTurnStart?: [number, number];
  /**
   * v2.260 Bug #4：古舊能量「對戰中只生效 1 次」減獎追蹤（per-player）。
   * 卡面：「附有這張卡的寶可夢受到對手的寶可夢招式的傷害而【昏厥】時，被獲得的獎賞卡減少 1 張。
   *   對戰中，自己的『古舊能量』的這個效果只生效 1 次。」
   * [P1, P2] — 該玩家附有古舊能量的寶可夢被 KO 並觸發過 -1 後設為 true。
   * 之後即使另一隻附古舊能量的寶可夢被 KO 也不再 -1。
   * 初始值 [false, false]。
   */
  ancientEnergyMinusOneUsed?: [boolean, boolean];
  /**
   * v2.70：copy-attack（例如 火箭隊的謎擬Ｑ｜扮晶晶酒）在 ATTACK_PRE 階段
   * 記下被複製招式的 effectKey（格式 `對手卡名|招式名`），好讓 ATTACK_POST
   * 可以轉接呼叫被複製招式的 POST（包含 pendingSelection 類附加效果）。
   * 必須在呼叫方自己的 POST 最末清空，否則下一招會重複觸發。
   */
  pendingCopyAttackKey?: string;
  /**
   * v2.124：END_TURN 中途若有 self-KO（中毒/灼傷/雪妖女冰冷之帳），剩餘 checkup
   * 與 finalize（清旗標 + 切換玩家）需要等被 KO 方補完戰鬥位後才繼續。
   * 此欄位記錄「正在結束回合的玩家 idx」；SEND_NEW_ACTIVE handler 偵測到此值
   * 不為 undefined → 補完後呼叫 finalizeEndTurn 完成切換玩家。
   */
  endTurnContinueAfterKO?: 0 | 1;
  /**
   * v2.124：搭配 endTurnContinueAfterKO 使用。SEND_NEW_ACTIVE re-dispatch END_TURN
   * 完成 finalize 時，跳過所有寶可夢 checkup（毒/灼/睡/麻/雪妖女）— 因為這些已經
   * 在第一次 END_TURN 跑過了，不可重複觸發傷害。
   */
  endTurnSkipCheckup?: boolean;
  /**
   * v3.892：attack-time snapshot — 攻擊宣告時對手場上是否有花之帷幔（謝米）。
   * 由 engine.ts ATTACK handler 在 PRE 之前 set，POST 後清掉。
   * hitBenchPickPost / hitBenchAll 入口 check 此 flag — true 時對對手備戰整段 skip。
   *
   * 理由：PTCG 規則「招式效果同時 resolve」— 即使謝米被招式 KO，
   * 攻擊宣告當時花之帷幔有效，備戰寶可夢仍應免疫此招式傷害。
   * POST 階段 defender.active 可能已 KO=null，無法事後判定，故需 snapshot。
   *
   * Transient：每次 attack flow 後 clear，不持久化（連線對戰 / 存檔不需考慮）。
   */
  _attackTimeOppFlowerVeil?: boolean;
}

export interface LogEntry {
  turn: number;
  playerIndex: 0 | 1 | null; // null = 系統訊息
  /** 公開訊息：所有人都看得到（含對手） */
  message: string;
  /**
   * v2.130：私有訊息覆寫（只給 playerIndex 所有者本人看）。
   * 例：忍之利刃 attacker 看「搜到 氣球 加入手牌」，對手看 message=「搜到 一張卡片」。
   * 若未設則所有人都看 message。null/undefined 表示沒有 private 版本。
   */
  privateMessage?: string;
  /**
   * v3.891：產生此 log 的 source inst iid（通常 = state.players[playerIndex].active.iid）。
   * 點擊 log 卡名連結時，UI 端先用此 iid 對應 inst 找 cardId，
   * 解決同名多版本卡（謝米 70HP/80HP 等）誤匹配問題。
   */
  sourceIid?: string;
}

// ── 動作 ────────────────────────────────────────────────────────────────────

export type GameAction =
  // setup 階段（senderIdx 必填 — setup 階段雙方同時行動，需明示來源）
  | { type: 'PLACE_ACTIVE'; iid: string; senderIdx: 0 | 1 }
  | { type: 'BENCH_POKEMON'; iid: string; senderIdx: 0 | 1 }
  | { type: 'FINISH_SETUP'; senderIdx: 0 | 1 }
  /** 對手 mulligan 補抽：accept=true 抽齊 pendingMulliganDraw[senderIdx] 張；false 放棄 */
  | { type: 'MULLIGAN_DRAW_DECISION'; accept: boolean; senderIdx: 0 | 1 }
  /** v3.74：玩家確認對方的 mulligan 揭示（看完 modal 後按確認）。設 mulliganRevealConfirmed[senderIdx]=true */
  | { type: 'CONFIRM_MULLIGAN_REVEAL'; senderIdx: 0 | 1 }

  // 正式對戰
  | { type: 'DRAW_CARD' }
  | { type: 'PLAY_BASIC'; iid: string }          // 從手牌打出基礎寶可夢到備戰區
  | { type: 'PLAY_FOSSIL'; iid: string }         // v2.187 化石 Item 作為 HP60【無】基礎寶可夢放到備戰區
  | { type: 'DISCARD_FOSSIL'; iid: string }      // v2.187 場上化石自主丟棄（非昏厥，對手不抽獎賞）
  | { type: 'ATTACH_ENERGY'; energyIid: string; targetIid: string }
  | { type: 'EVOLVE'; fromIid: string; toIid: string }
  | { type: 'RETREAT'; newActiveIid: string }
  | { type: 'PLAY_TRAINER'; iid: string; params?: Record<string, unknown> }
  | { type: 'RESOLVE_SELECTION'; selectedIids: string[]; senderIdx?: 0 | 1 }
  | {
      type: 'ATTACK';
      attackIndex: number;
      discardedEnergyIids?: string[];
      /**
       * v2.119：copy-attack 類招式（如 N的索羅亞克ex｜暗黑底牌）需要玩家先選：
       *   - pokeIid：要複製招式的「源頭」寶可夢（備戰區某隻 N的寶可夢）
       *   - attackIndex：該寶可夢 attacks 陣列的 index
       * 由 UI 層在 initiateAttack 時彈 picker 讓玩家挑；regPre/regPost 讀取此欄位
       * 轉接到被複製招式的 PRE/POST。無傳值時 fallback 為自動挑最高傷害招式。
       */
      copyAttackChoice?: { pokeIid: string; attackIndex: number };
    }
  | { type: 'TAKE_PRIZES'; count: number; playerIdx: 0 | 1; senderIdx?: 0 | 1 }
  | { type: 'SEND_NEW_ACTIVE'; iid: string; senderIdx?: 0 | 1 }
  | { type: 'USE_STADIUM' }
  | { type: 'USE_ABILITY'; iid: string; abilityIndex: number }
  // v3.07 Deferred Wave D — 手牌 UI 元件層 hook（3 張）
  // 玩家從手牌主動丟棄 1 張卡 → 觸發場上對應 trigger holder 的特性
  // 例：丟悠哉尾草棒觸發超能妙喵｜誘導之尾；丟基本【火】能量觸發火神蛾｜熱浪鱗粉
  | { type: 'USE_HAND_DISCARD_ABILITY'; triggerCardName: string; discardIid: string }
  // 玩家從手牌主動把『此手牌寶可夢自身』作為 trigger 放上備戰
  // 例：齒輪怪｜緊急迴轉 — 對手場上有 2 階進化時把齒輪怪從手牌放到備戰
  | { type: 'USE_HAND_ABILITY'; cardIid: string; abilityIndex: number }
  | { type: 'END_TURN' };

// ── 效果腳本插槽（M3/M4 填入） ─────────────────────────────────────────────

export interface EffectScript {
  implemented: boolean;
  execute?: (
    state: GameState,
    actorIndex: 0 | 1,
    params?: Record<string, unknown>
  ) => GameState;
}
