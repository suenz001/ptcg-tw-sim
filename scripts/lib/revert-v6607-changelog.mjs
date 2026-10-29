import { revertV6608Changelog } from './revert-v6608-changelog.mjs';
// v6.607合法公開更新紀錄的精確還原；額外異動不移除。
const PAIRS = {
  "static/changelog.html": [
    [
      "<details open>\n        <summary><span class=\"ver-badge\">v6.607</span> <b>修正手機對戰紀錄自動跟隨</b><br>手機觀戰與對戰停在紀錄底部時，持續跟隨最新動作；往上閱讀時保留位置。</summary>\n        <div class=\"log-body\">調整紀錄更新及視窗尺寸變化時的捲動處理。</div>\n      </details>\n      <details>\n        <summary><span class=\"ver-badge\">v6.606</span> <b>修正手機獎賞卡卡背比例</b><br>手機查閱獎賞卡時，卡背隨格子寬度等比例縮放，避免被拉長。</summary>\n",
      "<details open>\n        <summary><span class=\"ver-badge\">v6.606</span> <b>修正手機獎賞卡卡背比例</b><br>手機查閱獎賞卡時，卡背隨格子寬度等比例縮放，避免被拉長。</summary>\n"
    ],
    [
      "      </details>\n      <details data-ver=\"v6.594\">\n        <summary><span class=\"ver-badge\">v6.594</span> <b>牌組公布欄明細可以看卡圖</b><br>牌表新增縮圖模式，點卡片可看大圖與上一張、下一張。</summary>\n",
      "      </details>\n      <details>\n        <summary><span class=\"ver-badge\">v6.594</span> <b>牌組公布欄明細可以看卡圖</b><br>牌表新增縮圖模式，點卡片可看大圖與上一張、下一張。</summary>\n"
    ],
    [
      "        <summary><span class=\"ver-badge\">v6.594</span> <b>牌組公布欄明細可以看卡圖</b><br>牌表新增縮圖模式，點卡片可看大圖與上一張、下一張。</summary>\n      </details>\n",
      "        <summary><span class=\"ver-badge\">v6.594</span> <b>牌組公布欄明細可以看卡圖</b><br>牌表新增縮圖模式，點卡片可看大圖與上一張、下一張。</summary>\n        <div class=\"log-body\">牌組公布欄的牌組明細新增「縮圖／文字」切換（預設縮圖，會記住選擇）。縮圖依寶可夢、物品、支援者、競技場、能量排列並標出張數；點卡片可看大圖，並切換上一張、下一張。</div>\n      </details>\n"
    ],
    [
      "      </details>\n      <p class=\"changelog-archive-link\" style=\"margin:0.9rem 0 0.2rem;padding:0.7rem 0.9rem;border:1px dashed #c8d8f0;border-radius:6px;background:#f7fbff;font-size:0.92rem;line-height:1.6;color:#334;\">\n",
      "      </details>\n      <details data-ver=\"v6.569\">\n        <summary><span class=\"ver-badge\">v6.569</span> <b>對戰紀錄裡的玩家名稱不再被當成卡片連結</b><br>玩家暱稱和寶可夢同名時，對戰紀錄裡的玩家名稱不會再變成可點的卡片連結。</summary>\n      </details>\n      <p class=\"changelog-archive-link\" style=\"margin:0.9rem 0 0.2rem;padding:0.7rem 0.9rem;border:1px dashed #c8d8f0;border-radius:6px;background:#f7fbff;font-size:0.92rem;line-height:1.6;color:#334;\">\n"
    ]
  ],
  "static/changelog-bodies.html": [
    [
      "<div class=\"log-body\" data-ver=\"v6.594\">牌組公布欄的牌組明細新增「縮圖／文字」切換（預設縮圖，會記住選擇）。縮圖依寶可夢、物品、支援者、競技場、能量排列並標出張數；點卡片可看大圖，並切換上一張、下一張。</div>\n<div class=\"log-body\" data-ver=\"v6.593\">iPhone 主畫面版對戰頂部增加留白，減少系統模糊效果覆蓋操作列的情形，並同步調整短螢幕手牌空間。</div>\n",
      "<div class=\"log-body\" data-ver=\"v6.593\">iPhone 主畫面版對戰頂部增加留白，減少系統模糊效果覆蓋操作列的情形，並同步調整短螢幕手牌空間。</div>\n"
    ],
    [
      "<div class=\"log-body\" data-ver=\"v6.570\">上一版讓玩家暱稱不再被當成卡片連結；但暱稱和卡名完全相同（例如暱稱就叫「噴火龍ex」）時，紀錄裡分不出哪一處是玩家、哪一處是卡，結果連真正的卡片也點不開。現在這種情況恢復成可點的連結（玩家名稱也能點開那張卡）；暱稱只是含有寶可夢名字（例如「我的噴火龍」）時，仍然不會被當成連結。</div>\n<!-- v6.264 首頁「版本更新記錄」較舊條目的補充說明。\n",
      "<div class=\"log-body\" data-ver=\"v6.570\">上一版讓玩家暱稱不再被當成卡片連結；但暱稱和卡名完全相同（例如暱稱就叫「噴火龍ex」）時，紀錄裡分不出哪一處是玩家、哪一處是卡，結果連真正的卡片也點不開。現在這種情況恢復成可點的連結（玩家名稱也能點開那張卡）；暱稱只是含有寶可夢名字（例如「我的噴火龍」）時，仍然不會被當成連結。</div>\n<div class=\"log-body\" data-ver=\"v6.569\">以前對戰紀錄會把文字中所有符合卡名的地方變成可點的連結，所以暱稱取成寶可夢名字（或暱稱裡含有寶可夢名字）的玩家，名稱也會被點開成卡片。現在雙方的暱稱一律當一般文字顯示，同一行裡其他的卡片照樣可以點（暱稱與卡名一字不差時，那個卡名會以一般文字顯示）。桌機、手機與錦標賽戰報都已套用。</div>\n<!-- v6.264 首頁「版本更新記錄」較舊條目的補充說明。\n"
    ]
  ],
  "static/changelog-archive.html": [
    [
      "<details>\n        <summary><span class=\"ver-badge\">v6.569</span> <b>對戰紀錄裡的玩家名稱不再被當成卡片連結</b><br>玩家暱稱和寶可夢同名時，對戰紀錄裡的玩家名稱不會再變成可點的卡片連結。</summary>\n        <div class=\"log-body\">以前對戰紀錄會把文字中所有符合卡名的地方變成可點的連結，所以暱稱取成寶可夢名字（或暱稱裡含有寶可夢名字）的玩家，名稱也會被點開成卡片。現在雙方的暱稱一律當一般文字顯示，同一行裡其他的卡片照樣可以點（暱稱與卡名一字不差時，那個卡名會以一般文字顯示）。桌機、手機與錦標賽戰報都已套用。</div>\n      </details>\n      <details>\n        <summary><span class=\"ver-badge\">v6.568</span> <b>房間被解散後，畫面會提示並可一鍵回大廳</b><br>一般對戰的房間被解散或對局結束後被刪除時，畫面上方會出現提示與【回大廳】按鈕，不再停在沒反應的畫面。</summary>\n",
      "<details>\n        <summary><span class=\"ver-badge\">v6.568</span> <b>房間被解散後，畫面會提示並可一鍵回大廳</b><br>一般對戰的房間被解散或對局結束後被刪除時，畫面上方會出現提示與【回大廳】按鈕，不再停在沒反應的畫面。</summary>\n"
    ]
  ]
};
export function revertV6607Changelog(path, source) {let s=revertV6608Changelog(path, source).replace(/\r\n/g,'\n');const pairs=PAIRS[path];if(!pairs)throw Error('未知路徑 '+path);for(const[a,b]of pairs){if(s.split(a).length!==2)throw Error('6607更新紀錄錨點缺失或重複 '+path);s=s.replace(a,b);}return s;}
