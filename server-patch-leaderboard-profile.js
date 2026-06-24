/* ════════════════════════════════════════════════════════════════════════════
 * v0.66 玩家戰績：排行榜 /leaderboard + 個人資料 /profile
 *
 * 【如何套用】
 *   1. 打開主機上的 /opt/ptcg/api/server.js
 *   2. 找到「app.get('/api/tournament/champion-bracket', ...)」這個端點的結尾 `});`
 *      （約在 v0.61 註解附近）
 *   3. 把本檔「===== PASTE START =====」到「===== PASTE END =====」之間的整段，
 *      貼在那個 `});` 之後（與其他 app.get(...) 同一層，務必在 TARCHIVE/TEVENTS/
 *      tournIdentity 都已定義的同一個 closure 內 —— champion-bracket 旁邊就對了）。
 *   4. 存檔後重啟：  pm2 restart ptcg-api
 *   5. nginx 不需改（同 /api/tournament 路徑，既有代理已涵蓋）。
 *
 * 【設計重點】
 *   - 全部依 email 聚合，顯示玩家「最後一場賽事所用暱稱」，不外露 email。
 *   - /leaderboard 掃 TARCHIVE 用 projection 排除 players.deckEntries（降流量；主機接近 Free Tier）。
 *   - 8強/4強/決賽：僅官方賽(communityEvent=false)；用「從最後一輪往回數場數(1=決賽/2=4強/4=8強)
 *     + 勝者晉級子集驗證」判定，避免把瑞士輪誤判為 Top Cut。
 *   - 社群賽主辦榜：掃 TEVENTS{createdByPlayer:true} 依 createdBy(email) 統計（含歷史、不需改歸檔）。
 *   - 邏輯已用合成資料 + 真實 40 人賽輪次結構單元測試（scripts/test-tournament-stats，11/11）。
 * ════════════════════════════════════════════════════════════════════════════ */

