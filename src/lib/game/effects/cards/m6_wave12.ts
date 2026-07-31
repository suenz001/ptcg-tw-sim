// v6.078 M6「綠寶石風暴」實裝 批次 12 —— 手牌揭示型招式
//
// ⚠ 卡面逐字取自 static/cards（台灣官方中文），未經簡化。

import { registerHandRevealAttack } from '../../effects';

// ── 1. 變隱龍｜鮮豔鞭打 30× ────────────────────────────────────────────────
// 卡面：從自己的手牌將任意數量的寶可夢卡給對手看過後，
//        造成給對手看過的寶可夢的屬性種類的數量×30點傷害。
//   ⚠ 計數是「**屬性種類**的數量」不是張數 —— 3 張【草】只算 1 種。
//   ⚠ 屬性讀 pokemonType（寶可夢卡一定有；基本能量恒 null 的坑不適用於寶可夢卡）。
registerHandRevealAttack({
  key: '變隱龍|鮮豔鞭打',
  label: '鮮豔鞭打',
  supertype: 'Pokemon',
  revealLabel: '寶可夢卡',
  damageOf: (revealed) => new Set(revealed.map(c => c.pokemonType).filter(Boolean)).size * 30,
  describe: (revealed, dmg) => {
    const types = [...new Set(revealed.map(c => c.pokemonType).filter(Boolean))];
    return `${types.length} 種屬性 × 30 = ${dmg} 傷害`;
  },
  emptyText: '手牌中沒有寶可夢卡',
});

// ── 2. 雙劍鞘｜劍武備 60×（v6.078 修正：原本自動全展示，卡面是「任意數量」）─────
// 卡面：從自己的手牌將任意數量的「獨劍鞘」「雙劍鞘」「堅盾劍怪」給對手看過後，
//        造成其張數×60點傷害。
//   ⚠ 原實作直接數手牌中符合名稱的張數 → 玩家沒有「少展示」的選擇權。
//     卡面寫「任意數量」，且手牌是隱藏資訊 —— 展示幾張是有意義的決策。
//   ⚠ 這裡數的是**張數**（與鮮豔鞭打的「屬性種類」不同）。
registerHandRevealAttack({
  key: '雙劍鞘|劍武備',
  label: '劍武備',
  names: ['獨劍鞘', '雙劍鞘', '堅盾劍怪'],
  revealLabel: '「獨劍鞘」「雙劍鞘」「堅盾劍怪」',
  damageOf: (revealed) => revealed.length * 60,
  describe: (revealed, dmg) => `${revealed.length} 張 × 60 = ${dmg} 傷害`,
  emptyText: '手牌中無獨劍鞘／雙劍鞘／堅盾劍怪',
});
