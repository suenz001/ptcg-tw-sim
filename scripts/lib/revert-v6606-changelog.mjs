import { revertV6607Changelog } from './revert-v6607-changelog.mjs';
// v6.606：只精確還原本版合法公開更新紀錄，其他差異保留交給舊鎖檢查。
const PAIRS = {
  "static/changelog.html": [
    [
      "<details open>\n        <summary><span class=\"ver-badge\">v6.606</span> <b>修正手機獎賞卡卡背比例</b><br>手機查閱獎賞卡時，卡背隨格子寬度等比例縮放，避免被拉長。</summary>\n        <div class=\"log-body\">同步修正復盤牌庫中未提供卡片的卡背比例。</div>\n      </details>\n      <details>\n        <summary><span class=\"ver-badge\">v6.604</span> <b>復盤查看牌庫順序，精簡排行說明</b><br>點牌庫即可查看當時由牌頂到牌底的順序。</summary>\n",
      "<details open>\n        <summary><span class=\"ver-badge\">v6.604</span> <b>復盤查看牌庫順序，精簡排行說明</b><br>點牌庫即可查看當時由牌頂到牌底的順序。</summary>\n"
    ],
    [
      "      </details>\n      <details data-ver=\"v6.593\">\n        <summary><span class=\"ver-badge\">v6.593</span> <b>改善 iPhone 主畫面版對戰頂部顯示</b><br>調整頂部操作列與安全區的間距。</summary>\n",
      "      </details>\n      <details>\n        <summary><span class=\"ver-badge\">v6.593</span> <b>改善 iPhone 主畫面版對戰頂部顯示</b><br>調整頂部操作列與安全區的間距。</summary>\n"
    ],
    [
      "        <summary><span class=\"ver-badge\">v6.593</span> <b>改善 iPhone 主畫面版對戰頂部顯示</b><br>調整頂部操作列與安全區的間距。</summary>\n      </details>\n",
      "        <summary><span class=\"ver-badge\">v6.593</span> <b>改善 iPhone 主畫面版對戰頂部顯示</b><br>調整頂部操作列與安全區的間距。</summary>\n        <div class=\"log-body\">iPhone 主畫面版對戰頂部增加留白，減少系統模糊效果覆蓋操作列的情形，並同步調整短螢幕手牌空間。</div>\n      </details>\n"
    ],
    [
      "      </details>\n      <p class=\"changelog-archive-link\" style=\"margin:0.9rem 0 0.2rem;padding:0.7rem 0.9rem;border:1px dashed #c8d8f0;border-radius:6px;background:#f7fbff;font-size:0.92rem;line-height:1.6;color:#334;\">\n",
      "      </details>\n      <details data-ver=\"v6.568\">\n        <summary><span class=\"ver-badge\">v6.568</span> <b>房間被解散後，畫面會提示並可一鍵回大廳</b><br>一般對戰的房間被解散或對局結束後被刪除時，畫面上方會出現提示與【回大廳】按鈕，不再停在沒反應的畫面。</summary>\n      </details>\n      <p class=\"changelog-archive-link\" style=\"margin:0.9rem 0 0.2rem;padding:0.7rem 0.9rem;border:1px dashed #c8d8f0;border-radius:6px;background:#f7fbff;font-size:0.92rem;line-height:1.6;color:#334;\">\n"
    ]
  ],
  "static/changelog-bodies.html": [
    [
      "<div class=\"log-body\" data-ver=\"v6.593\">iPhone 主畫面版對戰頂部增加留白，減少系統模糊效果覆蓋操作列的情形，並同步調整短螢幕手牌空間。</div>\n<div class=\"log-body\" data-ver=\"v6.592\">依實際操作權計時；桌機與手機顯示倒數提醒。功能預設關閉。</div>\n",
      "<div class=\"log-body\" data-ver=\"v6.592\">依實際操作權計時；桌機與手機顯示倒數提醒。功能預設關閉。</div>\n"
    ],
    [
      "<div class=\"log-body\" data-ver=\"v6.569\">以前對戰紀錄會把文字中所有符合卡名的地方變成可點的連結，所以暱稱取成寶可夢名字（或暱稱裡含有寶可夢名字）的玩家，名稱也會被點開成卡片。現在雙方的暱稱一律當一般文字顯示，同一行裡其他的卡片照樣可以點（暱稱與卡名一字不差時，那個卡名會以一般文字顯示）。桌機、手機與錦標賽戰報都已套用。</div>\n<!-- v6.264 首頁「版本更新記錄」較舊條目的補充說明。\n",
      "<div class=\"log-body\" data-ver=\"v6.569\">以前對戰紀錄會把文字中所有符合卡名的地方變成可點的連結，所以暱稱取成寶可夢名字（或暱稱裡含有寶可夢名字）的玩家，名稱也會被點開成卡片。現在雙方的暱稱一律當一般文字顯示，同一行裡其他的卡片照樣可以點（暱稱與卡名一字不差時，那個卡名會以一般文字顯示）。桌機、手機與錦標賽戰報都已套用。</div>\n<div class=\"log-body\" data-ver=\"v6.568\">以前房間不存在時，只有在大廳畫面才看得到「房間不存在或連線中斷」這行字，對戰畫面看起來就像卡住；背景也會一直向伺服器詢問那個已經不存在的房間。現在對戰畫面與大廳都會顯示提示列與【回大廳】按鈕，背景的詢問也會逐步放慢（最多每 30 秒一次）；房間若恢復，提示會自動消失。</div>\n<!-- v6.264 首頁「版本更新記錄」較舊條目的補充說明。\n"
    ]
  ],
  "static/changelog-archive.html": [
    [
      "<details>\n        <summary><span class=\"ver-badge\">v6.568</span> <b>房間被解散後，畫面會提示並可一鍵回大廳</b><br>一般對戰的房間被解散或對局結束後被刪除時，畫面上方會出現提示與【回大廳】按鈕，不再停在沒反應的畫面。</summary>\n        <div class=\"log-body\">以前房間不存在時，只有在大廳畫面才看得到「房間不存在或連線中斷」這行字，對戰畫面看起來就像卡住；背景也會一直向伺服器詢問那個已經不存在的房間。現在對戰畫面與大廳都會顯示提示列與【回大廳】按鈕，背景的詢問也會逐步放慢（最多每 30 秒一次）；房間若恢復，提示會自動消失。</div>\n      </details>\n      <details>\n        <summary><span class=\"ver-badge\">v6.566</span> <b>錦標賽時限到仍未分勝負改判雙敗；修正社群賽通知關掉仍收到</b><br>錦標賽對局超過時限後照舊進行最後回合（後攻方結束他的下一個回合），之後若仍未分出勝負，雙方皆判敗（原本是比剩餘獎賞卡）。關掉「有玩家發起社群賽時也通知我」之後，不會再因為在別的裝置打開過錦標賽頁而又收到通知。</summary>\n",
      "<details>\n        <summary><span class=\"ver-badge\">v6.566</span> <b>錦標賽時限到仍未分勝負改判雙敗；修正社群賽通知關掉仍收到</b><br>錦標賽對局超過時限後照舊進行最後回合（後攻方結束他的下一個回合），之後若仍未分出勝負，雙方皆判敗（原本是比剩餘獎賞卡）。關掉「有玩家發起社群賽時也通知我」之後，不會再因為在別的裝置打開過錦標賽頁而又收到通知。</summary>\n"
    ]
  ]
};
export function revertV6606Changelog(path, source) {
  let s = revertV6607Changelog(path, source).replace(/\r\n/g, '\n');
  const pairs = PAIRS[path];
  if (!pairs) throw new Error('未知更新紀錄路徑：' + path);
  for (const [after, before] of pairs) {
    if (s.split(after).length !== 2) throw new Error('v6606更新紀錄錨點缺失或重複：' + path);
    s = s.replace(after, before);
  }
  return s;
}
