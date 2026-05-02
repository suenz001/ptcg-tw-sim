const fs = require('fs');
let code = fs.readFileSync('e:/ptcg-tw-sim/src/lib/game/effects.ts', 'utf8');

code = code.replace(/BENCH_PLACE_TRIGGERS\.set\('鐵蟻ex', \(st, idx\) => \{[\s\S]*?\}\);/, 
`ABILITY_EFFECTS.set('鐵蟻ex|突然削退', (st, aIdx, pool, inst) => {
  const oppIdx = (1 - aIdx) as 0 | 1;
  if (st.players[oppIdx].deck.length === 0) {
    return addLog(st, '突然削退：對手牌庫為空', aIdx);
  }
  st = addLog(st, '突然削退：丟對手牌庫頂 1 張', aIdx);
  return updatePlayer(st, oppIdx, p => {
    const top = p.deck.slice(0, 1);
    return { ...p, deck: p.deck.slice(1), discard: [...p.discard, ...top] };
  });
});`);

fs.writeFileSync('e:/ptcg-tw-sim/src/lib/game/effects.ts', code);
console.log('Replaced with regex');
