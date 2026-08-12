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

type SrcPlayer = { active: CardInstance | null; bench: CardInstance[]; discard?: CardInstance[] };

/**
 * ⭐⭐⭐ v6.176 中央述詞：**場上目標型 picker 的基礎候選**。
 *
 * 背景（v6.109 踩過的坑）：`filter`（UI 顯示什麼）與 `params.validIids`（中央閘允許勾什麼）
 *   一旦各寫一份就會漂移 —— 玩家看得到卻勾不動、或勾得到不該勾的。
 *   這個函式就是**唯一那一份**：
 *     ・`+page.svelte` 的 selectionCandidates 四個 case 用它算「顯示什麼」；
 *     ・`engine.sanitizeSelectedIids` 在 pending **沒有**宣告 validIids 時用它算「能勾什麼」。
 *   兩端同源 ⇒ 結構上不可能漂移。
 *
 * 語義（逐字對齊原本 inline 在 +page.svelte 的四個 case，零行為變更）：
 *   ・heal-target / opp-poke-choose：戰鬥位 + 備戰（這兩型天生含戰鬥位）
 *   ・bench-choose / opp-bench-choose：只有備戰；`includeActive` 才加上戰鬥位
 *
 * ⚠ 這是「該側場上」而不是「卡面允許的範圍」。卡面若更窄（只能選有能量的／非ex／受傷的…），
 *   呼叫端**必須**自己宣告 `params.validIids` 覆寫；本函式只負責兜底，不是卡面的替代品。
 */
export function fieldPickerBaseCandidates(
  type: string,
  src: SrcPlayer,
  includeActive?: boolean,
): CardInstance[] {
  if (type === 'heal-target' || type === 'opp-poke-choose') {
    return [...(src.active ? [src.active] : []), ...src.bench];
  }
  return includeActive === true && src.active ? [src.active, ...src.bench] : src.bench;
}

/** 同上，只取 iid（給 pending.params.validIids / 中央消毒閘用）。 */
export function fieldPickerBaseIids(
  type: string,
  src: SrcPlayer,
  includeActive?: boolean,
): string[] {
  return fieldPickerBaseCandidates(type, src, includeActive).map(c => c.iid);
}

/** 本函式涵蓋的 pending 型別（中央閘用來決定要不要套 fallback）。 */
export const FIELD_TARGET_PICKER_TYPES = new Set([
  'heal-target', 'bench-choose', 'opp-bench-choose', 'opp-poke-choose',
]);

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
  // v5.769：fromDiscard — 對手戰鬥位已被本招式『傷害』KO，欲搬移的能量在該方棄牌區
  //   (戲法舞步改附對手備戰 / 反轉之風放回對手手牌)。validIids = _koDefenderEnergySnapshot 記錄的 iid。
  if (params?.fromDiscard) {
    const validIidsSet = new Set(params?.validIids as string[] | undefined);
    return (src.discard ?? []).filter(e => validIidsSet.size === 0 || validIidsSet.has(e.iid));
  }
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
