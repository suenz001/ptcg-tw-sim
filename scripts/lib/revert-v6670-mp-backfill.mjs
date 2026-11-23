// v6.670 M-P 特典卡補漏收錄 15 張：資料層的還原（單一來源；IRON_RULES Rule 38）
//   釘「既有資料逐字等於某個舊版」的守衛（test-v6615／v6616／v6391…）先用這裡把本版的追加拿掉再比。
//   本版只在 M-P-I／M-P-J 檔尾追加、card-set-map 追加 15 筆、index.json 改 M-P 兩筆的張數三欄；既有內容逐字未動（test-v6670 D 組守著）。
import assert from 'node:assert/strict';

export const V6670_MP_IDS = ['20105', '20106', '20107', '20108', '20109', '20110', '20111', '20112', '20121', '20122', '20123', '20124', '20125', '20126', '20127'];
// v6.669（4e42533e）當時 M-P 兩筆的張數三欄（git cat-file 實查）
const V6669_MP_COUNTS = {
  'M-P-I': { cardCount: 62, supertypeCounts: { Pokemon: 39, Trainer: 23 }, count: 62 },
  'M-P-J': { cardCount: 141, supertypeCounts: { Pokemon: 108, Trainer: 15, Energy: 18 }, count: 141 },
};
export function revertV6670Index(idx) {
  return idx.map((e) => (V6669_MP_COUNTS[e.code] ? { ...e, ...V6669_MP_COUNTS[e.code] } : e));
}
export function revertV6670Map(map) {
  const drop = new Set(V6670_MP_IDS);
  const hit = Object.keys(map).filter((k) => drop.has(k)).length;
  assert.equal(hit, drop.size, 'v6670 map 還原：本版新增的 ' + drop.size + ' 筆只找到 ' + hit + ' 筆');
  return Object.fromEntries(Object.entries(map).filter(([k]) => !drop.has(k)));
}

