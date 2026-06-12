// === ORACLE ADMIN ENDPOINTS === v0.36 (錦標賽：/event+/state 回 serverNow 給前端對時(倒數同步) + /chat 回 clearedAt(admin清空即時生效))
// v0.35 (錦標賽：報名 coinPref 先後攻偏好 + admin /match/restart 重賽 + 完整賽事歸檔 tournamentArchives 永久保存)
// v0.34 (錦標賽：報名名單回 deckText 可複製匯入 + 未進場判負勝方房間設 game-over 顯示勝利畫面)
// v0.33 (錦標賽名人堂：歷屆冠軍 TCHAMPS + /champions 公開列表 + admin 編輯/刪除)
// v0.32 (錦標賽：/state 回 lastActionAt 給等待方倒數 + admin 強制裁定任意場 /admin/pending-matches + /admin/event/force-finish 安全閥)
// v0.31 (錦標賽：投降即時判負 /match/forfeit + 閒置逾3分鐘自動判負 currentActorSeat)
// v0.30 (admin v1.25 — 1.4 勝因分佈：離開類依 finalTurn<=1 細分「第一回合離開(開房掛機)」vs「中途離開(認輸)」；「取得所有獎勵牌」正名「取得所有獎賞卡」) (v0.29 — admin v1.23 — 對戰歷史全站搜尋：match-records 加 q(房號/玩家名/email 模糊 regex) + cardIds(牌組含此卡) 全站篩選) (v0.28 — admin v1.15 — 意見回饋 email 改「當前頁批次 uid 查詢」端點 /users/lookup，免載全量 users) (v0.27 — admin v1.12 — 2.3 卡牌勝率排除「玩家中途離開」獲勝場：臨時離開/斷線不代表真實卡牌勝率) (v0.26 — winrate/archetype 加 ?since 時間範圍篩選 24h/7d/不限) (v0.25 — 2.3 卡牌→代表牌組聚合端點 archetype)
// Inserted before app.listen() by oracle_admin_install.sh (or _update.sh)
//
// Changes:
//   v0.2 - Auth: admin token → Firebase ID token + email whitelist (ADMIN_EMAILS env)
//   v0.2 - Room list includes gameState summary (turn, winner, winReason, phase, prizeRemain)
//   v0.2 - Added /api/admin/whoami for client login verification
//   v0.3 - Sortable user columns, status badges, winner highlight, message count
//   v0.4 - Overview 三大類別、意見回覆/刪除 API、card name translation
//   v0.5 - 加 ZOMBIE ROOM CLEANUP 區塊（檔尾），每 5 分鐘掃 MongoDB 清殭屍房
//   v0.6 - rooms API enrich seat 加 email/isAnonymous/provider（admin v0.78）—
//          bypass listUsers cache 可能遺漏，用 adminAuth.getUsers() 即時 lookup +
//          5 分鐘 TTL 避免 N+1。
//   v0.7 - enrichSeats 認 'anon_*' prefix 為 session anon id（client 自產，非 Firebase
//          Auth uid），不查 Firebase。修 v0.6 全部誤標「已刪除」的 bug。
//   v0.71 - 修 enrichSeats session-anon 分支強制覆蓋 email/displayName=null，會把
//          v4.961 client 寫的 seat.email 蓋掉。改為由 `...s` spread 保留 client 寫入值。
//   v0.8  - zombie cleanup 加 ended 房 90 天 retention（之前永久保留，避免 db 無限成長）。
//   v0.9  - matchRecords Phase 1（client game-over fire POST /api/match-result 永久存 MongoDB
//          matchRecords collection，admin 用 GET /api/admin/match-records 讀）。
//          IMPORTANT: 必須跟 requireFirebaseAdmin 同閉包，故 inline 在主 .then() 內。
//   v0.10 - matchRecords schema: cardIds → cardCounts (張數 Object) for 牌組 modal 顯示「× N」。
//          validateRecord 兩種都接受 (backward compat 給 v5.005 舊客戶端 + 已存的 2 筆測試資料)。
//   v0.11 - matchRecords: 加 DELETE /api/admin/match-records/:matchId (測試資料清理用)；
//          ?mode=online/local filter 改用 roomCode 有無判斷（玩家語意：有房號=線上、無=本機）。
//   v0.12 - Phase 2a Tier 1 統計：加 GET /api/admin/stats/overview (1.1-1.4) +
//          GET /api/admin/stats/cards (1.5-1.8) + cardTags collection CRUD（支援型寶可夢標記）。
//   v0.13 - Phase 2b Tier 2 統計：加 5 個 endpoints
//          GET /api/admin/stats/players (2.1 玩家排行榜)
//          GET /api/admin/stats/players/:email (2.2 個人戰績頁)
//          GET /api/admin/stats/cards/winrate (2.3 卡牌勝率)
//          GET /api/admin/stats/heatmap (2.4 時段熱力圖 — Asia/Taipei tz)
//          GET /api/admin/stats/trends (2.5 對戰量趨勢 — day/week/month)

