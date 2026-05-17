# ABILITY_EFFECTS Key 重構計劃

## 背景

`ABILITY_EFFECTS` map 原本用 `${cardName}|${abilityIndex}` 當 key 註冊特性實作。
這個設計假設「同名卡共享 ability」— 但實際上 9 組同名卡跨 set 有不同的 abilities[0]：

| cardName | abilityName 候選 |
|----------|------------------|
| 叉字蝠 | 夜間工作 / 怨影使者 |
| 岩殿居蟹 | 神秘石居 / 結實 |
| 怖納噬草 | 恐慌牢籠 / 雜草魂 |
| 桃歹郎 | 劇毒支配 / 最後鎖鏈 |
| 樂天河童 | 激動治癒 / 生機森巴 |
| 白海獅 | 厚脂肪 / 沖刷 |
| 肋骨海龜 | 全能硬殼 / 原始心得 |
| 莫魯貝可 | 搜尋點心 / 飢餓衝刺 |
| 齒輪怪 | 緊急迴轉 / 齒輪塗層 |

## 已完成（v4.4995）

- **雙 map 設計**：
  - 保留 `ABILITY_EFFECTS` (key=`${cardName}|${abIdx}`) — 現有 125 個 regA 註冊不動
  - 新增 `ABILITY_EFFECTS_BY_NAME` (key=`${cardName}|${abilityName}`) — 解決撞 key
- 新 helper `regAByName(cardName, abilityName, fn)`
- dispatch 點（USE_ABILITY / getUsableAbilities / retreat hook）用 helper `getAbilityFn` / `hasAbilityFn`：先查 by-name fallback by-index
- 叉字蝠 SV6a 怨影使者完整實裝

## 漸進遷移路徑

### Phase 1：把現有 9 組撞 key 卡遷移到 regAByName
對每組撞 key 卡：
1. 找出 `regA('XX', 0, fn)` 註冊點，把 abIdx 換成實際 abilityName
2. 改 `regA` 為 `regAByName`
3. 確認 dispatch 走 by-name path（log / 行為一致）

優先順序（按使用頻率推估）：
- [x] 叉字蝠（v4.4995 完成）
- [ ] 樂天河童（v2995 註冊「激動治癒」/「生機森巴」— 需確認）
- [ ] 莫魯貝可（v2930 註冊「搜尋點心」— 撞 SV8a「飢餓衝刺」）
- [ ] 白海獅（v2380 註冊「沖刷」— 撞 M2「厚脂肪」）
- [ ] 怖納噬草（v2998 註冊「恐慌牢籠」— 撞 MC/SV5M/SV8a「雜草魂」）

其他 4 組（岩殿居蟹、桃歹郎、肋骨海龜、齒輪怪）目前沒 regA 直接註冊，可能 passive 形式，**不會撞 key**，無需遷移。

### Phase 2（可選）：把全部 125 個 regA 遷移到 regAByName

需要：
- audit script 從 JSON 對每個 cardName 抓 abilities[0].name
- 對非衝突卡可機械式 rewrite
- 衝突卡需手動

完成後可移除舊 `ABILITY_EFFECTS` map + `regA` helper（純 by-name 設計）。

### Phase 3（可選）：抽 cardId-based key

如果未來出現「同名卡同 abilityName 但效果不同」案例（理論可能但目前無），可進一步重構成 `${cardId}|${abilityName}`。

## 設計決策記錄

- **為什麼不一次全 rewrite？** 風險太高（125 個註冊點），分階段遷移 + backward-compat 雙 map 是穩健做法
- **dispatch 點為什麼先 by-name？** 新註冊用 by-name，舊註冊 fallback by-index — 新邏輯優先生效
- **同名卡同 ability 衝突？** 不可能（PTCG 規則同名同 ability 永遠一樣）
- **rule of thumb**：未來新加 regA 一律用 regAByName

## 風險評估

| 風險 | 機率 | 影響 | 緩解 |
|------|------|------|------|
| 雙 map 不同步 | 低 | 中 | helper 函式統一查詢，沒法繞過 |
| 遷移過程 dispatch 行為改變 | 低 | 高 | tsc + svelte-check + 實機驗證每 phase |
| 同名卡同 abilityName 仍撞 | 極低 | 高 | PTCG 規則保證唯一性 |

## 參考

- v4.4994：叉字蝠 SV6a defensive check + getUsableAbilities skip（暫擋方案，已移除）
- v4.4995：本次重構 + 怨影使者實裝
