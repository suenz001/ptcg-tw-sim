// 錦標賽戰績聚合核心（純函式，無外部相依；與 server_admin_patch.js 內嵌版邏輯一致）。
// v5.695：同分以「最近達成者」優先（各榜記最後達成 finishedAt 當 tie-break）。

export function detectCutPlacements(matches) {
  const out = { finals: new Set(), top4: new Set(), top8: new Set() };
  if (!matches || !matches.length) return out;
  const byRound = new Map(); let maxRound = 0;
  for (const m of matches) { const r = m.round || 1; if (!byRound.has(r)) byRound.set(r, []); byRound.get(r).push(m); if (r > maxRound) maxRound = r; }
  const playersIn = (r) => { const s = new Set(); for (const m of (byRound.get(r) || [])) { if (m.bye) { if (m.p1uid) s.add(m.p1uid); continue; } if (m.p1uid) s.add(m.p1uid); if (m.p2uid) s.add(m.p2uid); } return s; };
  const winnersIn = (r) => { const s = new Set(); for (const m of (byRound.get(r) || [])) if (m.winnerUid) s.add(m.winnerUid); return s; };
  const nonByeCount = (r) => (byRound.get(r) || []).filter((m) => !m.bye).length;
  const subset = (a, b) => { for (const x of a) if (!b.has(x)) return false; return true; };
  if (nonByeCount(maxRound) !== 1) return out;
  out.finals = playersIn(maxRound);
  const sr = maxRound - 1;
  if (byRound.has(sr) && nonByeCount(sr) <= 2 && subset(out.finals, winnersIn(sr))) {
    out.top4 = playersIn(sr);
    const qr = maxRound - 2;
    if (byRound.has(qr) && nonByeCount(qr) >= 3 && nonByeCount(qr) <= 4 && subset(out.top4, winnersIn(qr))) out.top8 = playersIn(qr);
  }
  return out;
}

export function aggregate(archives) {
  const acc = new Map();
  const ensure = (email) => { if (!acc.has(email)) acc.set(email, {
    email, displayName: '', lastFinishedAt: -1,
    champOfficial: 0, champOfficialAt: -1, champCommunity: 0, champCommunityAt: -1,
    wins: 0, winsAt: -1, losses: 0,
    finals: 0, finalsAt: -1, top4: 0, top4At: -1, top8: 0, top8At: -1,
    communityEntered: 0, officialEntered: 0, eventsPlayed: 0, events: [],
  }); return acc.get(email); };
  const mx = (a, b) => (a > b ? a : b);
  for (const a of archives) {
    const emailByUid = new Map();
    for (const p of (a.players || [])) if (p.email) emailByUid.set(p.uid, p.email);
    const fin = a.finishedAt || 0; const isComm = !!a.communityEvent;
    const cut = !isComm ? detectCutPlacements(a.matches || []) : { finals: new Set(), top4: new Set(), top8: new Set() };
    const evW = new Map(), evL = new Map();
    for (const m of (a.matches || [])) {
      if (m.bye) continue;
      if (m.winnerUid && m.p1uid && m.p2uid) {
        const lUid = m.winnerUid === m.p1uid ? m.p2uid : m.p1uid;
        const we = emailByUid.get(m.winnerUid), le = emailByUid.get(lUid);
        if (we) { const s = ensure(we); s.wins++; s.winsAt = mx(s.winsAt, fin); evW.set(we, (evW.get(we) || 0) + 1); }
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
      if (isChamp) { if (isComm) { s.champCommunity++; s.champCommunityAt = mx(s.champCommunityAt, fin); } else { s.champOfficial++; s.champOfficialAt = mx(s.champOfficialAt, fin); } }
      if (!isComm) {
        if (cut.finals.has(p.uid)) { s.finals++; s.finalsAt = mx(s.finalsAt, fin); }
        if (cut.top4.has(p.uid)) { s.top4++; s.top4At = mx(s.top4At, fin); }
        if (cut.top8.has(p.uid)) { s.top8++; s.top8At = mx(s.top8At, fin); }
      }
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

// 次數降序 → 同分以「最近達成時間(atKey)」降序（最近達成者優先）。
const topN = (arr, key, atKey, n = 5) => arr.filter((x) => x[key] > 0)
  .sort((a, b) => (b[key] - a[key]) || ((b[atKey] || 0) - (a[atKey] || 0)))
  .slice(0, n).map((x) => ({ displayName: x.displayName || '（未命名）', count: x[key] }));

export function buildLeaderboards(archives, communityEvents) {
  const all = [...aggregate(archives).values()];
  const hostMap = new Map();
  for (const ev of (communityEvents || [])) {
    const e = ev.createdBy; if (!e) continue;
    if (!hostMap.has(e)) hostMap.set(e, { displayName: ev.proposerName || e, count: 0, last: -1 });
    const h = hostMap.get(e); h.count++;
    if ((ev.createdAt || 0) > h.last) { h.last = ev.createdAt || 0; h.displayName = ev.proposerName || h.displayName; }
  }
  const communityHost = [...hostMap.values()]
    .sort((a, b) => (b.count - a.count) || ((b.last || 0) - (a.last || 0)))
    .slice(0, 5).map((x) => ({ displayName: x.displayName, count: x.count }));
  return {
    champions: { official: topN(all, 'champOfficial', 'champOfficialAt'), community: topN(all, 'champCommunity', 'champCommunityAt') },
    wins: topN(all, 'wins', 'winsAt'),
    top8: topN(all, 'top8', 'top8At'),
    finals: topN(all, 'finals', 'finalsAt'),
    communityHost,
  };
}

export function buildProfile(archives, email) {
  const s = aggregate(archives).get(email);
  if (!s) return null;
  return { email: s.email, displayName: s.displayName || '（未命名）', championsOfficial: s.champOfficial, championsCommunity: s.champCommunity,
    finals: s.finals, top4: s.top4, top8: s.top8, communityEntered: s.communityEntered, totalWins: s.wins, totalLosses: s.losses,
    eventsPlayed: s.eventsPlayed, events: s.events.slice().sort((a, b) => (b.date || 0) - (a.date || 0)) };
}
