// 錦標賽戰績聚合核心（純函式，無外部相依；可直接貼進 server.js）。
// 依 TARCHIVE 歸檔（players[{uid,name,email}], matches[{round,idx,p1uid,p2uid,winnerUid,status,bye}], championUid, communityEvent, format, finishedAt）。

// 從某場 matches 推導 Top Cut 名次（決賽/4強/8強）— 依「從最後一輪往回數場數 + 勝者晉級子集驗證」。
// 回傳 { finals:Set<uid>, top4:Set<uid>, top8:Set<uid> }（top4⊇finals、top8⊇top4）。
export function detectCutPlacements(matches) {
  const out = { finals: new Set(), top4: new Set(), top8: new Set() };
  if (!matches || !matches.length) return out;
  const byRound = new Map();
  let maxRound = 0;
  for (const m of matches) {
    const r = m.round || 1;
    if (!byRound.has(r)) byRound.set(r, []);
    byRound.get(r).push(m);
    if (r > maxRound) maxRound = r;
  }
  const playersIn = (r) => {
    const s = new Set();
    for (const m of (byRound.get(r) || [])) {
      if (m.bye) { if (m.p1uid) s.add(m.p1uid); continue; }
      if (m.p1uid) s.add(m.p1uid);
      if (m.p2uid) s.add(m.p2uid);
    }
    return s;
  };
  const winnersIn = (r) => {
    const s = new Set();
    for (const m of (byRound.get(r) || [])) if (m.winnerUid) s.add(m.winnerUid);
    return s;
  };
  const nonByeCount = (r) => (byRound.get(r) || []).filter((m) => !m.bye).length;
  const subset = (a, b) => { for (const x of a) if (!b.has(x)) return false; return true; };

  // 決賽：最後一輪（應為 1 場）的兩名選手
  const finalists = playersIn(maxRound);
  if (nonByeCount(maxRound) !== 1) return out; // 非單一決賽場 → 結構異常，保守不判
  out.finals = finalists;
  // 4強：maxRound-1，需恰 2 場且其勝者 = 決賽選手（真正準決賽）
  const sr = maxRound - 1;
  if (byRound.has(sr) && nonByeCount(sr) <= 2 && subset(finalists, winnersIn(sr))) {
    out.top4 = playersIn(sr);
    // 8強：maxRound-2，需 3~4 場且其勝者 ⊇ 4強選手（真正八強，非瑞士輪）
    const qr = maxRound - 2;
    if (byRound.has(qr) && nonByeCount(qr) >= 3 && nonByeCount(qr) <= 4 && subset(out.top4, winnersIn(qr))) {
      out.top8 = playersIn(qr);
    }
  }
  return out;
}

