// ─────────────────────────────────────────────────────────────────────────────
// 選擇器候選建構（純函式版本）— picker UI 的「params → 可選候選」邏輯抽出可單元測試。
//
// 背景：候選建構原 inline 在 +page.svelte selectionCandidates switch 內，無自動化測試。
//   v5.717 戲法舞步把選能量 picker 改 active-energy-discard 時，誤傳 targetIid=對手 active
//   → all-opp 分支 `if (pk.iid === targetIid) continue` 跳過 active 能量 → 玩家「連能量都選不到」。
//   engine harness 測不到此前端渲染。抽成純函式 + scripts/test-selection-candidates.mjs 覆蓋。
//
// ⚠ 行為等價要求：忠實鏡射原 inline 邏輯（含 validIids 篩選、targetIid 排除、向後相容）。
//   修改務必同步更新測試網。
// ─────────────────────────────────────────────────────────────────────────────

import type { CardInstance } from './types';

type SrcPlayer = { active: CardInstance | null; bench: CardInstance[] };

/**
 * active-energy-discard picker 的能量候選（src = sourcePlayerIdx 對應的 player）。
 *   - scope 'all-own'/'all-opp'：列 src 場上(active+bench)所有寶可夢能量；validIids 限定；
 *     targetIid（若傳）排除「該寶可夢自己」的能量（自轉無意義，如挪動一下的來源）。
 *     ⚠ 故「要選某寶可夢自己身上的能量」時不可把它設為 targetIid（戲法舞步 v5.718 教訓）。
 *   - 否則若有 targetIid：列該 target 身上能量（validIids 篩選；粉碎/改造之錘）。
 *   - 否則：列 src.active 能量（預設，自身丟能量）。
 */
export function activeEnergyDiscardCandidates(
  params: Record<string, unknown> | undefined,
  src: SrcPlayer,
): CardInstance[] {
  const scope = params?.scope as string | undefined;
  if (scope === 'all-own' || scope === 'all-opp') {
    const allPokes: CardInstance[] = [...(src.active ? [src.active] : []), ...src.bench];
    const validIidsSet = new Set(params?.validIids as string[] | undefined);
    const targetIidS = params?.targetIid as string | undefined;
    const out: CardInstance[] = [];
    for (const pk of allPokes) {
      if (pk.iid === targetIidS) continue; // 不列 target 自己的能量（自轉無意義）
      for (const e of pk.energyAttached) {
        if (validIidsSet.size === 0 || validIidsSet.has(e.iid)) out.push(e);
      }
    }
    return out;
  }
  const targetIid = params?.targetIid as string | undefined;
  if (targetIid) {
    const tgt = src.active?.iid === targetIid ? src.active
              : src.bench.find(b => b.iid === targetIid);
    const validIidsT = params?.validIids as string[] | undefined;
    const eListT = tgt?.energyAttached ?? [];
    return validIidsT ? eListT.filter(e => validIidsT.includes(e.iid)) : eListT;
  }
  return src.active?.energyAttached ?? [];
}
