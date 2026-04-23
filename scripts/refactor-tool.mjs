import fs from 'node:fs';
import path from 'node:path';

function replaceInFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let original = content;

  // Replace Pokemon Tool checks
  content = content.replace(/card\.supertype\s*===\s*'Pokemon'\s*&&\s*card\.subtype\s*===\s*'Other'/g, "card.supertype === 'Trainer' && card.subtype === 'PokemonTool'");
  content = content.replace(/card\?\.supertype\s*===\s*'Pokemon'\s*&&\s*card\.subtype\s*===\s*'Other'/g, "card?.supertype === 'Trainer' && card.subtype === 'PokemonTool'");
  content = content.replace(/c\.supertype\s*===\s*'Pokemon'\s*&&\s*c\.subtype\s*===\s*'Other'/g, "c.supertype === 'Trainer' && c.subtype === 'PokemonTool'");

  // Replace normal Pokemon checks (removing the subtype !== 'Other' part)
  content = content.replace(/card\.supertype\s*===\s*'Pokemon'\s*&&\s*card\.subtype\s*!==\s*'Other'/g, "card.supertype === 'Pokemon'");
  content = content.replace(/card\?\.supertype\s*===\s*'Pokemon'\s*&&\s*card\.subtype\s*!==\s*'Other'/g, "card?.supertype === 'Pokemon'");
  content = content.replace(/c\.supertype\s*===\s*'Pokemon'\s*&&\s*c\.subtype\s*!==\s*'Other'/g, "c.supertype === 'Pokemon'");

  // Handle negative checks
  content = content.replace(/card\.supertype\s*!==\s*'Pokemon'\s*\|\|\s*card\.subtype\s*===\s*'Other'/g, "card.supertype !== 'Pokemon'");
  content = content.replace(/c\.supertype\s*!==\s*'Pokemon'\s*\|\|\s*c\.subtype\s*===\s*'Other'/g, "c.supertype !== 'Pokemon'");

  if (content !== original) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Updated ${filePath}`);
  }
}

function walk(dir) {
  const files = fs.readdirSync(dir);
  for (const f of files) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) {
      walk(p);
    } else if (p.endsWith('.ts') || p.endsWith('.svelte')) {
      replaceInFile(p);
    }
  }
}

walk('src');
