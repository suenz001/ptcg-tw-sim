#!/usr/bin/env node
// 錦標賽完整紀錄 dump — 在 Oracle VM 上執行，給玩家名字/email/matchId/eventId，撈出該場完整紀錄供 debug。
//   用法: cd /opt/ptcg/api && node /tmp/dump-match-records.cjs "<玩家名字 / email / matchId / eventId>"
//   自動從 server.js 找 mongo URI(fallback localhost)，自動偵測含 tournamentMatches 的 db。
//   輸出: /tmp/ptcg_tourn_dump.json（含雙方牌組、最終盤面、逐回合 log）。
const fs = require('fs');
function loadMongo() {
  for (const c of ['/opt/ptcg/api/node_modules/mongodb','mongodb']) { try { return require(c); } catch (e) {} }
  throw new Error('找不到 mongodb 模組（請在 /opt/ptcg/api 下執行）');
}
const { MongoClient } = loadMongo();
function findUri() {
  if (process.env.MONGO_URL) return process.env.MONGO_URL;
  for (const p of ['/opt/ptcg/api/server.js','/opt/ptcg/server.js']) {
    try { const s = fs.readFileSync(p,'utf8'); const m = s.match(/mongodb(\+srv)?:\/\/[^'"`\s)]+/); if (m) return m[0]; } catch (e) {}
  }
  return 'mongodb://127.0.0.1:27017';
}
(async () => {
  const term = (process.argv[2] || '').trim();
  if (!term) { console.error('用法: node dump-match-records.cjs "<玩家名字 / email / matchId / eventId>"'); process.exit(1); }
  const uri = findUri();
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
  await client.connect();
  let db = null;
  try {
    const { databases } = await client.db().admin().listDatabases();
    for (const d of databases) {
      const cand = client.db(d.name);
      const cols = await cand.listCollections({ name: 'tournamentMatches' }).toArray();
      if (cols.length) { db = cand; break; }
    }
  } catch (e) {}
  if (!db) db = client.db();
  const TMATCH = db.collection('tournamentMatches');
  const TROOMS = db.collection('tournamentRooms');
  const TREGS  = db.collection('tournamentRegistrations');
  const TEVENTS= db.collection('tournamentEvents');
  const TARCHIVE=db.collection('tournamentArchives');
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = new RegExp(esc, 'i');
  const regHits = await TREGS.find({ $or: [ { name: rx }, { email: rx }, { uid: term } ] }).toArray();
  const regUids = [...new Set(regHits.map(r => r.uid))];
  const or = [ { _id: term }, { eventId: term }, { p1name: rx }, { p2name: rx } ];
  if (regUids.length) { or.push({ p1uid: { $in: regUids } }, { p2uid: { $in: regUids } }); }
  const matches = await TMATCH.find({ $or: or }).sort({ eventId: 1, round: 1, idx: 1 }).toArray();
  const out = { query: term, uri: uri.replace(/:\/\/[^@/]*@/, '://***@'), generatedAt: new Date().toISOString(), matchCount: matches.length, matches: [] };
  for (const m of matches) {
    const ev = await TEVENTS.findOne({ _id: m.eventId });
    const room = await TROOMS.findOne({ _id: m.roomId || ('mr_' + m._id) });
    const reg1 = await TREGS.findOne({ _id: m.eventId + '__' + m.p1uid });
    const reg2 = await TREGS.findOne({ _id: m.eventId + '__' + m.p2uid });
    const gs = (room && room.gameState) || m.finalState || null;
    out.matches.push({
      matchId: m._id, eventId: m.eventId, eventName: ev && ev.name, round: m.round, idx: m.idx,
      p1: { uid: m.p1uid, name: m.p1name, email: reg1 && reg1.email, deckName: reg1 && reg1.deckName, deck: reg1 && reg1.deckEntries },
      p2: { uid: m.p2uid, name: m.p2name, email: reg2 && reg2.email, deckName: reg2 && reg2.deckName, deck: reg2 && reg2.deckEntries },
      result: { winnerUid: m.winnerUid, winnerName: m.winnerName, status: m.status, bye: !!m.bye, forfeit: !!m.forfeit, idleForfeit: !!m.idleForfeit, timeLimit: !!m.timeLimit, noShow: !!m.noShow, adminResolved: !!m.adminResolved },
      roomId: room && room._id, version: room && room.version, gameStartedAt: m.gameStartedAt, endedAt: m.endedAt,
      finalPhase: gs && gs.phase, winner: gs && gs.winner, winReason: (gs && gs.winReason) || m.finalWinReason, turn: (gs && gs.turn) || m.finalTurn,
      logSource: (room && room.gameState) ? 'live-room' : (m.finalState ? 'match-snapshot' : 'none'),
      log: (gs && gs.log) || m.finalLog || [],
      finalState: gs,
    });
  }
  fs.writeFileSync('/tmp/ptcg_tourn_dump.json', JSON.stringify(out, null, 2), 'utf8');
  console.log('找到 ' + matches.length + ' 場符合「' + term + '」的對戰：');
  for (const m of out.matches) console.log('  - ' + (m.eventName || m.eventId) + ' R' + m.round + ' : ' + m.p1.name + ' vs ' + m.p2.name + ' -> ' + (m.result.winnerName || '(無)') + ' | log ' + (m.log || []).length + ' 行 | 來源 ' + m.logSource);
  console.log('完整紀錄已寫出: /tmp/ptcg_tourn_dump.json');
  await client.close();
})().catch(e => { console.error('ERROR:', e && e.message); process.exit(1); });
