// server_admin_patch.js v1.68（v6.575 錦標賽聊天室禁止連續傳送相同內容）的**整份還原器**。
//
// 本版只在 TAIL_ANCHOR 之前新增一個哨兵區塊 v168-chat-dedupe（同路徑先註冊的 POST /api/tournament/chat 前置 handler）；
// 錦標賽區塊逐位元未動（28 把鎖不變）。revertAdminV168 一次還原回 v1.67。
// ⚠ 字面由 python 從檔案精準切出、當場驗證「還原 === v1.67 原檔」後才寫入，不手打。
// ⚠ 命中次數不是恰好 1 次就 throw ⇒ 被動了宣告之外的地方會大聲紅。
import assert from 'node:assert';

/** [本版的樣子, 前一版的樣子] */
export const ADMIN_V168_PAIRS = [
  [
    "    // <<< v155-home-tourn-summary\n    // >>> v168-chat-dedupe\n    // ⭐server v1.68（v6.575，站長 2026-10-16）：「錦標賽聊天室 應該要禁止玩家連續傳送一模一樣的對話內容，造成洗版」。\n    //   同一個帳號送出的內容跟他自己上一則**成功送出**的「比對鍵」相同、且在 10 分鐘內 ⇒ 429「請勿連續傳送相同的內容」，不寫入。\n    //   比對鍵（只拿來比，寫進 DB 的文字照原端點不變）：NFKC（全形英數→半形）→ 拿掉零寬字元 → 空白壓一格 → 去頭尾 → 英文轉小寫 → 前 200 字\n    //   ⇒「hi」「HI」「ｈｉ」「hi＋零寬空白」都算同一句（審查 P3：原本只壓空白，改大小寫或夾零寬字元就繞過）。\n    //   系統管理員不受限（公告可能要重發；判準直接用區塊內的 isTournAdmin，不另抄一份）；\n    //   未驗證身分（沒有 token、只帶 playerId）不進比對 ⇒ 交給原端點回 403（審查 P3：否則可拿 429 探測別人上一則說了什麼）。\n    //   ⚠ 刻意做成「同路徑、先註冊」的前置 handler，放在錦標賽區塊（TAIL_ANCHOR）之前 ⇒ 原本的 /api/tournament/chat\n    //     一個字都不動（28 把鎖不必重釘）。Express 依註冊順序執行：這裡判斷完呼叫 next() 就交給原端點。\n    //   ⚠ 任何判斷不了的情況（沒有內容、身分驗不過、例外）一律 next() ⇒ 由原端點照舊回錯誤，不製造第二套判準。\n    //   ⚠ 「上一則」只在原端點真的回 { ok: true } 時才記（被限速、被擋下的不算），存在記憶體（pm2 單一 fork）；\n    //     重啟後第一則不比對（可接受：只是少擋一次）。上限 5000 個帳號，超過就整個清空重來（不會無限長大）。\n    const CHAT_DUP_WINDOW_MS = 10 * 60 * 1000;\n    const _chatLastText = new Map();   // uid -> { text, ts }\n    const chatDupKey = (t) => String(t || '').normalize('NFKC').replace(/[\\u200B-\\u200D\\u2060\\uFEFF]/g, '').replace(/\\s+/g, ' ').trim().toLowerCase().slice(0, 200);\n    app.post('/api/tournament/chat', async (req, res, next) => {\n      try {\n        const text = chatDupKey(req.body && req.body.text);\n        if (!text) return next();\n        const id = await tournIdentity(req);\n        if (!id || id.error || !id.uid || id.verified !== true) return next();\n        if (isTournAdmin(id)) return next();\n        const last = _chatLastText.get(id.uid);\n        if (last && last.text === text && Date.now() - last.ts < CHAT_DUP_WINDOW_MS) {\n          return res.status(429).json({ error: '請勿連續傳送相同的內容', code: 'chat-duplicate' });\n        }\n        const _json = res.json.bind(res);\n        res.json = (body) => {\n          if (body && body.ok === true) {\n            if (_chatLastText.size >= 5000) _chatLastText.clear();\n            _chatLastText.set(id.uid, { text, ts: Date.now() });\n          }\n          return _json(body);\n        };\n        return next();\n      } catch (_e) { return next(); }\n    });\n    // <<< v168-chat-dedupe\n\n    app.get('/api/tournament/state'",
    "    // <<< v155-home-tourn-summary\n\n    app.get('/api/tournament/state'"
  ]
];

/** 把 v1.68 的改動整份還原回 v1.67（輸入需為 LF、需為完整檔案）。 */
export function revertAdminV168(src) {
  let t = String(src);
  for (const [cur, old] of ADMIN_V168_PAIRS) {
    const n = t.split(cur).length - 1;
    assert.strictEqual(n, 1, 'revertAdminV168：錨點命中 ' + n + ' 次（預期 1）——宣告過期了：' + cur.slice(0, 80));
    t = t.split(cur).join(old);
  }
  return t;
}
