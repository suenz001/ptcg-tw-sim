import fs from 'node:fs';
import path from 'node:path';

const DIR = 'static/cards';
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json') && f !== 'index.json');

const addAncient = ['覺醒戰鼓'];
const addAceSpec = ['極限腰帶', '希望護身符', '璀璨結晶', '倖存鍛鍊器', '英雄斗篷', '奢華炸彈'];

let fixedCount = 0;

for (const f of files) {
  const fp = path.join(DIR, f);
  const cards = JSON.parse(fs.readFileSync(fp, 'utf8'));
  let mod = false;
  
  for (const c of cards) {
    if (addAncient.includes(c.name)) {
      if (!c.tags) c.tags = [];
      if (!c.tags.includes('古代')) {
        c.tags.push('古代');
        console.log(`Added 古代 to ${c.name} in ${f}`);
        mod = true;
        fixedCount++;
      }
    }
    
    if (addAceSpec.includes(c.name)) {
      if (!c.tags) c.tags = [];
      if (!c.tags.includes('ACE SPEC')) {
        c.tags.push('ACE SPEC');
        console.log(`Added ACE SPEC to ${c.name} in ${f}`);
        mod = true;
        fixedCount++;
      }
      // Fix supertype if it was parsed as Pokemon
      if (c.supertype === 'Pokemon') {
        c.supertype = 'Trainer';
        c.subtype = 'Tool';
        delete c.hp;
        delete c.pokemonType;
        delete c.stage;
        delete c.weakness;
        delete c.resistance;
        delete c.retreat;
        console.log(`Fixed supertype to Trainer/Tool for ${c.name} in ${f}`);
        mod = true;
      }
    }
  }
  
  if (mod) fs.writeFileSync(fp, JSON.stringify(cards, null, 2) + '\n', 'utf8');
}

console.log(`Done. Fixed ${fixedCount} missing tags.`);
