// Tests des fonctions métier pures de index.html, sans dépendance externe.
// Charge le <script> inline dans un bac à sable minimal (vm) plutôt que
// d'extraire des fonctions individuellement par regex, pour rester robuste
// aux évolutions du fichier — voir tests/README.md.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

function makeElement() {
  return {
    value: '', textContent: '', innerHTML: '', disabled: false, checked: false,
    style: {}, dataset: {}, src: '',
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, removeEventListener() {}, appendChild() {}, remove() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    closest() { return null; }, click() {},
  };
}

function makeLocalStorage() {
  const store = new Map();
  return {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
    clear: () => store.clear(),
  };
}

function makeSupabaseStub() {
  const from = () => ({
    select: () => Promise.resolve({ data: [], error: null }),
    insert: () => Promise.resolve({ data: null, error: null }),
    update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
    delete: () => ({ eq: () => Promise.resolve({ data: null, error: null }), not: () => Promise.resolve({ data: null, error: null }) }),
  });
  return {
    createClient: () => ({
      auth: {
        getSession: () => Promise.resolve({ data: { session: null } }),
        onAuthStateChange() {}, signInWithPassword: () => Promise.resolve({ error: null }), signOut: () => Promise.resolve({}),
      },
      from,
      storage: { from: () => ({ upload: () => Promise.resolve({ error: null }), getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
    }),
  };
}

// Charge index.html une seule fois dans un contexte partagé par tous les tests.
function loadApp() {
  const htmlPath = path.resolve(__dirname, '..', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const start = html.indexOf('<script>') + '<script>'.length;
  const end = html.lastIndexOf('</script>');
  assert.ok(start > -1 && end > start, 'Impossible de localiser le <script> inline dans index.html');
  const code = html.slice(start, end);

  const sandbox = {
    console,
    document: {
      getElementById: makeElement,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {},
      createElement: makeElement,
      body: { appendChild() {}, style: {}, classList: makeElement().classList },
    },
    window: { matchMedia: () => ({ matches: false, addEventListener() {} }), location: { href: 'http://localhost/' } },
    localStorage: makeLocalStorage(),
    navigator: {},
    supabase: makeSupabaseStub(),
    URL, Blob: class {}, FileReader: class {}, setTimeout, clearTimeout,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'index.html-inline-script' });
  return sandbox;
}

const app = loadApp();

test('escapeHtml échappe les caractères HTML dangereux', () => {
  assert.equal(app.escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(app.escapeHtml(`A & B "C" 'D'`), 'A &amp; B &quot;C&quot; &#39;D&#39;');
  assert.equal(app.escapeHtml(null), '');
  assert.equal(app.escapeHtml(undefined), '');
  assert.equal(app.escapeHtml(42), '42');
});

test('safeImageUrl accepte http(s), rejette javascript: et les URL invalides', () => {
  assert.equal(app.safeImageUrl('https://x.supabase.co/storage/v1/object/public/wine-labels/a.jpg'),
    'https://x.supabase.co/storage/v1/object/public/wine-labels/a.jpg');
  assert.equal(app.safeImageUrl('javascript:alert(1)'), '');
  assert.equal(app.safeImageUrl('data:text/html,<script>alert(1)</script>'), '');
  assert.equal(app.safeImageUrl(''), '');
  assert.equal(app.safeImageUrl(null), '');
});

test('normaliserTexte ignore accents, casse et ponctuation', () => {
  assert.equal(app.normaliserTexte('Château Élan'), 'chateau elan');
  assert.equal(app.normaliserTexte('  Beaujolais-Villages !  '), 'beaujolais villages');
  assert.equal(app.normaliserTexte(null), '');
});

test('isSameWineReference compare nom+domaine normalisés et le millésime exact', () => {
  assert.equal(app.isSameWineReference(
    { nom: 'Château Élan', domaine: ' D ', millesime: 2020 },
    { nom: 'chateau  elan', domaine: 'd', millesime: '2020' }
  ), true, 'accents/casse/espaces/type ignorés');
  assert.equal(app.isSameWineReference(
    { nom: 'Château Élan', domaine: 'D', millesime: 2020 },
    { nom: 'Château Élan', domaine: 'D', millesime: 2021 }
  ), false, 'millésime différent = référence différente');
  assert.equal(app.isSameWineReference(
    { nom: 'A', domaine: 'B', millesime: null },
    { nom: 'A', domaine: 'B', millesime: null }
  ), true, 'deux millésimes vides sont considérés identiques');
});

test('splitCepages découpe sur virgule, slash, "et" et "&"', () => {
  // Les tableaux renvoyés viennent du contexte vm : on les copie en
  // tableaux natifs de ce process avant deepEqual pour éviter un faux
  // négatif lié à des Array de deux "realms" JS différents.
  const split = s => [...app.splitCepages(s)];
  assert.deepEqual(split('Merlot, Cabernet Sauvignon'), ['Merlot', 'Cabernet Sauvignon']);
  assert.deepEqual(split('Grenache & Syrah'), ['Grenache', 'Syrah']);
  assert.deepEqual(split('Chasselas et Pinot Gris'), ['Chasselas', 'Pinot Gris']);
  assert.deepEqual(split('Merlot/Cabernet'), ['Merlot', 'Cabernet']);
  assert.deepEqual(split(''), []);
  assert.deepEqual(split(null), []);
});

// new Date().getFullYear() : YEAR est un `const` du script inline, donc pas
// exposé comme propriété du bac à sable (particularité de node:vm) — on
// recalcule la même valeur ici plutôt que de lire app.YEAR.
const CURRENT_YEAR = new Date().getFullYear();

test('monthsRemaining calcule les mois restants jusqu\'au 31 décembre de l\'année cible', () => {
  // Valeur non figée (dépend du mois d'exécution du test), mais toujours
  // dans [0, 11], et cohérente d'une année sur l'autre à ±12 mois près.
  const remainingThisYear = app.monthsRemaining(CURRENT_YEAR);
  assert.ok(remainingThisYear >= 0 && remainingThisYear <= 11,
    `monthsRemaining(année en cours) doit être entre 0 et 11, reçu ${remainingThisYear}`);
  assert.equal(app.monthsRemaining(CURRENT_YEAR + 1), remainingThisYear + 12);
  assert.equal(app.monthsRemaining(CURRENT_YEAR - 1), remainingThisYear - 12);
});

test('getStatut : passé, à attendre, urgent, prêt (horizon = 12 mois, le maximum)', () => {
  const key = 'cave_urgent_horizon_months';
  try {
    // Avec l'horizon maximal (12 mois), toute échéance dans l'année en
    // cours est forcément "urgent" (au plus 11 mois restants) et toute
    // échéance à 2 ans ou plus est forcément "prêt" (24 mois ou plus) —
    // vrai quel que soit le mois réel d'exécution du test.
    app.localStorage.setItem(key, '12');
    assert.equal(app.getStatut({ boire_avant: CURRENT_YEAR - 1 }), 'passe');
    assert.equal(app.getStatut({ boire_a_partir_de: CURRENT_YEAR + 3 }), 'attendre');
    assert.equal(app.getStatut({ boire_avant: CURRENT_YEAR }), 'urgent');
    assert.equal(app.getStatut({ boire_avant: CURRENT_YEAR + 2 }), 'pret');
    assert.equal(app.getStatut({}), null, 'aucune fenêtre renseignée');
  } finally {
    app.localStorage.removeItem(key);
  }
});

test('getUrgentHorizon retombe sur la valeur par défaut (6 mois) si la valeur stockée est hors bornes ou invalide', () => {
  const key = 'cave_urgent_horizon_months';
  try {
    app.localStorage.setItem(key, '99');
    assert.equal(app.getUrgentHorizon(), 6);
    app.localStorage.setItem(key, '2.5');
    assert.equal(app.getUrgentHorizon(), 6);
    app.localStorage.setItem(key, '4');
    assert.equal(app.getUrgentHorizon(), 4);
  } finally {
    app.localStorage.removeItem(key);
  }
});

test('isValidQuantiteInput : vide accepté, entier >= 1 accepté, le reste refusé', () => {
  assert.equal(app.isValidQuantiteInput(''), true);
  assert.equal(app.isValidQuantiteInput('1'), true);
  assert.equal(app.isValidQuantiteInput('12'), true);
  assert.equal(app.isValidQuantiteInput('0'), false);
  assert.equal(app.isValidQuantiteInput('-2'), false);
  assert.equal(app.isValidQuantiteInput('1.5'), false);
  // parseFloat('1e2') vaut 100, un entier valide — comportement actuel assumé,
  // pas un cas qu'un formulaire de quantité est susceptible de recevoir.
  assert.equal(app.isValidQuantiteInput('1e2'), true);
  assert.equal(app.isValidQuantiteInput('abc'), false);
});

test('isValidUrgentHorizonInput : entier entre 1 et 12 uniquement', () => {
  assert.equal(app.isValidUrgentHorizonInput('1'), true);
  assert.equal(app.isValidUrgentHorizonInput('12'), true);
  assert.equal(app.isValidUrgentHorizonInput('13'), false);
  assert.equal(app.isValidUrgentHorizonInput('0'), false);
  assert.equal(app.isValidUrgentHorizonInput('2.5'), false);
  assert.equal(app.isValidUrgentHorizonInput(''), false);
});

test('parseAiImportText reconnaît les 12 champs du format attendu', () => {
  const raw = [
    'NOM: Gevrey-Chambertin 1er Cru',
    'DOMAINE: Rossignol',
    'MILLESIME: 2019',
    'REGION: Bourgogne',
    'PAYS: France',
    'CEPAGE: Pinot Noir',
    'COULEUR: rouge',
    'BOIRE_DES: 2024',
    'BOIRE_AVANT: 2032',
    'ACCORD_METS: Viande rouge, Fromage',
    'PRIX_CHF: 45.00',
    'CAVISTE: Mövenpick Wein',
  ].join('\n');
  const parsed = app.parseAiImportText(raw);
  assert.equal(parsed.nom, 'Gevrey-Chambertin 1er Cru');
  assert.equal(parsed.domaine, 'Rossignol');
  assert.equal(parsed.millesime, '2019');
  assert.equal(parsed.couleur, 'rouge');
  assert.equal(parsed.prix, '45.00');
  assert.equal(parsed.caviste, 'Mövenpick Wein');
});

test('parseAiImportText ignore les lignes qui ne matchent pas le format', () => {
  const parsed = app.parseAiImportText('n\'importe quoi\nNOM: Test\n');
  assert.equal(parsed.nom, 'Test');
  assert.equal(Object.keys(parsed).length, 1);
});

test('pickWeightedWine privilégie fenêtre dépassée > urgent > prêt sans jamais sortir de la liste', () => {
  const key = 'cave_urgent_horizon_months';
  // Horizon au maximum (12 mois) : l'année en cours est forcément "urgent",
  // dans 2 ans forcément "prêt" — déterministe quel que soit le mois réel.
  app.localStorage.setItem(key, '12');
  try {
    const passe = { id: 'passe', boire_avant: CURRENT_YEAR - 1 };
    const urgent = { id: 'urgent', boire_avant: CURRENT_YEAR };
    const pret = { id: 'pret', boire_avant: CURRENT_YEAR + 2 };
    const list = [passe, urgent, pret];

    const counts = { passe: 0, urgent: 0, pret: 0 };
    for (let i = 0; i < 500; i++) {
      const picked = app.pickWeightedWine(list);
      assert.ok(list.includes(picked), 'ne doit jamais retourner un élément hors de la liste fournie');
      counts[picked.id]++;
    }
    // Poids relatifs 3/2/1 : "passe" doit statistiquement dominer largement "pret".
    assert.ok(counts.passe > counts.pret, `passe (${counts.passe}) devrait dépasser pret (${counts.pret}) sur 500 tirages`);
    assert.ok(counts.urgent > counts.pret, `urgent (${counts.urgent}) devrait dépasser pret (${counts.pret}) sur 500 tirages`);
  } finally {
    app.localStorage.removeItem(key);
  }
});

test('pickWeightedWine ne choisit que l\'unique élément d\'une liste à un seul vin', () => {
  const only = { id: 'only', boire_avant: CURRENT_YEAR };
  assert.equal(app.pickWeightedWine([only]), only);
});

console.log('Tous les tests métier ont passé ✓');