// ── 文字檔（src／對外 changelog／admin）的逐位元還原：逐字回 4e42533e（v6.669）；鏈：revert-v6669 會先呼叫本檔 ──
import { normEol } from './eol-agnostic.mjs';
import { revertV6671IfPresent } from './revert-v6671-noshow-auto-drop.mjs';   // v6.671 由新到舊
export const V6670_PAIRS = {
  "oracle-admin/admin.html": [
    [
      "//     絕不影響版本閘本身的行為（門檻是伺服器給的，擋人判斷在玩家端且處處 fail-open）。\nwindow.SITE_VERSION_HINT = '6.670';\n// v6.160 十進位版本比較（與 src/lib/version-compare.ts 同語義：minor 右補 0 到等長再比）。\n",
      "//     絕不影響版本閘本身的行為（門檻是伺服器給的，擋人判斷在玩家端且處處 fail-open）。\nwindow.SITE_VERSION_HINT = '6.669';\n// v6.160 十進位版本比較（與 src/lib/version-compare.ts 同語義：minor 右補 0 到等長再比）。\n"
    ]
  ],
  "src/lib/game/effects.ts": [
    [
      "import './effects/cards/mp_j_wave1'; // v6.391 M-P（J 標）招式實裝 批次1（11 招，全部純類推既有中央 helper）\nimport './effects/cards/mp_j_wave2'; // v6.670 M-P 補漏收錄 批次2（超級席多藍恩ex｜巨重壓、支援者 春紫）\nimport './effects/cards/svi_wave1'; // v6.616 SVI「Trianers Camp」招式實裝（6 招，全部純類推既有中央 helper）\n",
      "import './effects/cards/mp_j_wave1'; // v6.391 M-P（J 標）招式實裝 批次1（11 招，全部純類推既有中央 helper）\nimport './effects/cards/svi_wave1'; // v6.616 SVI「Trianers Camp」招式實裝（6 招，全部純類推既有中央 helper）\n"
    ]
  ],
  "src/lib/version.ts": [
    [
      " */\nexport const VERSION = '6.670';\n",
      " */\nexport const VERSION = '6.669';\n"
    ]
  ],
  "static/changelog-archive.html": [
    [
      "<details>\n        <summary><span class=\"ver-badge\">v6.631</span> <b>手機卡圖卡住不顯示時會自動換路徑重新載入；iPad 圖示置中</b><br>手機對戰時卡圖偶爾一直空白、要點開詳情才出現的情況改善了；iPad 上放大鏡、星星、明暗切換等圖示也會正確置中。</summary>\n        <div class=\"log-body\">手機網路不穩時，卡圖有時會「卡住」——既沒有載入完成、也沒有顯示失敗，備戰區就一直空白，要點開查看詳情才會出現。現在畫面上的卡圖若 15 秒還沒載完，會自動改用另一條路徑重新載入；切到其他 App 再回來時，之前一直載不出來的圖也會再試一次。另外修正 iPad 上牌組編輯器的放大鏡、星星（常用卡牌）圖示，以及上方的明暗模式切換圖示稍微偏一邊的問題。</div>\n      </details>\n      <details>\n        <summary><span class=\"ver-badge\">v6.629</span> <b>改善手機牌組投稿按鈕辨識度</b><br>牌組公布欄的投稿按鈕統一使用綠底白字。</summary>\n",
      "<details>\n        <summary><span class=\"ver-badge\">v6.629</span> <b>改善手機牌組投稿按鈕辨識度</b><br>牌組公布欄的投稿按鈕統一使用綠底白字。</summary>\n"
    ]
  ],
  "static/changelog-bodies.html": [
    [
      "<div class=\"log-body\" data-ver=\"v6.632\">官方公布了「30th CELEBRATION」的 37 條判例，我們逐條實際對戰比對，有 3 處與官方不同，已修正：① 夢幻ex 用特性「記憶螺旋」使出鐵螯龍蝦的「反撲剪」（或八爪武師的「觸手激怒」）時，看的是夢幻ex 自己身上有沒有傷害指示物，有的話只要 1 個能量就能使用。② 甜甜螢的特性「絕佳費洛蒙」對特性「化隱」有效的對手來悲粗茶無效，弱點照樣以 ×2 計算。③ 百變怪的招式「整人變身」不能換上海豚俠ex。其餘 34 條判例與網站原本的行為一致。</div>\n<!-- v6.264 首頁「版本更新記錄」較舊條目的補充說明。\n",
      "<div class=\"log-body\" data-ver=\"v6.632\">官方公布了「30th CELEBRATION」的 37 條判例，我們逐條實際對戰比對，有 3 處與官方不同，已修正：① 夢幻ex 用特性「記憶螺旋」使出鐵螯龍蝦的「反撲剪」（或八爪武師的「觸手激怒」）時，看的是夢幻ex 自己身上有沒有傷害指示物，有的話只要 1 個能量就能使用。② 甜甜螢的特性「絕佳費洛蒙」對特性「化隱」有效的對手來悲粗茶無效，弱點照樣以 ×2 計算。③ 百變怪的招式「整人變身」不能換上海豚俠ex。其餘 34 條判例與網站原本的行為一致。</div>\n<div class=\"log-body\" data-ver=\"v6.631\">手機網路不穩時，卡圖有時會「卡住」——既沒有載入完成、也沒有顯示失敗，備戰區就一直空白，要點開查看詳情才會出現。現在畫面上的卡圖若 15 秒還沒載完，會自動改用另一條路徑重新載入；切到其他 App 再回來時，之前一直載不出來的圖也會再試一次。另外修正 iPad 上牌組編輯器的放大鏡、星星（常用卡牌）圖示，以及上方的明暗模式切換圖示稍微偏一邊的問題。</div>\n<!-- v6.264 首頁「版本更新記錄」較舊條目的補充說明。\n"
    ],
    [
      "<div class=\"log-body\" data-ver=\"v6.657\">未登入時建立、修改與排序的牌組僅寫入此瀏覽器本機空間；註冊或登入正式帳號後，系統只比對差異並上傳本機新增或較新的牌組，不會以舊紀錄覆蓋雲端較新資料。本機寫入或雲端同步失敗時會顯示明確錯誤與重試提示；頁面亦標示未登入資料僅存於此瀏覽器。</div>\n<div class=\"log-body\" data-ver=\"v6.656\">卡牌資料庫與牌組編輯器新增稀有卡／一般卡、有特性／無特性篩選。招式費用改用0、1、2等數字，並改善桌機與手機的篩選列對齊及換行。</div>\n",
      "<div class=\"log-body\" data-ver=\"v6.656\">卡牌資料庫與牌組編輯器新增稀有卡／一般卡、有特性／無特性篩選。招式費用改用0、1、2等數字，並改善桌機與手機的篩選列對齊及換行。</div>\n"
    ]
  ],
  "static/changelog.html": [
    [
      "      </details>\n      <p class=\"changelog-archive-link\" style=\"margin:0.9rem 0 0.2rem;padding:0.7rem 0.9rem;border:1px dashed #c8d8f0;border-radius:6px;background:#f7fbff;font-size:0.92rem;line-height:1.6;color:#334;\">\n",
      "      </details>\n      <details data-ver=\"v6.631\">\n        <summary><span class=\"ver-badge\">v6.631</span> <b>手機卡圖卡住不顯示時會自動換路徑重新載入；iPad 圖示置中</b><br>手機對戰時卡圖偶爾一直空白、要點開詳情才出現的情況改善了；iPad 上放大鏡、星星、明暗切換等圖示也會正確置中。</summary>\n      </details>\n      <p class=\"changelog-archive-link\" style=\"margin:0.9rem 0 0.2rem;padding:0.7rem 0.9rem;border:1px dashed #c8d8f0;border-radius:6px;background:#f7fbff;font-size:0.92rem;line-height:1.6;color:#334;\">\n"
    ],
    [
      "        <summary><span class=\"ver-badge\">v6.657</span> <b>未登入組牌改為瀏覽器本機保存，登入後自動同步至雲端</b><br>未登入訪客的牌組與常用卡牌僅保存於此瀏覽器，登入帳號或升級會員後自動合併並保留本機編輯。</summary>\n      </details>\n",
      "        <summary><span class=\"ver-badge\">v6.657</span> <b>未登入組牌改為瀏覽器本機保存，登入後自動同步至雲端</b><br>未登入訪客的牌組與常用卡牌僅保存於此瀏覽器，登入帳號或升級會員後自動合併並保留本機編輯。</summary>\n        <div class=\"log-body\">未登入時建立、修改與排序的牌組僅寫入此瀏覽器本機空間；註冊或登入正式帳號後，系統只比對差異並上傳本機新增或較新的牌組，不會以舊紀錄覆蓋雲端較新資料。本機寫入或雲端同步失敗時會顯示明確錯誤與重試提示；頁面亦標示未登入資料僅存於此瀏覽器。</div>\n      </details>\n"
    ],
    [
      "      </details>\n      <details data-ver=\"v6.657\">\n        <summary><span class=\"ver-badge\">v6.657</span> <b>未登入組牌改為瀏覽器本機保存，登入後自動同步至雲端</b><br>未登入訪客的牌組與常用卡牌僅保存於此瀏覽器，登入帳號或升級會員後自動合併並保留本機編輯。</summary>\n",
      "      </details>\n      <details>\n        <summary><span class=\"ver-badge\">v6.657</span> <b>未登入組牌改為瀏覽器本機保存，登入後自動同步至雲端</b><br>未登入訪客的牌組與常用卡牌僅保存於此瀏覽器，登入帳號或升級會員後自動合併並保留本機編輯。</summary>\n"
    ],
    [
      "<details open>\n        <summary><span class=\"ver-badge\">v6.670</span> <b>卡牌資料庫補上 15 張 M-P 特典卡（含超級席多藍恩ex）</b><br>玩家回報超級席多藍恩ex 沒有收錄，一併補上官方新公布的 M-P 特典卡共 15 張，並完成效果實裝。</summary>\n        <div class=\"log-body\">・新增：超級席多藍恩ex、春紫、火焰鳥、急凍鳥、閃電鳥、泥偶小人、鬼斯、鐵掌力士、謝米×2、能量回收器、沐淨、勝利之證×3。\n・超級席多藍恩ex｜巨重壓：下個自己的回合「巨重壓」傷害 +140；特性 高密度盔甲：HP 全滿時受到對手招式的傷害 -60。\n・春紫：擲 1 次硬幣，正面時戰鬥寶可夢恢復 150 HP、反面恢復 30 HP（戰鬥寶可夢沒有受傷時不能使用）。</div>\n      </details>\n      <details>\n        <summary><span class=\"ver-badge\">v6.669</span> <b>豐收漁網的選擇視窗也標上組別</b><br>豐收漁網改用跟小光、鬥子相同的選擇方式：每張卡標出【寶可夢】或【能量】，某一組選滿 3 張後同組其他卡變暗。</summary>\n",
      "<details open>\n        <summary><span class=\"ver-badge\">v6.669</span> <b>豐收漁網的選擇視窗也標上組別</b><br>豐收漁網改用跟小光、鬥子相同的選擇方式：每張卡標出【寶可夢】或【能量】，某一組選滿 3 張後同組其他卡變暗。</summary>\n"
    ]
  ],
  "static/site-version.txt": [
    [
      "6.670\n",
      "6.669\n"
    ]
  ]
};
// 僅以本版獨有的錨點識別版本。
const V6670_MARKERS = {"oracle-admin/admin.html": [0], "src/lib/game/effects.ts": [0], "src/lib/version.ts": [0], "static/changelog-archive.html": [0], "static/changelog-bodies.html": [0, 1], "static/changelog.html": [3], "static/site-version.txt": [0]};

export function revertV6670IfPresent(path, source) {
  let text = revertV6671IfPresent(path, normEol(String(source)));
  const pairs = V6670_PAIRS[path];
  if (!pairs || V6670_MARKERS[path].every((index) => !text.includes(pairs[index][0]))) return text;
  // 依序檢查＋還原（表是由新往舊逐段產生的，後面的錨點可能要前面先還原才出現）
  for (const [index, [from, to]] of pairs.entries()) {
    assert.equal(text.split(from).length, 2, 'v6670 還原錨點變動 ' + path + ' #' + (index + 1));
    text = text.replace(from, () => to);
  }
  return text;
}
