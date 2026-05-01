const fs = require('fs');
const path = require('path');

const cardsDir = path.join(__dirname, 'static', 'cards');

let found = [];

const files = fs.readdirSync(cardsDir).filter(f => f.endsWith('.json') && f !== 'index.json');
for (const file of files) {
  const data = JSON.parse(fs.readFileSync(path.join(cardsDir, file), 'utf8'));
  for (const card of data) {
    if (card.supertype !== 'Pokemon') continue;
    const regulation = card.regulationMark;
    if (['H', 'I', 'J', 'G'].indexOf(regulation) === -1) continue; 
    
    let hasFiltering = false;
    let desc = "";

    if (card.abilities) {
      for (const ab of card.abilities) {
        if (ab.text && (ab.text.includes('抽') || ab.text.includes('牌庫') || ab.text.includes('選擇'))) {
          hasFiltering = true;
          desc += `特性: ${ab.name} - ${ab.text.substring(0, 50)}...\n`;
        }
      }
    }

    if (card.attacks) {
      for (const atk of card.attacks) {
        if (atk.text && (atk.text.includes('抽') || atk.text.includes('牌庫') || atk.text.includes('選擇'))) {
          hasFiltering = true;
          desc += `招式: ${atk.name} - ${atk.text.substring(0, 50)}...\n`;
        }
      }
    }

    if (hasFiltering) {
      if (!found.find(c => c.name === card.name && c.desc === desc)) {
        found.push({ name: card.name, desc: desc, setId: file.replace('.json', '') });
      }
    }
  }
}

console.log(`Total Pokemon with these keywords: ${found.length}`);
for (let i = 0; i < 10; i++) {
  if (found[i]) {
    console.log(`[${found[i].setId}] ${found[i].name}`);
    console.log(found[i].desc.trim());
  }
}
