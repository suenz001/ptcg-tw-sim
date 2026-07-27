#!/usr/bin/env node
/**
 * 【批次 0：資料盤點】某個牌組原型，到底有多少「可學習的錦標賽對局」？
 *
 * 用途：在動手做「從回放學打法、強化本機對戰 AI」之前，先用半天把
 *   「資料到底夠不夠」變成攤在桌上的數字 —— 這是整個構想唯一的分岔點。
 *   資料豐富 → 走完整 pipeline（統計 → 模型讀 → 產出打法表）；
 *   資料貧乏 → 玩家資料降級成驗證集，改以卡面推理為主。
 *   兩條路都能交付，但先知道走哪條，才不會做完才發現樣本只有 5 場。
 *
 * ⚠這支腳本**只輸出統計數字，不輸出任何對局內容**。原始資料很大（每個半回合
 *   都是一份完整 GameState），盤點階段不需要、也不該整包拉下來。
 *
 * 用法（在 Oracle VM 上）：
 *   cd /opt/ptcg/api && node /tmp/survey-archetype-replays.cjs "N的索羅亞克ex"
 *   可多個關鍵卡（全部都要含）：... "N的索羅亞克ex" "N的索羅亞"
 * 輸出：/tmp/ptcg_archetype_survey.json
 */
const fs = require('fs');
function loadMongo() {
  for (const c of ['/opt/ptcg/api/node_modules/mongodb', 'mongodb']) { try { return require(c); } catch (e) {} }
  throw new Error('找不到 mongodb 模組（請在 /opt/ptcg/api 下執行）');
}
const { MongoClient } = loadMongo();

