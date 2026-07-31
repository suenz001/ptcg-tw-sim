/**
 * v2.37 新牌組批次實裝 — 5 組預設牌組缺失效果補全
 *
 * 涵蓋使用者交付的 5 套新預組（魔靈超級寶石海星 / 寶石猛雷鼓 / 月月熊 赫月 /
 * 岩殿居蟹 / 遠古巨蜓）所需要、且 v2.363 之前尚未補上的寶可夢招式。
 *
 * 不在本檔的部分（已散落於既有實裝，本次無需重做）：
 *   - 雪妖女｜冰冷之帳            engine.ts checkup hook（v2.70 / v2.125）
 *   - 岩殿居蟹｜神秘石居           effects.ts PASSIVE_IMMUNITY（v2.267）
 *   - 純傷害招式（海星星｜水槍 20、雪妖女｜冰霜粉碎 60、蜻蜻蜓｜銳利羽 30、
 *     可達鴨｜衝撞 20、探探鼠｜咬住 10）— 引擎讀 attacks[i].damage 自動處理。
 *
 * 本檔登錄：
 *   A. 石居蟹｜覺醒          0C，自身從牌庫進化為「岩殿居蟹」（覺醒進化招式）
 *   B. 岩殿居蟹｜偉大剪     GCC，120 傷害，不計算對手戰鬥寶可夢身上附加效果
 *   C. 蜻蜻蜓｜吹飛           0C，強制對手將戰鬥寶可夢與備戰互換（由對手選擇）
 *   D. 雷吉奇卡斯｜寶石破壞   CCCC，100；若對手戰鬥場為「太晶」寶可夢則 +230
 *
 * 設計取捨：
 *   - 可達鴨｜濕氣 — v2.65 已既存實裝（effects.ts hasPsyduckDamp），新版 M2a 可達鴨
 *     的 abilities[0].name === '濕氣' 直接被既有 hook 認得，無需重做。
 *   - 探探鼠｜監視之眼 — v2.371 已補實裝（maroon_dragon_deck.ts hasOakEye + engine.ts
 *     腎上腺腦力 gate），目前覆蓋「願增猿｜腎上腺腦力」此類「移放傷害指示物」特性。
 *     未來新增同類特性時，只要在其 regA 入口加 hasOakEye 檢查即可。
 */

import type { CardInstance, PlayerState } from '../../types';
import { canApplyEffectToTarget } from '../../defense'; // v5.837 換位免疫 gate
import {
  addLog,
  regPost,
  regPre,
  regR,
  shuffle,
  updatePlayer,
  withPending,
} from '../_shared';
import { evolvedStatusAfter, buildEvolvedInstance } from '../_shared'; // v5.741/v5.742 進化狀態+建構中央
import { registerDirectEvolveAwaken } from '../../effects'; // v6.078 「覺醒」型直接進化中央 helper

// ══════════════════════════════════════════════════════════════════════════════
// A. 石居蟹｜覺醒 — 招式驅動「從牌庫直接進化」
// ──────────────────────────────────────────────────────────────────────────────
// 卡面（M2a 013/193）：「從自己的牌庫選擇 1 張從這隻寶可夢進化而來的卡，放置於
//   這隻寶可夢身上完成進化。並且重洗牌庫。」
// cost: ['Colorless']，無傷害。
// ══════════════════════════════════════════════════════════════════════════════
// v6.078：收斂到 effects.ts registerDirectEvolveAwaken（夢妖／伊布／火箭隊的沙基拉斯／
//   M6 穿山鼠措辭逐字相同 → 單一來源）。effectKey 沿用 'crab-awaken-evolve' 不變。
registerDirectEvolveAwaken('石居蟹|覺醒', '石居蟹', 0, 'crab-awaken-evolve');

// ══════════════════════════════════════════════════════════════════════════════
// B. 岩殿居蟹｜偉大剪 — 120 傷害，不計算對手戰鬥寶可夢身上附加效果
// ══════════════════════════════════════════════════════════════════════════════
regPre('岩殿居蟹|偉大剪', (state, _aIdx, _pool) => ({
  state,
  damage: 120,
  skipDefEffects: true,
}));

// ══════════════════════════════════════════════════════════════════════════════
// C. 蜻蜻蜓｜吹飛 — 0 cost C，強制對手將戰鬥/備戰互換（由對手選擇）
// ══════════════════════════════════════════════════════════════════════════════
regPre('蜻蜻蜓|吹飛', (state, _aIdx, _pool) => ({ state, damage: 0 }));
regPost('蜻蜻蜓|吹飛', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const d = state.players[dIdx];
  if (!d.active) return state;
  // v5.837：化隱/純樸等免疫招式效果的 active 不被強制換位（對齊中央 forceOppSwapPost）。
  {
    const _sg = canApplyEffectToTarget(state, aIdx, d.active, _pool.get(d.active.cardId), 'attack-effect', _pool);
    if (_sg.blocked) return addLog(state, `吹飛：${_sg.reason}（不被強制換位）`, aIdx);
  }
  if (d.bench.length === 0) {
    return addLog(state, '吹飛：對手沒有備戰寶可夢可交換', aIdx);
  }
  const s = addLog(state, '吹飛：對手必須將戰鬥寶可夢與備戰寶可夢互換（由對手選擇）', aIdx);
  return withPending(s, {
    type: 'bench-choose',
    actorIdx: dIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'force-opp-swap',
    params: { label: '吹飛', attackerIdx: aIdx },
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// D. 雷吉奇卡斯｜寶石破壞 — 100 + (對手戰鬥場為「太晶」寶可夢時 +230)
// ══════════════════════════════════════════════════════════════════════════════
regPre('雷吉奇卡斯|寶石破壞', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx].active;
  const defCard = def ? pool.get(def.cardId) : undefined;
  const isTera = !!defCard?.tags?.includes('太晶');
  let logged = state;
  if (isTera) {
    logged = addLog(state, '寶石破壞：對手戰鬥場為太晶寶可夢 → +230', aIdx);
  }
  return { state: logged, damage: 100 + (isTera ? 230 : 0) };
});

// stub 區已淨空 — 可達鴨｜濕氣（v2.65 既存）/ 探探鼠｜監視之眼（v2.371）皆完整實裝。

// 輔助：避免 TS 把未使用的型別 import 標記成 unused
export type _v2370Sentinel = PlayerState;
