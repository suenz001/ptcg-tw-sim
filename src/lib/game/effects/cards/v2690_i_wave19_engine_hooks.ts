/**
 * v2.69 I 標 Wave 19 — 引擎機制擴充收尾（4 張）
 *
 * 4 張卡分別仰賴 4 個新增的引擎 hooks（types.ts CardInstance 加新欄位 +
 * engine.ts 在 ATTACK 損害應用 / ATTACK_POST 結算後 / ATTACH_ENERGY 完成後 /
 * END_TURN 對 aIdx 方執行 promote/clear/KO）：
 *
 * 1. 超級赫拉克羅斯ex｜重裝角擊 100+ — defender 受到的招式傷害累計（damageTakenLastOppTurn）
 * 2. 雙彈瓦斯｜瘋狂炸彈 50+ — 上回合自身使用過「充滿瓦斯」+120（attackUsedLastSelfTurn）
 * 3. 帕奇利茲｜麻痺門牙 10 — 對手附能量到 defender 觸發 8 指示物（paralyzeFangPending）
 * 4. 火箭隊的臭泥｜浸蝕污泥 0 — 下個對手回合結束時 KO defender（koAtMyNextEndOfTurn）
 */

import { regPre, regPost, addLog, updatePlayer } from '../_shared';
import type { AttackPostFn, AttackPreFn } from '../_shared';

// ══════════════════════════════════════════════════════════════════════════════
// 1. 超級赫拉克羅斯ex｜重裝角擊 100+ — 增加上個對手回合此寶可夢受到的招式傷害
// ══════════════════════════════════════════════════════════════════════════════
regPre('超級赫拉克羅斯ex|重裝角擊', (state, aIdx, _pool) => {
  const a = state.players[aIdx].active;
  const dmgTaken = a?.damageTakenLastOppTurn ?? 0;
  const dmg = 100 + dmgTaken;
  return {
    state: addLog(state, `重裝角擊：上個對手回合受到 ${dmgTaken} 點招式傷害 → 100 + ${dmgTaken} = ${dmg}`, aIdx),
    damage: dmg,
  };
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. 雙彈瓦斯｜瘋狂炸彈 50+ — 上個自己回合使出過「充滿瓦斯」+120
// ══════════════════════════════════════════════════════════════════════════════
regPre('雙彈瓦斯|瘋狂炸彈', (state, aIdx, _pool) => {
  const a = state.players[aIdx].active;
  const last = a?.attackUsedLastSelfTurn;
  if (last === '充滿瓦斯') {
    return { state: addLog(state, `瘋狂炸彈：上個自己回合用過「充滿瓦斯」 → 50+120 = 170`, aIdx), damage: 170 };
  }
  return { state: addLog(state, `瘋狂炸彈：上個自己回合未用過「充滿瓦斯」（last=${last ?? '無'}） → 50`, aIdx), damage: 50 };
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. 帕奇利茲｜麻痺門牙 10 — 在受擊者上設 paralyzeFangPending
// ══════════════════════════════════════════════════════════════════════════════
regPre('帕奇利茲|麻痺門牙', (s) => ({ state: s, damage: 10 }));
regPost('帕奇利茲|麻痺門牙', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  return updatePlayer(
    addLog(state, '麻痺門牙：在 defender 上設 paralyzeFangPending → 下個對手回合附能量時放 8 個指示物', aIdx),
    dIdx, p => ({
      ...p,
      active: p.active ? { ...p.active, paralyzeFangPending: true } : null,
    }),
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. 火箭隊的臭泥｜浸蝕污泥 — 在受擊者上設 koAtMyNextEndOfTurn
// ══════════════════════════════════════════════════════════════════════════════
regPre('火箭隊的臭泥|浸蝕污泥', (s) => ({ state: s, damage: 0 }));
regPost('火箭隊的臭泥|浸蝕污泥', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  return updatePlayer(
    addLog(state, '浸蝕污泥：在 defender 上設 koAtMyNextEndOfTurn → 下個對手回合結束時 KO', aIdx),
    dIdx, p => ({
      ...p,
      active: p.active ? { ...p.active, koAtMyNextEndOfTurn: true } : null,
    }),
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// Wave 19 統計：4 張寶可夢招式 effect 實裝
// I 標寶可夢招式 effect 累計：450 + 4 = 454 張，引擎覆蓋率 ~98%
// ══════════════════════════════════════════════════════════════════════════════