// ── mongo URI 探測：與 dump-match-records.cjs 完全同一套（已驗證可用）──────
function readEnvFile(p) {
  try {
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/=\s*["']?(mongodb(?:\+srv)?:\/\/[^"'\s]+)/i);
      if (m) return m[1];
    }
  } catch (e) {}
  return null;
}
function fromProcEnviron() {
  try {
    for (const pid of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(pid)) continue;
      let cmd = '';
      try { cmd = fs.readFileSync('/proc/' + pid + '/cmdline', 'utf8'); } catch (e) { continue; }
      if (!/server\.js|ptcg/.test(cmd)) continue;
      let env = '';
      try { env = fs.readFileSync('/proc/' + pid + '/environ', 'utf8'); } catch (e) { continue; }
      for (const v of env.split('\0')) {
        const m = v.match(/^[^=]*=(mongodb(?:\+srv)?:\/\/[^\s]+)$/);
        if (m) return m[1];
      }
    }
  } catch (e) {}
  return null;
}
function findUri() {
  if (process.env.MONGO_URL) return process.env.MONGO_URL;
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI;
  const fp = fromProcEnviron(); if (fp) return fp;
  for (const p of ['/opt/ptcg/api/.env', '/opt/ptcg/.env', '/opt/ptcg/api/.env.production', '/opt/ptcg/api/.env.local']) {
    const u = readEnvFile(p); if (u) return u;
  }
  for (const p of ['/opt/ptcg/api/server.js', '/opt/ptcg/server.js']) {
    try { const s = fs.readFileSync(p, 'utf8'); const m = s.match(/mongodb(\+srv)?:\/\/[^'"`\s)]+/); if (m) return m[0]; } catch (e) {}
  }
  return 'mongodb://127.0.0.1:27017';
}
function dbNameFromUri(u) {
  try { const m = u.match(/mongodb(?:\+srv)?:\/\/[^/]+\/([^?]+)/); return m && m[1] ? decodeURIComponent(m[1]) : null; } catch (e) { return null; }
}

/** cardId → 卡名。⚠牌組存的是 cardId，我們要比對的是卡名，一定要這層對照。 */
function loadCardNames() {
  for (const p of ['/opt/ptcg/api/tournament/tournament-pool.json', './tournament/tournament-pool.json']) {
    try {
      const pool = JSON.parse(fs.readFileSync(p, 'utf8'));
      const m = new Map();
      for (const k of Object.keys(pool || {})) if (pool[k] && pool[k].name) m.set(String(k), String(pool[k].name));
      if (m.size) return m;
    } catch (e) {}
  }
  throw new Error('找不到 tournament-pool.json（卡名對照）');
}

(async () => {
  const keyCards = process.argv.slice(2).map((s) => String(s).trim()).filter(Boolean);
  if (!keyCards.length) {
    console.error('用法: node survey-archetype-replays.cjs "<關鍵卡名>" ["<關鍵卡名2>" ...]（全部都要含才算命中）');
    process.exit(1);
  }
  const nameMap = loadCardNames();
  const uri = findUri();
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
  await client.connect();

  let db = null;
  try {
    const { databases } = await client.db().admin().listDatabases();
    for (const d of databases) {
      const cols = await client.db(d.name).listCollections({ name: 'tournamentMatches' }).toArray();
      if (cols.length) { db = client.db(d.name); break; }
    }
  } catch (e) {}
  if (!db) { const dn = dbNameFromUri(uri); db = dn ? client.db(dn) : client.db(); }

  const TARCHIVE = db.collection('tournamentArchives');
  const TREPLAY = db.collection('tournamentReplayTurns');

  // 回放的 TTL 是 90 天 —— 超過就過期了，掃更早的歸檔只會得到「有對局但沒有過程」。
  const REPLAY_TTL_DAYS = 90;
  const since = Date.now() - REPLAY_TTL_DAYS * 86400000;

  const archives = await TARCHIVE.find({}).sort({ finishedAt: -1 }).limit(200).toArray();

  /** 這副牌是否含全部關鍵卡。deckEntries 形如 [{cardId,count}]。 */
  function deckHitsArchetype(entries) {
    if (!Array.isArray(entries) || !entries.length) return false;
    const names = new Set();
    for (const e of entries) {
      if (!e || e.cardId == null) continue;
      const n = nameMap.get(String(e.cardId));
      if (n) names.add(n);
    }
    return keyCards.every((k) => names.has(k));
  }

  const perPlayer = new Map();   // uid → { name, wins, losses, matchIds[] }
  let eventsScanned = 0, eventsInTTL = 0, matchesHit = 0;
  const hitMatchIds = [];
  const oppArchetypeCount = new Map();   // 對手主力寶可夢粗略分佈（判斷對手強度/多樣性用）

  for (const a of archives) {
    eventsScanned++;
    const inTTL = (a.finishedAt || 0) >= since;
    if (inTTL) eventsInTTL++;

    const deckByUid = new Map(), nameByUid = new Map();
    for (const p of (a.players || [])) {
      if (!p || !p.uid) continue;
      deckByUid.set(String(p.uid), p.deckEntries || []);
      nameByUid.set(String(p.uid), p.name || '');
    }
    for (const m of (a.matches || [])) {
      if (!m || m.bye || !m.winnerUid) continue;
      for (const uid of [m.p1uid, m.p2uid]) {
        if (!uid) continue;
        if (!deckHitsArchetype(deckByUid.get(String(uid)))) continue;
        matchesHit++;
        const matchId = a.eventId + '_r' + m.round + '_m' + m.idx;
        if (inTTL) hitMatchIds.push(matchId);
        const rec = perPlayer.get(String(uid))
          || { name: nameByUid.get(String(uid)) || '', wins: 0, losses: 0, inTTL: 0, matchIds: [] };
        if (String(m.winnerUid) === String(uid)) rec.wins++; else rec.losses++;
        if (inTTL) { rec.inTTL++; rec.matchIds.push(matchId); }
        rec.name = rec.name || nameByUid.get(String(uid)) || '';
        perPlayer.set(String(uid), rec);

        // 對手側主力（粗略：對手牌裡的 ex 寶可夢卡名），用來看「對手是不是也都在打正經牌」
        const oppUid = String(uid) === String(m.p1uid) ? m.p2uid : m.p1uid;
        for (const e of (deckByUid.get(String(oppUid)) || [])) {
          const n = e && e.cardId != null ? nameMap.get(String(e.cardId)) : null;
          if (n && /ex$/.test(n)) oppArchetypeCount.set(n, (oppArchetypeCount.get(n) || 0) + 1);
        }
      }
    }
  }

  // ⭐真正決定成敗的數字：這些命中的對局裡，**有幾場真的還留著回放快照**。
  //   歸檔可以很老，但 tournamentReplayTurns 有 90 天 TTL，過期就沒有過程可學了。
  let withReplay = 0, snapshotTotal = 0;
  const replayDetail = [];
  for (const mid of hitMatchIds) {
    const n = await TREPLAY.countDocuments({ matchId: mid });
    if (n > 0) { withReplay++; snapshotTotal += n; replayDetail.push({ matchId: mid, snapshots: n }); }
  }

  const players = [...perPlayer.entries()]
    .map(([uid, r]) => ({
      uid, name: r.name, matches: r.wins + r.losses, wins: r.wins, losses: r.losses,
      winRate: (r.wins + r.losses) > 0 ? +(r.wins / (r.wins + r.losses)).toFixed(3) : null,
      matchesInTTL: r.inTTL,
    }))
    .sort((a, b) => b.matches - a.matches);

  // 高勝率門檻（Fable 建議）：≥6 場且勝率 ≥60%；無人達標則退為前 2 名、≥4 場且 ≥55%。
  let qualified = players.filter((p) => p.matches >= 6 && p.winRate !== null && p.winRate >= 0.6);
  let thresholdUsed = 'matches>=6 且 winRate>=0.60';
  if (!qualified.length) {
    qualified = players.filter((p) => p.matches >= 4 && p.winRate !== null && p.winRate >= 0.55).slice(0, 2);
    thresholdUsed = '（放寬）matches>=4 且 winRate>=0.55，取前 2 名';
  }
  const learnableMatches = qualified.reduce((s, p) => s + p.matchesInTTL, 0);

  const out = {
    keyCards,
    generatedAt: new Date().toISOString(),
    replayTtlDays: REPLAY_TTL_DAYS,
    scanned: { archivesScanned: eventsScanned, archivesWithinTtl: eventsInTTL },
    archetype: { matchesTotal: matchesHit, matchesWithinTtl: hitMatchIds.length, players: players.length },
    replay: { matchesWithSnapshots: withReplay, snapshotDocs: snapshotTotal },
    players,
    highWinRate: { thresholdUsed, qualified, learnableMatchesWithReplay: learnableMatches },
    opponentTopEx: [...oppArchetypeCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)
      .map(([name, n]) => ({ name, decks: n })),
    // 判準直接印在報告裡，免得看完數字還要回頭翻文件
    verdict: learnableMatches >= 10
      ? 'GO：可學習對局 >= 10 場，走完整 pipeline（統計 → 模型讀 → 產出打法表）'
      : 'FALLBACK：可學習對局 < 10 場，玩家資料降級為驗證集，改以卡面推理為主產出打法表',
  };

  const P = '/tmp/ptcg_archetype_survey.json';
  fs.writeFileSync(P, JSON.stringify(out, null, 2), 'utf8');

  console.log('══════ 牌組原型資料盤點 ══════');
  console.log('關鍵卡：', keyCards.join(' + '));
  console.log(`掃描歸檔賽事 ${eventsScanned} 場（其中 ${eventsInTTL} 場在 ${REPLAY_TTL_DAYS} 天回放保留期內）`);
  console.log(`命中此原型的對局：${matchesHit} 場（保留期內 ${hitMatchIds.length} 場）`);
  console.log(`⭐其中真的還留著回放快照的：${withReplay} 場，共 ${snapshotTotal} 格半回合快照`);
  console.log(`使用此原型的玩家：${players.length} 位`);
  for (const p of players.slice(0, 12)) {
    console.log(`   ${p.name || p.uid}  ${p.matches} 場  ${p.wins}勝${p.losses}負  勝率 ${p.winRate === null ? '-' : (p.winRate * 100).toFixed(1) + '%'}  (保留期內 ${p.matchesInTTL})`);
  }
  console.log(`高勝率門檻：${thresholdUsed} → 入選 ${qualified.length} 位，可學習對局 ${learnableMatches} 場`);
  console.log('判定：' + out.verdict);
  console.log('明細已寫入 ' + P);
  await client.close();
})().catch((e) => { console.error('盤點失敗:', e && e.message ? e.message : e); process.exit(1); });