// ===== PASTE START =====

    // ── v0.66 玩家戰績聚合 helpers ──────────────────────────────────────────
    // 從某場 matches 推導 Top Cut 名次（決賽/4強/8強）。回傳 { finals, top4, top8 }（皆 Set<uid>）。
    function _detectCutPlacements(matches) {
      const out = { finals: new Set(), top4: new Set(), top8: new Set() };
      if (!matches || !matches.length) return out;
      const byRound = new Map(); let maxRound = 0;
      for (const m of matches) { const r = m.round || 1; if (!byRound.has(r)) byRound.set(r, []); byRound.get(r).push(m); if (r > maxRound) maxRound = r; }
      const playersIn = (r) => { const s = new Set(); for (const m of (byRound.get(r) || [])) { if (m.bye) { if (m.p1uid) s.add(m.p1uid); continue; } if (m.p1uid) s.add(m.p1uid); if (m.p2uid) s.add(m.p2uid); } return s; };
      const winnersIn = (r) => { const s = new Set(); for (const m of (byRound.get(r) || [])) if (m.winnerUid) s.add(m.winnerUid); return s; };
      const nonByeCount = (r) => (byRound.get(r) || []).filter((m) => !m.bye).length;
      const subset = (a, b) => { for (const x of a) if (!b.has(x)) return false; return true; };
      if (nonByeCount(maxRound) !== 1) return out;             // 非單一決賽場 → 結構異常，保守不判
      out.finals = playersIn(maxRound);
      const sr = maxRound - 1;
      if (byRound.has(sr) && nonByeCount(sr) <= 2 && subset(out.finals, winnersIn(sr))) {
        out.top4 = playersIn(sr);
        const qr = maxRound - 2;
        if (byRound.has(qr) && nonByeCount(qr) >= 3 && nonByeCount(qr) <= 4 && subset(out.top4, winnersIn(qr))) {
          out.top8 = playersIn(qr);
        }
      }
      return out;
    }
    // 把多筆 archives 聚合成 Map<email, stat>。
    function _aggregateArchives(archives) {
      const acc = new Map();
      const ensure = (email) => { if (!acc.has(email)) acc.set(email, { email, displayName: '', lastFinishedAt: -1, champOfficial: 0, champCommunity: 0, wins: 0, losses: 0, finals: 0, top4: 0, top8: 0, communityEntered: 0, officialEntered: 0, eventsPlayed: 0, events: [] }); return acc.get(email); };
      for (const a of archives) {
        const emailByUid = new Map();
        for (const p of (a.players || [])) if (p.email) emailByUid.set(p.uid, p.email);
        const fin = a.finishedAt || 0; const isComm = !!a.communityEvent;
        const cut = !isComm ? _detectCutPlacements(a.matches || []) : { finals: new Set(), top4: new Set(), top8: new Set() };
        const evW = new Map(), evL = new Map();
        for (const m of (a.matches || [])) {
          if (m.bye) continue;
          if (m.winnerUid && m.p1uid && m.p2uid) {
            const lUid = m.winnerUid === m.p1uid ? m.p2uid : m.p1uid;
            const we = emailByUid.get(m.winnerUid), le = emailByUid.get(lUid);
            if (we) { ensure(we).wins++; evW.set(we, (evW.get(we) || 0) + 1); }
            if (le) { ensure(le).losses++; evL.set(le, (evL.get(le) || 0) + 1); }
          } else if (m.status === 'done' && m.p1uid && m.p2uid && !m.winnerUid) {
            const a1 = emailByUid.get(m.p1uid), a2 = emailByUid.get(m.p2uid);
            if (a1) { ensure(a1).losses++; evL.set(a1, (evL.get(a1) || 0) + 1); }
            if (a2) { ensure(a2).losses++; evL.set(a2, (evL.get(a2) || 0) + 1); }
          }
        }
        const champEmail = a.championUid ? emailByUid.get(a.championUid) : null;
        for (const p of (a.players || [])) {
          if (!p.email) continue;
          const s = ensure(p.email);
          s.eventsPlayed++; if (isComm) s.communityEntered++; else s.officialEntered++;
          if (fin > s.lastFinishedAt) { s.lastFinishedAt = fin; s.displayName = p.name || s.displayName; }
          const isChamp = champEmail === p.email;
          if (isChamp) { if (isComm) s.champCommunity++; else s.champOfficial++; }
          if (!isComm) { if (cut.finals.has(p.uid)) s.finals++; if (cut.top4.has(p.uid)) s.top4++; if (cut.top8.has(p.uid)) s.top8++; }
          let result = '';
          if (isChamp) result = '冠軍';
          else if (!isComm && cut.finals.has(p.uid)) result = '亞軍';
          else if (!isComm && cut.top4.has(p.uid)) result = '4強';
          else if (!isComm && cut.top8.has(p.uid)) result = '8強';
          s.events.push({ eventName: a.eventName || '錦標賽', date: fin, format: a.format || 'single-elim', communityEvent: isComm, wins: evW.get(p.email) || 0, losses: evL.get(p.email) || 0, result });
        }
      }
      return acc;
    }

    // ── v0.66 公開：排行榜（各榜前 5；依 email 聚合、顯示最後暱稱、不回 email）──
    app.get('/api/tournament/leaderboard', async (req, res) => {
      try {
        const archives = await TARCHIVE.find({}, { projection: { 'players.deckEntries': 0 } }).toArray();
        const all = [..._aggregateArchives(archives).values()];
        const topN = (key) => all.filter((x) => x[key] > 0).sort((a, b) => b[key] - a[key]).slice(0, 5).map((x) => ({ displayName: x.displayName || '（未命名）', count: x[key] }));
        const commEvents = await TEVENTS.find({ createdByPlayer: true }).toArray();
        const hostMap = new Map();
        for (const ev of commEvents) { const e = ev.createdBy; if (!e) continue; if (!hostMap.has(e)) hostMap.set(e, { displayName: ev.proposerName || e, count: 0, last: -1 }); const h = hostMap.get(e); h.count++; if ((ev.createdAt || 0) > h.last) { h.last = ev.createdAt || 0; h.displayName = ev.proposerName || h.displayName; } }
        const communityHost = [...hostMap.values()].sort((a, b) => b.count - a.count).slice(0, 5).map((x) => ({ displayName: x.displayName, count: x.count }));
        res.json({ champions: { official: topN('champOfficial'), community: topN('champCommunity') }, wins: topN('wins'), top8: topN('top8'), finals: topN('finals'), communityHost });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ── v0.66 個人資料（需登入；只回本人 email 的聚合戰績）──
    app.get('/api/tournament/profile', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        if (!id.email) return res.status(403).json({ error: '需要 email 帳號才能查看個人戰績' });
        const archives = await TARCHIVE.find({ 'players.email': id.email }, { projection: { 'players.deckEntries': 0 } }).toArray();
        const s = _aggregateArchives(archives).get(id.email);
        if (!s) return res.json({ email: id.email, displayName: id.name || String(id.email).split('@')[0], championsOfficial: 0, championsCommunity: 0, finals: 0, top4: 0, top8: 0, communityEntered: 0, totalWins: 0, totalLosses: 0, eventsPlayed: 0, events: [] });
        res.json({ email: s.email, displayName: s.displayName || '（未命名）', championsOfficial: s.champOfficial, championsCommunity: s.champCommunity, finals: s.finals, top4: s.top4, top8: s.top8, communityEntered: s.communityEntered, totalWins: s.wins, totalLosses: s.losses, eventsPlayed: s.eventsPlayed, events: s.events.slice().sort((a, b) => (b.date || 0) - (a.date || 0)) });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

// ===== PASTE END =====
