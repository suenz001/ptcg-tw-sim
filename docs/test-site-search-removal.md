# 測試站搜尋排除與現有結果移除

測試站：`https://suenz001.github.io/ptcg-tw-sim/`。正式站：`https://www.ptcg-tw-sim.com/`。

## 已由網站發布流程處理

GitHub Pages 工作流程在 `npm run build` 成功後、上傳 artifact 前，執行
`node scripts/set-test-site-noindex.mjs`。所有內容 HTML（含卡片深層頁、404、更新紀錄片段）
都會在 HTML 的 head 中帶有 `robots: noindex, follow`。此命令未接入一般 build；正式站的
搜尋設定、canonical 與 sitemap 保持原狀。轉換或驗證失敗會中止 Pages 發布。

唯一保留原文的 HTML 是 Google 擁有權驗證檔：檔名必須是 `google[十六進位].html`，
且內容必須精確對應 `google-site-verification: 同檔名`（僅容許頭尾空白）。
它是擁有權證明，不是網站內容頁；不能改寫而讓既有 Search Console 驗證失效。

已收錄的內容不會在發布瞬間消失。Google 重新抓取並讀到 noindex 後才會排除；
已知測試網址仍可直接使用。不要追加 robots.txt Disallow 全站，避免阻擋爬蟲讀取 noindex。

## 站長可操作：加速隱藏現有 Google 搜尋結果

1. 登入 [Google Search Console](https://search.google.com/search-console/)。
2. 新增或選取測試站的「網址前置字串」資源：
   `https://suenz001.github.io/ptcg-tw-sim/`，依 Google 介面完成擁有權驗證。
   正式站的網域資源不涵蓋 github.io；請勿誤選正式站資源或輸入正式站網址。
3. 開啟「移除」→「暫時移除」→「新增要求」，選擇暫時移除網址。
4. 輸入 `https://suenz001.github.io/ptcg-tw-sim/`，選「移除所有含此前置字串的網址」。
   若 Search Console 顯示其他沒有尾斜線的獨立根網址，也核對並處理該網址。
5. 在「網址審查」使用即時測試，檢查測試站內容頁有 noindex；後續觀察索引報表。

暫時移除約持續六個月，長期排除由已部署的 noindex 負責。無須為此執行正式站部署 bat。
admin 內部改版條目會隨站長下一次後台部署更新；玩家首頁不新增此維護條目。

依據：[Google noindex 說明](https://developers.google.com/search/docs/crawling-indexing/block-indexing)、
[Search Console 移除工具](https://support.google.com/webmasters/answer/9689846?hl=zh-Hant)。
