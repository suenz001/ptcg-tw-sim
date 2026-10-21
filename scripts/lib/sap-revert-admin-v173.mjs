import assert from 'node:assert/strict';
export const ADMIN_V173_PAIRS = [
 [
  "// === ORACLE ADMIN ENDPOINTS === v1.73 (v6.592 錦標賽個人操作時計，預設關閉)\n",
  ""
 ],
 [
  "      // >>> v6592-player-clock-action\n      if (doc.matchId && typeof playerClockRuntime !== 'undefined' && playerClockRuntime) {\n        set.playerClock = playerClockRuntime.calculate(doc, newGs);\n        if (set.playerClock) set.playerClock.stalled = [false, false];\n      }\n      // <<< v6592-player-clock-action\n",
  ""
 ],
 [
  "      // >>> v6592-player-clock-remember\n      if (doc.matchId && typeof playerClockRuntime !== 'undefined' && playerClockRuntime) playerClockRuntime.remember(doc, set.playerClock || null);\n      // <<< v6592-player-clock-remember\n",
  ""
 ],
 [
  "    // >>> v6592-player-clock\n    // 個人操作時計：預設關閉；只由伺服器保存時間與執行必要收尾。\n    const PLAYER_CLOCK_ID = 'playerClock';\n    const playerClockRuntime = typeof TENG.createPlayerClockRuntime === 'function' ? TENG.createPlayerClockRuntime({\n      now: Date.now,\n      pool: TPOOL,\n      loadPolicy: () => db.collection('tournamentConfig').findOne({ _id: PLAYER_CLOCK_ID }),\n      savePolicy: (policy) => db.collection('tournamentConfig').updateOne(\n        { _id: PLAYER_CLOCK_ID }, { $set: policy }, { upsert: true }),\n      activeRooms: async () => {\n        const matches = await db.collection('tournamentMatches').find(\n          { status: 'playing' }, { projection: { roomId: 1 } }).limit(512).toArray();\n        return matches.map(m => m.roomId).filter(Boolean);\n      },\n      loadRoom: id => TROOMS.findOne({ _id: id }),\n      commit: async (doc, next, clock, automatic) => {\n        const now = Date.now();\n        const changed = next !== doc.gameState;\n        const nv = doc.version + 1;\n        const set = { playerClock: clock, version: nv, updatedAt: now };\n        if (changed) {\n          next = Object.assign({}, next, { log: [...(next.log || []), {\n            turn: next.turn, playerIndex: null, timestamp: now,\n            message: '⏱ 個人操作時間已到，電腦完成必要收尾動作。',\n          }] });\n          set.gameState = next;\n          set.actorSeat = currentActorSeat(next);\n          set.lastActionAt = now;\n        }\n        const wr = await TROOMS.updateOne(\n          { _id: doc._id, version: { $eq: doc.version }, 'gameState.phase': 'playing', timeLimitTurn: doc.timeLimitTurn ?? null }, { $set: set });\n        if (!wr || !wr.matchedCount) return false;\n        _lpNotify(doc._id);\n        if (changed && automatic) {\n          tReplayOnApplied(doc, next, nv);\n          if (doc.gameState.activePlayerIndex !== next.activePlayerIndex) snapshotTurn(doc.matchId, doc.eventId, next);\n          if (next.phase === 'game-over') await onMatchGameOver(doc, next);\n        }\n        return true;\n      },\n      warn: message => console.warn('[player-clock] ' + message),\n      notifyPolicyChange: ids => { for (const id of ids) _lpNotify(id); },\n    }) : null;\n    app.get('/api/tourn-player-clock', async (req, res) => {\n      try {\n        const id = await tournIdentity(req);\n        if (!isTournAdmin(id)) return res.status(403).json({ error: '只有管理員可操作' });\n        if (!playerClockRuntime) return res.status(503).json({ error: '伺服器引擎尚未更新' });\n        await playerClockRuntime.refresh();\n        if (!playerClockRuntime.ready()) return res.status(503).json({ error: '設定讀取失敗，狀態未知' });\n        res.set('Cache-Control', 'no-store');\n        res.json({ playerClockApi: 1, policy: playerClockRuntime.currentPolicy() });\n      } catch (e) { res.status(500).json({ error: e.message }); }\n    });\n    app.post('/api/tourn-player-clock', async (req, res) => {\n      try {\n        const id = await tournIdentity(req);\n        if (!isTournAdmin(id)) return res.status(403).json({ error: '只有管理員可操作' });\n        if (!playerClockRuntime) return res.status(503).json({ error: '伺服器引擎尚未更新' });\n        const policy = await playerClockRuntime.configure(req.body && req.body.enabled, req.body && req.body.minutes);\n        res.json({ ok: true, playerClockApi: 1, policy });\n        void playerClockRuntime.refresh();\n      } catch (e) { res.status(400).json({ error: e.message }); }\n    });\n    if (playerClockRuntime) {\n      const refreshClock = setInterval(() => { void playerClockRuntime.refresh(); }, 5000);\n      const tickClock = setInterval(() => { void playerClockRuntime.tick(); }, 250);\n      if (refreshClock.unref) refreshClock.unref();\n      if (tickClock.unref) tickClock.unref();\n      // 等整個 IIFE 完成，才可以使用下方的 TMATCH／回放與終局函式。\n      setTimeout(() => { void playerClockRuntime.refresh(); }, 1000).unref();\n    }\n    // <<< v6592-player-clock\n",
  ""
 ],
 [
  "          // >>> v6592-player-clock-light\n          _un.playerClock = playerClockRuntime ? playerClockRuntime.publicClock(light.playerClock) : null;\n          _un.playerClockRevision = playerClockRuntime ? playerClockRuntime.currentPolicy().changedAt : 0;\n          // <<< v6592-player-clock-light\n",
  ""
 ],
 [
  "        // >>> v6592-player-clock-full\n        const _playerClock = playerClockRuntime ? playerClockRuntime.publicClock(doc.playerClock) : null;\n        const _playerClockRevision = playerClockRuntime ? playerClockRuntime.currentPolicy().changedAt : 0;\n        // <<< v6592-player-clock-full\n",
  ""
 ],
 [
  "        res.json({ longPoll: _lpCfgNow.enabled, waited: _waited || undefined, gameState: _stateForSeat(doc.gameState, _vseat), version: doc.version, seats: doc.seats, names: doc.names, actorSeat: _actorSeat, waiting: !doc.gameState, lastActionAt: doc.lastActionAt || null, idleForfeitMin: doc.idleForfeitMin || 3, serverNow: Date.now(), oppQuietSec: _oqFull || undefined, playerClock: _playerClock, playerClockRevision: _playerClockRevision });\n",
  "        res.json({ longPoll: _lpCfgNow.enabled, waited: _waited || undefined, gameState: _stateForSeat(doc.gameState, _vseat), version: doc.version, seats: doc.seats, names: doc.names, actorSeat: _actorSeat, waiting: !doc.gameState, lastActionAt: doc.lastActionAt || null, idleForfeitMin: doc.idleForfeitMin || 3, serverNow: Date.now(), oppQuietSec: _oqFull || undefined });\n"
 ],
 [
  "        // >>> v6592-player-clock-gate\n        if (doc.matchId && playerClockRuntime && playerClockRuntime.blocked(doc, seat)) {\n          void playerClockRuntime.work(room).catch(() => { console.warn('[player-clock] 接管讀寫失敗，等待重新同步'); });\n          return res.json({ error: '操作時間已到，電腦正在完成必要收尾', gameState: _stateForSeat(gs, _vseat), version: doc.version });\n        }\n        // <<< v6592-player-clock-gate\n",
  ""
 ]
];
export function revertAdminV173(source) {
 let s=source;
 for(const [now,prev] of ADMIN_V173_PAIRS){assert.equal(s.split(now).length-1,1,'v173還原錨點必須恰一處');s=s.replace(now,prev);}
 return s;
}
