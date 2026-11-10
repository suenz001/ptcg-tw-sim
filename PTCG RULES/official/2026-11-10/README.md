# 官方規則資料封存（2026-11-10）

依據站長提供的 [第十三回資格認證測驗公開範圍](https://asia.pokemon-card.com/hk/exam_details_13/) 建檔。這是維護參考資料，不是試題庫，不構成網站規則一致性認證。

## 六項範圍對照

| 考試範圍 | 本機資料 | 取得狀態與限制 |
|---|---|---|
| 超級進化系列卡牌 | `products.json`、`card-catalog.json`、`card-coverage.json`、`additional-card-texts.json`，以及索引所指向的 `static/cards/*.json` | 官方 M* 商品目錄與卡牌文字對照；只涵蓋官網可檢索範圍。現有卡表不是本日重新下載的原文；另存的文字未核卡圖，不更動卡池。最終數量與缺口見 `validation.json`。 |
| 超級進化系列遊戲說明書 | `pages/mega-starter-hk.md`、`pages/basic-rules-1.md`～`7.md` | **原版系列說明書待補**。官方商品頁列有紙本玩法說明書，本次未找到可驗證的官方公開 PDF。另存官方線上教學供查閱，不能視為相同版本或替代原檔。 |
| 朱&紫系列卡牌 | 同上，商品代碼 SV* | 與超級進化分開標記系列；歷史卡僅作規則參考，本站仍只維護 H／I／J。卡圖像素未在這次重新下載。 |
| 朱&紫系列遊戲說明書 | `pages/sv-starter.md`、上述官方線上教學 | **原版系列說明書待補**。官方商品頁載明紙本說明書，本次未找到可驗證的官方公開 PDF，不冒稱六項均已完整取得。 |
| 進階玩家規則教學手冊 | [PDF](pdf/advanced-manual-3.4.1.pdf)／[文字](text/advanced-manual-3.4.1.txt) | ver 3.4.1，61 頁；官方下載頁更新日 2026-08-28。原有 3.4 不覆寫。 |
| 寶可夢卡牌遊戲賽場規則 | [PDF](pdf/floor-rules-1.32.pdf)／[文字](text/floor-rules-1.32.txt) | Ver. Asia-1.32，12 個 PDF 實際頁；PDF 內文最終更新日及官網更新日均為 2025-08-21。原封面目錄的印刷頁碼與實際 PDF 頁數不完全相同，引用時須區分。 |

## 一併收錄的官方補充文件

| 文件 | 本機資料 | 版本／日期 |
|---|---|---|
| 招式的處理順序 | [PDF](pdf/attack-flow.pdf)／[文字](text/attack-flow.txt) | 2 頁；官網未在本入口列明版本日期，不以 URL 的 2021/09 當生效日。 |
| 罰則速查表 | [PDF](pdf/penalty-chart-240111.pdf)／[文字](text/penalty-chart-240111.txt) | 1 頁；內文日期 2024-01-11。官網仍連結此檔，與較新罰則文件應分開核對，不預設舊表優先。 |
| 裁判罰則處理規則 | [PDF](pdf/judge-penalty-1.3.pdf)／[文字](text/judge-penalty-1.3.txt) | Ver.1.3，33 頁；PDF 內文最終更新日 2026-09-04，官網下載頁更新日 2026-10-08。第 31 頁是原檔空白頁，完整保留。 |

三份主要 PDF 的台灣／香港下載檔已逐份比對 SHA-256，位元組相同。仍以各來源與日期辨識，不把其他地區或英文版資料混入台灣卡面依據。

原官方 3.4.1 PDF 有少數字形／字碼問題：擷取文字共 3 處 U+F8FF，第 9 頁「神秘花園」末字的原檔渲染亦異常，具體頁碼見 manifest 的 `sourceFontMappingWarnings`。原檔完整保留，不把它描述成沒有排版或字形缺陷；遇到相關卡名須交叉查台灣官方卡圖及 Q&A，不能依錯字改遊戲。

## 卡牌目錄的範圍

| 系列 | 官方檢索商品數 | 不重複官方卡牌 ID |
|---|---:|---:|
| 超級進化（M*） | 19 | 2,756 |
| 朱&紫（SV*） | 53 | 5,061 |
| 合計 | 72 | 7,817 |

共核對 429 個官方卡牌列表頁。目錄不套標準賽制篩選，故包含本站不維護的歷史卡；本站已存在相同 id 的 5,388 筆沿用現有維護卡表，另 2,429 個 id 的頁面文字獨立封存。各項實際完成與缺漏狀態以 `validation.json` 為準，不能僅憑本段數字宣稱下載已成功。

## 內容與搜尋

- `manifest.json`：5 份原始 PDF 與 18 份官方網頁文字擷取的來源、雜湊、下載時間、地區、版本及頁數；網頁只擷取 main 文字與連結，未嵌入影片或圖片。
- `text/*.txt`：原 PDF 文字擷取，以「PDF 第 N 頁」分隔；衍生文字統一 LF、移除行尾空白，不是人工改寫規則。抽字可能失去表格欄位關係、能量圖示或底線語義，判定時仍須查看對應 PDF 原頁。原 PDF 使用的相容部首字可能使一般字串搜尋漏查，可先用 `unicodedata.normalize('NFKC', text)` 建立暫存搜尋字串；不改原檔。
- `pages/*.md`：官方考試公開範圍、規則下載入口、七個玩法章節、賽制、商品及附件入口。
- `products.json`／`card-catalog.json`：官方商品與逐頁卡牌 id；`complete` 只表示本次該商品獨立 id 數符合官網宣告總數，**不表示所有實體卡或全部規則情境已完整覆蓋**。
- `card-coverage.json`：每個官方 id 對應現有卡表或新增封存文字；現有卡表包含來源抓取日期與 Git 基準。`sha256` 保存當時 Windows 工作樹的原始位元組證據；`gitBlobSha256`／`gitBlobSource` 保存指定 Git 基準的位元組，跨平台應驗後者。兩者可能只因 CRLF／LF 不同，已逐份確認解析 JSON 相同。`missingIds` 不為空時不得宣稱卡目錄文字已全覆蓋。
- `additional-card-texts.json`：本站尚無相同 id 的官方卡牌頁文字、圖示檔名與圖片網址。只是參考封存，未核卡圖、未套 H/I/J 收卡政策、未做引擎實裝審查。
- `validation.json`：本次實際檔案完整性與卡目錄覆蓋驗證；獨立審查結論另記 `review.md`。
- [取得紀錄與待補原檔](acquisition-notes.md)：兩份系列說明書的查找範圍、卡牌目錄取得方式，以及原官方 PDF 的解析警告與限制。

搜尋範例（在專案根執行）：

```powershell
rg -n '宣言|混亂|昏厥' 'PTCG RULES/official/2026-11-10/text'
rg -n '特性名或卡名' static/cards 'PTCG RULES/official/2026-11-10/additional-card-texts.json'
```

## 來源與後續使用

原始官方下載入口：[台灣詳細規則](https://asia.pokemon-card.com/tw/rules/detail/)、[香港詳細規則](https://asia.pokemon-card.com/hk/rules/detail/)。逐檔實際 URL 見 manifest。

原始網頁 HTML、卡牌 HTML、目錄 HTML 與渲染檢查圖保存在本機 `E:/ptcg-tw-sim-local/official-rules-20261110/`，便於追溯擷取；它們不是需要放上網站的執行資源。公開 repo 的維護資料不包含這些原始 HTML 中的第三方分析腳本。

封存文字以 UTF-8 儲存；本資料夾的 `.gitattributes` 只固定文字 LF 換行、PDF 為 binary，不負責轉碼，也不改專案其他檔案的換行政策。`manifest.json` 的衍生文字雜湊與 `validation.json` 的成員雜湊皆以實際提交位元組計算，須在 Git blob 與 checkout 後保持一致。

之後維護 AI 應先讀 [規則庫入口](../../README.md)，對照最新官方文件及直接判例，再以真實情境驗證程式；本次未修改、也未逐條稽核對戰引擎。兩份原版系列說明書若日後取得，須核對封面／系列、完整頁數及官方來源，再以新資料項目補入，不覆蓋線上教學或假填下載來源。
