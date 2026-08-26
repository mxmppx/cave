const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('index.html','utf8');
const js = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
function fn(name) {
  const start = js.indexOf(`function ${name}(`); assert(start >= 0, `${name} missing`);
  const brace = js.indexOf('{', start); let depth=0, end=brace;
  for (; end<js.length; end++) { if(js[end]==='{')depth++; else if(js[end]==='}' && --depth===0){end++;break;} }
  return js.slice(start,end);
}
const context = { console, YEAR: 2026 };
vm.createContext(context);
vm.runInContext([fn('normalizeReferencePart'), fn('isSameWineReference'), fn('getStatut'), fn('parseAiImportText'), fn('validateBackupJson')].join('\n'), context);
assert.equal(context.normalizeReferencePart('  Château  Élan '), 'chateau elan');
assert.equal(context.isSameWineReference({nom:'Élan',domaine:' D ',millesime:2020,couleur:'rouge'},{nom:'elan',domaine:'d',millesime:'2020',couleur:'Rouge'}), true);
assert.equal(context.isSameWineReference({nom:'Élan',domaine:'D',millesime:2021,couleur:'rouge'},{nom:'elan',domaine:'d',millesime:2020,couleur:'rouge'}), false);
assert.equal(context.getStatut({boire_avant:2025}), 'passe');
assert.equal(context.getStatut({boire_a_partir_de:2027,boire_avant:2030}), 'attendre');
assert.equal(context.getStatut({boire_avant:2027}), 'urgent');
assert.equal(context.parseAiImportText('NOM: Porto\nCOULEUR: fortifié').couleur, 'fortifié');
assert.equal(context.validateBackupJson({cave:[{nom:'A',quantite:1}],historique:[]}).cave.length, 1);
assert.throws(() => context.validateBackupJson({cave:[{nom:'A',quantite:0}],historique:[]}));
console.log('core tests passed');
