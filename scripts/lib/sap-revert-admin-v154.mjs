// server_admin_patch.js v1.54（全站 audit 2026-10-03：伺服器端降載六項）的**整份還原器**。
//
// 本版改動（含哨兵區塊與行內改動）全部逐字宣告在這裡，revertAdminV154 一次還原回 v1.53：
//   ・TAIL_ANCHOR 之前：v154-log-chain-resume（log 鏈雜湊接續計算）、v154-rooms-inflight（大廳列表在途合併）＋各自的呼叫點。
//   ・錦標賽區塊：v154-event-shared-inflight、v154-event-myregs、v154-chat-meta-cache ＋ /bracket 整段計算合併 ＋ 聊天清除寫回記憶體。
//   ⚠ 字面由 difflib 從檔案精準切出、當場驗證「逐條還原 === v1.53 原檔」後才寫入，不手打。
// ⚠ 命中次數不是恰好 1 次就 throw ⇒ 被動了宣告之外的地方會大聲紅，不會靜默吃掉。
import assert from 'node:assert';

/** [本版的樣子, 前一版的樣子] */
export const ADMIN_V154_PAIRS = [
  [
    "      };\n      // >>> v154-rooms-inflight\n      // ⭐server v1.54（全站 audit 2026-10-03）：大廳列表的查詢對**所有人都一樣**，原本每個請求各查一次 DB、\n      //   各解 100 間房的 BSON、各算一次 digest、各剝一次 email。改成「同時抵達的請求共用同一次查詢」\n      //   （in-flight 合併，不加任何 TTL 快取 ⇒ 結果不會比原本舊；查完就丟，下一個請求重新查）。\n      //   ⚠ 失敗時這一批都拿到同一個錯誤 ⇒ 照原本的 catch → next() 走核心端點（fail-open 不變）。\n      let _roomsCombinedInflight = null;\n      const _roomsCombinedShared = () => {\n        if (_roomsCombinedInflight) return _roomsCombinedInflight;\n        _roomsCombinedInflight = (async () => {\n          const _rooms = await db.collection('rooms')\n            .find({ status: { $in: ['lobby', 'playing'] } }, { projection: { 'seats.deckEntries': 0, gameState: 0 } })\n            .limit(100).sort({ updatedAt: -1 }).toArray();\n          return { dg: _roomsListDigest(_rooms), rooms: _rooms.map(_stripSeatEmails17) };\n        })();\n        _roomsCombinedInflight.then(() => { _roomsCombinedInflight = null; }, () => { _roomsCombinedInflight = null; });\n        return _roomsCombinedInflight;\n      };\n      // <<< v154-rooms-inflight\n      const _roomsCombinedMw = async (req, res, next) => {\n",
    "      };\n      const _roomsCombinedMw = async (req, res, next) => {\n"
  ],
  [
    "          if (_auth.indexOf('Bearer ') !== 0) return next();\n          const { dg: _dg, rooms: _out } = await _roomsCombinedShared();   // ⭐v1.54 見 v154-rooms-inflight\n          if (_h && _h === _dg) return res.status(204).end();  // 內容沒變 → 零 body\n",
    "          if (_auth.indexOf('Bearer ') !== 0) return next();\n          const _rooms = await db.collection('rooms')\n            .find({ status: { $in: ['lobby', 'playing'] } }, { projection: { 'seats.deckEntries': 0, gameState: 0 } })\n            .limit(100).sort({ updatedAt: -1 }).toArray();\n          const _dg = _roomsListDigest(_rooms);\n          if (_h && _h === _dg) return res.status(204).end();  // 內容沒變 → 零 body\n"
  ],
  [
    "          if (_h && _h === _dg) return res.status(204).end();  // 內容沒變 → 零 body\n          return res.status(200).json({ rooms: _out, combined: true, h: _dg });\n        } catch (_e) { return next(); }  // 任何錯誤 → fail-open 走核心端點\n",
    "          if (_h && _h === _dg) return res.status(204).end();  // 內容沒變 → 零 body\n          return res.status(200).json({ rooms: _rooms.map(_stripSeatEmails17), combined: true, h: _dg });\n        } catch (_e) { return next(); }  // 任何錯誤 → fail-open 走核心端點\n"
  ],
  [
    "      // 所以兩端對同一份 log 必得同雜湊,差一個字元就整包退回全量。\n      // >>> v154-log-chain-resume\n      // ⭐server v1.54（全站 audit 2026-10-03）：鏈雜湊改成「可以從中間狀態接著算」。\n      //   原本增量判斷先算 _logChainHash(log, logSince)、相符後再從頭算一次 _logChainHash(log, log.length)\n      //   ⇒ 前 logSince 則被 JSON.stringify＋逐字雜湊兩遍。FNV 鏈是累加的，第二遍完全是第一遍的延伸，\n      //   改成接著第一遍的狀態算剩下的幾則 ⇒ 輸出逐位元相同、CPU 少一半。\n      const _logChainRun = (log, from, to, st) => {\n        let h1 = st.h1, h2 = st.h2;\n        for (let i = from; i < to; i++) {\n          const s = JSON.stringify(log[i]) ?? 'null';\n",
    "      // 所以兩端對同一份 log 必得同雜湊,差一個字元就整包退回全量。\n      const _logChainHash = (log, n) => {\n        let h1 = 0x811c9dc5 >>> 0, h2 = 0xcbf29ce4 >>> 0;\n        for (let i = 0; i < n; i++) {\n          const s = JSON.stringify(log[i]) ?? 'null';\n"
  ],
  [
    "        }\n        return { h1, h2 };\n      };\n",
    "        }\n        return h1.toString(16) + '-' + h2.toString(16) + '-' + n;\n      };\n"
  ],
  [
    "      };\n      const _logChainFmt = (st, n) => st.h1.toString(16) + '-' + st.h2.toString(16) + '-' + n;\n      // <<< v154-log-chain-resume\n      const _logChainHash = (log, n) => _logChainFmt(_logChainRun(log, 0, n, { h1: 0x811c9dc5 >>> 0, h2: 0xcbf29ce4 >>> 0 }), n);\n      // 純函式:對「即將送出的 body」做轉換。任何路徑都回傳完整合法 body;\n",
    "      };\n      // 純函式:對「即將送出的 body」做轉換。任何路徑都回傳完整合法 body;\n"
  ],
  [
    "          const log = gs && Array.isArray(gs.log) ? gs.log : null;\n          const _st0 = (log && Number.isInteger(logSince) && logSince > 0 && logSince <= log.length) ? _logChainRun(log, 0, logSince, { h1: 0x811c9dc5 >>> 0, h2: 0xcbf29ce4 >>> 0 }) : null;   // ⭐v1.54 見 v154-log-chain-resume\n          if (_st0 && _logChainFmt(_st0, logSince) === logh) {\n            delta = { since: logSince, total: log.length, fh: _logChainFmt(_logChainRun(log, logSince, log.length, _st0), log.length) };\n            room = { ...room, gameState: { ...gs, log: log.slice(logSince) } };\n",
    "          const log = gs && Array.isArray(gs.log) ? gs.log : null;\n          if (log && Number.isInteger(logSince) && logSince > 0 && logSince <= log.length\n              && _logChainHash(log, logSince) === logh) {\n            delta = { since: logSince, total: log.length, fh: _logChainHash(log, log.length) };\n            room = { ...room, gameState: { ...gs, log: log.slice(logSince) } };\n"
  ],
  [
    "    const EVENT_SHARED_TTL_MS = 3000;\n    // >>> v154-event-shared-inflight\n    // ⭐server v1.54（全站 audit 2026-10-03）：3 秒快取過期的那一刻，同時抵達的請求原本**各自**重填一次\n    //   （listOpenEvents ＋ 每場一次 countDocuments ＋ running 清單，全部序列）。改成：\n    //   ① 同時抵達的共用同一次重填（in-flight 合併；TTL 與快取內容完全不變）；\n    //   ② 重填內部改並行：running 清單與 listOpenEvents 同時發、各場 count 同時發。\n    //   ⚠ 失敗時這一批拿到同一個錯誤（原本是各自失敗）；下一個請求重新嘗試。\n    let _eventSharedInflight = null;\n    // <<< v154-event-shared-inflight\n    async function getEventShared() {\n",
    "    const EVENT_SHARED_TTL_MS = 3000;\n    async function getEventShared() {\n"
  ],
  [
    "      if (_eventShared.at && (now - _eventShared.at) <= EVENT_SHARED_TTL_MS) return _eventShared;\n      if (_eventSharedInflight) return _eventSharedInflight;   // ⭐v1.54\n      _eventSharedInflight = (async () => {   // ⭐v1.54\n        const [openList, runningEvents] = await Promise.all([listOpenEvents(), TEVENTS.find({ status: 'running' }).toArray()]);   // ⭐v1.54 並行\n        const regCounts = {};\n        const _counts = await Promise.all(openList.map((_e) => TREGS.countDocuments({ eventId: _e._id })));   // ⭐v1.54 並行\n        openList.forEach((_e, _i) => { regCounts[_e._id] = _counts[_i]; });\n        _eventShared = { at: now, openList, regCounts, runningEvents };\n        return _eventShared;\n      })();\n      try { return await _eventSharedInflight; } finally { _eventSharedInflight = null; }\n    }\n",
    "      if (_eventShared.at && (now - _eventShared.at) <= EVENT_SHARED_TTL_MS) return _eventShared;\n      const openList = await listOpenEvents();\n      const regCounts = {};\n      for (const _e of openList) regCounts[_e._id] = await TREGS.countDocuments({ eventId: _e._id });\n      const runningEvents = await TEVENTS.find({ status: 'running' }).toArray();\n      _eventShared = { at: now, openList, regCounts, runningEvents };\n      return _eventShared;\n    }\n"
  ],
  [
    "        //   需要的那一筆再用 _id 點查補回（走主鍵，極便宜）。\n        // >>> v154-event-myregs\n        // ⭐server v1.54（全站 audit 2026-10-03）：原本每 3 秒把本人**全部歷屆報名**整批讀回來（TREGS 只增不減，\n        //   老玩家數百筆、隨時間線性變大），實際只用到「開放中賽事（＋這次查的那場）」的幾筆，和「最近一次的暱稱」。\n        //   改成兩發並行：① 用主鍵 `${eventId}__${uid}`（三支報名端點都用這個 _id）只取那幾筆，順便帶回 deckEntries\n        //   （省掉原本的 _regDeck 補查）；② 取最近一次有暱稱的那一筆（只投影 name／registeredAt、limit 1）。\n        //   ⚠ 輸出欄位與原本逐一相同；同一 registeredAt 的極端並列時暱稱取哪一筆可能不同（原本也沒有定義）。\n        const _myRegIds = [...new Set([...shared.openList.map((_e) => _e._id), ...(ev ? [ev._id] : [])])].map((_eid) => String(_eid) + '__' + id.uid);\n        const [myRegs, _lastRegs] = await Promise.all([\n          _myRegIds.length ? TREGS.find({ _id: { $in: _myRegIds } }).toArray() : Promise.resolve([]),\n          TREGS.find({ uid: id.uid, name: { $nin: [null, ''] } }, { projection: { name: 1, registeredAt: 1 } }).sort({ registeredAt: -1 }).limit(1).toArray(),\n        ]);\n        // <<< v154-event-myregs\n        const myRegBy = new Map(myRegs.map((r) => [r.eventId, r]));\n",
    "        //   需要的那一筆再用 _id 點查補回（走主鍵，極便宜）。\n        const myRegs = await TREGS.find({ uid: id.uid }, { projection: { deckEntries: 0 } }).toArray();\n        const myRegBy = new Map(myRegs.map((r) => [r.eventId, r]));\n"
  ],
  [
    "          const reg = myRegBy.get(ev._id);\n          if (reg) me = { registered: true, checkedIn: !!reg.checkedIn, deckCount: deckCount(reg.deckEntries), name: reg.name, deckName: reg.deckName || null, autoRemovedConflict: !!reg.autoRemovedConflict, dropped: !!reg.dropped, lateJoin: !!reg.lateJoin };   // ⭐v1.54 deckEntries 隨主鍵查詢一起回來\n        }\n",
    "          const reg = myRegBy.get(ev._id);\n          // v6.119：deckEntries 已被 projection 掉，這一筆單獨補查（_id 點查）。\n          //   ⚠ deckCount(undefined) 會回 -1（非 0），前端會誤顯示 → 一定要補回來。\n          const _regDeck = reg ? await TREGS.findOne({ _id: reg._id }, { projection: { deckEntries: 1 } }) : null;\n          if (reg) me = { registered: true, checkedIn: !!reg.checkedIn, deckCount: deckCount(_regDeck && _regDeck.deckEntries), name: reg.name, deckName: reg.deckName || null, autoRemovedConflict: !!reg.autoRemovedConflict, dropped: !!reg.dropped, lateJoin: !!reg.lateJoin };\n        }\n"
  ],
  [
    "        }\n        // v0.84 預填暱稱:附「最近一次報名的暱稱」供前端未報名任何賽事時預填;從沒報過退帳號顯示名 id.name\n        const _lastReg = _lastRegs[0];   // ⭐v1.54 改由資料庫排序取最新一筆\n        me.lastName = (_lastReg && _lastReg.name) || id.name || null;\n",
    "        }\n        // v0.84 預填暱稱:附「最近一次報名的暱稱」供前端未報名任何賽事時預填(從已抓的 myRegs 取最新,無額外查詢);從沒報過退帳號顯示名 id.name\n        const _lastReg = myRegs.filter((r) => r.name).sort((a, b) => (b.registeredAt || 0) - (a.registeredAt || 0))[0];\n        me.lastName = (_lastReg && _lastReg.name) || id.name || null;\n"
  ],
  [
    "    }\n    // >>> v154-chat-meta-cache\n    // ⭐server v1.54（全站 audit 2026-10-03）：/chat 每人每 3 秒一發，原本每發都先讀一次 TCONFIG chatMeta、\n    //   **讀完才查**聊天（兩段序列 DB 往返）。clearedAt 唯一的寫入點是同一個行程裡的 /admin/chat/clear\n    //   （pm2 單一 fork）⇒ 改成記憶體值：清除時同步更新（零延遲生效），讀取 60 秒才回 DB 確認一次（保險：\n    //   萬一有人從 mongo shell 直接改）。\n    let _chatMeta = { at: 0, clearedAt: 0 };\n    const CHAT_META_TTL_MS = 60 * 1000;\n    async function chatClearedAt() {\n      if (_chatMeta.at && (Date.now() - _chatMeta.at) <= CHAT_META_TTL_MS) return _chatMeta.clearedAt;\n      const cfg = await TCONFIG.findOne({ _id: 'chatMeta' });\n      _chatMeta = { at: Date.now(), clearedAt: (cfg && cfg.clearedAt) || 0 };\n      return _chatMeta.clearedAt;\n    }\n    // <<< v154-chat-meta-cache\n    app.get('/api/tournament/chat', async (req, res) => {\n",
    "    }\n    app.get('/api/tournament/chat', async (req, res) => {\n"
  ],
  [
    "        const before = Number(req.query.before) || 0; // v0.66 懶載入：before>0=上滑載更舊；since=before=0=初始載「最新」一頁\n        const clearedAt = await chatClearedAt();   // ⭐v1.54 見 v154-chat-meta-cache\n        let docs, hasMore;\n",
    "        const before = Number(req.query.before) || 0; // v0.66 懶載入：before>0=上滑載更舊；since=before=0=初始載「最新」一頁\n        const cfg = await TCONFIG.findOne({ _id: 'chatMeta' });\n        const clearedAt = (cfg && cfg.clearedAt) || 0;\n        let docs, hasMore;\n"
  ],
  [
    "        await TCHAT.deleteMany({ room: 'lobby' });\n        const _clearedAt = Date.now();   // ⭐v1.54 同一個值寫 DB 與記憶體\n        await TCONFIG.updateOne({ _id: 'chatMeta' }, { $set: { clearedAt: _clearedAt } }, { upsert: true });\n        _chatMeta = { at: Date.now(), clearedAt: _clearedAt };   // ⭐v1.54 見 v154-chat-meta-cache\n        res.json({ ok: true });\n",
    "        await TCHAT.deleteMany({ room: 'lobby' });\n        await TCONFIG.updateOne({ _id: 'chatMeta' }, { $set: { clearedAt: Date.now() } }, { upsert: true });\n        res.json({ ok: true });\n"
  ],
  [
    "        if (!_cache || (_now - _cache.at) > BRACKET_TTL_MS || _cache.round !== ev.currentRound || _cache.status !== ev.status) {\n          // ⭐server v1.54（全站 audit）：v1.52 只合併了「查詢」；同時醒來的 k 個請求原本各自再做一次排名計算\n          //   （buildSwissPlayersFromMatches＋computeStandings）與整理 ⇒ 連「查詢＋計算＋寫快取」整段一起合併，等待者直接拿成品（輸出逐位元相同）。\n          _cache = await bracketFindShared('c:' + ev._id + ':' + ev.currentRound + ':' + ev.status, async () => {   // ⭐v1.54\n          const matches = await bracketFindShared('m:' + ev._id, () => TMATCH.find({ eventId: ev._id }, { projection: BRACKET_MATCH_PROJ_V152 }).sort({ round: 1, idx: 1 }).toArray());   // ⭐v1.52 只讀用得到的欄位＋同時過期只讀一次\n",
    "        if (!_cache || (_now - _cache.at) > BRACKET_TTL_MS || _cache.round !== ev.currentRound || _cache.status !== ev.status) {\n          const matches = await bracketFindShared('m:' + ev._id, () => TMATCH.find({ eventId: ev._id }, { projection: BRACKET_MATCH_PROJ_V152 }).sort({ round: 1, idx: 1 }).toArray());   // ⭐v1.52 只讀用得到的欄位＋同時過期只讀一次\n"
  ],
  [
    "          const matchesRaw = matches.map((m) => ({ round: m.round, idx: m.idx, phase: m.phase || null, p1uid: m.p1uid, p2uid: m.p2uid, p1name: m.p1name, p2name: m.p2name, winnerName: m.winnerName, winnerUid: m.winnerUid, status: m.status, bye: m.bye, roomId: m.roomId || null }));\n          const _built = { at: _now, round: ev.currentRound, status: ev.status, matchesRaw, standingsRaw };   // ⭐v1.54 原本直接寫 _cache\n          _bracketCache.set(ev._id, _built);\n          // v0.69：上限 20 個 event(防歷史/社群賽 eventId 累積漏記憶體);超過刪最舊(插入序)。\n",
    "          const matchesRaw = matches.map((m) => ({ round: m.round, idx: m.idx, phase: m.phase || null, p1uid: m.p1uid, p2uid: m.p2uid, p1name: m.p1name, p2name: m.p2name, winnerName: m.winnerName, winnerUid: m.winnerUid, status: m.status, bye: m.bye, roomId: m.roomId || null }));\n          _cache = { at: _now, round: ev.currentRound, status: ev.status, matchesRaw, standingsRaw };\n          _bracketCache.set(ev._id, _cache);\n          // v0.69：上限 20 個 event(防歷史/社群賽 eventId 累積漏記憶體);超過刪最舊(插入序)。\n"
  ],
  [
    "          if (_bracketCache.size > 20) { const _oldest = _bracketCache.keys().next().value; if (_oldest !== ev._id) _bracketCache.delete(_oldest); }\n          return _built;   // ⭐v1.54\n          });   // ⭐v1.54\n        }\n",
    "          if (_bracketCache.size > 20) { const _oldest = _bracketCache.keys().next().value; if (_oldest !== ev._id) _bracketCache.delete(_oldest); }\n        }\n"
  ]
];

/** 把 v1.54 的改動整份還原回 v1.53（輸入需為 LF、需為完整檔案）。 */
export function revertAdminV154(src) {
  let t = String(src);
  for (const [cur, old] of ADMIN_V154_PAIRS) {
    const n = t.split(cur).length - 1;
    assert.strictEqual(n, 1, 'revertAdminV154：錨點命中 ' + n + ' 次（預期 1）——宣告過期了：' + cur.slice(0, 80));
    t = t.split(cur).join(old);
  }
  return t;
}