import('firebase-admin').then(async ({ default: admin }) => {
  const fs = await import('fs');
  if (!admin.apps.length) {
    const keyPath = '/opt/ptcg/api/firebase-admin-key.json';
    if (fs.existsSync(keyPath)) {
      const key = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
      admin.initializeApp({ credential: admin.credential.cert(key) });
      console.log('[admin] firebase-admin initialized for project:', key.project_id);
    } else {
      console.warn('[admin] firebase-admin-key.json not found; firebase admin endpoints disabled');
    }
  }
  const fbInitialized = admin.apps.length > 0;
  const adminAuth = fbInitialized ? admin.auth() : null;
  const adminDb = fbInitialized ? admin.firestore() : null;

  // Parse ADMIN_EMAILS whitelist
  const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (ADMIN_EMAILS.length === 0) {
    console.warn('[admin] ADMIN_EMAILS env var not set — no one can access admin (set in .env)');
  } else {
    console.log('[admin] Whitelist:', ADMIN_EMAILS.join(', '));
  }

  // Firebase ID token auth middleware
  async function requireFirebaseAdmin(req, res, next) {
    if (!fbInitialized || !adminAuth) {
      return res.status(503).json({ error: 'firebase admin not initialized' });
    }
    const authHeader = req.headers.authorization || '';
    const m = authHeader.match(/^Bearer\s+(.+)$/);
    if (!m) {
      return res.status(401).json({ error: 'missing Authorization Bearer token' });
    }
    try {
      const decoded = await adminAuth.verifyIdToken(m[1]);
      const email = (decoded.email || '').toLowerCase();
      if (!email || !ADMIN_EMAILS.includes(email)) {
        return res.status(403).json({ error: 'not in admin whitelist: ' + (decoded.email || 'no email') });
      }
      req.adminUser = { uid: decoded.uid, email: decoded.email };
      next();
    } catch (err) {
      return res.status(401).json({ error: 'invalid token: ' + err.message });
    }
  }
  function requireFb(req, res, next) {
    if (!fbInitialized) return res.status(503).json({ error: 'firebase admin disabled (key missing)' });
    next();
  }
  function tsToMillis(v) {
    if (!v) return v;
    if (typeof v === 'number') return v;
    if (v.toMillis) return v.toMillis();
    if (v._seconds) return v._seconds * 1000;
    return v;
  }

  // ── v0.6 (admin v0.78): seat enrich — 對每個 seat.uid 用 adminAuth.getUsers() ────
  //   batch lookup，回傳 email / isAnonymous / provider，bypass listUsers cache 的可能
  //   遺漏。5 分鐘 TTL 避免重複查（rooms API 每次叫都跑 enrich 會慢）。
  const userInfoCache = new Map();  // uid -> { info, ts }
  const USER_INFO_TTL = 5 * 60 * 1000;  // 5 min

  async function lookupUserInfoBatch(uids) {
    const out = new Map();
    if (!adminAuth) return out;
    const now = Date.now();
    const toFetch = [];
    for (const uid of uids) {
      const c = userInfoCache.get(uid);
      if (c && now - c.ts < USER_INFO_TTL) {
        out.set(uid, c.info);
      } else {
        toFetch.push(uid);
      }
    }
    // 批次 lookup，每批 100（getUsers API 上限）
    for (let i = 0; i < toFetch.length; i += 100) {
      const batch = toFetch.slice(i, i + 100).map(uid => ({ uid }));
      try {
        const result = await adminAuth.getUsers(batch);
        for (const u of result.users) {
          const info = {
            email: u.email || null,
            displayName: u.displayName || null,
            isAnonymous: !u.providerData || u.providerData.length === 0,
            provider: (u.providerData && u.providerData[0] && u.providerData[0].providerId) || 'anonymous',
            disabled: !!u.disabled,
          };
          userInfoCache.set(u.uid, { info, ts: now });
          out.set(u.uid, info);
        }
        // notFound：uid 在 Firebase Auth 已被刪除（殘留在房間 seats 內）
        for (const nf of (result.notFound || [])) {
          if (nf.uid) {
            const info = { email: null, displayName: null, isAnonymous: false, provider: 'not-found', disabled: false };
            userInfoCache.set(nf.uid, { info, ts: now });
            out.set(nf.uid, info);
          }
        }
      } catch (e) {
        console.warn('[admin] getUsers batch failed:', e.message);
      }
    }
    return out;
  }

  // v0.7：判斷 uid 是否為 client 自產 session anon id（前綴 `anon_`）。
  //   這些 id 由 main-site client 給未登入訪客用，跟 Firebase Auth uid 是不同 namespace —
  //   丟給 adminAuth.getUsers() 一定 notFound（會被誤標「已刪除」）。
  //   先 filter 掉，不浪費 6 個 batch call。
  function isSessionAnonUid(uid) {
    return typeof uid === 'string' && uid.startsWith('anon_');
  }

  // 給 rooms 陣列的 seats 加 email / isAnonymous / provider 欄位
  async function enrichSeats(rooms) {
    if (!adminAuth || !Array.isArray(rooms) || rooms.length === 0) return rooms;
    // v0.7：分流 — session anon (anon_*) 不查 Firebase，其他才丟 batch lookup
    const firebaseUidSet = new Set();
    for (const r of rooms) {
      for (const s of (r.seats || [])) {
        if (s && s.uid && !isSessionAnonUid(s.uid)) firebaseUidSet.add(s.uid);
      }
    }
    const uidMap = firebaseUidSet.size > 0
      ? await lookupUserInfoBatch([...firebaseUidSet])
      : new Map();
    for (const r of rooms) {
      r.seats = (r.seats || []).map(s => {
        if (!s || !s.uid) return s;
        // v0.7：session anon 直接給 session-anon provider，不算「已刪除」
        // v0.71 修：原本強制 email=null/displayName=null 會把 v4.961 client 寫的
        //   seat.email 覆蓋掉。改為「不主動覆蓋」— 由 `...s` spread 保留 client 寫的值，
        //   只 enrich isAnonymous/provider/disabled 三個 server 推斷的欄位。
        if (isSessionAnonUid(s.uid)) {
          return {
            ...s,
            isAnonymous: true,
            provider: 'session-anon',
            disabled: false,
          };
        }
        const u = uidMap.get(s.uid);
        if (u) {
          // v0.71：firebase auth 拿到的 email 優先；若 lookup 沒 email 但 client 寫了 seat.email，
          //   保留 client 寫的（fallback）。display name 同理。
          return {
            ...s,
            email: u.email ?? s.email ?? null,
            displayName: u.displayName ?? s.displayName ?? null,
            isAnonymous: u.isAnonymous,
            provider: u.provider,
            disabled: u.disabled,
          };
        }
        return s;
      });
    }
    return rooms;
  }

  // gameState 摘要：抽 turn / winner / winReason / phase / prizeRemain
  function summarizeRoom(r) {
    const gs = r.gameState || null;
    if (gs) {
      r.gameStateSummary = {
        turn: gs.turn ?? null,
        winner: gs.winner ?? null,
        winReason: gs.winReason ?? null,
        phase: gs.phase ?? null,
        prizeRemain: (gs.players || []).map(p => Array.isArray(p?.prize) ? p.prize.length : null),
        logCount: Array.isArray(gs.log) ? gs.log.length : 0,
      };
    } else {
      r.gameStateSummary = null;
    }
    delete r.gameState;
    return r;
  }

  // ── whoami ────────────────────────────────────────────────────────
  app.get('/api/admin/whoami', requireFirebaseAdmin, (req, res) => {
    res.json({ ok: true, user: req.adminUser });
  });

  // ── Combined stats v0.4 (含三大類別) ───────────────────────────────
  app.get('/api/admin/stats', requireFirebaseAdmin, async (req, res) => {
    try {
      const h24 = Date.now() - 86400000;

      // ── Oracle (mongo) ──
      const [oLobby, oPlaying, oEnded, oNew24h, msgCount] = await Promise.all([
        db.collection('rooms').countDocuments({ status: 'lobby' }),
        db.collection('rooms').countDocuments({ status: 'playing' }),
        db.collection('rooms').countDocuments({ status: 'ended' }),
        db.collection('rooms').countDocuments({ createdAt: { $gt: h24 } }),
        db.collection('messages').countDocuments({}),
      ]);
      const oTotal = oLobby + oPlaying + oEnded;

      // ── Firebase ──
      let firebase = { enabled: false };
      let users = { enabled: false };
      let feedback = { enabled: false };
      if (fbInitialized) {
        // rooms 統計
        try {
          const [lobbySnap, playingSnap, endedSnap] = await Promise.all([
            adminDb.collection('rooms').where('status', '==', 'lobby').count().get(),
            adminDb.collection('rooms').where('status', '==', 'playing').count().get(),
            adminDb.collection('rooms').where('status', '==', 'ended').count().get(),
          ]);
          // 24h 新增（用 updatedAt 替代 createdAt 因為 firestore Timestamp 比較需要特殊處理）
          const since = admin.firestore.Timestamp.fromMillis(h24);
          const new24hSnap = await adminDb.collection('rooms').where('updatedAt', '>', since).count().get();
          firebase = {
            enabled: true,
            lobby: lobbySnap.data().count,
            playing: playingSnap.data().count,
            ended: endedSnap.data().count,
            new24h: new24hSnap.data().count,
            total: lobbySnap.data().count + playingSnap.data().count + endedSnap.data().count,
          };
        } catch (e) { firebase = { enabled: true, error: e.message }; }

        // users 統計（loop 抓全部 — 上限 sane safety: 50,000）
        try {
          const allUsers = [];
          let pageToken = undefined;
          while (allUsers.length < 50000) {
            const result = await adminAuth.listUsers(1000, pageToken);
            allUsers.push(...result.users);
            pageToken = result.pageToken;
            if (!pageToken) break;
          }
          const uniqUids = new Set(allUsers.map(u => u.uid));
          const memberUids = new Set(allUsers.filter(u => u.email).map(u => u.uid));
          const active24hUids = new Set(
            allUsers.filter(u => u.metadata.lastSignInTime && new Date(u.metadata.lastSignInTime).getTime() > h24).map(u => u.uid)
          );
          users = {
            enabled: true,
            total: uniqUids.size,
            members: memberUids.size,
            anonymous: uniqUids.size - memberUids.size,
            active24h: active24hUids.size,
          };
        } catch (e) { users = { enabled: true, error: e.message }; }

        // feedback 統計
        try {
          const since = admin.firestore.Timestamp.fromMillis(h24);
          const [totalSnap, new24hSnap] = await Promise.all([
            adminDb.collection('feedbacks').count().get(),
            adminDb.collection('feedbacks').where('createdAt', '>', since).count().get(),
          ]);
          // 未回覆數：需要 client-side filter，因為 firestore 不支援 OR (reply == null OR reply does not exist)
          // 改抓全部 doc 內存計算（feedback 通常 < 200 筆，可接受）
          const allSnap = await adminDb.collection('feedbacks').get();
          const unreplied = allSnap.docs.filter(d => !d.data().reply).length;
          feedback = {
            enabled: true,
            total: totalSnap.data().count,
            new24h: new24hSnap.data().count,
            unreplied,
          };
        } catch (e) { feedback = { enabled: true, error: e.message }; }
      }

      res.json({
        oracle: { total: oTotal, lobby: oLobby, playing: oPlaying, ended: oEnded, new24h: oNew24h, messages: msgCount },
        firebase, users, feedback,
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── v0.21: Firestore 寫入 audit ────────────────────────────────
  // 列各 top-level collection 的 total + 過去 1h / 24h 內新增/更新 doc 數
  // 用 aggregate count() query，每個 query 只算 1 read，總成本約 5×N reads
  // 目的：定位寫入暴量元兇（v5.072 後 users 不應該再寫，但寫入仍高 → 找其他 collection）
  //
  // v0.22：timestamp query 加 ISO string fallback — decks 等 client 寫的 collection
  //   schema 用 new Date().toISOString() 而非 serverTimestamp → 直接 Timestamp 比對 fail
  //   ISO string lex sort 跟時間順序一致，string '>' compare 完全 work
  app.get('/api/admin/firestore-write-audit', requireFirebaseAdmin, requireFb, async (req, res) => {
    try {
      const now = Date.now();
      const h1Ts = admin.firestore.Timestamp.fromMillis(now - 3600000);
      const h24Ts = admin.firestore.Timestamp.fromMillis(now - 86400000);
      const h1Iso = new Date(now - 3600000).toISOString();
      const h24Iso = new Date(now - 86400000).toISOString();

      async function tryCount(query) {
        try {
          const s = await query.count().get();
          return s.data().count;
        } catch (e) {
          return { error: e.message };
        }
      }

      // v0.22：嘗試兩種 timestamp 比對 — Timestamp 失敗 fallback 試 ISO string
      async function tryCountWithFallback(collRef, field, tsValue, isoValue) {
        const r1 = await tryCount(collRef.where(field, '>', tsValue));
        if (typeof r1 === 'number') return r1;
        // Timestamp 比對失敗 → 嘗試 ISO string 比對
        const r2 = await tryCount(collRef.where(field, '>', isoValue));
        if (typeof r2 === 'number') return r2;
        // 兩種都失敗（field 不存在 / 其他錯誤）
        return r1;
      }

      async function auditCollection(collRef, name) {
        const row = { collection: name };
        row.total = await tryCount(collRef);
        row.createdAt_1h = await tryCountWithFallback(collRef, 'createdAt', h1Ts, h1Iso);
        row.createdAt_24h = await tryCountWithFallback(collRef, 'createdAt', h24Ts, h24Iso);
        row.updatedAt_1h = await tryCountWithFallback(collRef, 'updatedAt', h1Ts, h1Iso);
        row.updatedAt_24h = await tryCountWithFallback(collRef, 'updatedAt', h24Ts, h24Iso);
        return row;
      }

      // 列出全部 top-level collections
      const colls = await adminDb.listCollections();
      const results = [];
      for (const coll of colls) {
        results.push(await auditCollection(coll, coll.id));
      }

      // 也查已知的 subcollection groups
      const knownGroups = ['decks', 'messages', 'chats'];
      for (const grp of knownGroups) {
        try {
          const grpRef = adminDb.collectionGroup(grp);
          const row = await auditCollection(grpRef, `(group) ${grp}`);
          results.push(row);
        } catch (e) {
          results.push({ collection: `(group) ${grp}`, error: e.message });
        }
      }

      // 排序：1h 寫入數最多的在前（讓元兇浮上）
      results.sort((a, b) => {
        const aH = (typeof a.createdAt_1h === 'number' ? a.createdAt_1h : 0)
                 + (typeof a.updatedAt_1h === 'number' ? a.updatedAt_1h : 0);
        const bH = (typeof b.createdAt_1h === 'number' ? b.createdAt_1h : 0)
                 + (typeof b.updatedAt_1h === 'number' ? b.updatedAt_1h : 0);
        return bH - aH;
      });

      res.json({ at: now, h1_window_ms: 3600000, h24_window_ms: 86400000, results });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });


  // ── Feedback reply / delete ─────────────────────────────────────
  app.put('/api/admin/firebase/feedbacks/:id/reply', requireFirebaseAdmin, requireFb, async (req, res) => {
    try {
      const { reply } = req.body || {};
      if (typeof reply !== 'string' || !reply.trim()) {
        return res.status(400).json({ error: 'reply required' });
      }
      await adminDb.collection('feedbacks').doc(req.params.id).update({
        reply: reply.trim(),
        repliedAt: admin.firestore.FieldValue.serverTimestamp(),
        repliedBy: req.adminUser.email,
      });
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete('/api/admin/firebase/feedbacks/:id', requireFirebaseAdmin, requireFb, async (req, res) => {
    try {
      await adminDb.collection('feedbacks').doc(req.params.id).delete();
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Oracle MongoDB ────────────────────────────────────────────────
  app.get('/api/admin/oracle/rooms', requireFirebaseAdmin, async (req, res) => {
    try {
      // v1.18: 接受 ?status=playing|lobby|ended → 只撈該 status 子集（admin 進行中分頁 Refresh 加速）。
      const _sq = (req.query.status || '').trim();
      const _filter = (_sq && _sq !== 'all') ? { status: _sq } : {};
      const rooms = await db.collection('rooms')
        .find(_filter, {
          projection: {
            _id: 1, roomName: 1, hostName: 1, hostUid: 1, status: 1,
            seats: 1, memberUids: 1, createdAt: 1, updatedAt: 1,
            _version: 1, schemaVersion: 1, spectatorsAllowed: 1,
            'gameState.turn': 1,
            'gameState.winner': 1,
            'gameState.winReason': 1,
            'gameState.phase': 1,
            'gameState.players.prize': 1,
            'gameState.log': 1,
          }
        })
        .sort({ updatedAt: -1 }).toArray(); // v0.20: 拿掉 limit 300 — Oracle 主機沒額度限制
      rooms.forEach(summarizeRoom);
      // v0.3: 用單一 aggregation 算每房間訊息數
      try {
        const codes = rooms.map(r => r._id);
        const counts = await db.collection('messages').aggregate([
          { $match: { roomCode: { $in: codes } } },
          { $group: { _id: '$roomCode', count: { $sum: 1 } } },
        ]).toArray();
        const m = Object.fromEntries(counts.map(c => [c._id, c.count]));
        for (const r of rooms) r.messageCount = m[r._id] || 0;
      } catch (e) {
        console.warn('[admin] oracle messageCount agg failed:', e.message);
      }
      // v0.6: 用 adminAuth.getUsers() 直接 enrich 每個 seat.uid 的 email / isAnonymous
      await enrichSeats(rooms);
      // v1.18: 永遠回全量三狀態計數（cheap countDocuments，與 rooms 子集無關），供 toolbar 顯示。
      let counts = { lobby: 0, playing: 0, ended: 0 };
      try {
        const [lobby, playing, ended] = await Promise.all([
          db.collection('rooms').countDocuments({ status: 'lobby' }),
          db.collection('rooms').countDocuments({ status: 'playing' }),
          db.collection('rooms').countDocuments({ status: 'ended' }),
        ]);
        counts = { lobby, playing, ended };
      } catch (e) { console.warn('[admin] oracle counts failed:', e.message); }
      res.json({ rooms, counts });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/admin/oracle/rooms/:code', requireFirebaseAdmin, async (req, res) => {
    try {
      const room = await db.collection('rooms').findOne({ _id: req.params.code.toUpperCase() });
      res.json({ room });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/admin/oracle/messages/:code', requireFirebaseAdmin, async (req, res) => {
    try {
      const messages = await db.collection('messages')
        .find({ roomCode: req.params.code.toUpperCase() })
        .sort({ createdAt: 1 }).limit(500).toArray();
      res.json({ messages });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete('/api/admin/oracle/rooms/:code', requireFirebaseAdmin, async (req, res) => {
    try {
      const code = req.params.code.toUpperCase();
      await db.collection('rooms').deleteOne({ _id: code });
      await db.collection('messages').deleteMany({ roomCode: code });
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // v0.19: DELETE Firebase room (含 messages subcollection cascade)
  //   原本 admin.html 只能刪 Oracle room，Firebase rooms 因 firestore rules v2.81
  //   設定「ended 房永久保留」而無刪除路徑。zombie ended 房積累時無法清理。
  //   此 endpoint 使用 firebase-admin SDK 繞過 client-side rules（admin 全權）。
  //   先 batch 刪 messages 子集合，再刪 room doc（Firestore 不會自動 cascade）。
  app.delete('/api/admin/firebase/rooms/:code', requireFirebaseAdmin, requireFb, async (req, res) => {
    try {
      const code = req.params.code.toUpperCase();
      const msgsRef = adminDb.collection('rooms').doc(code).collection('messages');
      let totalDeleted = 0;
      while (true) {
        const snap = await msgsRef.limit(400).get();
        if (snap.empty) break;
        const batch = adminDb.batch();
        snap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
        totalDeleted += snap.size;
        if (snap.size < 400) break;
      }
      await adminDb.collection('rooms').doc(code).delete();
      res.json({ ok: true, code, deletedMessages: totalDeleted });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Firebase Firestore ────────────────────────────────────────────
  app.get('/api/admin/firebase/rooms', requireFirebaseAdmin, requireFb, async (req, res) => {
    try {
      // v1.18: ?status= 過濾。帶 where 時不加 orderBy（免複合索引），改 JS 排序。
      const _sq = (req.query.status || '').trim();
      const snap = (_sq && _sq !== 'all')
        ? await adminDb.collection('rooms').where('status', '==', _sq).get()
        : await adminDb.collection('rooms').orderBy('updatedAt', 'desc').get(); // v0.20: 拿掉 limit 300 — admin SDK 不吃 client quota
      const rooms = snap.docs.map(d => {
        const data = d.data();
        const r = {
          _id: d.id,
          ...data,
          updatedAt: tsToMillis(data.updatedAt),
          createdAt: tsToMillis(data.createdAt),
        };
        summarizeRoom(r);
        return r;
      });
      // v1.18: status 過濾時沒帶 orderBy → JS 補 updatedAt desc 排序。
      if (_sq && _sq !== 'all') rooms.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      // v0.3: 並行用 count() aggregation 拿每房間訊息數（subcollection）
      try {
        await Promise.all(rooms.map(async r => {
          try {
            const snap = await adminDb.collection('rooms').doc(r._id).collection('messages').count().get();
            r.messageCount = snap.data().count;
          } catch { r.messageCount = 0; }
        }));
      } catch (e) {
        console.warn('[admin] firebase messageCount failed:', e.message);
      }
      // v0.6: 用 adminAuth.getUsers() 直接 enrich 每個 seat.uid 的 email / isAnonymous
      await enrichSeats(rooms);
      // v1.18: 永遠回全量三狀態計數（cheap count() aggregation），供 toolbar 顯示。
      let counts = { lobby: 0, playing: 0, ended: 0 };
      try {
        const [l, p, e2] = await Promise.all([
          adminDb.collection('rooms').where('status', '==', 'lobby').count().get(),
          adminDb.collection('rooms').where('status', '==', 'playing').count().get(),
          adminDb.collection('rooms').where('status', '==', 'ended').count().get(),
        ]);
        counts = { lobby: l.data().count, playing: p.data().count, ended: e2.data().count };
      } catch (e) { console.warn('[admin] firebase counts failed:', e.message); }
      res.json({ rooms, counts });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/admin/firebase/rooms/:code', requireFirebaseAdmin, requireFb, async (req, res) => {
    try {
      const doc = await adminDb.collection('rooms').doc(req.params.code.toUpperCase()).get();
      if (!doc.exists) return res.json({ room: null });
      const data = doc.data();
      const room = {
        _id: doc.id,
        ...data,
        updatedAt: tsToMillis(data.updatedAt),
        createdAt: tsToMillis(data.createdAt),
      };
      res.json({ room });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/admin/firebase/messages/:code', requireFirebaseAdmin, requireFb, async (req, res) => {
    try {
      const code = req.params.code.toUpperCase();
      const snap = await adminDb.collection('rooms').doc(code).collection('messages')
        .orderBy('createdAt', 'asc').limit(500).get();
      const messages = snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          createdAt: tsToMillis(data.createdAt),
        };
      });
      res.json({ messages });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/admin/firebase/users', requireFirebaseAdmin, requireFb, async (req, res) => {
    try {
      const pageToken = req.query.pageToken;
      const result = await adminAuth.listUsers(100, pageToken);
      const users = result.users.map(u => ({
        uid: u.uid, email: u.email || null, emailVerified: u.emailVerified,
        displayName: u.displayName || null,
        anonymous: u.providerData.length === 0,
        createdAt: u.metadata.creationTime,
        lastSignIn: u.metadata.lastSignInTime,
        disabled: u.disabled,
      }));
      res.json({ users, pageToken: result.pageToken || null });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // v0.28: 批次 uid → email 查詢（意見回饋分頁只查「當前頁可見」的少數 uid，免載全量 users）。
  //   重用 lookupUserInfoBatch（5 分鐘 TTL 快取 + adminAuth.getUsers 每批 100）。
  //   body: { uids: string[] } → res: { emails: { [uid]: email|null } }（null=匿名/查無）。
  app.post('/api/admin/firebase/users/lookup', requireFirebaseAdmin, requireFb, async (req, res) => {
    try {
      const raw = Array.isArray(req.body && req.body.uids) ? req.body.uids : [];
      const uids = raw.filter(u => typeof u === 'string').slice(0, 200);  // 上限保護
      const emails = {};
      const realUids = [];
      for (const uid of uids) {
        if (isSessionAnonUid(uid)) emails[uid] = null;  // client 自產 anon id，無 Firebase email
        else realUids.push(uid);
      }
      if (realUids.length) {
        const info = await lookupUserInfoBatch(realUids);
        for (const uid of realUids) {
          const i = info.get(uid);
          emails[uid] = (i && i.email) || null;
        }
      }
      res.json({ emails });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/admin/firebase/users/:uid/decks', requireFirebaseAdmin, requireFb, async (req, res) => {
    try {
      const snap = await adminDb.collection('users').doc(req.params.uid).collection('decks').get();
      const decks = snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id, name: data.name,
          entryCount: (data.entries || []).reduce((s, e) => s + (e.count || 0), 0),
          createdAt: tsToMillis(data.createdAt),
          updatedAt: tsToMillis(data.updatedAt),
          entries: data.entries,
        };
      });
      res.json({ decks });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/admin/firebase/feedback', requireFirebaseAdmin, requireFb, async (req, res) => {
    try {
      // v0.4: 不限上限（fetch all），讓 client 顯示完整列表
      const snap = await adminDb.collection('feedbacks')
        .orderBy('createdAt', 'desc').get();
      const items = snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id, ...data,
          createdAt: tsToMillis(data.createdAt),
          updatedAt: tsToMillis(data.updatedAt),
          repliedAt: tsToMillis(data.repliedAt),
        };
      });
      res.json({ feedback: items });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ═════════════════════════════════════════════════════════════════════════════
  // v0.9 MATCH RECORDS Phase 1
  //   inline 在主 .then() 內，才能用 requireFirebaseAdmin closure。
  //   POST /api/match-result   (公開 + rate-limit；client game-over fire)
  //   GET  /api/admin/match-records (admin auth)
  // ═════════════════════════════════════════════════════════════════════════════
  (function registerMatchRecords() {
    // Rate-limit POST /api/match-result：避免惡意 client 灌資料
    const MR_RATE_WINDOW = 60 * 1000;
    const MR_RATE_MAX = 10;           // 每分鐘最多 10 筆 per IP（正常一場結束才 1 筆）
    const mrRateBuckets = new Map();

    function mrRateLimitCheck(ip) {
      const now = Date.now();
      const arr = (mrRateBuckets.get(ip) || []).filter(t => now - t < MR_RATE_WINDOW);
      if (arr.length >= MR_RATE_MAX) {
        mrRateBuckets.set(ip, arr);
        return false;
      }
      arr.push(now);
      mrRateBuckets.set(ip, arr);
      return true;
    }

    // 讀 JSON body helper
    function mrReadJsonBody(req) {
      return new Promise((resolve, reject) => {
        if (req.body && typeof req.body === 'object') return resolve(req.body);
        let data = '';
        req.on('data', chunk => { data += chunk; if (data.length > 100 * 1024) { reject(new Error('payload too large')); req.destroy(); } });
        req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
        req.on('error', reject);
      });
    }

    // 驗證 payload — 必要欄位 + 型別 sanity
    // v0.10: 接受 cardCounts (新格式 Record<id,count>) 或 cardIds (舊格式 string[])，兩者擇一即可
    function mrValidateRecord(rec) {
      if (!rec || typeof rec !== 'object') return 'payload not object';
      if (typeof rec.matchId !== 'string' || !rec.matchId) return 'matchId required';
      if (typeof rec.endedAt !== 'number' || rec.endedAt < 0) return 'endedAt required';
      if (rec.winner !== null && rec.winner !== 0 && rec.winner !== 1) return 'winner must be 0|1|null';
      if (typeof rec.finalTurn !== 'number') return 'finalTurn required';
      if (!rec.p1 || !rec.p2) return 'p1/p2 required';
      for (const side of ['p1', 'p2']) {
        const s = rec[side];
        if (typeof s.name !== 'string') return side + '.name required';
        const hasCounts = s.cardCounts && typeof s.cardCounts === 'object' && !Array.isArray(s.cardCounts);
        const hasIds = Array.isArray(s.cardIds);
        if (!hasCounts && !hasIds) return side + '.cardCounts or .cardIds required';
        if (hasCounts) {
          const keys = Object.keys(s.cardCounts);
          if (keys.length > 100) return side + '.cardCounts has too many keys';
          for (const k of keys) {
            if (typeof s.cardCounts[k] !== 'number' || s.cardCounts[k] < 0 || s.cardCounts[k] > 60) {
              return side + '.cardCounts[' + k + '] out of range (0-60)';
            }
          }
        }
        if (hasIds && s.cardIds.length > 100) return side + '.cardIds too long';
      }
      if (rec.mode !== 'local' && rec.mode !== 'online') return 'mode must be local|online';
      return null;
    }

    // v0.10: 把 client 端 p1/p2 payload 整成存進 DB 的 doc shape
    //   - 接受 cardCounts (新) 或 cardIds (舊)
    //   - 若兩者都沒 → 存空 cardCounts {}
    //   - 字元限長：name 60, email 120
    //   - cardCounts 最多 100 keys，每個 count 0-60（validate 已過濾，這裡再 sanitize 一次）
    function makePlayerDoc(p) {
      const doc = {
        name: String(p.name).substring(0, 60),
        email: p.email ? String(p.email).substring(0, 120) : null,
        cardCounts: {},
      };
      if (p.cardCounts && typeof p.cardCounts === 'object' && !Array.isArray(p.cardCounts)) {
        // 直接 sanitize cardCounts
        const keys = Object.keys(p.cardCounts).slice(0, 100);
        for (const k of keys) {
          const v = Number(p.cardCounts[k]);
          if (Number.isFinite(v) && v > 0 && v <= 60) {
            doc.cardCounts[String(k)] = Math.floor(v);
          }
        }
      } else if (Array.isArray(p.cardIds)) {
        // 舊客戶端 fallback：cardIds[] → cardCounts (每張視為 1)
        for (const id of p.cardIds.slice(0, 100)) {
          doc.cardCounts[String(id)] = 1;
        }
      }
      return doc;
    }

    app.post('/api/match-result', async (req, res) => {
      const ip = (req.headers['x-forwarded-for'] || req.ip || 'unknown').toString().split(',')[0].trim();
      if (!mrRateLimitCheck(ip)) {
        return res.status(429).json({ error: '請求過於頻繁（每分鐘最多 10 筆）' });
      }
      let body;
      try { body = await mrReadJsonBody(req); }
      catch (e) { return res.status(400).json({ error: 'JSON body 解析失敗：' + e.message }); }

      const err = mrValidateRecord(body);
      if (err) return res.status(400).json({ error: err });

      if (typeof db === 'undefined' || !db) return res.status(503).json({ error: 'db not ready' });

      try {
        // 用 matchId 為 _id，upsert 防重複（client 端可能多次 fire）。
        const doc = {
          _id: body.matchId,
          roomCode: body.roomCode || null,
          mode: body.mode,
          vsAI: !!body.vsAI,
          aiSide: typeof body.aiSide === 'number' ? body.aiSide : null,
          winner: body.winner,
          winReason: typeof body.winReason === 'string' ? body.winReason.substring(0, 200) : '',
          finalTurn: body.finalTurn,
          durationMs: typeof body.durationMs === 'number' ? body.durationMs : 0,
          startedAt: typeof body.startedAt === 'number' ? body.startedAt : null,
          endedAt: body.endedAt,
          p1: makePlayerDoc(body.p1),
          p2: makePlayerDoc(body.p2),
          ip,  // for abuse audit
          createdAt: new Date(),
        };
        // upsert — 已存在的 matchId 不會 dup（同場 game-over 多次觸發保護）
        const result = await db.collection('matchRecords').updateOne(
          { _id: body.matchId },
          { $setOnInsert: doc },
          { upsert: true }
        );
        const inserted = result.upsertedCount === 1;
        if (inserted) {
          console.log('[match-record] new match ' + body.matchId + ' p1=' + doc.p1.name + ' vs p2=' + doc.p2.name + ' winner=' + body.winner + ' from ' + ip);
        }
        res.json({ ok: true, inserted });
      } catch (e) {
        console.warn('[match-record] insert error:', e.message);
        res.status(500).json({ error: '寫入失敗: ' + e.message });
      }
    });

    app.get('/api/admin/match-records', requireFirebaseAdmin, async (req, res) => {
      if (typeof db === 'undefined' || !db) return res.status(503).json({ error: 'db not ready' });
      const limit = Math.min(parseInt(req.query.limit) || 50, 500);
      const skip = parseInt(req.query.skip) || 0;
      // v0.29：改用 $and 組合條件，支援「全站搜尋」q（房號/玩家名/email 模糊）+ cardIds（牌組含此卡）。
      const and = [];
      // mode filter（roomCode 判斷：有房號=線上、無=本機）
      if (req.query.mode === 'online') and.push({ roomCode: { $type: 'string' } });
      else if (req.query.mode === 'local') and.push({ roomCode: null });
      if (req.query.since) and.push({ endedAt: { $gte: parseInt(req.query.since) } });
      // 向後相容：舊 email 精確 filter
      if (req.query.email) and.push({ $or: [{ 'p1.email': req.query.email }, { 'p2.email': req.query.email }] });
      // v0.29 全站搜尋：q 對 房號/p1+p2 的 name/email 做 case-insensitive 模糊比對；
      //   cardIds（client 把寶可夢名解析成的卡 id 清單）對 p1/p2.cardCounts 做「含此卡」比對（牌組搜尋）。
      const q = String(req.query.q || '').trim();
      const cardIds = req.query.cardIds
        ? String(req.query.cardIds).split(',').map(s => s.trim()).filter(Boolean).slice(0, 300)
        : [];
      if (q || cardIds.length) {
        const or = [];
        if (q) {
          const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
          or.push({ roomCode: rx }, { 'p1.name': rx }, { 'p2.name': rx }, { 'p1.email': rx }, { 'p2.email': rx });
        }
        for (const id of cardIds) {
          or.push({ ['p1.cardCounts.' + id]: { $gt: 0 } }, { ['p2.cardCounts.' + id]: { $gt: 0 } });
        }
        if (or.length) and.push({ $or: or });
      }
      const filter = and.length ? { $and: and } : {};
      try {
        const [records, total] = await Promise.all([
          db.collection('matchRecords')
            .find(filter)
            .sort({ endedAt: -1 })
            .skip(skip)
            .limit(limit)
            .toArray(),
          db.collection('matchRecords').countDocuments(filter),
        ]);
        res.json({ records, total, limit, skip });
      } catch (e) {
        console.warn('[admin match-records] error:', e.message);
        res.status(500).json({ error: e.message });
      }
    });

    // v0.11：DELETE 單筆 — admin 測試資料清理用，避免污染後續 Phase 2 統計
    app.delete('/api/admin/match-records/:matchId', requireFirebaseAdmin, async (req, res) => {
      if (typeof db === 'undefined' || !db) return res.status(503).json({ error: 'db not ready' });
      const matchId = String(req.params.matchId || '').trim();
      if (!matchId) return res.status(400).json({ error: 'matchId required' });
      try {
        const result = await db.collection('matchRecords').deleteOne({ _id: matchId });
        if (result.deletedCount === 0) {
          return res.status(404).json({ error: 'matchRecord not found: ' + matchId });
        }
        console.log('[match-record] deleted matchId=' + matchId + ' by admin=' + (req.adminUser?.email || 'unknown'));
        res.json({ ok: true, deletedCount: result.deletedCount });
      } catch (e) {
        console.warn('[match-record delete] error:', e.message);
        res.status(500).json({ error: '刪除失敗: ' + e.message });
      }
    });

    console.log('[match-records] v0.2 endpoints registered: POST /api/match-result + GET/DELETE /api/admin/match-records');
  })();

  // ═════════════════════════════════════════════════════════════════════════════
  // v0.12 Phase 2a — Tier 1 統計 endpoints + cardTags collection
  //   GET /api/admin/stats/overview  (1.1 總場次 / 1.2 先攻後攻勝率 / 1.3 對戰時長回合 / 1.4 勝因)
  //   GET /api/admin/stats/cards     (1.5-1.8 卡牌使用率原始資料，admin 端做 supertype 分群)
  //   GET /api/admin/cards/tags      (列出所有 cardTags — 給 admin 端 cache)
  //   POST /api/admin/cards/tags/:cardId  (toggle/upsert tag — 給「⭐ 標支援型」按鈕用)
  // ═════════════════════════════════════════════════════════════════════════════
  (function registerStatsEndpoints() {
    // 1.1-1.4 對戰總覽 — 單一 aggregate 跑 N 個 $facet
    // v0.12 + 全局 ?mode=online|local 過濾（玩家要區分線上 vs 本機統計）
    app.get('/api/admin/stats/overview', requireFirebaseAdmin, async (req, res) => {
      if (typeof db === 'undefined' || !db) return res.status(503).json({ error: 'db not ready' });
      const now = Date.now();
      const ONE_DAY = 24 * 60 * 60 * 1000;
      // 全局 mode filter — 在 $facet 之前先過濾
      const baseMatch = {};
      if (req.query.mode === 'online') baseMatch.roomCode = { $type: 'string' };
      else if (req.query.mode === 'local') baseMatch.roomCode = null;
      try {
        const pipeline = [];
        if (Object.keys(baseMatch).length > 0) pipeline.push({ $match: baseMatch });
        pipeline.push({ $facet: {
            // 1.1 總場次 — 各類別 count
            totals: [
              { $group: {
                _id: null,
                all: { $sum: 1 },
                online: { $sum: { $cond: [{ $and: [{ $ne: ['$roomCode', null] }, { $ne: ['$roomCode', ''] }] }, 1, 0] } },
                local: { $sum: { $cond: [{ $or: [{ $eq: ['$roomCode', null] }, { $eq: ['$roomCode', ''] }] }, 1, 0] } },
                vsAI: { $sum: { $cond: ['$vsAI', 1, 0] } },
                humanOnly: { $sum: { $cond: ['$vsAI', 0, 1] } },
              }},
              { $project: { _id: 0 } },
            ],
            new24h: [{ $match: { endedAt: { $gte: now - ONE_DAY } } }, { $count: 'n' }],
            // v0.25：前 24h（24–48h 前）給 1.1 成長率比較
            new24hPrev: [{ $match: { endedAt: { $gte: now - 2 * ONE_DAY, $lt: now - ONE_DAY } } }, { $count: 'n' }],
            new7d: [{ $match: { endedAt: { $gte: now - 7 * ONE_DAY } } }, { $count: 'n' }],
            new30d: [{ $match: { endedAt: { $gte: now - 30 * ONE_DAY } } }, { $count: 'n' }],
            // 1.2 先攻後攻勝率（可選 filter：只看真人對戰）
            firstMover: [
              { $group: {
                _id: null,
                p1Win: { $sum: { $cond: [{ $eq: ['$winner', 0] }, 1, 0] } },
                p2Win: { $sum: { $cond: [{ $eq: ['$winner', 1] }, 1, 0] } },
                draws: { $sum: { $cond: [{ $eq: ['$winner', null] }, 1, 0] } },
              }},
              { $project: { _id: 0 } },
            ],
            firstMoverHumanOnly: [
              { $match: { vsAI: { $ne: true } } },
              { $group: {
                _id: null,
                p1Win: { $sum: { $cond: [{ $eq: ['$winner', 0] }, 1, 0] } },
                p2Win: { $sum: { $cond: [{ $eq: ['$winner', 1] }, 1, 0] } },
                draws: { $sum: { $cond: [{ $eq: ['$winner', null] }, 1, 0] } },
              }},
              { $project: { _id: 0 } },
            ],
            firstMoverOnlineOnly: [
              { $match: { $and: [{ roomCode: { $type: 'string' } }, { vsAI: { $ne: true } }] } },
              { $group: {
                _id: null,
                p1Win: { $sum: { $cond: [{ $eq: ['$winner', 0] }, 1, 0] } },
                p2Win: { $sum: { $cond: [{ $eq: ['$winner', 1] }, 1, 0] } },
                draws: { $sum: { $cond: [{ $eq: ['$winner', null] }, 1, 0] } },
              }},
              { $project: { _id: 0 } },
            ],
            // 1.3 對戰時長 / 回合（avg + bucket histogram）
            durationAvg: [
              { $match: { durationMs: { $gt: 0 } } },
              { $group: { _id: null, avg: { $avg: '$durationMs' }, count: { $sum: 1 } } },
              { $project: { _id: 0 } },
            ],
            durationHistogram: [
              { $match: { durationMs: { $gt: 0 } } },
              { $bucket: {
                groupBy: '$durationMs',
                boundaries: [0, 300000, 600000, 900000, 1200000, 1500000, 1800000, 2400000, 3000000, 3600000],
                default: '60+',
                output: { count: { $sum: 1 } },
              }},
            ],
            turnsAvg: [
              { $match: { finalTurn: { $gt: 0 } } },
              { $group: { _id: null, avg: { $avg: '$finalTurn' }, count: { $sum: 1 } } },
              { $project: { _id: 0 } },
            ],
            turnsDistribution: [
              { $match: { finalTurn: { $gt: 0 } } },
              { $group: { _id: '$finalTurn', count: { $sum: 1 } } },
              { $sort: { _id: 1 } },
              { $limit: 40 },  // turn 1 - 40, 超過會被截
            ],
            // 1.4 勝因分佈
            winReasons: [
              { $match: { winReason: { $ne: '' } } },
              // v0.30: 加入「是否第一回合(含開局設置)結束」維度，讓 1.4 勝因分佈能區分
              //   第一回合離開(開房者掛機) vs 其他回合離開(中途認輸放棄)。finalTurn<=1 視為第一回合。
              { $group: { _id: { r: '$winReason', ft: { $lte: ['$finalTurn', 1] } }, count: { $sum: 1 } } },
              { $sort: { count: -1 } },
              { $limit: 100 },
            ],
          }});
        const [agg] = await db.collection('matchRecords').aggregate(pipeline).toArray();

        const unwrap = (arr, fallback) => (arr && arr[0]) ? arr[0] : fallback;
        const unwrapCount = (arr) => (arr && arr[0]) ? arr[0].n : 0;

        res.json({
          total: unwrap(agg.totals, { all: 0, online: 0, local: 0, vsAI: 0, humanOnly: 0 }),
          new24h: unwrapCount(agg.new24h),
          new24hPrev: unwrapCount(agg.new24hPrev),
          new7d: unwrapCount(agg.new7d),
          new30d: unwrapCount(agg.new30d),
          firstMover: {
            all: unwrap(agg.firstMover, { p1Win: 0, p2Win: 0, draws: 0 }),
            humanOnly: unwrap(agg.firstMoverHumanOnly, { p1Win: 0, p2Win: 0, draws: 0 }),
            onlineHumanOnly: unwrap(agg.firstMoverOnlineOnly, { p1Win: 0, p2Win: 0, draws: 0 }),
          },
          duration: {
            avgMs: unwrap(agg.durationAvg, { avg: 0 }).avg || 0,
            sampleCount: unwrap(agg.durationAvg, { count: 0 }).count || 0,
            histogram: agg.durationHistogram || [],
          },
          turns: {
            avg: unwrap(agg.turnsAvg, { avg: 0 }).avg || 0,
            sampleCount: unwrap(agg.turnsAvg, { count: 0 }).count || 0,
            distribution: agg.turnsDistribution || [],
          },
          winReasons: (agg.winReasons || []).map(x => ({ reason: x._id.r, firstTurn: !!x._id.ft, count: x.count })),  // v0.30: 帶出 firstTurn 供客戶端細分離開類
        });
      } catch (e) {
        console.warn('[stats overview] error:', e.message);
        res.status(500).json({ error: e.message });
      }
    });

    // 1.5-1.8 卡牌使用率（admin 端做 supertype/subtype/pokemonType 分群）
    //   server 純算 cardId → { totalCount, deckCount }，回傳前 N 筆。
    //   admin 端拿到後用 cardInfoMap 補名稱 + supertype 等資訊。
    app.get('/api/admin/stats/cards', requireFirebaseAdmin, async (req, res) => {
      if (typeof db === 'undefined' || !db) return res.status(503).json({ error: 'db not ready' });
      const limit = Math.max(1, parseInt(req.query.limit) || 100); // v0.20: 拿掉 default 300 + cap 1000 — Oracle 無額度限制；client 仍 pagination limit=50
      // 可選 mode filter（線上 only / 本機 only）
      const matchStage = {};
      if (req.query.mode === 'online') matchStage.roomCode = { $type: 'string' };
      else if (req.query.mode === 'local') matchStage.roomCode = null;
      // 可選 since filter
      if (req.query.since) matchStage.endedAt = { $gte: parseInt(req.query.since) };

      try {
        const pipeline = [];
        if (Object.keys(matchStage).length > 0) pipeline.push({ $match: matchStage });
        pipeline.push(
          // 同時展開 p1 + p2 牌組（兩邊都算）
          { $project: { decks: [
            { cardCounts: '$p1.cardCounts' },
            { cardCounts: '$p2.cardCounts' },
          ]}},
          { $unwind: '$decks' },
          // cardCounts: {cardId: count} → array of {k, v}
          { $project: { entries: { $objectToArray: '$decks.cardCounts' } } },
          { $unwind: '$entries' },
          { $group: {
            _id: '$entries.k',
            totalCount: { $sum: '$entries.v' },  // 累計總張數
            deckCount: { $sum: 1 },              // 出現在幾副牌組
          }},
          { $sort: { totalCount: -1 } },
          { $limit: limit },
          { $project: { _id: 0, cardId: '$_id', totalCount: 1, deckCount: 1 } },
        );

        const [cards, deckCountAgg] = await Promise.all([
          db.collection('matchRecords').aggregate(pipeline).toArray(),
          // 總共有幾副牌組（= matches × 2）— 用來算 deck usage %
          db.collection('matchRecords').countDocuments(matchStage),
        ]);
        const totalDecks = deckCountAgg * 2;

        res.json({
          cards,
          totalDecks,
          generatedAt: Date.now(),
        });
      } catch (e) {
        console.warn('[stats cards] error:', e.message);
        res.status(500).json({ error: e.message });
      }
    });

    // cardTags：admin 標記某張卡為「支援型」等 tag（用於 1.6 分群顯示）
    //   document shape: { _id: cardId, tags: ['support', ...], updatedAt, updatedBy }
    app.get('/api/admin/cards/tags', requireFirebaseAdmin, async (req, res) => {
      if (typeof db === 'undefined' || !db) return res.status(503).json({ error: 'db not ready' });
      try {
        const docs = await db.collection('cardTags').find({}).toArray();
        const tagMap = {};
        for (const d of docs) tagMap[d._id] = d.tags || [];
        res.json({ tags: tagMap });
      } catch (e) {
        console.warn('[card tags get] error:', e.message);
        res.status(500).json({ error: e.message });
      }
    });

    // POST body: { tag: 'support', action: 'add' | 'remove' }
    app.post('/api/admin/cards/tags/:cardId', requireFirebaseAdmin, async (req, res) => {
      if (typeof db === 'undefined' || !db) return res.status(503).json({ error: 'db not ready' });
      const cardId = String(req.params.cardId || '').trim();
      if (!cardId) return res.status(400).json({ error: 'cardId required' });
      let body;
      try {
        body = await new Promise((resolve, reject) => {
          if (req.body && typeof req.body === 'object') return resolve(req.body);
          let data = '';
          req.on('data', c => { data += c; if (data.length > 10 * 1024) { reject(new Error('payload too large')); req.destroy(); } });
          req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
          req.on('error', reject);
        });
      } catch (e) { return res.status(400).json({ error: 'JSON body 解析失敗：' + e.message }); }
      const tag = String(body?.tag || '').trim();
      const action = String(body?.action || 'add');
      if (!tag || !/^[a-z_]+$/i.test(tag) || tag.length > 30) return res.status(400).json({ error: 'invalid tag (alphanumeric, ≤30 chars)' });
      if (action !== 'add' && action !== 'remove') return res.status(400).json({ error: 'action must be add|remove' });
      try {
        const now = new Date();
        const admin = req.adminUser?.email || 'unknown';
        const update = action === 'add'
          ? { $addToSet: { tags: tag }, $set: { updatedAt: now, updatedBy: admin } }
          : { $pull: { tags: tag }, $set: { updatedAt: now, updatedBy: admin } };
        await db.collection('cardTags').updateOne({ _id: cardId }, update, { upsert: true });
        const doc = await db.collection('cardTags').findOne({ _id: cardId });
        res.json({ ok: true, cardId, tags: doc?.tags || [] });
      } catch (e) {
        console.warn('[card tags post] error:', e.message);
        res.status(500).json({ error: e.message });
      }
    });

    // ────────────────────────────────────────────────────────────────────────
    // v0.13 Phase 2b — 5 個 Tier 2 endpoints
    // ────────────────────────────────────────────────────────────────────────

    // 2.1 玩家排行榜 — 用 p1/p2 email 聚合，含勝/負/平/勝率
    //   ?mode=online|local (default 全部)
    //   ?excludeAI=true (default false — true 則排除 vsAI 場)
    //   ?minMatches=N (default 1 — 最少對戰場次，過濾雜訊)
    app.get('/api/admin/stats/players', requireFirebaseAdmin, async (req, res) => {
      if (typeof db === 'undefined' || !db) return res.status(503).json({ error: 'db not ready' });
      const baseMatch = {};
      if (req.query.mode === 'online') baseMatch.roomCode = { $type: 'string' };
      else if (req.query.mode === 'local') baseMatch.roomCode = null;
      // v0.17: excludeAI 改用「roomCode 有值 OR vsAI != true」— 線上對戰一律算真人（不可能有 AI 配對）
      //   背景：v0.16 diagnostic 顯示 134 筆線上對戰被 client 誤標 vsAI=true（aiPlayerIndex 殘留 bug）
      //   roomCode 才是線上對戰 source of truth，繞過 vsAI 旗標誤判
      if (req.query.excludeAI === 'true') {
        baseMatch.$or = [
          { roomCode: { $type: 'string' } },  // 線上對戰必為真人
          { vsAI: { $ne: true } },             // 本機非 AI 場
        ];
      }
      const minMatches = Math.max(1, parseInt(req.query.minMatches) || 1);
      try {
        const pipeline = [];
        if (Object.keys(baseMatch).length > 0) pipeline.push({ $match: baseMatch });
        pipeline.push({ $facet: {
          // v0.15 P1 視角：email 為主鍵；email 缺則用 name (prefix "name:" 避免與 email 碰撞)
          //   實況：多數玩家為 Firebase 匿名登入（無 email），但有 displayName。
          //   PM2 log 確認 asP1=0 asP2=0 而 match log 有 p1=ええ vs p2=雷電獸來了!! 等多場
          //   → 完全沒 email、name 為唯一身份。改 name fallback 才能呈現排行。
          //   AI 玩家以 name 開頭含 '🤖' 排除（vsAI 旗標其實上層 baseMatch 已擋了，這層作雙保險）
          asP1: [
            // 必須有 name 才有資格上榜（AI 玩家用 '🤖 AI 對手' 此處不擋，靠 baseMatch.vsAI 擋）
            { $match: { 'p1.name': { $nin: [null, ''] } } },
            { $group: {
              _id: { $ifNull: ['$p1.email', { $concat: ['name:', '$p1.name'] }] },
              name: { $last: '$p1.name' },
              email: { $last: '$p1.email' },
              matches: { $sum: 1 },
              wins: { $sum: { $cond: [{ $eq: ['$winner', 0] }, 1, 0] } },
              losses: { $sum: { $cond: [{ $eq: ['$winner', 1] }, 1, 0] } },
              draws: { $sum: { $cond: [{ $eq: ['$winner', null] }, 1, 0] } },
            }},
          ],
          asP2: [
            { $match: { 'p2.name': { $nin: [null, ''] } } },
            { $group: {
              _id: { $ifNull: ['$p2.email', { $concat: ['name:', '$p2.name'] }] },
              name: { $last: '$p2.name' },
              email: { $last: '$p2.email' },
              matches: { $sum: 1 },
              wins: { $sum: { $cond: [{ $eq: ['$winner', 1] }, 1, 0] } },
              losses: { $sum: { $cond: [{ $eq: ['$winner', 0] }, 1, 0] } },
              draws: { $sum: { $cond: [{ $eq: ['$winner', null] }, 1, 0] } },
            }},
          ],
        }});
        const [agg] = await db.collection('matchRecords').aggregate(pipeline).toArray();
        // merge p1 + p2 by composite key (server-side JS) — key 即 _id，可能是 email 或 "name:xxx"
        const merged = new Map();
        for (const src of [agg.asP1, agg.asP2]) {
          for (const row of (src || [])) {
            const key = row._id;
            if (!merged.has(key)) merged.set(key, { key, email: row.email || null, name: row.name, matches: 0, wins: 0, losses: 0, draws: 0 });
            const m = merged.get(key);
            m.matches += row.matches;
            m.wins += row.wins;
            m.losses += row.losses;
            m.draws += row.draws;
            if (row.name) m.name = row.name;  // 後寫贏（取最新 name）
            if (row.email && !m.email) m.email = row.email;  // 補 email
          }
        }
        // v0.15 過濾掉 AI 玩家（'🤖 AI 對手' / '玩家 1' 等 default name 也 OK — 至少能看）
        //   注意：vsAI=true 在 baseMatch 已過濾整場，這裡額外擋名字含 🤖 的兜底
        const isAIPlayer = (n) => typeof n === 'string' && n.includes('🤖');
        const list = [...merged.values()]
          .filter(p => p.matches >= minMatches)
          .filter(p => !isAIPlayer(p.name))  // v0.15 排除 AI 玩家
          .map(p => {
            const decisive = p.wins + p.losses;  // 排除平局算勝率
            p.winRate = decisive > 0 ? p.wins / decisive : null;
            return p;
          })
          .sort((a, b) => b.matches - a.matches);
        // v0.15 diagnostic — 部署後可用 PM2 log 觀察排行榜資料分佈
        const _p1Count = (agg.asP1 || []).length;
        const _p2Count = (agg.asP2 || []).length;
        const _withEmail = list.filter(p => p.email).length;
        // v0.16 完整診斷 — 各階段 record 數，找出資料在哪一步被過濾掉
        //   執行 4 個獨立 countDocuments，每個 ~10ms，admin 統計用 OK
        const [totalAll, onlineAll, localAll, vsAIAll, nonAIAll, afterBaseMatch] = await Promise.all([
          db.collection('matchRecords').countDocuments({}),
          db.collection('matchRecords').countDocuments({ roomCode: { $type: 'string' } }),
          db.collection('matchRecords').countDocuments({ roomCode: null }),
          db.collection('matchRecords').countDocuments({ vsAI: true }),
          db.collection('matchRecords').countDocuments({ vsAI: { $ne: true } }),
          db.collection('matchRecords').countDocuments(baseMatch),
        ]);
        // 取 1 筆 sample 看實際 shape（檢查 p1.name / p1.email 等 field 結構）
        const sample = await db.collection('matchRecords').findOne(baseMatch, {
          projection: { _id: 1, roomCode: 1, vsAI: 1, mode: 1, winner: 1, 'p1.name': 1, 'p1.email': 1, 'p2.name': 1, 'p2.email': 1, endedAt: 1 },
          sort: { endedAt: -1 },
        });
        const fullDebug = {
          asP1Count: _p1Count,
          asP2Count: _p2Count,
          mergedCount: list.length,
          withEmail: _withEmail,
          // v0.16 新增
          query: { mode: req.query.mode || 'all', excludeAI: req.query.excludeAI === 'true' },
          dataBreakdown: {
            totalRecords: totalAll,
            onlineRecords: onlineAll,
            localRecords: localAll,
            vsAIRecords: vsAIAll,
            nonAIRecords: nonAIAll,
            afterBaseMatchFilter: afterBaseMatch,
          },
          sampleAfterBaseMatch: sample,
        };
        console.log('[stats players] q=' + JSON.stringify({mode:req.query.mode,excludeAI:req.query.excludeAI}) + ' total=' + totalAll + ' online=' + onlineAll + ' local=' + localAll + ' nonAI=' + nonAIAll + ' afterFilter=' + afterBaseMatch + ' asP1=' + _p1Count + ' asP2=' + _p2Count + ' merged=' + list.length + ' withEmail=' + _withEmail);
        res.json({ players: list, generatedAt: Date.now(), debug: fullDebug });
      } catch (e) {
        console.warn('[stats players] error:', e.message);
        res.status(500).json({ error: e.message });
      }
    });

    // 2.2 個人戰績頁 — 最近 N 場 + 常用卡 Top 20 + 勝率走勢
    //   path param: :email
    //   ?recent=20 (default)
    app.get('/api/admin/stats/players/:email', requireFirebaseAdmin, async (req, res) => {
      if (typeof db === 'undefined' || !db) return res.status(503).json({ error: 'db not ready' });
      const email = decodeURIComponent(String(req.params.email || '')).trim();
      if (!email) return res.status(400).json({ error: 'email required' });
      const recentLimit = Math.min(parseInt(req.query.recent) || 30, 200);
      try {
        // 玩家所有對戰（p1.email 或 p2.email match）
        const playerMatches = await db.collection('matchRecords').find({
          $or: [{ 'p1.email': email }, { 'p2.email': email }],
        }).sort({ endedAt: -1 }).limit(recentLimit).toArray();

        // summary（全部對戰，不限 recentLimit）
        const summaryPipeline = [
          { $match: { $or: [{ 'p1.email': email }, { 'p2.email': email }] } },
          { $project: {
            isP1: { $eq: ['$p1.email', email] },
            winner: 1,
            cardCounts: { $cond: [{ $eq: ['$p1.email', email] }, '$p1.cardCounts', '$p2.cardCounts'] },
          }},
          { $project: {
            isWin: { $or: [
              { $and: ['$isP1', { $eq: ['$winner', 0] }] },
              { $and: [{ $not: '$isP1' }, { $eq: ['$winner', 1] }] },
            ]},
            isLoss: { $or: [
              { $and: ['$isP1', { $eq: ['$winner', 1] }] },
              { $and: [{ $not: '$isP1' }, { $eq: ['$winner', 0] }] },
            ]},
            isDraw: { $eq: ['$winner', null] },
            cardCounts: 1,
          }},
        ];
        const [counts] = await db.collection('matchRecords').aggregate([
          ...summaryPipeline,
          { $group: {
            _id: null,
            matches: { $sum: 1 },
            wins: { $sum: { $cond: ['$isWin', 1, 0] } },
            losses: { $sum: { $cond: ['$isLoss', 1, 0] } },
            draws: { $sum: { $cond: ['$isDraw', 1, 0] } },
          }},
        ]).toArray();

        // 常用卡 Top 20（從玩家牌組的 cardCounts 聚合）
        const topCards = await db.collection('matchRecords').aggregate([
          ...summaryPipeline,
          { $project: { entries: { $objectToArray: '$cardCounts' } } },
          { $unwind: '$entries' },
          { $group: {
            _id: '$entries.k',
            totalCount: { $sum: '$entries.v' },
            deckCount: { $sum: 1 },
          }},
          { $sort: { totalCount: -1 } },
          { $limit: 50 },
          { $project: { _id: 0, cardId: '$_id', totalCount: 1, deckCount: 1 } },
        ]).toArray();

        const summary = counts || { matches: 0, wins: 0, losses: 0, draws: 0 };
        delete summary._id;
        const decisive = (summary.wins || 0) + (summary.losses || 0);
        summary.winRate = decisive > 0 ? summary.wins / decisive : null;

        res.json({
          email, summary,
          recentMatches: playerMatches,
          topCards,
        });
      } catch (e) {
        console.warn('[stats player detail] error:', e.message);
        res.status(500).json({ error: e.message });
      }
    });

    // 2.3 卡牌勝率 — 該卡在勝方牌組出現次數 / 在所有牌組出現次數
    //   ?mode=online (default 全部，但建議用 online)
    //   ?minDecks=10 (default — 至少 N 副才算統計顯著)
    //   ?excludeAI=true (default true — AI 對戰會污染勝率)
    app.get('/api/admin/stats/cards/winrate', requireFirebaseAdmin, async (req, res) => {
      if (typeof db === 'undefined' || !db) return res.status(503).json({ error: 'db not ready' });
      const baseMatch = { winner: { $in: [0, 1] } };  // 只算分出勝負的場（排除平局）
      if (req.query.mode === 'online') baseMatch.roomCode = { $type: 'string' };
      else if (req.query.mode === 'local') baseMatch.roomCode = null;
      // 預設排除 AI 對戰（AI 勝率不應算入統計）
      const excludeAI = req.query.excludeAI !== 'false';
      // v0.98: 玩家規則 — 「只要有 roomCode 就不是 AI」.
      //   vsAI field 不可靠 (client 寫入可能誤判), 改用 roomCode 存在判定.
      //   excludeAI=true 等同 「只算有房號的對戰」(本機 vs 玩家也排除, 因為 client 端不太可靠分辨).
      if (excludeAI) baseMatch.roomCode = { $type: 'string' };
      // v0.26：時間範圍篩選（避免新卡包後仍看舊統計）— ?since=<ms epoch> → endedAt >= since
      if (req.query.since) baseMatch.endedAt = { $gte: parseInt(req.query.since) };
      // v0.27：排除「玩家中途離開」獲勝的場 — winReason 形如「<玩家名> 中途離開」
      //   （臨時有事/斷線等非實力因素，會污染真實卡牌勝率）。
      //   $not + regex：同時保留 winReason 不存在的舊場（不影響歷史資料）。
      baseMatch.winReason = { $not: /中途離開/ };
      const minDecks = Math.max(1, parseInt(req.query.minDecks) || 5);
      try {
        const pipeline = [
          { $match: baseMatch },
          // 同時展開 p1 + p2 兩副牌，標記是否為勝方
          { $project: {
            decks: [
              { cardCounts: '$p1.cardCounts', isWinner: { $eq: ['$winner', 0] } },
              { cardCounts: '$p2.cardCounts', isWinner: { $eq: ['$winner', 1] } },
            ],
          }},
          { $unwind: '$decks' },
          { $project: {
            entries: { $objectToArray: '$decks.cardCounts' },
            isWinner: '$decks.isWinner',
          }},
          { $unwind: '$entries' },
          { $group: {
            _id: '$entries.k',
            totalDecks: { $sum: 1 },
            winDecks: { $sum: { $cond: ['$isWinner', 1, 0] } },
          }},
          // v0.93: 拿掉 minDecks server-side filter — admin 合併 canonical (老大的指令多版本)
          //   後再 filter, 否則同名多版本各自被 filter 留下太少, 數字小不合理.
          //   limit 也從 1000 提升到 10000.
          { $project: {
            _id: 0,
            cardId: '$_id',
            totalDecks: 1,
            winDecks: 1,
            winRate: { $cond: [{ $gt: ['$totalDecks', 0] }, { $divide: ['$winDecks', '$totalDecks'] }, 0] },
          }},
          { $sort: { totalDecks: -1 } },
          { $limit: 10000 },
        ];
        const cards = await db.collection('matchRecords').aggregate(pipeline).toArray();
        // v0.97: 完整 diagnostic — 顯示資料源 breakdown
        //   (Wilson v0.94 diag 看到 totalMatchRecords=8 才發現是排除 AI 後樣本太少,
        //    不是統計 bug. 本版加 absolute db 數字 + 各 filter 後數字, 一眼看清)
        let diagnostics = {};
        try {
          const [diag] = await db.collection('matchRecords').aggregate([
            { $facet: {
              allDb: [{ $count: 'n' }],
              afterFilter: [{ $match: baseMatch }, { $count: 'n' }],
              vsAITotal: [{ $match: { vsAI: true } }, { $count: 'n' }],
              nonAITotal: [{ $match: { vsAI: { $ne: true } } }, { $count: 'n' }],
              onlineTotal: [{ $match: { roomCode: { $type: 'string' } } }, { $count: 'n' }],
              localTotal: [{ $match: { roomCode: null } }, { $count: 'n' }],
              withCardCountsFilter: [
                { $match: baseMatch },
                { $match: { $or: [
                  { 'p1.cardCounts': { $exists: true, $not: { $size: 0 } } },
                  { 'p2.cardCounts': { $exists: true, $not: { $size: 0 } } },
                ] } },
                { $count: 'n' },
              ],
              sampleP1: [
                { $match: { 'p1.cardCounts': { $exists: true } } },
                { $limit: 1 },
                { $project: { _id: 0, sampleSize: { $size: { $objectToArray: { $ifNull: ['$p1.cardCounts', {}] } } } } },
              ],
            }},
          ]).toArray();
          diagnostics = {
            // 資料源 absolute
            dbTotalAllTime: diag.allDb?.[0]?.n || 0,
            dbVsAI: diag.vsAITotal?.[0]?.n || 0,
            dbNonAI: diag.nonAITotal?.[0]?.n || 0,
            dbOnline: diag.onlineTotal?.[0]?.n || 0,
            dbLocal: diag.localTotal?.[0]?.n || 0,
            // 當前 filter 後
            afterFilterCount: diag.afterFilter?.[0]?.n || 0,
            withCardCountsCount: diag.withCardCountsFilter?.[0]?.n || 0,
            // 樣本
            sampleP1CardCountSize: diag.sampleP1?.[0]?.sampleSize || 0,
            topCardTotalDecks: cards[0]?.totalDecks || 0,
            cardsReturnedCount: cards.length,
            // 當前查詢
            currentMode: req.query.mode || 'all',
            currentExcludeAI: excludeAI,
            currentMinDecks: minDecks,
          };
        } catch (de) { diagnostics = { error: de.message }; }
        res.json({ cards, minDecks, mode: req.query.mode || 'all', excludeAI, generatedAt: Date.now(), diagnostics });
      } catch (e) {
        console.warn('[stats winrate] error:', e.message);
        res.status(500).json({ error: e.message });
      }
    });

    // v0.23：2.3 卡牌→代表牌組聚合。給定一組 cardId（同 canonical 的多版本），
    //   找出「含其中任一張」的所有牌組（p1/p2 cardCounts 任一），聚合每張卡的
    //   出現牌組數 (deckCount) 與張數分佈 (countDist)，admin 端再依 canonical 合併、
    //   取眾數張數、貪婪湊成代表性 60 張牌組。mode 與 excludeAI 鏡射 winrate（玩家從
    //   winrate 表點進來，scope 一致＝只算有房號的對戰）。
    app.get('/api/admin/stats/cards/archetype', requireFirebaseAdmin, async (req, res) => {
      if (typeof db === 'undefined' || !db) return res.status(503).json({ error: 'db not ready' });
      const idSet = String(req.query.ids || '')
        .split(',').map(x => x.trim()).filter(Boolean).slice(0, 50);
      if (idSet.length === 0) return res.status(400).json({ error: 'ids 必填（逗號分隔 cardId）' });
      const baseMatch = {};
      if (req.query.mode === 'online') baseMatch.roomCode = { $type: 'string' };
      else if (req.query.mode === 'local') baseMatch.roomCode = null;
      const excludeAI = req.query.excludeAI !== 'false';
      if (excludeAI) baseMatch.roomCode = { $type: 'string' };  // 同 winrate：只算有房號
      // v0.24：只從獲勝牌組篩選 — 排除平局 + unwind 後只留「勝方」那一副牌
      const winnerOnly = req.query.winnerOnly === 'true';
      if (winnerOnly) baseMatch.winner = { $in: [0, 1] };
      // v0.26：時間範圍篩選 — ?since=<ms epoch> → endedAt >= since（與 winrate 同）
      if (req.query.since) baseMatch.endedAt = { $gte: parseInt(req.query.since) };
      try {
        const pipeline = [
          { $match: baseMatch },
          // 展開 p1 + p2 兩副牌，標記是否為勝方
          { $project: { decks: [
            { cc: '$p1.cardCounts', win: { $eq: ['$winner', 0] } },
            { cc: '$p2.cardCounts', win: { $eq: ['$winner', 1] } },
          ] } },
          { $unwind: '$decks' },
        ];
        // winnerOnly：unwind 後只留勝方那副
        if (winnerOnly) pipeline.push({ $match: { 'decks.win': true } });
        pipeline.push(
          { $project: { entries: { $objectToArray: { $ifNull: ['$decks.cc', {}] } } } },
          // 只保留「含目標卡（任一 variant id）」的牌組
          { $match: { 'entries.k': { $in: idSet } } },
          { $facet: {
            // 符合的牌組總數（樣本數）
            totalDecks: [ { $count: 'n' } ],
            // 每張卡 → deckCount + 張數分佈
            cards: [
              { $unwind: '$entries' },
              { $group: { _id: { card: '$entries.k', cnt: '$entries.v' }, n: { $sum: 1 } } },
              { $group: {
                _id: '$_id.card',
                deckCount: { $sum: '$n' },
                countDist: { $push: { cnt: '$_id.cnt', n: '$n' } },
              }},
              { $sort: { deckCount: -1 } },
              { $limit: 3000 },
            ],
          }},
        );
        const [agg] = await db.collection('matchRecords').aggregate(pipeline).toArray();
        const totalDecks = agg && agg.totalDecks && agg.totalDecks[0] ? agg.totalDecks[0].n : 0;
        const cards = ((agg && agg.cards) || []).map(c => ({
          cardId: c._id, deckCount: c.deckCount, countDist: c.countDist,
        }));
        res.json({ totalDecks, cards, ids: idSet, mode: req.query.mode || 'all', excludeAI, winnerOnly, generatedAt: Date.now() });
      } catch (e) {
        console.warn('[stats archetype] error:', e.message);
        res.status(500).json({ error: e.message });
      }
    });

    // 2.4 時段熱力圖 — 24 小時 × 7 星期幾 對戰量分佈
    //   使用 Asia/Taipei 時區（玩家活動時間貼合台灣）
    //   ?mode=online|local
    // v0.94: 玩家儲存的牌組 list (從 Firestore users/{uid}/decks)
    app.get('/api/admin/users/by-email/:email/decks', requireFirebaseAdmin, requireFb, async (req, res) => {
      try {
        const email = req.params.email;
        if (!email || !email.includes('@')) return res.status(400).json({ error: 'email 必填' });
        const user = await adminAuth.getUserByEmail(email).catch(() => null);
        if (!user) return res.status(404).json({ error: 'Firebase Auth 找不到此 email' });
        const snap = await adminDb.collection('users').doc(user.uid).collection('decks').get();
        const decks = snap.docs.map(d => {
          const data = d.data() || {};
          return {
            id: data.id || d.id,
            name: data.name || '(未命名)',
            entries: data.entries || [],
            updatedAt: data.updatedAt || null,
          };
        });
        res.json({ uid: user.uid, decks });
      } catch (e) {
        console.warn('[users/decks] error:', e.message);
        res.status(500).json({ error: e.message });
      }
    });

    app.get('/api/admin/stats/heatmap', requireFirebaseAdmin, async (req, res) => {
      if (typeof db === 'undefined' || !db) return res.status(503).json({ error: 'db not ready' });
      const baseMatch = {};
      if (req.query.mode === 'online') baseMatch.roomCode = { $type: 'string' };
      else if (req.query.mode === 'local') baseMatch.roomCode = null;
      try {
        const pipeline = [];
        if (Object.keys(baseMatch).length > 0) pipeline.push({ $match: baseMatch });
        pipeline.push(
          { $match: { endedAt: { $gt: 0 } } },
          { $project: {
            // $endedAt 是 Date.now() millisecond，$toDate 轉成 Date
            dayOfWeek: { $dayOfWeek: { date: { $toDate: '$endedAt' }, timezone: 'Asia/Taipei' } },  // 1-7 (1=Sunday)
            hour: { $hour: { date: { $toDate: '$endedAt' }, timezone: 'Asia/Taipei' } },           // 0-23
          }},
          { $group: {
            _id: { day: '$dayOfWeek', hour: '$hour' },
            count: { $sum: 1 },
          }},
          { $project: { _id: 0, day: '$_id.day', hour: '$_id.hour', count: 1 } },
        );
        const cells = await db.collection('matchRecords').aggregate(pipeline).toArray();
        res.json({ cells, timezone: 'Asia/Taipei', generatedAt: Date.now() });
      } catch (e) {
        console.warn('[stats heatmap] error:', e.message);
        res.status(500).json({ error: e.message });
      }
    });

    // 2.5 對戰量趨勢 — 按天/週/月 分桶
    //   ?mode=online|local
    //   ?granularity=day|week|month (default day)
    //   ?days=30 (default — 看近 N 天；max 365)
    app.get('/api/admin/stats/trends', requireFirebaseAdmin, async (req, res) => {
      if (typeof db === 'undefined' || !db) return res.status(503).json({ error: 'db not ready' });
      const baseMatch = {};
      if (req.query.mode === 'online') baseMatch.roomCode = { $type: 'string' };
      else if (req.query.mode === 'local') baseMatch.roomCode = null;
      const days = Math.min(365, Math.max(1, parseInt(req.query.days) || 30));
      const granularity = ['day', 'week', 'month'].includes(req.query.granularity) ? req.query.granularity : 'day';
      const fmt = granularity === 'day' ? '%Y-%m-%d' : (granularity === 'week' ? '%G-W%V' : '%Y-%m');
      try {
        const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
        const pipeline = [
          { $match: { ...baseMatch, endedAt: { $gte: cutoff } } },
          { $project: {
            bucket: { $dateToString: { date: { $toDate: '$endedAt' }, format: fmt, timezone: 'Asia/Taipei' } },
            isOnline: { $cond: [{ $or: [{ $eq: ['$roomCode', null] }, { $eq: ['$roomCode', ''] }] }, false, true] },
            vsAI: { $ifNull: ['$vsAI', false] },
          }},
          { $group: {
            _id: '$bucket',
            total: { $sum: 1 },
            online: { $sum: { $cond: ['$isOnline', 1, 0] } },
            local: { $sum: { $cond: ['$isOnline', 0, 1] } },
            vsAI: { $sum: { $cond: ['$vsAI', 1, 0] } },
          }},
          { $sort: { _id: 1 } },
          { $project: { _id: 0, bucket: '$_id', total: 1, online: 1, local: 1, vsAI: 1 } },
        ];
        const buckets = await db.collection('matchRecords').aggregate(pipeline).toArray();
        res.json({ buckets, granularity, days, mode: req.query.mode || 'all', generatedAt: Date.now() });
      } catch (e) {
        console.warn('[stats trends] error:', e.message);
        res.status(500).json({ error: e.message });
      }
    });

    console.log('[stats] v0.2 endpoints registered (Phase 2a + 2b): /api/admin/stats/{overview,cards,players,players/:email,cards/winrate,heatmap,trends} + /api/admin/cards/tags');
  })();

  console.log('[admin] v0.13 endpoints registered (firebase ' + (fbInitialized ? 'ON' : 'OFF') + ', matchRecords cardCounts + DELETE + roomCode mode filter, Phase 2a + 2b stats + cardTags)');
}).catch(err => {
  console.error('[admin] firebase-admin import failed:', err);
});

// === TW DECK CODE IMPORT === v0.1
// 公開 endpoint（無需 admin auth）— 玩家貼台灣官網 deck code 自動解析牌組。
// 對應 client: src/routes/decks/+page.svelte 的「🎫 官網代碼匯入」按鈕。
//
// 官網 URL pattern: https://asia.pokemon-card.com/tw/deck-build/recipe/{code}/
//   - 直接 SSR 出完整牌組 HTML，無需走 JS API
//   - HTML 內每張卡有 <a href="/tw/card-search/detail/<numericId>/">卡名</a>
//     + 緊接 setCode collectorNumber + count 數字
//
// Cache: 5 分鐘 TTL（同 code 不重複爬官網）
// Rate-limit: 5 reqs/min per IP（防爬蟲行為，避免被官網封 IP）
// User-Agent: 偽裝正常瀏覽器
(function registerTwDeckImport() {
  const DECK_CACHE_TTL = 5 * 60 * 1000;
  const RATE_WINDOW = 60 * 1000;
  const RATE_MAX = 5;
  const deckCache = new Map();           // code -> { entries, fetchedAt }
  const rateBuckets = new Map();          // ip -> [timestamps]

  function rateLimitCheck(ip) {
    const now = Date.now();
    const arr = (rateBuckets.get(ip) || []).filter(t => now - t < RATE_WINDOW);
    if (arr.length >= RATE_MAX) {
      rateBuckets.set(ip, arr);
      return false;
    }
    arr.push(now);
    rateBuckets.set(ip, arr);
    return true;
  }

  // Parse 官網 deck-recipe HTML 抽出每張卡的 cardId/setCode/number/count
  function parseDeckHtml(html) {
    const entries = [];
    // 找所有 <a href="/tw/card-search/detail/<id>/"> 鏈接
    const linkRegex = /href="(?:https?:\/\/asia\.pokemon-card\.com)?\/tw\/card-search\/detail\/(\d+)\/?"[^>]*>([^<]+)<\/a>/g;
    const positions = [];
    let m;
    while ((m = linkRegex.exec(html)) !== null) {
      positions.push({ id: m[1], name: m[2].trim(), endIdx: linkRegex.lastIndex });
    }
    for (let i = 0; i < positions.length; i++) {
      const cur = positions[i];
      const nextStart = i + 1 < positions.length ? html.indexOf('href=', cur.endIdx) : html.length;
      const segment = html.substring(cur.endIdx, nextStart > 0 ? nextStart : html.length);
      // setCode + collectorNumber pattern: 字母數字組合，後面接 數字/[數字或字母]
      //   e.g. "M4 002/083" / "SVTM 001/022" / "SVM WAT"
      const setMatch = segment.match(/>\s*([A-Za-z0-9\-]+)\s+(\d+\/[\w\d]+|[A-Z]+)\s*</);
      // count: 1~60 範圍內的整數（卡片張數，能量卡最多 59）
      const countMatch = segment.match(/>\s*(\d{1,2})\s*</);
      if (!countMatch) continue;
      const count = parseInt(countMatch[1], 10);
      if (!count || count > 60) continue;
      entries.push({
        cardId: cur.id,
        name: cur.name,
        setCode: setMatch ? setMatch[1] : null,
        collectorNumber: setMatch ? setMatch[2] : null,
        count,
      });
    }
    return entries;
  }

  app.get('/api/decode-tw-deck/:code', async (req, res) => {
    const code = req.params.code;
    // 代碼格式驗證：XXXXXX-XXXXXX-XXXXXX
    if (!/^[A-Za-z0-9]{6}-[A-Za-z0-9]{6}-[A-Za-z0-9]{6}$/.test(code)) {
      return res.status(400).json({ error: '代碼格式錯誤（應為 XXXXXX-XXXXXX-XXXXXX）' });
    }
    // Rate-limit
    const ip = (req.headers['x-forwarded-for'] || req.ip || 'unknown').toString().split(',')[0].trim();
    if (!rateLimitCheck(ip)) {
      return res.status(429).json({ error: '請求過於頻繁，請稍候再試（每分鐘最多 5 次）' });
    }
    // Cache hit
    const cached = deckCache.get(code);
    if (cached && Date.now() - cached.fetchedAt < DECK_CACHE_TTL) {
      return res.json({ code, entries: cached.entries, cached: true });
    }
    // Fetch 官網
    try {
      const url = 'https://asia.pokemon-card.com/tw/deck-build/recipe/' + code + '/';
      const r = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });
      if (!r.ok) {
        return res.status(r.status === 404 ? 404 : 502).json({ error: '官網回應異常 (HTTP ' + r.status + ')' });
      }
      const html = await r.text();
      const entries = parseDeckHtml(html);
      if (entries.length === 0) {
        return res.status(422).json({ error: 'HTML 解析失敗（可能代碼無效或官網結構變動）' });
      }
      deckCache.set(code, { entries, fetchedAt: Date.now() });
      const totalCards = entries.reduce((s, e) => s + e.count, 0);
      console.log('[deck-import] ' + code + ' → ' + entries.length + ' 種卡 (' + totalCards + ' 張) from ' + ip);
      res.json({ code, entries, cached: false });
    } catch (err) {
      console.warn('[deck-import] fetch error:', err.message);
      res.status(500).json({ error: '無法連線到官網: ' + err.message });
    }
  });

  console.log('[deck-import] v0.1 endpoint /api/decode-tw-deck/:code registered');
})();

// === TW OFFICIAL DECK CODE EXPORT === v0.1 (v4.973 主站 - 牌組編輯器「📤 匯出為官網代碼」)
//
// 流程（透過抓 deckCreate.js / HTML 反推）：
//   1. GET https://asia.pokemon-card.com/tw/deck-build/
//      → 拿 Set-Cookie 的 PHPSESSID + HTML 內 <input name="token" value="..."> CSRF token
//   2. POST /tw/deck-build/beforecheck/ (form-urlencoded, deckData[N][cardId/cardName/count])
//      → response {"success":{"code":200,"errors":[]}}；errors 非空代表牌組違規（不到 60 / 違反賽季 etc）
//   3. POST /tw/deck-build/register/ (form-urlencoded, token=...&deckData=<JSON.stringify(array)>)
//      → 302 redirect to /tw/deck-build/code/?deckCode=XXXXXX-XXXXXX-XXXXXX
//
// 注意：register/ 會在官網 DB 永久寫入這筆牌組，所以 rate-limit 比 import 嚴：
//   - 3 reqs/min per IP（防爛用）
//   - 12 reqs/hour per IP（每天上限 ~288 次以避免我們 IP 被官網風控）
//
// 沒 cache — 同樣 deck 每次 export 拿到的 deckCode 不同（官網每次都 register 新 entry）。
// 玩家在 client 端拿到 code 後應該自己留存，不要無限 re-export。
//
// User-Agent 偽裝 Chrome（同 import endpoint）。
(function registerTwDeckExport() {
  const RATE_MIN_WINDOW = 60 * 1000;
  const RATE_MIN_MAX = 3;
  const RATE_HR_WINDOW = 60 * 60 * 1000;
  const RATE_HR_MAX = 12;
  const exportRateBuckets = new Map(); // ip -> [timestamps]
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  function rateLimitExport(ip) {
    const now = Date.now();
    // 雙窗：min + hr
    const arr = (exportRateBuckets.get(ip) || []).filter(t => now - t < RATE_HR_WINDOW);
    const minCount = arr.filter(t => now - t < RATE_MIN_WINDOW).length;
    if (minCount >= RATE_MIN_MAX) {
      exportRateBuckets.set(ip, arr);
      return { ok: false, reason: '請求過於頻繁（每分鐘最多 3 次）' };
    }
    if (arr.length >= RATE_HR_MAX) {
      exportRateBuckets.set(ip, arr);
      return { ok: false, reason: '每小時匯出上限已達（最多 12 次）' };
    }
    arr.push(now);
    exportRateBuckets.set(ip, arr);
    return { ok: true };
  }

  // 驗證 entries：cardId 純數字 / cardName 非空 / count 1~60 / 總數 ≤ 60
  function validateEntries(entries) {
    if (!Array.isArray(entries) || entries.length === 0) return '牌組空白';
    if (entries.length > 60) return '卡牌種類超過 60';
    let total = 0;
    for (const e of entries) {
      if (!e || typeof e !== 'object') return 'entry 格式錯誤';
      if (!/^\d+$/.test(String(e.cardId))) return `cardId 須為純數字（收到 "${e.cardId}"）`;
      if (typeof e.cardName !== 'string' || !e.cardName.trim()) return 'cardName 不可空白';
      if (e.cardName.length > 50) return `cardName 過長（${e.cardName}）`;
      const c = Number(e.count);
      if (!Number.isInteger(c) || c < 1 || c > 60) return `count 須為 1~60 整數（收到 ${e.count}）`;
      total += c;
    }
    if (total > 60) return `總卡數超過 60（目前 ${total}）`;
    return null;
  }

  // Express 預設不 parse 自訂 JSON body，server.js 應該已掛 express.json()；保險起見手動讀 stream。
  function readJsonBody(req) {
    return new Promise((resolve, reject) => {
      if (req.body && typeof req.body === 'object') return resolve(req.body);
      let data = '';
      req.on('data', chunk => { data += chunk; if (data.length > 100 * 1024) { reject(new Error('payload too large')); req.destroy(); } });
      req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
      req.on('error', reject);
    });
  }

  // 從 Set-Cookie header 抽 Cookie 字串（PHPSESSID=...; otherCookie=...）
  function cookiesFromResponse(r) {
    // Node 18+ has getSetCookie(); fallback to raw header parse
    const arr = (typeof r.headers.getSetCookie === 'function')
      ? r.headers.getSetCookie()
      : (r.headers.get('set-cookie') ? [r.headers.get('set-cookie')] : []);
    return arr.filter(Boolean).map(c => c.split(';')[0]).join('; ');
  }

  app.post('/api/encode-tw-deck', async (req, res) => {
    const ip = (req.headers['x-forwarded-for'] || req.ip || 'unknown').toString().split(',')[0].trim();
    const rateRes = rateLimitExport(ip);
    if (!rateRes.ok) {
      return res.status(429).json({ error: rateRes.reason });
    }
    let body;
    try {
      body = await readJsonBody(req);
    } catch (e) {
      return res.status(400).json({ error: 'JSON body 解析失敗：' + e.message });
    }
    const entries = body && body.entries;
    const errMsg = validateEntries(entries);
    if (errMsg) {
      return res.status(400).json({ error: errMsg });
    }
    try {
      // Step 1: GET /tw/deck-build/ → cookie + token
      const r1 = await fetch('https://asia.pokemon-card.com/tw/deck-build/', {
        headers: {
          'User-Agent': UA,
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
        },
      });
      if (!r1.ok) {
        return res.status(502).json({ error: '官網拿 token 失敗 (HTTP ' + r1.status + ')' });
      }
      const cookieHeader = cookiesFromResponse(r1);
      const html = await r1.text();
      const tokenMatch = html.match(/<input[^>]*name="token"[^>]*value="([^"]+)"/);
      if (!tokenMatch) {
        return res.status(502).json({ error: '官網 token 抽取失敗（HTML 結構變動？）' });
      }
      const token = tokenMatch[1];

      // Step 2: POST beforecheck/ — 驗證 entries 合法
      const checkBody = new URLSearchParams();
      entries.forEach((e, i) => {
        checkBody.set(`deckData[${i}][cardId]`, String(e.cardId));
        checkBody.set(`deckData[${i}][cardName]`, String(e.cardName));
        checkBody.set(`deckData[${i}][count]`, String(e.count));
      });
      const r2 = await fetch('https://asia.pokemon-card.com/tw/deck-build/beforecheck/', {
        method: 'POST',
        headers: {
          'User-Agent': UA,
          'Accept': 'application/json, text/javascript, */*; q=0.01',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
          'Origin': 'https://asia.pokemon-card.com',
          'Referer': 'https://asia.pokemon-card.com/tw/deck-build/',
          'Cookie': cookieHeader,
        },
        body: checkBody.toString(),
      });
      if (!r2.ok) {
        return res.status(502).json({ error: 'beforecheck/ HTTP ' + r2.status });
      }
      const checkJson = await r2.json().catch(() => null);
      const checkErrors = checkJson && checkJson.success && Array.isArray(checkJson.success.errors) ? checkJson.success.errors : null;
      if (checkErrors === null) {
        return res.status(502).json({ error: 'beforecheck/ response 結構異常（' + JSON.stringify(checkJson).substring(0, 200) + '）' });
      }
      if (checkErrors.length > 0) {
        return res.status(422).json({ error: '官網拒絕此牌組：' + checkErrors.join('; '), officialErrors: checkErrors });
      }

      // Step 3: POST register/ — 真正寫入，拿 deckCode
      const deckJsonStr = JSON.stringify(entries.map(e => ({
        cardId: String(e.cardId),
        cardName: String(e.cardName),
        count: Number(e.count),
      })));
      const regBody = new URLSearchParams();
      regBody.set('token', token);
      regBody.set('deckData', deckJsonStr);
      const r3 = await fetch('https://asia.pokemon-card.com/tw/deck-build/register/', {
        method: 'POST',
        headers: {
          'User-Agent': UA,
          'Accept': 'text/html,application/xhtml+xml',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'Origin': 'https://asia.pokemon-card.com',
          'Referer': 'https://asia.pokemon-card.com/tw/deck-build/',
          'Cookie': cookieHeader,
        },
        body: regBody.toString(),
        redirect: 'manual',
      });
      if (r3.status !== 302) {
        return res.status(502).json({ error: 'register/ 預期 302 但拿到 HTTP ' + r3.status });
      }
      const location = r3.headers.get('location') || '';
      const codeMatch = location.match(/deckCode=([A-Za-z0-9]{6}-[A-Za-z0-9]{6}-[A-Za-z0-9]{6})/);
      if (!codeMatch) {
        return res.status(502).json({ error: 'register/ redirect 無 deckCode（location=' + location.substring(0, 200) + '）' });
      }
      const deckCode = codeMatch[1];
      const totalCards = entries.reduce((s, e) => s + Number(e.count), 0);
      console.log('[deck-export] ' + deckCode + ' ← ' + entries.length + ' 種卡 (' + totalCards + ' 張) from ' + ip);
      res.json({ deckCode, totalKinds: entries.length, totalCards });
    } catch (err) {
      console.warn('[deck-export] fetch error:', err.message);
      res.status(500).json({ error: '無法連線到官網: ' + err.message });
    }
  });

  console.log('[deck-export] v0.1 endpoint POST /api/encode-tw-deck registered');
})();

// === ZOMBIE ROOM CLEANUP === v0.3 (Oracle 主機無 firebase 額度限制，頻率提高)
// 定期清理 MongoDB 殭屍房間，避免 lobby 一堆死房 + playing 房雙方斷線後永遠卡在那。
// v0.2：加 ended 房 90 天 retention（之前永久保留，但歷史資料無限累積會吃 disk）。
// v0.3：firebase 額度限制已不適用（搬到 Oracle 主機）— 頻率提高、lobby 閾值降低，避免殭屍堆積。
//
// 規則（v0.3 更新）：
//   - status='lobby' 且 updatedAt > 5 min 前 → 清掉（從 10 min 降到 5 min — 玩家關瀏覽器沒解房）
//   - status='playing' 且 updatedAt > 5 min 前 → 清掉（雙方都斷線，心跳全停；不改避免殺活房）
//   - status='ended' 且 updatedAt > 90 天 前 → 清掉
//   - 連帶清掉孤兒 messages（roomCode 對應的 room 已被清掉）
//
// 啟動延遲 15s 跑首次（從 30s 降），之後每 2 分鐘掃一次（從 5 min 降）。
(function startZombieRoomCleanup() {
  const ZOMBIE_INTERVAL_MS = 2 * 60 * 1000;             // v0.3: 每 2 分鐘掃（從 5 → 2）
  const LOBBY_STALE_MS = 5 * 60 * 1000;                 // v0.3: lobby 5 分鐘無動作（從 10 → 5）
  const PLAYING_STALE_MS = 5 * 60 * 1000;               // playing 5 分鐘無動作（不改）
  const ENDED_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;  // ended 房保留 90 天（不改）

  async function sweepZombies() {
    if (typeof db === 'undefined' || !db) return;
    try {
      const now = Date.now();
      const lobbyCutoff = now - LOBBY_STALE_MS;
      const playingCutoff = now - PLAYING_STALE_MS;
      const endedCutoff = now - ENDED_RETENTION_MS;     // v0.2

      // 一次性查出殭屍 room IDs（lobby + playing + ended retention 合併 query）
      // 注意：updatedAt 在 mongo 內存的是 number（毫秒 epoch），由 oracle server.js 寫入時就是 Date.now()
      const zombies = await db.collection('rooms').find(
        {
          $or: [
            { status: 'lobby', updatedAt: { $lt: lobbyCutoff } },
            { status: 'playing', updatedAt: { $lt: playingCutoff } },
            { status: 'ended', updatedAt: { $lt: endedCutoff } },  // v0.2: 90 天 retention
          ],
        },
        { projection: { _id: 1, status: 1, updatedAt: 1 } }
      ).toArray();

      if (zombies.length === 0) return;

      const codes = zombies.map(r => r._id);
      // 並行刪除 rooms + 對應 messages
      const [roomResult, msgResult] = await Promise.all([
        db.collection('rooms').deleteMany({ _id: { $in: codes } }),
        db.collection('messages').deleteMany({ roomCode: { $in: codes } }),
      ]);

      const lobbyCount = zombies.filter(r => r.status === 'lobby').length;
      const playingCount = zombies.filter(r => r.status === 'playing').length;
      const endedCount = zombies.filter(r => r.status === 'ended').length;  // v0.2
      console.log(
        '[zombie-cleanup] 清掉 ' + roomResult.deletedCount + ' 個房 ' +
        '(lobby:' + lobbyCount + ', playing:' + playingCount + ', ended>90d:' + endedCount + ') + ' +
        msgResult.deletedCount + ' 則孤兒訊息'
      );
    } catch (err) {
      console.warn('[zombie-cleanup] sweep error:', err.message || err);
    }
  }

  // 啟動：延遲 15 秒讓 server.js / mongo 連線完整 init，之後每 2 分鐘掃一次（v0.3 提高頻率）
  setTimeout(() => {
    sweepZombies();
    setInterval(sweepZombies, ZOMBIE_INTERVAL_MS);
  }, 15 * 1000);
  console.log('[zombie-cleanup] v0.3 已啟動：lobby>5min / playing>5min / ended>90天 自動清，每 2 分鐘掃一次');
})();

// ════════════════════════════════════════════════════════════════════════════
// v0.31 錦標賽 — 伺服器權威（測試，限定 /game/tournament）
//   引擎跑在伺服器：收動作 → applyAction → 存 tournamentRooms collection → 回傳唯一盤面。
//   引擎 bundle + 卡池放 /opt/ptcg/api/tournament/（server-engine.cjs + tournament-pool.json）。
//   ★ 獨立 collection、獨立路由；載入失敗只停用錦標賽，正常對戰/admin 完全不受影響（金絲雀）。
// ════════════════════════════════════════════════════════════════════════════
(async () => {
  try {
    const TDIR = '/opt/ptcg/api/tournament';
    let TENG, poolObj;
    try {
      // CJS host
      TENG = require(TDIR + '/server-engine.cjs');
      poolObj = require(TDIR + '/tournament-pool.json');
    } catch (eReq) {
      // ESM host
      const _m = await import(TDIR + '/server-engine.cjs');
      TENG = (_m.default && _m.default.createGame) ? _m.default : _m;
      const _fs = await import('fs');
      poolObj = JSON.parse(_fs.readFileSync(TDIR + '/tournament-pool.json', 'utf8'));
    }
    const TPOOL = new Map(Object.entries(poolObj));
    const TROOMS = db.collection('tournamentRooms');
    console.log('[tournament] engine + pool loaded:', TPOOL.size, 'cards');
    // ── A1：身分驗證（重用 admin 既有 firebase-admin + /opt/ptcg/api/firebase-admin-key.json）──
    let TADMIN = null;
    try { TADMIN = (await import('firebase-admin')).default; } catch (e) { console.warn('[tournament] firebase-admin import failed (auth fallback to playerId):', e && e.message); }
    async function tournIdentity(req) {
      const h = (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
      const m = /^Bearer\s+(.+)$/.exec(h);
      if (TADMIN && TADMIN.apps && TADMIN.apps.length && m) {
        try {
          const dec = await TADMIN.auth().verifyIdToken(m[1]);
          if (dec.firebase && dec.firebase.sign_in_provider === 'anonymous') return { error: '錦標賽不開放匿名帳號，請用 email 帳號登入', code: 403 };
          const nm = dec.name || (dec.email ? String(dec.email).split('@')[0] : '玩家');
          return { uid: dec.uid, email: dec.email || null, name: String(nm).slice(0, 24), verified: true };
        } catch (e) { return { error: '登入憑證無效或過期，請重新登入', code: 401 }; }
      }
      const pid = (req.body && req.body.playerId) || (req.query && req.query.playerId);
      if (pid) return { uid: String(pid), email: null, name: String((req.body && req.body.name) || '玩家').slice(0, 24), verified: false };
      return { error: '需要登入', code: 401 };
    }

    // ── 工具：用雙方真實牌組建一局完整遊戲（引擎 createGame → setup 階段）──
    function makeGame(decks, names, prefs) {
      const d0 = { name: (names && names[0]) || 'P1', entries: decks[0] };
      const d1 = { name: (names && names[1]) || 'P2', entries: decks[1] };
      const fc = Array.isArray(prefs) ? [prefs[0] || 'random', prefs[1] || 'random'] : ['random', 'random'];
      return TENG.createGame(d0, d1, TPOOL, { firstChoicePreferences: fc });
    }
    // ── 伺服器權威 actor gate：防止玩家替對手送動作 ──
    function canSeatAct(gs, seat, action) {
      if (!gs || gs.phase === 'game-over') return false;
      const t = action && action.type;
      const SELF = (action && Object.prototype.hasOwnProperty.call(action, 'senderIdx'))
        || t === 'RESOLVE_SELECTION' || t === 'TAKE_PRIZES' || t === 'SEND_NEW_ACTIVE';
      if (gs.phase === 'setup') return SELF;          // setup 只收自我識別動作
      if (gs.phase !== 'playing') return false;
      if (SELF) return true;
      if (gs.pendingSelection) return gs.pendingSelection.actorIdx === seat;
      if (gs.pendingPrizes && (gs.pendingPrizes[seat] || 0) > 0) return true;
      if (gs.players[seat] && gs.players[seat].active === null) return true;
      return gs.activePlayerIndex === seat;
    }
    // v0.31：閒置判負用 — 算「當前該動作的座位」(沿用 canSeatAct 的優先序)。回傳 0/1；setup 雙方都未完成回 -1；無法判定回 null。
    function currentActorSeat(gs) {
      if (!gs || gs.phase === 'game-over') return null;
      if (gs.phase === 'setup') {
        const d0 = !!(gs.setupDone && gs.setupDone[0]), d1 = !!(gs.setupDone && gs.setupDone[1]);
        if (d0 && !d1) return 1;
        if (!d0 && d1) return 0;
        return -1; // 雙方都未完成 setup → 都欠動作
      }
      if (gs.phase !== 'playing') return null;
      if (gs.pendingSelection && (gs.pendingSelection.actorIdx === 0 || gs.pendingSelection.actorIdx === 1)) return gs.pendingSelection.actorIdx;
      if (gs.pendingPrizes && (gs.pendingPrizes[0] || 0) > 0) return 0;
      if (gs.pendingPrizes && (gs.pendingPrizes[1] || 0) > 0) return 1;
      if (gs.players && gs.players[0] && gs.players[0].active === null) return 0;
      if (gs.players && gs.players[1] && gs.players[1].active === null) return 1;
      return (gs.activePlayerIndex === 0 || gs.activePlayerIndex === 1) ? gs.activePlayerIndex : null;
    }
    // 強制 senderIdx/playerIdx = 自己 seat，防偽造替對手操作
    function normalizeAction(action, seat) {
      const a = Object.assign({}, action);
      if (Object.prototype.hasOwnProperty.call(a, 'senderIdx')) a.senderIdx = seat;
      if (a.type === 'TAKE_PRIZES') a.playerIdx = seat;
      if ((a.type === 'RESOLVE_SELECTION' || a.type === 'SEND_NEW_ACTIVE') && a.senderIdx == null) a.senderIdx = seat;
      return a;
    }
    // doc：{ _id, seats:[pid0,pid1], names:[n0,n1], decks:[e0,e1], gameState, version, updatedAt }
    function freshDoc(room) {
      return { _id: room, seats: [null, null], names: [null, null], decks: [null, null], gameState: null, version: 0, updatedAt: Date.now() };
    }
    async function maybeStartGame(room, doc) {
      if (doc.gameState) return doc;
      if (doc.seats[0] && doc.seats[1] && doc.decks[0] && doc.decks[1]) {
        let gs;
        try { gs = makeGame(doc.decks, doc.names); }
        catch (e) { throw new Error('建立對局失敗(牌組可能含未支援卡): ' + (e && e.message)); }
        const nv = (doc.version || 0) + 1;
        await TROOMS.updateOne({ _id: room }, { $set: { gameState: gs, version: nv, updatedAt: Date.now() } });
        doc.gameState = gs; doc.version = nv;
      }
      return doc;
    }

    app.post('/api/tournament/join', async (req, res) => {
      try {
        const room = String((req.body && req.body.room) || 'TOURNAMENT-TEST');
        const _id = await tournIdentity(req);
        if (_id.error) return res.status(_id.code || 401).json({ error: _id.error });
        const pid = _id.uid;
        const name = _id.name;
        const deckEntries = req.body && req.body.deckEntries;
        if (!Array.isArray(deckEntries) || deckEntries.length === 0) return res.status(400).json({ error: '請先選擇牌組' });
        let doc = await TROOMS.findOne({ _id: room });
        if (!doc) { doc = freshDoc(room); await TROOMS.insertOne(doc); }
        // v0.41 自我修復：舊版 doc 可能缺 names/decks 陣列（preset 時期殘留）→ 補齊避免 undefined[idx]
        doc.seats = Array.isArray(doc.seats) ? doc.seats : [null, null];
        doc.names = Array.isArray(doc.names) ? doc.names : [null, null];
        doc.decks = Array.isArray(doc.decks) ? doc.decks : [null, null];
        let seat = doc.seats.indexOf(pid);
        if (seat < 0) {
          if (doc.seats[0] == null) seat = 0;
          else if (doc.seats[1] == null) seat = 1;
          else return res.status(409).json({ error: '測試房已滿(2人)，請按「重置房」或換另一台/瀏覽器。' });
        }
        doc.seats[seat] = pid; doc.names[seat] = name; doc.decks[seat] = deckEntries;
        // 整陣列寫回（避免 dotted $set 在缺欄位時把 names/decks 建成物件而非陣列）
        await TROOMS.updateOne({ _id: room }, { $set: { seats: doc.seats, names: doc.names, decks: doc.decks, updatedAt: Date.now() } });
        doc = await maybeStartGame(room, doc);
        return res.json({ seat, gameState: doc.gameState, version: doc.version, waiting: !doc.gameState, seats: doc.seats, names: doc.names });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.get('/api/tournament/state', async (req, res) => {
      try {
        const room = String(req.query.room || 'TOURNAMENT-TEST');
        const doc = await TROOMS.findOne({ _id: room });
        if (!doc) return res.json({ version: -1, waiting: true });
        res.json({ gameState: doc.gameState, version: doc.version, seats: doc.seats, names: doc.names, waiting: !doc.gameState, lastActionAt: doc.lastActionAt || null, idleForfeitMin: doc.idleForfeitMin || 3, serverNow: Date.now() });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.post('/api/tournament/action', async (req, res) => {
      try {
        const room = String((req.body && req.body.room) || 'TOURNAMENT-TEST');
        const _id = await tournIdentity(req);
        if (_id.error) return res.status(_id.code || 401).json({ error: _id.error });
        const pid = _id.uid;
        const action = req.body && req.body.action;
        const doc = await TROOMS.findOne({ _id: room });
        if (!doc) return res.status(404).json({ error: 'no room' });
        const seat = doc.seats.indexOf(pid);
        if (seat < 0) return res.status(403).json({ error: '你不在這個房間' });
        const gs = doc.gameState;
        if (!gs) return res.json({ error: '對局尚未開始', waiting: true, version: doc.version });
        if (!action || !action.type) return res.status(400).json({ error: 'no action' });
        if (!canSeatAct(gs, seat, action)) return res.json({ error: '現在不是你能操作的時機', gameState: gs, version: doc.version });
        let newGs;
        try { newGs = TENG.applyAction(gs, normalizeAction(action, seat), TPOOL); }
        catch (e) { return res.json({ error: '動作無效：' + e.message, gameState: gs, version: doc.version }); }
        if (newGs === gs) return res.json({ rejected: true, gameState: gs, version: doc.version });
        const nv = doc.version + 1;
        await TROOMS.updateOne({ _id: room }, { $set: { gameState: newGs, version: nv, updatedAt: Date.now(), lastActionAt: Date.now() } });
        if (newGs.phase === 'game-over' && doc.matchId) { try { await onMatchGameOver(doc, newGs); } catch (e) { console.warn('[tournament] match advance failed:', e && e.message); } }
        res.json({ gameState: newGs, version: nv });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.post('/api/tournament/reset', async (req, res) => {
      try {
        const room = String((req.body && req.body.room) || 'TOURNAMENT-TEST');
        const prev = await TROOMS.findOne({ _id: room });
        const nv = ((prev && prev.version) || 0) + 1;
        await TROOMS.updateOne({ _id: room }, { $set: { seats: [null, null], names: [null, null], decks: [null, null], gameState: null, version: nv, updatedAt: Date.now() } }, { upsert: true });
        res.json({ ok: true, version: nv, waiting: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ════════════════════════════════════════════════════════════════════
    // Phase1-B：賽事 collections + 報名（一次一 active 賽事；單敗淘汰 Bo1）
    // ════════════════════════════════════════════════════════════════════
    const TEVENTS = db.collection('tournamentEvents');
    const TREGS = db.collection('tournamentRegistrations');
    const TADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    function isTournAdmin(id) { return !!(id && id.verified && id.email && TADMIN_EMAILS.includes(String(id.email).toLowerCase())); }
    // 目前唯一進行中的賽事（status 非 finished）
    async function getActiveEvent() {
      return await TEVENTS.findOne({ status: { $ne: 'finished' } });
    }
    // v0.34：把 deckEntries 轉成可貼回「編輯我的牌組」匯入功能的文字格式
    function deckEntriesToText(entries, deckName) {
      const lines = ['// ' + (deckName || '牌組'), ''];
      if (Array.isArray(entries)) {
        for (const e of entries) {
          const c = TPOOL.get(String(e.cardId));
          if (c) lines.push(e.count + ' ' + (c.name || '') + ' ' + (c.setCode || '') + ' ' + (c.collectorNumber || ''));
          else lines.push(e.count + ' (未知卡 ' + e.cardId + ')');
        }
      }
      return lines.join('\n');
    }
    function deckCount(entries) {
      if (!Array.isArray(entries)) return -1;
      let n = 0; for (const e of entries) n += (e && e.count) || 0; return n;
    }

    // 玩家：目前賽事 + 我的報名狀態
    app.get('/api/tournament/event', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        const ev = await getActiveEvent();
        let me = { registered: false, checkedIn: false };
        if (ev) {
          const reg = await TREGS.findOne({ _id: ev._id + '__' + id.uid });
          if (reg) me = { registered: true, checkedIn: !!reg.checkedIn, deckCount: deckCount(reg.deckEntries), name: reg.name, deckName: reg.deckName || null };
        }
        let regCount = 0;
        if (ev) regCount = await TREGS.countDocuments({ eventId: ev._id });
        let myMatch = null;
        if (ev && ev.status === 'running') {
          const mm = await TMATCH.findOne({ eventId: ev._id, round: ev.currentRound, status: { $ne: 'done' }, p1uid: { $ne: null }, p2uid: { $ne: null }, $or: [{ p1uid: id.uid }, { p2uid: id.uid }] });
          if (mm) {
            const cdMin = (ev.roundCountdownMin != null ? ev.roundCountdownMin : 3);
            const nsMin = (ev.noShowMin > 0 ? ev.noShowMin : 5);
            const enterOpenAt = (ev.roundStartedAt || 0) + cdMin * 60000;
            const mySeat = (mm.p1uid === id.uid) ? 0 : 1;
            myMatch = { matchId: mm._id, round: mm.round, oppName: (mm.p1uid === id.uid ? mm.p2name : mm.p1name), enterOpenAt, noShowDeadline: enterOpenAt + nsMin * 60000, entered: !!(mm.entered && mm.entered[mySeat]), roomId: mm.roomId || null };
          }
        }
        res.json({ event: ev || null, me, regCount, isAdmin: isTournAdmin(id), myMatch, serverNow: Date.now() });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // 玩家：報名（鎖定牌組，一帳號一名額）
    app.post('/api/tournament/register', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        const ev = await getActiveEvent();
        if (!ev) return res.status(409).json({ error: '目前沒有開放報名的賽事' });
        if (ev.status !== 'registration') return res.status(409).json({ error: '目前不在報名階段' });
        const deckEntries = req.body && req.body.deckEntries;
        if (deckCount(deckEntries) !== 60) return res.status(400).json({ error: '牌組需為 60 張' });
        const nickname = String((req.body && req.body.name) || '').replace(/\s+/g, ' ').trim().slice(0, 16);
        if (!nickname) return res.status(400).json({ error: '請填寫錦標賽暱稱' });
        const regId = ev._id + '__' + id.uid;
        const existing = await TREGS.findOne({ _id: regId });
        if (existing) return res.status(409).json({ error: '你已經報名了（牌組已鎖定，整賽不可更換）' });
        // 人數上限（maxPlayers=null 表示不限）
        if (ev.maxPlayers != null) {
          const cnt = await TREGS.countDocuments({ eventId: ev._id });
          if (cnt >= ev.maxPlayers) return res.status(409).json({ error: '報名人數已滿（' + ev.maxPlayers + ' 人）' });
        }
        const deckName = String((req.body && req.body.deckName) || '').slice(0, 40);
        const cp = String((req.body && req.body.coinPref) || 'random');
        const coinPref = (cp === 'first' || cp === 'second') ? cp : 'random'; // 硬幣勝出時 先攻/後攻/隨機
        await TREGS.insertOne({ _id: regId, eventId: ev._id, uid: id.uid, email: id.email || null, name: nickname, deckName, deckEntries, coinPref, checkedIn: false, registeredAt: Date.now() });
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // 玩家：退賽（僅報名階段）
    app.post('/api/tournament/unregister', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        const ev = await getActiveEvent();
        if (!ev || ev.status !== 'registration') return res.status(409).json({ error: '目前無法退賽' });
        await TREGS.deleteOne({ _id: ev._id + '__' + id.uid });
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // 管理員：建立賽事
    app.post('/api/tournament/admin/event/create', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        if (!isTournAdmin(id)) return res.status(403).json({ error: '只有管理員可建立賽事' });
        const exist = await getActiveEvent();
        if (exist) return res.status(409).json({ error: '已有進行中的賽事，請先結束或刪除它（一次只辦一個）' });
        const b = req.body || {};
        const regOpen = Number(b.registrationOpenAt) > 0 ? Number(b.registrationOpenAt) : null;
        const regClose = Number(b.registrationCloseAt) > 0 ? Number(b.registrationCloseAt) : null;
        const initStatus = (regOpen && regOpen > Date.now()) ? 'draft' : 'registration';
        const ev = {
          _id: 'evt_' + Date.now().toString(36),
          createdAt: Date.now(),
          name: String(b.name || '錦標賽').slice(0, 60),
          format: 'single-elim', bestOf: 1,
          status: initStatus,
          registrationOpenAt: regOpen, registrationCloseAt: regClose,
          maxPlayers: (b.maxPlayers == null || b.maxPlayers === '' || Number(b.maxPlayers) <= 0) ? null : Math.min(64, Number(b.maxPlayers)),
          roundLimitMin: Number(b.roundLimitMin) > 0 ? Number(b.roundLimitMin) : 25,
          noShowMin: Number(b.noShowMin) > 0 ? Number(b.noShowMin) : 5,
          roundCountdownMin: (b.roundCountdownMin != null && b.roundCountdownMin !== '' && Number(b.roundCountdownMin) >= 0) ? Number(b.roundCountdownMin) : 3,
          checkInEnabled: b.checkInEnabled !== false,
          currentRound: 0,
          createdBy: id.email || id.uid, createdAt: Date.now(),
        };
        await TEVENTS.insertOne(ev);
        res.json({ ok: true, event: ev });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // 管理員：轉換賽事階段
    app.post('/api/tournament/admin/event/status', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        if (!isTournAdmin(id)) return res.status(403).json({ error: '只有管理員可操作' });
        const ev = await getActiveEvent();
        if (!ev) return res.status(404).json({ error: '沒有進行中的賽事' });
        const st = String((req.body && req.body.status) || '');
        const valid = ['draft', 'registration', 'checkin', 'bracket_ready', 'running', 'finished'];
        if (!valid.includes(st)) return res.status(400).json({ error: 'invalid status' });
        await TEVENTS.updateOne({ _id: ev._id }, { $set: { status: st } });
        res.json({ ok: true, status: st });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // 管理員：刪除賽事（含報名）
    app.post('/api/tournament/admin/event/delete', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        if (!isTournAdmin(id)) return res.status(403).json({ error: '只有管理員可操作' });
        const ev = await getActiveEvent();
        if (!ev) return res.status(404).json({ error: '沒有進行中的賽事' });
        await TREGS.deleteMany({ eventId: ev._id });
        await TMATCH.deleteMany({ eventId: ev._id });
        await TEVENTS.deleteOne({ _id: ev._id });
        res.json({ ok: true }); // 註：tournamentArchives 永久歸檔不刪
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // 管理員：列出目前賽事的報名名單
    app.get('/api/tournament/admin/event/registrations', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        if (!isTournAdmin(id)) return res.status(403).json({ error: '只有管理員可操作' });
        const ev = await getActiveEvent();
        if (!ev) return res.json({ event: null, regs: [] });
        const regs = await TREGS.find({ eventId: ev._id }).toArray();
        res.json({ event: ev, regs: regs.map((r) => ({ uid: r.uid, email: r.email, name: r.name, checkedIn: !!r.checkedIn, deckCount: deckCount(r.deckEntries), deckText: deckEntriesToText(r.deckEntries, r.deckName), registeredAt: r.registeredAt })) });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ── Phase1-C：大廳聊天室（全站登入者共用 room='lobby'）──
    const TCHAT = db.collection('tournamentChat');
    const TCONFIG = db.collection('tournamentConfig'); // v0.36 聊天清空標記等
    const _chatRate = new Map(); // uid -> last post ts（記憶體限速）
    app.get('/api/tournament/chat', async (req, res) => {
      try {
        const since = Number(req.query.since) || 0;
        const cfg = await TCONFIG.findOne({ _id: 'chatMeta' });
        const clearedAt = (cfg && cfg.clearedAt) || 0;
        const msgs = await TCHAT.find({ room: 'lobby', ts: { $gt: since } }).sort({ ts: 1 }).limit(80).toArray();
        res.json({ messages: msgs.map((m) => ({ id: String(m._id), name: m.name, text: m.text, ts: m.ts, uid: m.uid, sys: !!m.sys, admin: !!m.admin })), clearedAt, serverNow: Date.now() });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    app.post('/api/tournament/chat', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        const text = String((req.body && req.body.text) || '').replace(/\s+/g, ' ').trim().slice(0, 200);
        if (!text) return res.status(400).json({ error: '訊息不可空白' });
        // 只有報名者（或管理員）可發言；未報名僅能觀看
        const evc = await getActiveEvent();
        const regc = evc ? await TREGS.findOne({ eventId: evc._id, uid: id.uid }) : null;
        if (!regc && !isTournAdmin(id)) return res.status(403).json({ error: '只有報名者可以發言，未報名僅能觀看' });
        const now = Date.now();
        if (now - (_chatRate.get(id.uid) || 0) < 1200) return res.status(429).json({ error: '發言太快，請稍候' });
        _chatRate.set(id.uid, now);
        const isAdm = isTournAdmin(id);  // v0.31：管理員發言統一顯示「系統管理員」+ admin 標記(前端專屬顏色+icon)
        const chatName = isAdm ? '系統管理員' : ((regc && regc.name) ? regc.name : (id.name || '玩家'));
        await TCHAT.insertOne({ room: 'lobby', uid: id.uid, name: chatName, text, ts: now, admin: isAdm || undefined });
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    app.post('/api/tournament/admin/chat/clear', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        if (!isTournAdmin(id)) return res.status(403).json({ error: '只有管理員可操作' });
        await TCHAT.deleteMany({ room: 'lobby' });
        await TCONFIG.updateOne({ _id: 'chatMeta' }, { $set: { clearedAt: Date.now() } }, { upsert: true });
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });


    // ════════════════════════════════════════════════════════════════════
    // Phase1-D：賽程引擎（單敗淘汰 Bo1，含 bye 湊 2 次方，伺服器權威自動晉級）
    // ════════════════════════════════════════════════════════════════════
    const TMATCH = db.collection('tournamentMatches');
    const TCHAMPS = db.collection('tournamentChampions'); // v0.33 名人堂（歷屆冠軍）
    const TARCHIVE = db.collection('tournamentArchives'); // v0.35 完整賽事歸檔（永久保存，刪賽事不影響）
    function buildBracket(players, evId) {
      const N = players.length;
      const ps = players.slice();
      for (let i = ps.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = ps[i]; ps[i] = ps[j]; ps[j] = t; }
      let P = 1; while (P < N) P *= 2;
      const rounds = Math.round(Math.log2(P));
      const byes = P - N; const half = P / 2;
      const mid = (r, i) => evId + '_r' + r + '_m' + i;
      const matches = [];
      for (let r = 1; r <= rounds; r++) { const cnt = P / Math.pow(2, r); for (let i = 0; i < cnt; i++) matches.push({ _id: mid(r, i), eventId: evId, round: r, idx: i, p1uid: null, p1name: null, p2uid: null, p2name: null, roomId: null, winnerUid: null, winnerName: null, status: 'pending', bye: false }); }
      const M = {}; for (const m of matches) M[m.round + '_' + m.idx] = m;
      let pi = 0;
      for (let i = 0; i < byes; i++) { const m = M['1_' + i]; const pl = ps[pi++]; m.p1uid = pl.uid; m.p1name = pl.name; m.bye = true; m.winnerUid = pl.uid; m.winnerName = pl.name; m.status = 'done'; }
      for (let i = byes; i < half; i++) { const m = M['1_' + i]; const a = ps[pi++], b = ps[pi++]; m.p1uid = a.uid; m.p1name = a.name; m.p2uid = b.uid; m.p2name = b.name; }
      for (let i = 0; i < byes; i++) { const m = M['1_' + i]; if (m.round < rounds && m.winnerUid) { const parent = M[(m.round + 1) + '_' + Math.floor(m.idx / 2)]; const slot = (m.idx % 2 === 0) ? 'p1' : 'p2'; parent[slot + 'uid'] = m.winnerUid; parent[slot + 'name'] = m.winnerName; } }
      return { matches, rounds, P, byes };
    }
    async function postSystemChat(text) {
      try { await TCHAT.insertOne({ room: 'lobby', uid: 'system', name: '系統', text: String(text).slice(0, 200), ts: Date.now(), sys: true }); }
      catch (e) { /* best-effort 通知 */ }
    }
    async function seedEventBracket(ev) {
      const regs = await TREGS.find({ eventId: ev._id }).toArray();
      if (regs.length < 2) return { error: '至少需要 2 位報名者' };
      const players = regs.map((r) => ({ uid: r.uid, name: r.name || '玩家' }));
      const { matches, rounds } = buildBracket(players, ev._id);
      await TMATCH.deleteMany({ eventId: ev._id });
      await TMATCH.insertMany(matches);
      await TEVENTS.updateOne({ _id: ev._id }, { $set: { status: 'running', currentRound: 1, rounds, roundStartedAt: Date.now(), startedAt: Date.now() } });
      return { ok: true, rounds, players: players.length };
    }
    // 名人堂：賽事誕生冠軍時永久記錄（以 eventId 為鍵 upsert，重複完賽不重覆）
    async function recordChampion(ev, champUid, champName) {
      if (!ev || !champUid) return;
      try {
        const reg = await TREGS.findOne({ eventId: ev._id, uid: champUid });
        const playerCount = await TREGS.countDocuments({ eventId: ev._id });
        await TCHAMPS.updateOne({ _id: 'champ_' + ev._id }, { $set: {
          _id: 'champ_' + ev._id, eventId: ev._id, eventName: ev.name || '錦標賽',
          championUid: champUid, championName: champName || (reg && reg.name) || '冠軍',
          deckName: (reg && reg.deckName) || '', playerCount: playerCount || 0, finishedAt: Date.now(),
        } }, { upsert: true });
      } catch (e) { /* best-effort 名人堂 */ }
    }
    // 完整賽事歸檔（永久保存：日期/名稱/人數/玩家名/牌組內容/勝敗，供日後資料庫運用）
    async function recordTournamentArchive(ev) {
      if (!ev) return;
      try {
        const regs = await TREGS.find({ eventId: ev._id }).toArray();
        const matches = await TMATCH.find({ eventId: ev._id }).sort({ round: 1, idx: 1 }).toArray();
        await TARCHIVE.updateOne({ _id: 'arch_' + ev._id }, { $set: {
          _id: 'arch_' + ev._id, eventId: ev._id, eventName: ev.name || '錦標賽',
          createdAt: ev.createdAt || null, startedAt: ev.startedAt || ev.createdAt || null, finishedAt: Date.now(),
          format: ev.format || 'single-elim', bestOf: ev.bestOf || 1, playerCount: regs.length,
          championUid: ev.championUid || null, championName: ev.championName || null,
          players: regs.map((r) => ({ uid: r.uid, name: r.name, email: r.email || null, deckName: r.deckName || '', coinPref: r.coinPref || 'random', deckEntries: r.deckEntries || [] })),
          matches: matches.map((m) => ({ round: m.round, idx: m.idx, p1uid: m.p1uid, p1name: m.p1name, p2uid: m.p2uid, p2name: m.p2name, winnerUid: m.winnerUid, winnerName: m.winnerName, status: m.status, bye: !!m.bye, noShow: !!m.noShow, doubleNoShow: !!m.doubleNoShow, forfeit: !!m.forfeit, idleForfeit: !!m.idleForfeit, timeLimit: !!m.timeLimit, adminResolved: !!m.adminResolved })),
        } }, { upsert: true });
      } catch (e) { /* best-effort 歸檔 */ }
    }
    // 勝者填入下一輪 parent（或決賽 → 完賽）
    async function advanceOrFinish(m, winnerUid, winnerName) {
      const ev = await TEVENTS.findOne({ _id: m.eventId });
      const rounds = (ev && ev.rounds) || 99;
      if (m.round < rounds) {
        const parentId = m.eventId + '_r' + (m.round + 1) + '_m' + Math.floor(m.idx / 2);
        const slot = (m.idx % 2 === 0) ? 'p1' : 'p2';
        const set = {}; set[slot + 'uid'] = winnerUid; set[slot + 'name'] = winnerName;
        await TMATCH.updateOne({ _id: parentId }, { $set: set });
      } else {
        await TEVENTS.updateOne({ _id: m.eventId }, { $set: { status: 'finished', championUid: winnerUid, championName: winnerName } });
        await recordChampion(ev, winnerUid, winnerName);
        await recordTournamentArchive({ ...ev, championUid: winnerUid, championName: winnerName });
        await postSystemChat('🏆 賽事結束！冠軍：' + (winnerName || '?') + ' 🎉 恭喜！');
      }
      await checkRoundAdvance(m.eventId);
    }
    // 本輪全 done → currentRound++ + 設 roundStartedAt（倒數重新計時）+ 通知；新輪空位自動 bye
    async function checkRoundAdvance(eventId) {
      const ev = await TEVENTS.findOne({ _id: eventId });
      if (!ev || ev.status !== 'running') return;
      const cur = ev.currentRound; const rounds = ev.rounds || 99;
      const remaining = await TMATCH.countDocuments({ eventId, round: cur, status: { $ne: 'done' } });
      if (remaining > 0 || cur >= rounds) return;
      const next = cur + 1;
      await TEVENTS.updateOne({ _id: eventId }, { $set: { currentRound: next, roundStartedAt: Date.now() } });
      const cd = (ev.roundCountdownMin != null ? ev.roundCountdownMin : 3);
      await postSystemChat('⚔️ 第 ' + next + ' 輪即將開始！休息倒數 ' + cd + ' 分鐘，時間到才可進場。');
      await autoByeLonelyMatches(eventId, next);
    }
    // 新一輪：某場只剩一名玩家（另一格 null，因上一輪雙淘汰）→ 該玩家 bye 直接晉級
    async function autoByeLonelyMatches(eventId, round) {
      const ms = await TMATCH.find({ eventId, round, status: { $ne: 'done' } }).toArray();
      for (const m of ms) {
        const hasP1 = !!m.p1uid, hasP2 = !!m.p2uid;
        if (hasP1 !== hasP2) {
          const wUid = hasP1 ? m.p1uid : m.p2uid, wName = hasP1 ? m.p1name : m.p2name;
          await TMATCH.updateOne({ _id: m._id }, { $set: { winnerUid: wUid, winnerName: wName, status: 'done', bye: true } });
          await advanceOrFinish(m, wUid, wName);
        }
      }
    }
    // 對局結束 → 記勝者 + 晉級
    async function onMatchGameOver(doc, gs) {
      if (!doc.matchId) return;
      const m = await TMATCH.findOne({ _id: doc.matchId });
      if (!m || m.status === 'done') return;
      const wSeat = (gs.winner === 0 || gs.winner === 1) ? gs.winner : null;
      if (wSeat == null) return;
      const winnerUid = doc.seats[wSeat]; const winnerName = (doc.names && doc.names[wSeat]) || '';
      await TMATCH.updateOne({ _id: m._id }, { $set: { winnerUid, winnerName, status: 'done' } });
      await advanceOrFinish(m, winnerUid, winnerName);
    }

    // 管理員：產生賽程（報名名單 → 隨機種子 → 單敗淘汰，含 bye）
    app.post('/api/tournament/admin/bracket/seed', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        if (!isTournAdmin(id)) return res.status(403).json({ error: '只有管理員可操作' });
        const ev = await getActiveEvent();
        if (!ev) return res.status(404).json({ error: '沒有進行中的賽事' });
        const r = await seedEventBracket(ev);
        if (r.error) return res.status(400).json({ error: r.error });
        await postSystemChat('🔔 「' + ev.name + '」賽程已公布，第 1 輪開始！');
        res.json({ ok: true, rounds: r.rounds, players: r.players });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // 賽程表
    app.get('/api/tournament/bracket', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        const ev = await getActiveEvent();
        if (!ev) return res.json({ event: null, matches: [] });
        const matches = await TMATCH.find({ eventId: ev._id }).sort({ round: 1, idx: 1 }).toArray();
        res.json({
          event: { _id: ev._id, name: ev.name, status: ev.status, currentRound: ev.currentRound, rounds: ev.rounds, championName: ev.championName || null },
          matches: matches.map((m) => ({ round: m.round, idx: m.idx, p1name: m.p1name, p2name: m.p2name, winnerName: m.winnerName, winner: (m.winnerUid && m.winnerUid === m.p1uid) ? 'p1' : (m.winnerUid && m.winnerUid === m.p2uid) ? 'p2' : null, status: m.status, bye: m.bye, mine: (m.p1uid === id.uid || m.p2uid === id.uid) })),
        });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    // 觀戰：列出進行中的對戰（任何登入者可看）
    app.get('/api/tournament/spectate/list', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        const ev = await getActiveEvent();
        if (!ev) return res.json({ matches: [] });
        const ms = await TMATCH.find({ eventId: ev._id, status: 'playing', roomId: { $ne: null } }).toArray();
        res.json({ matches: ms.map((m) => ({ roomId: m.roomId, round: m.round, p1name: m.p1name, p2name: m.p2name })) });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    // 觀戰：取對局盤面（雙方手牌 redact 成卡背，防作弊；觀戰者不可操作）
    app.get('/api/tournament/spectate/state', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        const room = String(req.query.room || '');
        const doc = await TROOMS.findOne({ _id: room });
        if (!doc || !doc.gameState) return res.json({ version: -1, waiting: true });
        const gs = JSON.parse(JSON.stringify(doc.gameState));
        if (Array.isArray(gs.players)) for (const pl of gs.players) { if (Array.isArray(pl.hand)) pl.hand = pl.hand.map((c) => ({ iid: c.iid, cardId: '__HIDDEN__', damage: 0, energyAttached: [] })); }
        res.json({ gameState: gs, version: doc.version, seats: [null, null], names: doc.names, spectate: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // 進入我這輪的對戰（建/取伺服器權威房）
    app.post('/api/tournament/match/enter', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        const ev = await getActiveEvent();
        if (!ev || ev.status !== 'running') return res.json({ error: '賽事尚未開始或已結束' });
        const m = await TMATCH.findOne({ eventId: ev._id, round: ev.currentRound, status: { $ne: 'done' }, p1uid: { $ne: null }, p2uid: { $ne: null }, $or: [{ p1uid: id.uid }, { p2uid: id.uid }] });
        if (!m) return res.json({ error: '你目前沒有可進行的對戰（可能在等對手、等下一輪、或已淘汰）' });
        // 倒數休息 gate：到 enterOpenAt 才可進場
        const cdMin = (ev.roundCountdownMin != null ? ev.roundCountdownMin : 3);
        const enterOpenAt = (ev.roundStartedAt || 0) + cdMin * 60000;
        if (Date.now() < enterOpenAt) return res.json({ error: '本輪休息倒數中，時間到才可進場', enterOpenAt });
        // 標記本人已進場（未進場判負用）
        const mySeat0 = (id.uid === m.p1uid) ? 0 : 1;
        const enteredArr = Array.isArray(m.entered) ? m.entered.slice() : [false, false];
        enteredArr[mySeat0] = true;
        await TMATCH.updateOne({ _id: m._id }, { $set: { entered: enteredArr } });
        let roomId = m.roomId;
        if (!roomId) {
          roomId = 'mr_' + m._id;
          const reg1 = await TREGS.findOne({ _id: ev._id + '__' + m.p1uid });
          const reg2 = await TREGS.findOne({ _id: ev._id + '__' + m.p2uid });
          if (!reg1 || !reg2) return res.status(500).json({ error: '找不到玩家牌組' });
          let gs;
          try { gs = makeGame([reg1.deckEntries, reg2.deckEntries], [m.p1name, m.p2name], [reg1.coinPref || 'random', reg2.coinPref || 'random']); }
          catch (e) { return res.status(500).json({ error: '建立對局失敗（牌組可能含未支援卡）：' + e.message }); }
          await TROOMS.updateOne({ _id: roomId }, { $set: { _id: roomId, seats: [m.p1uid, m.p2uid], names: [m.p1name, m.p2name], decks: [reg1.deckEntries, reg2.deckEntries], gameState: gs, version: 1, matchId: m._id, eventId: ev._id, updatedAt: Date.now(), lastActionAt: Date.now(), idleForfeitMin: (ev.idleForfeitMin > 0 ? ev.idleForfeitMin : 3) } }, { upsert: true });
          await TMATCH.updateOne({ _id: m._id }, { $set: { roomId, status: 'playing', gameStartedAt: Date.now() } });
        }
        const seat = (id.uid === m.p1uid) ? 0 : 1;
        res.json({ roomId, seat });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // 玩家投降：對戰中按「投降離開」→ 立即判對手勝 + 晉級（不必等對局時限）
    app.post('/api/tournament/match/forfeit', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        const ev = await getActiveEvent();
        if (!ev || ev.status !== 'running') return res.json({ ok: true, note: '賽事未進行中' });
        const m = await TMATCH.findOne({ eventId: ev._id, status: 'playing', $or: [{ p1uid: id.uid }, { p2uid: id.uid }] });
        if (!m) return res.json({ ok: true, note: '無進行中對戰' });
        const mySeat = (id.uid === m.p1uid) ? 0 : 1;
        const winSeat = 1 - mySeat;
        const wUid = winSeat === 0 ? m.p1uid : m.p2uid, wName = winSeat === 0 ? m.p1name : m.p2name;
        const lName = mySeat === 0 ? m.p1name : m.p2name;
        await TMATCH.updateOne({ _id: m._id }, { $set: { winnerUid: wUid, winnerName: wName, status: 'done', forfeit: true } });
        if (m.roomId) { try { const room = await TROOMS.findOne({ _id: m.roomId }); if (room && room.gameState) { const og = JSON.parse(JSON.stringify(room.gameState)); og.phase = 'game-over'; og.winner = winSeat; og.winReason = (lName || '對手') + ' 投降，' + wName + ' 勝'; await TROOMS.updateOne({ _id: m.roomId }, { $set: { gameState: og, version: (room.version || 1) + 1, updatedAt: Date.now() } }); } } catch (e) { /* best-effort */ } }
        await postSystemChat('🏳 ' + (lName || '一方') + ' 投降，' + wName + ' 自動晉級。');
        await advanceOrFinish(m, wUid, wName);
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // 管理員：裁定平手場(時限到雙方獎賞相同)的勝者
    app.post('/api/tournament/admin/match/resolve', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        if (!isTournAdmin(id)) return res.status(403).json({ error: '只有管理員可裁定' });
        const matchId = String((req.body && req.body.matchId) || '');
        const winnerSeat = Number(req.body && req.body.winnerSeat);
        const m = await TMATCH.findOne({ _id: matchId });
        if (!m) return res.status(404).json({ error: '找不到該場次' });
        if (m.status === 'done') return res.status(409).json({ error: '該場次已結束' });
        if (winnerSeat !== 0 && winnerSeat !== 1) return res.status(400).json({ error: 'winnerSeat 需 0 或 1' });
        const wUid = winnerSeat === 0 ? m.p1uid : m.p2uid, wName = winnerSeat === 0 ? m.p1name : m.p2name;
        if (!wUid) return res.status(400).json({ error: '該座位無玩家，無法判勝' });
        await TMATCH.updateOne({ _id: m._id }, { $set: { winnerUid: wUid, winnerName: wName, status: 'done', adminResolved: true } });
        if (m.roomId) { try { const room = await TROOMS.findOne({ _id: m.roomId }); if (room && room.gameState) { const og = JSON.parse(JSON.stringify(room.gameState)); og.phase = 'game-over'; og.winner = winnerSeat; og.winReason = '管理員裁定：' + wName + ' 勝'; await TROOMS.updateOne({ _id: m.roomId }, { $set: { gameState: og, version: (room.version || 1) + 1, updatedAt: Date.now() } }); } } catch (e) { /* best-effort */ } }
        await postSystemChat('⚖️ 管理員裁定：' + wName + ' 勝出，自動晉級。');
        await advanceOrFinish(m, wUid, wName);
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    // 管理員：列出所有「未結束」場次（強制裁定卡死場用，不限平手）
    app.get('/api/tournament/admin/pending-matches', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        if (!isTournAdmin(id)) return res.status(403).json({ error: '只有管理員可操作' });
        const ev = await getActiveEvent();
        if (!ev) return res.json({ pending: [] });
        const ms = await TMATCH.find({ eventId: ev._id, status: { $ne: 'done' } }).sort({ round: 1, idx: 1 }).toArray();
        res.json({ pending: ms.map((m) => ({ matchId: m._id, round: m.round, idx: m.idx, p1name: m.p1name, p2name: m.p2name, hasP1: !!m.p1uid, hasP2: !!m.p2uid, status: m.status })) });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    // 管理員：重賽（從擲幣重新開始該場對局；只限尚未結束的場）
    app.post('/api/tournament/admin/match/restart', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        if (!isTournAdmin(id)) return res.status(403).json({ error: '只有管理員可操作' });
        const matchId = String((req.body && req.body.matchId) || '');
        const m = await TMATCH.findOne({ _id: matchId });
        if (!m) return res.status(404).json({ error: '找不到該場次' });
        if (m.status === 'done') return res.status(409).json({ error: '已結束的場次無法重賽（請改用強制裁定／完賽）' });
        if (!m.p1uid || !m.p2uid) return res.status(400).json({ error: '此場尚未湊齊兩位玩家，無法重賽' });
        const ev = await TEVENTS.findOne({ _id: m.eventId });
        const reg1 = await TREGS.findOne({ _id: m.eventId + '__' + m.p1uid });
        const reg2 = await TREGS.findOne({ _id: m.eventId + '__' + m.p2uid });
        if (!reg1 || !reg2) return res.status(500).json({ error: '找不到玩家牌組' });
        let gs;
        try { gs = makeGame([reg1.deckEntries, reg2.deckEntries], [m.p1name, m.p2name], [reg1.coinPref || 'random', reg2.coinPref || 'random']); }
        catch (e) { return res.status(500).json({ error: '建立對局失敗：' + e.message }); }
        const roomId = m.roomId || ('mr_' + m._id);
        const prev = await TROOMS.findOne({ _id: roomId });
        await TROOMS.updateOne({ _id: roomId }, { $set: { _id: roomId, seats: [m.p1uid, m.p2uid], names: [m.p1name, m.p2name], decks: [reg1.deckEntries, reg2.deckEntries], gameState: gs, version: ((prev && prev.version) || 0) + 1, matchId: m._id, eventId: m.eventId, updatedAt: Date.now(), lastActionAt: Date.now(), idleForfeitMin: (ev && ev.idleForfeitMin > 0 ? ev.idleForfeitMin : 3) } }, { upsert: true });
        await TMATCH.updateOne({ _id: m._id }, { $set: { roomId, status: 'playing', winnerUid: null, winnerName: null, gameStartedAt: Date.now(), entered: [true, true] }, $unset: { noShow: '', doubleNoShow: '', forfeit: '', idleForfeit: '', timeLimit: '', adminResolved: '' } });
        await postSystemChat('🔄 管理員將「' + m.p1name + ' vs ' + m.p2name + '」重新開賽（從擲幣重新開始）。');
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    // 管理員：強制完賽（賽事卡死的最終安全閥；可指定冠軍 seat，或無冠軍結束）
    app.post('/api/tournament/admin/event/force-finish', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        if (!isTournAdmin(id)) return res.status(403).json({ error: '只有管理員可操作' });
        const ev = await getActiveEvent();
        if (!ev) return res.status(404).json({ error: '沒有進行中的賽事' });
        const champUid = (req.body && req.body.championUid) || null;
        const champName = (req.body && req.body.championName) || null;
        await TEVENTS.updateOne({ _id: ev._id }, { $set: { status: 'finished', championUid: champUid, championName: champName, forceFinished: true } });
        if (champUid) await recordChampion(ev, champUid, champName);
        await recordTournamentArchive({ ...ev, championUid: champUid, championName: champName });
        await postSystemChat(champName ? ('🏆 管理員強制完賽，冠軍：' + champName) : '⚠️ 管理員強制結束賽事（無冠軍）。');
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    // 名人堂：歷屆冠軍列表（公開，登入即可看）
    app.get('/api/tournament/champions', async (req, res) => {
      try {
        const cs = await TCHAMPS.find({}).sort({ finishedAt: -1 }).limit(200).toArray();
        res.json({ champions: cs.map((c) => ({ id: c._id, eventName: c.eventName, championName: c.championName, deckName: c.deckName || '', playerCount: c.playerCount || 0, finishedAt: c.finishedAt || 0 })) });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    // 管理員：編輯名人堂紀錄（冠軍名/賽事名/牌組名）
    app.post('/api/tournament/admin/champions/update', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        if (!isTournAdmin(id)) return res.status(403).json({ error: '只有管理員可操作' });
        const cid = String((req.body && req.body.id) || '');
        if (!cid) return res.status(400).json({ error: '缺少 id' });
        const set = {};
        if (req.body && typeof req.body.championName === 'string') set.championName = req.body.championName.slice(0, 40);
        if (req.body && typeof req.body.eventName === 'string') set.eventName = req.body.eventName.slice(0, 60);
        if (req.body && typeof req.body.deckName === 'string') set.deckName = req.body.deckName.slice(0, 60);
        if (!Object.keys(set).length) return res.status(400).json({ error: '無可更新欄位' });
        const r = await TCHAMPS.updateOne({ _id: cid }, { $set: set });
        if (!r.matchedCount) return res.status(404).json({ error: '找不到該紀錄' });
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    // 管理員：刪除名人堂紀錄
    app.post('/api/tournament/admin/champions/delete', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        if (!isTournAdmin(id)) return res.status(403).json({ error: '只有管理員可操作' });
        const cid = String((req.body && req.body.id) || '');
        if (!cid) return res.status(400).json({ error: '缺少 id' });
        await TCHAMPS.deleteOne({ _id: cid });
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    // 管理員：賽事統計 — 回傳所有賽事歸檔(TARCHIVE) + 名人堂(TCHAMPS)，前端用卡片索引聚合各項數據
    app.get('/api/tournament/admin/stats', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        if (!isTournAdmin(id)) return res.status(403).json({ error: '只有管理員可操作' });
        const archives = await TARCHIVE.find({}).sort({ finishedAt: -1 }).limit(500).toArray();
        const champions = await TCHAMPS.find({}).sort({ finishedAt: -1 }).limit(500).toArray();
        res.json({
          archives: archives.map((a) => ({
            eventId: a.eventId, eventName: a.eventName || '錦標賽',
            createdAt: a.createdAt || null, startedAt: a.startedAt || a.createdAt || null, finishedAt: a.finishedAt || 0,
            playerCount: a.playerCount || 0,
            championUid: a.championUid || null, championName: a.championName || null,
            players: (a.players || []).map((p) => ({ uid: p.uid, name: p.name, email: p.email || '', deckName: p.deckName || '', coinPref: p.coinPref || 'random', deckEntries: p.deckEntries || [] })),
            matches: (a.matches || []).map((m) => ({ round: m.round, idx: m.idx, p1uid: m.p1uid, p1name: m.p1name, p2uid: m.p2uid, p2name: m.p2name, winnerUid: m.winnerUid, winnerName: m.winnerName, status: m.status, bye: !!m.bye, noShow: !!m.noShow, doubleNoShow: !!m.doubleNoShow, forfeit: !!m.forfeit, idleForfeit: !!m.idleForfeit, timeLimit: !!m.timeLimit, adminResolved: !!m.adminResolved })),
          })),
          champions: champions.map((c) => ({ eventId: c.eventId, eventName: c.eventName, championUid: c.championUid, championName: c.championName, deckName: c.deckName || '', playerCount: c.playerCount || 0, finishedAt: c.finishedAt || 0 })),
        });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    // 管理員：刪除某場賽事的歸檔（連同名人堂紀錄）— 測試賽事清除，刪除後完全不計入賽事統計
    app.post('/api/tournament/admin/stats/archive/delete', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        if (!isTournAdmin(id)) return res.status(403).json({ error: '只有管理員可操作' });
        const eventId = String((req.body && req.body.eventId) || '');
        if (!eventId) return res.status(400).json({ error: '缺少 eventId' });
        await TARCHIVE.deleteOne({ _id: 'arch_' + eventId });
        await TCHAMPS.deleteOne({ _id: 'champ_' + eventId });  // 一併移除名人堂該筆，統計與冠軍榜都不再計入
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    // 管理員：列出待裁定平手場
    app.get('/api/tournament/admin/tie-matches', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        if (!isTournAdmin(id)) return res.status(403).json({ error: '只有管理員可操作' });
        const ev = await getActiveEvent();
        if (!ev) return res.json({ ties: [] });
        const ties = await TMATCH.find({ eventId: ev._id, status: 'tie' }).toArray();
        res.json({ ties: ties.map((m) => ({ matchId: m._id, round: m.round, p1name: m.p1name, p2name: m.p2name })) });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    async function tournamentSchedulerTick() {
      try {
        const ev = await getActiveEvent();
        if (!ev) return;
        const now = Date.now();
        if (ev.status === 'draft' && ev.registrationOpenAt && now >= ev.registrationOpenAt) {
          await TEVENTS.updateOne({ _id: ev._id }, { $set: { status: 'registration' } });
          await postSystemChat('📋 「' + ev.name + '」報名開始！快來報名～');
          return;
        }
        if (ev.status === 'registration' && ev.registrationCloseAt && now >= ev.registrationCloseAt) {
          const r = await seedEventBracket(ev);
          if (r.ok) await postSystemChat('🔔 「' + ev.name + '」報名截止，賽程已公布，第 1 輪開始！');
          else if (!ev._closeWarned) { await TEVENTS.updateOne({ _id: ev._id }, { $set: { _closeWarned: true } }); await postSystemChat('⚠️ 「' + ev.name + '」報名人數不足 2 人，請管理員處理。'); }
          return;
        }
        // 未進場判負：倒數(roundCountdownMin)+遲到容許(noShowMin) 過後，本輪未進場者判負
        if (ev.status === 'running' && ev.roundStartedAt) {
          const cdMin = (ev.roundCountdownMin != null ? ev.roundCountdownMin : 3);
          const nsMin = (ev.noShowMin > 0 ? ev.noShowMin : 5);
          const deadline = ev.roundStartedAt + (cdMin + nsMin) * 60000;
          if (now > deadline) {
            const pend = await TMATCH.find({ eventId: ev._id, round: ev.currentRound, status: { $ne: 'done' }, p1uid: { $ne: null }, p2uid: { $ne: null } }).toArray();
            for (const m of pend) {
              const e0 = !!(m.entered && m.entered[0]), e1 = !!(m.entered && m.entered[1]);
              if (e0 && e1) continue; // 雙方都進場 = 對戰中，不判負
              if (e0 || e1) {
                const wUid = e0 ? m.p1uid : m.p2uid, wName = e0 ? m.p1name : m.p2name, lName = e0 ? m.p2name : m.p1name;
                await TMATCH.updateOne({ _id: m._id }, { $set: { winnerUid: wUid, winnerName: wName, status: 'done', noShow: true } });
                // v0.34：勝方已進場(卡在 setup 等待)→把房間設 game-over 讓勝方看到勝利畫面 + 返回賽事大廳
                if (m.roomId) { try { const room = await TROOMS.findOne({ _id: m.roomId }); if (room && room.gameState && room.gameState.phase !== 'game-over') { const winSeat = e0 ? 0 : 1; const og = JSON.parse(JSON.stringify(room.gameState)); og.phase = 'game-over'; og.winner = winSeat; og.winReason = (lName || '對手') + ' 未進場，判定你獲勝'; await TROOMS.updateOne({ _id: m.roomId }, { $set: { gameState: og, version: (room.version || 1) + 1, updatedAt: now } }); } } catch (e) { /* best-effort */ } }
                await postSystemChat('⏰ ' + (lName || '一方') + ' 未進場判負，' + wName + ' 自動晉級。');
                await advanceOrFinish(m, wUid, wName);
              } else {
                await TMATCH.updateOne({ _id: m._id }, { $set: { status: 'done', winnerUid: null, doubleNoShow: true } });
                await postSystemChat('⏰ 本場雙方皆未進場，雙淘汰，無人晉級。');
                await checkRoundAdvance(ev._id);
              }
            }
          }
        }
        // 閒置判負：對局中(雙方都已進場)，輪到動作的一方逾 idleForfeitMin(預設3)分鐘無動作 → 判負(含斷線)。
        if (ev.status === 'running') {
          const idleMin = (ev.idleForfeitMin > 0 ? ev.idleForfeitMin : 3);
          const playingI = await TMATCH.find({ eventId: ev._id, status: 'playing', roomId: { $ne: null } }).toArray();
          for (const m of playingI) {
            if (!(m.entered && m.entered[0] && m.entered[1])) continue; // 只判雙方都進場的對局(單方未進場由未進場判負處理)
            const room = await TROOMS.findOne({ _id: m.roomId });
            const gs = room && room.gameState;
            if (!gs || gs.phase === 'game-over') continue;
            const last = room.lastActionAt || room.updatedAt || m.gameStartedAt || now;
            if (now <= last + idleMin * 60000) continue;
            const actor = currentActorSeat(gs);
            if (actor === 0 || actor === 1) {
              const winSeat = 1 - actor;
              const wUid = winSeat === 0 ? m.p1uid : m.p2uid, wName = winSeat === 0 ? m.p1name : m.p2name, lName = actor === 0 ? m.p1name : m.p2name;
              await TMATCH.updateOne({ _id: m._id }, { $set: { winnerUid: wUid, winnerName: wName, status: 'done', idleForfeit: true } });
              try { const og = JSON.parse(JSON.stringify(gs)); og.phase = 'game-over'; og.winner = winSeat; og.winReason = (lName || '一方') + ' 閒置逾 ' + idleMin + ' 分鐘判負，' + wName + ' 勝'; await TROOMS.updateOne({ _id: m.roomId }, { $set: { gameState: og, version: (room.version || 1) + 1, updatedAt: now } }); } catch (e) { /* best-effort */ }
              await postSystemChat('⏰ ' + (lName || '一方') + ' 閒置逾 ' + idleMin + ' 分鐘判負，' + wName + ' 自動晉級。');
              await advanceOrFinish(m, wUid, wName);
            } else if (actor === -1) {
              await TMATCH.updateOne({ _id: m._id }, { $set: { status: 'done', winnerUid: null, doubleNoShow: true } });
              try { const og = JSON.parse(JSON.stringify(gs)); og.phase = 'game-over'; og.winner = null; og.winReason = '雙方皆閒置逾 ' + idleMin + ' 分鐘，雙淘汰'; await TROOMS.updateOne({ _id: m.roomId }, { $set: { gameState: og, version: (room.version || 1) + 1, updatedAt: now } }); } catch (e) { /* best-effort */ }
              await postSystemChat('⏰ 本場雙方皆閒置逾 ' + idleMin + ' 分鐘，雙淘汰，無人晉級。');
              await checkRoundAdvance(ev._id);
            }
          }
        }
        // 對局時限：每場 roundLimitMin 分(預設25)到 → 依「獎賞卡取得較多(剩餘較少)」判勝；平手交管理員裁定。
        if (ev.status === 'running') {
          const limitMin = (ev.roundLimitMin > 0 ? ev.roundLimitMin : 25);
          const playing = await TMATCH.find({ eventId: ev._id, status: 'playing', roomId: { $ne: null }, gameStartedAt: { $ne: null } }).toArray();
          for (const m of playing) {
            if (now <= m.gameStartedAt + limitMin * 60000) continue;
            const room = await TROOMS.findOne({ _id: m.roomId });
            const gs = room && room.gameState;
            if (!gs || gs.phase === 'game-over') continue;
            const p0rem = ((gs.players[0] && gs.players[0].prizes) || []).length;
            const p1rem = ((gs.players[1] && gs.players[1].prizes) || []).length;
            if (p0rem === p1rem) {
              if (m.status !== 'tie') {
                await TMATCH.updateOne({ _id: m._id }, { $set: { status: 'tie', tieAt: now } });
                try { const og = JSON.parse(JSON.stringify(gs)); og.phase = 'game-over'; og.winner = null; og.winReason = '對局時限到且雙方獎賞卡數相同，等待管理員裁定'; await TROOMS.updateOne({ _id: m.roomId }, { $set: { gameState: og, version: (room.version || 1) + 1, updatedAt: now } }); } catch (e) { /* best-effort */ }
                await postSystemChat('⏰ 「' + m.p1name + ' vs ' + m.p2name + '」對局時限(' + limitMin + '分)到且平手，請管理員後台裁定。');
              }
              continue;
            }
            const winSeat = (p0rem < p1rem) ? 0 : 1;
            const wUid = winSeat === 0 ? m.p1uid : m.p2uid, wName = winSeat === 0 ? m.p1name : m.p2name;
            await TMATCH.updateOne({ _id: m._id }, { $set: { winnerUid: wUid, winnerName: wName, status: 'done', timeLimit: true } });
            try { const og = JSON.parse(JSON.stringify(gs)); og.phase = 'game-over'; og.winner = winSeat; og.winReason = '對局時限到，依獎賞卡數判定（' + wName + ' 勝）'; await TROOMS.updateOne({ _id: m.roomId }, { $set: { gameState: og, version: (room.version || 1) + 1, updatedAt: now } }); } catch (e) { /* best-effort */ }
            await postSystemChat('⏰ 對局時限到：' + wName + ' 以獎賞卡較多勝出，自動晉級。');
            await advanceOrFinish(m, wUid, wName);
          }
        }
      } catch (e) { console.warn('[tournament] scheduler tick failed:', e && e.message); }
    }
    setInterval(tournamentSchedulerTick, 30000);
    console.log('[tournament] endpoints registered: join/state/action/reset + event/register/unregister + chat + bracket/seed/match-enter + admin event/chat');
  } catch (_te) {
    console.warn('[tournament] init failed → 錦標賽停用（正常對戰/admin 不受影響）:', _te && _te.message);
  }
})();

// === ORACLE ADMIN PATCH END ===
// 上面這行是 oracle_admin_update.sh 用的 patch 結尾標記，請勿刪除。
// install script 會 strip 從 patch 起點 marker 到本 END marker 之間的全部內容，
// 避免歷史殘留 IIFE 堆疊。（起點 marker 名字故意不寫在這裡，避免 sanity check 誤把
// 註解內的字串提及當成第 2 個真實 marker — v0.82 修。）
