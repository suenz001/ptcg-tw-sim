// v6.671 的精確歷史還原（瑞士輪未進場自動棄賽、server v1.88），供舊版守衛使用。表由 difflib 產生、驗證逐位元回 c24b7701（v6.670＋鐵律 Rule 93）。
// 鏈：v6.672 起由 revert-v6672 接在本檔前面；revert-v6670 的 revertV6670IfPresent 會先呼叫本檔（錦標賽區塊的 tail sha 守衛也經由這條鏈還原）。
import assert from 'node:assert/strict';
import { normEol } from './eol-agnostic.mjs';
import { revertV6672IfPresent } from './revert-v6672-m7.mjs';   // v6.672 由新到舊

export const V6671_PAIRS = {
  "oracle-admin/admin.html": [
    [
      "//     絕不影響版本閘本身的行為（門檻是伺服器給的，擋人判斷在玩家端且處處 fail-open）。\nwindow.SITE_VERSION_HINT = '6.671';\n// v6.160 十進位版本比較（與 src/lib/version-compare.ts 同語義：minor 右補 0 到等長再比）。\n",
      "//     絕不影響版本閘本身的行為（門檻是伺服器給的，擋人判斷在玩家端且處處 fail-open）。\nwindow.SITE_VERSION_HINT = '6.670';\n// v6.160 十進位版本比較（與 src/lib/version-compare.ts 同語義：minor 右補 0 到等長再比）。\n"
    ]
  ],
  "oracle-admin/server_admin_patch.js": [
    [
      "            }\n            // >>> v188-noshow-auto-drop\n            if (_adAnyV188) { try { await finishIfLastSurvivor(ev._id); } catch (_adE) { /* 與 /drop 相同的收尾；失敗不影響本次判負 */ } }\n            // <<< v188-noshow-auto-drop\n          }\n",
      "            }\n          }\n"
    ],
    [
      "                await TMATCH.updateOne({ _id: m._id }, { $set: { status: 'done', winnerUid: null, doubleNoShow: true } });\n                // >>> v188-noshow-auto-drop\n                const _adNamesV188 = [];\n                for (const [_adU, _adN] of [[m.p1uid, m.p1name], [m.p2uid, m.p2name]]) {\n                  try { if (await noShowAutoDropV188(ev, m, _adU, _adN)) { _adAnyV188 = true; _adNamesV188.push(_adN || '一位選手'); } } catch (_adE) { console.warn('[tournament] 未進場自動棄賽失敗 match=' + m._id + ' :: ' + (_adE && _adE.message)); }\n                }\n                // <<< v188-noshow-auto-drop\n                await postSystemChat(swissPhase(ev) ? ('⏰ 本場雙方皆未進場，以雙敗處理' + (_adNamesV188.length === 2 ? '。' : _adNamesV188.length === 1 ? '（另一位仍可繼續比賽）。' : '（瑞士制：雙方仍可繼續比賽）。') + noShowAutoDropNoteV188(_adNamesV188)) : '⏰ 本場雙方皆未進場，雙淘汰，無人晉級。');   // v188-noshow-auto-drop：依自動棄賽結果改寫括號\n                await checkRoundAdvance(ev._id);\n",
      "                await TMATCH.updateOne({ _id: m._id }, { $set: { status: 'done', winnerUid: null, doubleNoShow: true } });\n                await postSystemChat(swissPhase(ev) ? '⏰ 本場雙方皆未進場，以雙敗處理（瑞士制：雙方仍可繼續比賽）。' : '⏰ 本場雙方皆未進場，雙淘汰，無人晉級。');\n                await checkRoundAdvance(ev._id);\n"
    ],
    [
      "                if (m.roomId) { try { await forceRoomGameOverV183(m.roomId, (room) => { if (room.gameState.phase === 'game-over') return null; const winSeat = e0 ? 0 : 1; const og = JSON.parse(JSON.stringify(room.gameState)); og.phase = 'game-over'; og.winner = winSeat; og.winReason = (lName || '對手') + ' 未進場，判定你獲勝'; return og; }, now); } catch (e) { /* best-effort */ } }   // ⭐v1.83 版本 CAS＋重試\n                await postSystemChat(swissPhase(ev) ? ('⏰ ' + (lName || '一方') + ' 未進場，本場由 ' + wName + ' 獲勝' + (_adLoserV188 /* v188-noshow-auto-drop */ ? '。' + noShowAutoDropNoteV188([lName || '一方']) : '（瑞士制：雙方仍繼續後續輪次）。')) : ('⏰ ' + (lName || '一方') + ' 未進場判負，' + wName + ' 獲勝。'));\n                await advanceOrFinish(m, wUid, wName);\n",
      "                if (m.roomId) { try { await forceRoomGameOverV183(m.roomId, (room) => { if (room.gameState.phase === 'game-over') return null; const winSeat = e0 ? 0 : 1; const og = JSON.parse(JSON.stringify(room.gameState)); og.phase = 'game-over'; og.winner = winSeat; og.winReason = (lName || '對手') + ' 未進場，判定你獲勝'; return og; }, now); } catch (e) { /* best-effort */ } }   // ⭐v1.83 版本 CAS＋重試\n                await postSystemChat(swissPhase(ev) ? ('⏰ ' + (lName || '一方') + ' 未進場，本場由 ' + wName + ' 獲勝（瑞士制：雙方仍繼續後續輪次）。') : ('⏰ ' + (lName || '一方') + ' 未進場判負，' + wName + ' 獲勝。'));\n                await advanceOrFinish(m, wUid, wName);\n"
    ],
    [
      "                await TMATCH.updateOne({ _id: m._id }, { $set: { winnerUid: wUid, winnerName: wName, status: 'done', noShow: true } });\n                // >>> v188-noshow-auto-drop\n                let _adLoserV188 = false;\n                try { if (await noShowAutoDropV188(ev, m, e0 ? m.p2uid : m.p1uid, lName)) { _adAnyV188 = true; _adLoserV188 = true; } } catch (_adE) { console.warn('[tournament] 未進場自動棄賽失敗 match=' + m._id + ' :: ' + (_adE && _adE.message)); }\n                // <<< v188-noshow-auto-drop\n                // v0.34：勝方已進場(卡在 setup 等待)→把房間設 game-over 讓勝方看到勝利畫面 + 返回賽事大廳\n",
      "                await TMATCH.updateOne({ _id: m._id }, { $set: { winnerUid: wUid, winnerName: wName, status: 'done', noShow: true } });\n                // v0.34：勝方已進場(卡在 setup 等待)→把房間設 game-over 讓勝方看到勝利畫面 + 返回賽事大廳\n"
    ],
    [
      "            const pend = await TMATCH.find({ eventId: ev._id, round: ev.currentRound, status: { $ne: 'done' }, p1uid: { $ne: null }, p2uid: { $ne: null } }).toArray();\n            let _adAnyV188 = false;   // v188-noshow-auto-drop：本次有人被自動棄賽 ⇒ 迴圈後比照 /drop 檢查是否只剩一人\n            for (const m of pend) {\n",
      "            const pend = await TMATCH.find({ eventId: ev._id, round: ev.currentRound, status: { $ne: 'done' }, p1uid: { $ne: null }, p2uid: { $ne: null } }).toArray();\n            for (const m of pend) {\n"
    ],
    [
      "    // <<< v6381-swiss-continue-note\n    // >>> v188-noshow-auto-drop\n    // ⭐server v1.88（v6.671，玩家建議＋站長裁定 2026-11-24）：瑞士輪未進場時，若該玩家**本場之前**已有 1 敗以上 ⇒ 自動棄賽，\n    //   後續輪次不再排入配對（省得對手每輪空等「倒數＋遲到容許」）。\n    //   站長裁定：①「敗」＝沒贏的都算（一般敗、未進場敗、平手／時限雙敗、雙方未進場、雙方棄賽）；②只看本場之前（0 敗的人未進場只判負，還有一次機會）；\n    //   ③所有瑞士輪都適用（網站賽與社群賽）。單淘汰／複賽不經過這裡（swissPhase 才呼叫）。\n    //   ⚠ 只在「判未進場」那一刻跑一次（每位未進場者一個帶 projection 的小查詢），不在任何輪詢熱路徑上 ⇒ 不加重伺服器負擔（鐵律 Rule 92）。\n    //   ⚠ 必須在推進輪次（advanceOrFinish／checkRoundAdvance）**之前**寫入 dropped，否則下一輪會先把他排進去。\n    //   ⚠ 沿用 /api/tournament/drop 的條件式搶占（dropped:{$ne:true}）⇒ 已經手動棄賽的不重複公告。\n    async function noShowAutoDropV188(ev, m, uid, name) {\n      if (!swissPhase(ev) || !uid) return false;   // name 參數保留給呼叫端對照（公告在呼叫端）\n      const prior = await TMATCH.find(\n        { eventId: ev._id, _id: { $ne: m._id }, status: 'done', bye: { $ne: true }, $or: [{ p1uid: uid }, { p2uid: uid }] },\n        { projection: { winnerUid: 1 } }).toArray();\n      const nonWins = prior.filter((x) => x.winnerUid !== uid).length;\n      if (nonWins < 1) return false;\n      const _claim = await TREGS.updateOne({ _id: ev._id + '__' + uid, dropped: { $ne: true } },\n        { $set: { dropped: true, droppedAt: Date.now(), droppedReason: 'noShow' } });\n      if (!_claim || _claim.modifiedCount !== 1) return false;\n      return true;   // 公告由呼叫端併進判負公告（同一則講清楚，不會出現「已棄賽」又「雙方仍繼續」的矛盾）\n    }\n    // 判負公告裡「自動棄賽」那一段的文字（單一來源；單方／雙方未進場共用）\n    function noShowAutoDropNoteV188(names) {\n      return names.length ? ('🏳 ' + names.join('、') + ' 之前已有敗場，依規則自動棄賽，後續輪次不再排入配對。') : '';\n    }\n    // <<< v188-noshow-auto-drop\n    async function postSystemChat(text) {\n",
      "    // <<< v6381-swiss-continue-note\n    async function postSystemChat(text) {\n"
    ]
  ],
  "src/lib/version.ts": [
    [
      " */\nexport const VERSION = '6.671';\n",
      " */\nexport const VERSION = '6.670';\n"
    ]
  ],
  "static/changelog-archive.html": [
    [
      "<details>\n        <summary><span class=\"ver-badge\">v6.632</span> <b>依 30th CELEBRATION 官方判例修正 3 個卡牌判定</b><br>依官方最新公布的「30th CELEBRATION」判例逐條比對，修正夢幻ex借用反撲剪、甜甜螢對化隱的弱點計算、百變怪整人變身的候選。</summary>\n        <div class=\"log-body\">官方公布了「30th CELEBRATION」的 37 條判例，我們逐條實際對戰比對，有 3 處與官方不同，已修正：① 夢幻ex 用特性「記憶螺旋」使出鐵螯龍蝦的「反撲剪」（或八爪武師的「觸手激怒」）時，看的是夢幻ex 自己身上有沒有傷害指示物，有的話只要 1 個能量就能使用。② 甜甜螢的特性「絕佳費洛蒙」對特性「化隱」有效的對手來悲粗茶無效，弱點照樣以 ×2 計算。③ 百變怪的招式「整人變身」不能換上海豚俠ex。其餘 34 條判例與網站原本的行為一致。</div>\n      </details>\n      <details>\n        <summary><span class=\"ver-badge\">v6.631</span> <b>手機卡圖卡住不顯示時會自動換路徑重新載入；iPad 圖示置中</b><br>手機對戰時卡圖偶爾一直空白、要點開詳情才出現的情況改善了；iPad 上放大鏡、星星、明暗切換等圖示也會正確置中。</summary>\n",
      "<details>\n        <summary><span class=\"ver-badge\">v6.631</span> <b>手機卡圖卡住不顯示時會自動換路徑重新載入；iPad 圖示置中</b><br>手機對戰時卡圖偶爾一直空白、要點開詳情才出現的情況改善了；iPad 上放大鏡、星星、明暗切換等圖示也會正確置中。</summary>\n"
    ]
  ],
  "static/changelog-bodies.html": [
    [
      "<div class=\"log-body\" data-ver=\"v6.633\">海豚俠ex 的特性「全能靈魂」寫明「這張卡只可依據『海豚俠』的特性『全能變身』的效果放置於場上」。之前雙卵細胞球的「細胞進化」、人造細胞卵的「細胞覺醒」、彩粉蝶的「進化粉」這類從牌庫選進化卡直接進化的招式，可以把波普海豚進化成海豚俠ex，與卡面不符；現在這些招式的選卡清單不會再出現海豚俠ex。（上一版已依官方判例修正百變怪「整人變身」不能換上海豚俠ex，這次把同一句卡面的其他效果一起改好。）</div>\n<!-- v6.264 首頁「版本更新記錄」較舊條目的補充說明。\n",
      "<div class=\"log-body\" data-ver=\"v6.633\">海豚俠ex 的特性「全能靈魂」寫明「這張卡只可依據『海豚俠』的特性『全能變身』的效果放置於場上」。之前雙卵細胞球的「細胞進化」、人造細胞卵的「細胞覺醒」、彩粉蝶的「進化粉」這類從牌庫選進化卡直接進化的招式，可以把波普海豚進化成海豚俠ex，與卡面不符；現在這些招式的選卡清單不會再出現海豚俠ex。（上一版已依官方判例修正百變怪「整人變身」不能換上海豚俠ex，這次把同一句卡面的其他效果一起改好。）</div>\n<div class=\"log-body\" data-ver=\"v6.632\">官方公布了「30th CELEBRATION」的 37 條判例，我們逐條實際對戰比對，有 3 處與官方不同，已修正：① 夢幻ex 用特性「記憶螺旋」使出鐵螯龍蝦的「反撲剪」（或八爪武師的「觸手激怒」）時，看的是夢幻ex 自己身上有沒有傷害指示物，有的話只要 1 個能量就能使用。② 甜甜螢的特性「絕佳費洛蒙」對特性「化隱」有效的對手來悲粗茶無效，弱點照樣以 ×2 計算。③ 百變怪的招式「整人變身」不能換上海豚俠ex。其餘 34 條判例與網站原本的行為一致。</div>\n<!-- v6.264 首頁「版本更新記錄」較舊條目的補充說明。\n"
    ],
    [
      "<div class=\"log-body\" data-ver=\"v6.658\">修正登入、存檔與排序期間的牌組同步狀態；舊版來源未明的牌組保留本機備份，可下載後匯入。</div>\n<div class=\"log-body\" data-ver=\"v6.657\">未登入時建立、修改與排序的牌組僅寫入此瀏覽器本機空間；註冊或登入正式帳號後，系統只比對差異並上傳本機新增或較新的牌組，不會以舊紀錄覆蓋雲端較新資料。本機寫入或雲端同步失敗時會顯示明確錯誤與重試提示；頁面亦標示未登入資料僅存於此瀏覽器。</div>\n",
      "<div class=\"log-body\" data-ver=\"v6.657\">未登入時建立、修改與排序的牌組僅寫入此瀏覽器本機空間；註冊或登入正式帳號後，系統只比對差異並上傳本機新增或較新的牌組，不會以舊紀錄覆蓋雲端較新資料。本機寫入或雲端同步失敗時會顯示明確錯誤與重試提示；頁面亦標示未登入資料僅存於此瀏覽器。</div>\n"
    ]
  ],
  "static/changelog.html": [
    [
      "      </details>\n      <p class=\"changelog-archive-link\" style=\"margin:0.9rem 0 0.2rem;padding:0.7rem 0.9rem;border:1px dashed #c8d8f0;border-radius:6px;background:#f7fbff;font-size:0.92rem;line-height:1.6;color:#334;\">\n",
      "      </details>\n      <details data-ver=\"v6.632\">\n        <summary><span class=\"ver-badge\">v6.632</span> <b>依 30th CELEBRATION 官方判例修正 3 個卡牌判定</b><br>依官方最新公布的「30th CELEBRATION」判例逐條比對，修正夢幻ex借用反撲剪、甜甜螢對化隱的弱點計算、百變怪整人變身的候選。</summary>\n      </details>\n      <p class=\"changelog-archive-link\" style=\"margin:0.9rem 0 0.2rem;padding:0.7rem 0.9rem;border:1px dashed #c8d8f0;border-radius:6px;background:#f7fbff;font-size:0.92rem;line-height:1.6;color:#334;\">\n"
    ],
    [
      "        <summary><span class=\"ver-badge\">v6.658</span> <b>修正牌組同步與本機資料保留</b><br>保留同步期間的最新修改，改善舊版牌組遷移與本機備份。</summary>\n      </details>\n",
      "        <summary><span class=\"ver-badge\">v6.658</span> <b>修正牌組同步與本機資料保留</b><br>保留同步期間的最新修改，改善舊版牌組遷移與本機備份。</summary>\n        <div class=\"log-body\">修正登入、存檔與排序期間的牌組同步狀態；舊版來源未明的牌組保留本機備份，可下載後匯入。</div>\n      </details>\n"
    ],
    [
      "      </details>\n      <details data-ver=\"v6.658\">\n        <summary><span class=\"ver-badge\">v6.658</span> <b>修正牌組同步與本機資料保留</b><br>保留同步期間的最新修改，改善舊版牌組遷移與本機備份。</summary>\n",
      "      </details>\n      <details>\n        <summary><span class=\"ver-badge\">v6.658</span> <b>修正牌組同步與本機資料保留</b><br>保留同步期間的最新修改，改善舊版牌組遷移與本機備份。</summary>\n"
    ],
    [
      "<details open>\n        <summary><span class=\"ver-badge\">v6.671</span> <b>瑞士輪未到場且已有敗場，自動棄賽</b><br>玩家建議：瑞士輪常常有人輸了之後就不再出現，對手每輪都要空等。改成未到場時若之前已有 1 敗以上，就自動棄賽、後續輪次不再排入配對。</summary>\n        <div class=\"log-body\">・適用所有瑞士輪（網站賽與社群賽）；複賽不受影響。\n・「敗」包含一般敗、未到場敗、雙方皆判敗的場次。\n・之前沒有敗場的玩家未到場，仍只判負，下一輪照常配對。</div>\n      </details>\n      <details>\n        <summary><span class=\"ver-badge\">v6.670</span> <b>卡牌資料庫補上 15 張 M-P 特典卡（含超級席多藍恩ex）</b><br>玩家回報超級席多藍恩ex 沒有收錄，一併補上官方新公布的 M-P 特典卡共 15 張，並完成效果實裝。</summary>\n",
      "<details open>\n        <summary><span class=\"ver-badge\">v6.670</span> <b>卡牌資料庫補上 15 張 M-P 特典卡（含超級席多藍恩ex）</b><br>玩家回報超級席多藍恩ex 沒有收錄，一併補上官方新公布的 M-P 特典卡共 15 張，並完成效果實裝。</summary>\n"
    ]
  ],
  "static/site-version.txt": [
    [
      "6.671\n",
      "6.670\n"
    ]
  ]
};
// 僅以本版獨有的錨點識別版本。
const V6671_MARKERS = {"oracle-admin/admin.html": [0], "oracle-admin/server_admin_patch.js": [0, 1, 2, 3, 4], "src/lib/version.ts": [0], "static/changelog-archive.html": [0], "static/changelog-bodies.html": [0, 1], "static/changelog.html": [3], "static/site-version.txt": [0]};

export function revertV6671IfPresent(path, source) {
  let text = revertV6672IfPresent(path, normEol(String(source)));
  const pairs = V6671_PAIRS[path];
  if (!pairs || V6671_MARKERS[path].every((index) => !text.includes(pairs[index][0]))) return text;
  // 依序檢查＋還原（表是由新往舊逐段產生的，後面的錨點可能要前面先還原才出現）
  for (const [index, [from, to]] of pairs.entries()) {
    assert.equal(text.split(from).length, 2, 'v6671 還原錨點變動 ' + path + ' #' + (index + 1));
    text = text.replace(from, () => to);
  }
  return text;
}