// 把多筆 archives 聚合成每個 email 的統計。
export function aggregate(archives) {
  const acc = new Map(); // email -> stat
  const ensure = (email) => {
    if (!acc.has(email)) acc.set(email, {
      email, displayName: '', lastFinishedAt: -1,
      champOfficial: 0, champCommunity: 0, wins: 0, losses: 0,
      finals: 0, top4: 0, top8: 0, communityEntered: 0, officialEntered: 0, eventsPlayed: 0,
      events: [],
    });
    return acc.get(email);
  };
  for (const a of archives) {
    const emailByUid = new Map(), nameByUid = new Map();
    for (const p of (a.players || [])) {
      if (p.email) emailByUid.set(p.uid, p.email);
      nameByUid.set(p.uid, p.name || '玩家');
    }
    const fin = a.finishedAt || 0;
    const isComm = !!a.communityEvent;
    // 名次集合（僅官方賽算 8強/4強/決賽）
    const cut = !isComm ? detectCutPlacements(a.matches || []) : { finals: new Set(), top4: new Set(), top8: new Set() };
    // 每場 per-email W/L 暫存（給 events 清單）
    const evW = new Map(), evL = new Map();
    for (const m of (a.matches || [])) {
      if (m.bye) continue;
      if (m.winnerUid && m.p1uid && m.p2uid) {
        const lUid = m.winnerUid === m.p1uid ? m.p2uid : m.p1uid;
        const we = emailByUid.get(m.winnerUid), le = emailByUid.get(lUid);
        if (we) { ensure(we).wins++; evW.set(we, (evW.get(we) || 0) + 1); }
        if (le) { ensure(le).losses++; evL.set(le, (evL.get(le) || 0) + 1); }
      } else if (m.status === 'done' && m.p1uid && m.p2uid && !m.winnerUid) {
        // 雙未進場 → 雙敗
        const a1 = emailByUid.get(m.p1uid), a2 = emailByUid.get(m.p2uid);
        if (a1) { ensure(a1).losses++; evL.set(a1, (evL.get(a1) || 0) + 1); }
        if (a2) { ensure(a2).losses++; evL.set(a2, (evL.get(a2) || 0) + 1); }
      }
    }
    const champEmail = a.championUid ? emailByUid.get(a.championUid) : null;
    for (const p of (a.players || [])) {
      if (!p.email) continue;
      const s = ensure(p.email);
      s.eventsPlayed++;
      if (isComm) s.communityEntered++; else s.officialEntered++;
      if (fin > s.lastFinishedAt) { s.lastFinishedAt = fin; s.displayName = p.name || s.displayName; }
      const isChamp = champEmail === p.email;
      if (isChamp) { if (isComm) s.champCommunity++; else s.champOfficial++; }
      if (!isComm) {
        if (cut.finals.has(p.uid)) s.finals++;
        if (cut.top4.has(p.uid)) s.top4++;
        if (cut.top8.has(p.uid)) s.top8++;
      }
      // result 標籤
      let result = '';
      if (isChamp) result = '冠軍';
      else if (!isComm && cut.finals.has(p.uid)) result = '亞軍';
      else if (!isComm && cut.top4.has(p.uid)) result = '4強';
      else if (!isComm && cut.top8.has(p.uid)) result = '8強';
      s.events.push({
        eventName: a.eventName || '錦標賽', date: fin, format: a.format || 'single-elim',
        communityEvent: isComm, wins: evW.get(p.email) || 0, losses: evL.get(p.email) || 0, result,
      });
    }
  }
  return acc;
}

const topN = (arr, key, n = 5) => arr.filter((x) => x[key] > 0).sort((a, b) => b[key] - a[key]).slice(0, n)
  .map((x) => ({ displayName: x.displayName || '（未命名）', count: x[key] }));

export function buildLeaderboards(archives, communityEvents) {
  const all = [...aggregate(archives).values()];
  // 社群賽主辦榜：依 createdBy(email) 統計 TEVENTS{createdByPlayer:true}
  const hostMap = new Map();
  for (const ev of (communityEvents || [])) {
    const e = ev.createdBy; if (!e) continue;
    if (!hostMap.has(e)) hostMap.set(e, { displayName: ev.proposerName || e, count: 0, last: -1 });
    const h = hostMap.get(e); h.count++;
    if ((ev.createdAt || 0) > h.last) { h.last = ev.createdAt || 0; h.displayName = ev.proposerName || h.displayName; }
  }
  const communityHost = [...hostMap.values()].sort((a, b) => b.count - a.count).slice(0, 5)
    .map((x) => ({ displayName: x.displayName, count: x.count }));
  return {
    champions: {
      official: topN(all, 'champOfficial'),
      community: topN(all, 'champCommunity'),
    },
    wins: topN(all, 'wins'),
    top8: topN(all, 'top8'),
    finals: topN(all, 'finals'),
    communityHost,
  };
}

export function buildProfile(archives, email) {
  const s = aggregate(archives).get(email);
  if (!s) return null;
  return {
    email: s.email, displayName: s.displayName || '（未命名）',
    championsOfficial: s.champOfficial, championsCommunity: s.champCommunity,
    finals: s.finals, top4: s.top4, top8: s.top8,
    communityEntered: s.communityEntered, totalWins: s.wins, totalLosses: s.losses,
    eventsPlayed: s.eventsPlayed,
    events: s.events.slice().sort((a, b) => (b.date || 0) - (a.date || 0)),
  };
}
