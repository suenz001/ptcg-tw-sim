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
 * 【批次 1：--extract】把入選玩家的對局還原成「打法統計」。
 *   ⭐關鍵發現：GameState 裡本來就存著 **turnActionsLog**（v5.055 為了「對手回合動作面板」
 *     而加的），欄位是 { turn, actions: ActionRecord[] }，ActionRecord 有
 *     type(play_hand/attack/retreat/use_ability/discard) + cardId + extra(招式名/特性名)，
 *     而且是**按執行順序**存的。快照又是每個半回合存一格 →
 *     **整場的動作序列可以完整拼回來，時序完全沒有丟失**。
 *     （原先以為半回合快照只能看到「淨效果」、學不到節奏，是低估了這個欄位。）
 *   三個資料來源互補：
 *     動作序列（做了什麼、什麼順序）＋ 盤面快照（打給誰、選了什麼）＋ finalLog（複製了哪招）。
 *
 * ⚠**上帝視角裁切**：快照存了雙方完整手牌與牌庫，分析端看得到玩家當下看不到的東西。
 *   不設防的話會「學」到「牌庫頂是能量時他就不用交易」這種巧合，固化進去等於植入作弊知識。
 *   → 本腳本輸出**一律不含任何手牌內容、牌庫內容、對手隱藏區**，手牌只出現張數。
 *
 * 用法（在 Oracle VM 上）：
 *   cd /opt/ptcg/api && node /tmp/survey-archetype-replays.cjs            # 批次 0：盤點
 *   cd /opt/ptcg/api && node /tmp/survey-archetype-replays.cjs --extract  # 批次 1：抽打法
 *   關鍵卡可覆寫：... --extract "N的索羅亞克ex" "N的索羅亞"
 * 輸出：/tmp/ptcg_archetype_survey.json（盤點）/ /tmp/ptcg_archetype_playstyle.json（打法）
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
  // ⚠預設值刻意寫在這裡（UTF-8 原始碼），而**不是**由 .bat 傳中文參數進來 ——
  //   中文經 cmd → ssh → bash 三層轉碼很容易變亂碼，卡名一旦亂碼就會「一場都比不中」，
  //   而且看起來就像「這套牌沒人在打」，完全不像編碼問題。
  const DEFAULT_KEY_CARDS = ['N的索羅亞克ex'];
  const raw = process.argv.slice(2).map((s) => String(s).trim()).filter(Boolean);
  const EXTRACT = raw.includes('--extract');
  const argv = raw.filter((x) => !x.startsWith('--'));
  const keyCards = argv.length ? argv : DEFAULT_KEY_CARDS;
  if (!argv.length) console.log('（未指定關鍵卡，使用內建預設：' + DEFAULT_KEY_CARDS.join(' + ') + '）');
  console.log('模式：' + (EXTRACT ? '批次 1 抽打法（--extract）' : '批次 0 盤點'));
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
      matchesInTTL: r.inTTL, matchIds: r.matchIds,
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


  // ══ 批次 1：把入選玩家的對局還原成「打法統計」════════════════════════════
  if (EXTRACT) {
    const TMATCH = db.collection('tournamentMatches');
    const TROOMS = db.collection('tournamentRooms');
    if (!qualified.length) {
      console.error('沒有任何入選玩家，無法抽打法。請先跑批次 0 確認門檻。');
      await client.close(); process.exit(1);
    }

    /** archive 快取：matchId 前綴就是 eventId，用來查該場雙方是誰。 */
    const archiveById = new Map();
    for (const a of archives) archiveById.set(String(a.eventId), a);

    // ── 統計桶 ──────────────────────────────────────────────────────────
    const inc = (m, k, n) => m.set(k, (m.get(k) || 0) + (n === undefined ? 1 : n));
    const stat = {
      setupActive: new Map(),        // 開局戰鬥位放誰
      benchNPokemon: new Map(),      // 備戰鋪過哪些「N的」寶可夢（每場每種算一次）
      benchByTurn: new Map(),        // '卡名@回合' → 次數（第幾回合鋪上去的）
      darkCardCopied: new Map(),     // 暗黑底牌複製了哪個招式
      attackUsed: new Map(),         // 用過哪些招式
      firstAttackTurn: new Map(),    // 第幾回合打出第一次攻擊
      tradePerTurn: new Map(),       // 一個回合用幾次「交易」
      tradeDiscarded: new Map(),     // 交易丟了什麼
      actionKinds: new Map(),        // 動作類型分佈
      playedCards: new Map(),        // 打出過的卡（play_hand）
      turnsAnalysed: 0,
    };
    const samples = [];
    let matchesAnalysed = 0, matchesSkipped = 0;
    // ⚠診斷用：分清「finalLog 根本沒讀到」與「讀到了但措辭對不上」。
    let logLinesRead = 0, logLinesMatched = 0, matchesWithLog = 0;

    for (const q of qualified) {
      for (const matchId of (q.matchIds || [])) {
        const snaps = await TREPLAY.find({ matchId }).sort({ logLen: 1, turn: 1 }).toArray();
        if (!snaps.length) { matchesSkipped++; continue; }

        // 這場我方坐哪一側：用快照裡的 players[].name 對照入選玩家暱稱。
        // ⚠不能只靠 seat 順序 —— p1/p2 與 gameState.players[0/1] 的對應不保證，
        //   而 archive 只有 uid、快照只有 name，name 是唯一能接起來的欄位。
        const s0 = snaps[0].state || {};
        const ps = s0.players || [];
        let mySeat = -1;
        for (let i = 0; i < ps.length; i++) if (ps[i] && ps[i].name === q.name) mySeat = i;
        if (mySeat < 0) { matchesSkipped++; continue; }   // 對不上就跳過，不猜

        // finalLog：優先 TMATCH.finalLog，投降/判負場補讀房間（與 /replay 端點同一套 fallback）
        let finalLog = [];
        try {
          const m = await TMATCH.findOne({ _id: matchId }, { projection: { finalLog: 1 } });
          if (m && Array.isArray(m.finalLog)) finalLog = m.finalLog;
          if (!finalLog.length) {
            const room = await TROOMS.findOne({ _id: 'mr_' + matchId }, { projection: { 'gameState.log': 1 } });
            if (room && room.gameState && Array.isArray(room.gameState.log)) finalLog = room.gameState.log;
          }
        } catch (e) { /* 沒有 log 就只用動作序列 */ }
        if (finalLog.length) matchesWithLog++;

        matchesAnalysed++;
        const sampleTurns = [];

        // ── 動作序列：turnActionsLog 是「按執行順序」存的，用 (seat,turn) 去重跨快照拼回全場 ──
        const seen = new Set();
        for (const sn of snaps) {
          const st = sn.state || {};
          const me = (st.players || [])[mySeat];
          if (!me) continue;
          stat.turnsAnalysed++;

          // 開局戰鬥位（第一格快照）
          if (sn === snaps[0] && me.active) {
            const n = nameMap.get(String(me.active.cardId));
            if (n) inc(stat.setupActive, n);
          }
          // 備戰的「N的」寶可夢（每格看一次，之後以 Set 去重成 per-match）
          for (const b of (me.bench || [])) {
            const n = b && b.cardId != null ? nameMap.get(String(b.cardId)) : null;
            if (n && n.startsWith('N的')) inc(stat.benchByTurn, n + '@T' + (st.turn || 0));
          }

          for (const tl of (me.turnActionsLog || [])) {
            const key = mySeat + '#' + tl.turn;
            if (seen.has(key)) continue;
            seen.add(key);
            const acts = Array.isArray(tl.actions) ? tl.actions : [];
            let tradeCount = 0;
            for (const a of acts) {
              if (!a || !a.type) continue;
              inc(stat.actionKinds, a.type);
              const cn = a.cardId != null ? nameMap.get(String(a.cardId)) : null;
              if (a.type === 'play_hand' && cn) inc(stat.playedCards, cn);
              if (a.type === 'attack') {
                if (a.extra) inc(stat.attackUsed, a.extra);
                if (!stat._firstAtkDone) { /* per-match 在下面處理 */ }
              }
              if (a.type === 'use_ability' && a.extra === '交易') tradeCount++;
            }
            inc(stat.tradePerTurn, String(tradeCount));
            // 第一次攻擊發生在第幾回合
            if (acts.some((a) => a && a.type === 'attack')) {
              const prev = stat._firstAtkTurnThisMatch;
              if (prev === undefined || tl.turn < prev) stat._firstAtkTurnThisMatch = tl.turn;
            }
            // ⚠sample 只放「可見」資訊：自己的動作序列 + 自己場面 + 手牌**張數**。
            //   刻意不放手牌內容與任何牌庫 —— 見檔頭的上帝視角說明。
            sampleTurns.push({
              turn: tl.turn,
              actions: acts.map((a) => ({
                type: a.type,
                card: a.cardId != null ? (nameMap.get(String(a.cardId)) || String(a.cardId)) : null,
                extra: a.extra || undefined,
              })),
              myActive: me.active ? (nameMap.get(String(me.active.cardId)) || null) : null,
              myBench: (me.bench || []).map((b) => nameMap.get(String(b.cardId)) || null).filter(Boolean),
              myHandCount: (me.hand || []).length,
              myPrizesLeft: (me.prizes || []).length,
              oppPrizesLeft: ((st.players || [])[1 - mySeat] || {}).prizes
                ? ((st.players || [])[1 - mySeat].prizes || []).length : null,
            });
          }
        }
        if (stat._firstAtkTurnThisMatch !== undefined) {
          inc(stat.firstAttackTurn, 'T' + stat._firstAtkTurnThisMatch);
          delete stat._firstAtkTurnThisMatch;
        }
        // 本場備戰出現過的「N的」寶可夢（per-match 去重）
        const benchSeen = new Set();
        for (const sn of snaps) {
          const me = ((sn.state || {}).players || [])[mySeat];
          for (const b of ((me || {}).bench || [])) {
            const n = b && b.cardId != null ? nameMap.get(String(b.cardId)) : null;
            if (n && n.startsWith('N的')) benchSeen.add(n);
          }
        }
        for (const n of benchSeen) inc(stat.benchNPokemon, n);

        // ── finalLog 白名單事件（只抽這套牌關心的，不做通用解析器）──────────
        // ⚠log 是中文自然語言、**字面不是 API**：引擎改一個字這裡就抽不到。
        //   所以下面每條都回報命中數，命中 0 就是措辭變了，不是「玩家沒用過」。
        logLinesRead += finalLog.length;
        for (const line of finalLog) {
          // ⚠v2 修：欄位是 **message**，不是 text（LogEntry = {turn, playerIndex, message, timestamp}）。
          //   第一版寫 line.text → 每一行都變空字串被跳過 → 暗黑底牌/交易丟棄一條都抽不到，
          //   而畫面上的提示卻說「多半是措辭改過」，把人指向完全錯誤的方向。
          //   → 這就是為什麼下面一定要回報 logLinesRead：**「log 讀不到」與「措辭不符」
          //     是兩種完全不同的失敗，混在一起就查不出來**。
          const t = typeof line === 'string' ? line : ((line && (line.message || line.text)) || '');
          if (!t) continue;
          logLinesMatched++;
          let m = t.match(/暗黑底牌：使用\s*(.+?)\s*的「(.+?)」/);
          if (m) inc(stat.darkCardCopied, m[1] + '｜' + m[2]);
          m = t.match(/交易：丟棄\s*(.+)$/);
          if (m) for (const nm of m[1].split(/[、,，]/)) { const k = nm.trim(); if (k) inc(stat.tradeDiscarded, k); }
        }

        if (samples.length < 4 && sampleTurns.length >= 3) {
          samples.push({ matchId, seat: mySeat, playerName: q.name, turns: sampleTurns.slice(0, 24) });
        }
      }
    }

    const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n === undefined ? 25 : n)
      .map(([k, v]) => ({ key: k, n: v }));
    const outX = {
      keyCards, generatedAt: new Date().toISOString(),
      players: qualified.map((q) => ({ name: q.name, matches: q.matches, winRate: q.winRate })),
      matchesAnalysed, matchesSkipped, halfTurnsAnalysed: stat.turnsAnalysed,
      logDiag: { matchesWithLog, logLinesRead, logLinesMatched },
      stats: {
        setupActive: top(stat.setupActive, 12),
        benchNPokemon: top(stat.benchNPokemon, 20),
        benchByTurn: top(stat.benchByTurn, 40),
        darkCardCopied: top(stat.darkCardCopied, 20),
        attackUsed: top(stat.attackUsed, 20),
        firstAttackTurn: top(stat.firstAttackTurn, 10),
        tradePerTurn: top(stat.tradePerTurn, 8),
        tradeDiscarded: top(stat.tradeDiscarded, 25),
        actionKinds: top(stat.actionKinds, 10),
        playedCards: top(stat.playedCards, 30),
      },
      samples,
      note: '本檔不含任何手牌內容與牌庫內容（只有張數）——避免以上帝視角學到假規律。',
    };
    const PX = '/tmp/ptcg_archetype_playstyle.json';
    fs.writeFileSync(PX, JSON.stringify(outX, null, 2), 'utf8');

    console.log('══════ 打法抽取（批次 1）══════');
    console.log('入選玩家：' + qualified.map((q) => q.name).join('、'));
    console.log(`分析對局 ${matchesAnalysed} 場（略過 ${matchesSkipped} 場：無快照或座位對不上），半回合 ${stat.turnsAnalysed} 格`);
    const show = (label, arr) => console.log('  ' + label + '：' + (arr.length ? arr.slice(0, 8).map((x) => x.key + '×' + x.n).join('  ') : '（無）'));
    show('開局戰鬥位', outX.stats.setupActive);
    show('備戰的N寶可夢', outX.stats.benchNPokemon);
    show('暗黑底牌複製', outX.stats.darkCardCopied);
    show('交易/回合次數', outX.stats.tradePerTurn);
    show('交易丟棄', outX.stats.tradeDiscarded);
    show('首次攻擊回合', outX.stats.firstAttackTurn);
    console.log(`  對戰log：${matchesWithLog}/${matchesAnalysed} 場讀到，共 ${logLinesRead} 行（可解析 ${logLinesMatched} 行）`);
    if (!logLinesRead) {
      console.log('  ⚠一行 log 都沒讀到 —— 是取 log 的路徑壞了（TMATCH.finalLog / 房間 fallback），不是措辭問題。');
    } else if (!logLinesMatched) {
      console.log('  ⚠讀到 log 但一行都解析不出來 —— 欄位名不對（LogEntry 是 message 不是 text）。');
    } else if (!outX.stats.darkCardCopied.length) {
      console.log('  ⚠log 讀得到也解析得出來，但暗黑底牌一次都沒命中 —— 這才真的是措辭改過，請回報。');
    }
    console.log('明細已寫入 ' + PX);
    await client.close();
    return;
  }

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
