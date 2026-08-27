# Tests

Tests unitaires des fonctions métier pures de `index.html` (validation,
normalisation, calcul de statut, tirage pondéré, parsing d'import IA, etc.),
sans aucune dépendance externe (uniquement les modules `node:` intégrés).

## Lancer les tests

```sh
node --test tests/
```

## Fonctionnement

`index.html` n'a pas de build ni de modules : tout le JS applicatif vit dans
un unique `<script>` inline. Plutôt que d'extraire des fonctions par regex
(fragile à chaque modification du fichier), `core.test.js` charge ce
`<script>` tel quel dans un bac à sable `node:vm`, avec un DOM/localStorage/
client Supabase minimalistes simulés (juste assez pour que le script
s'exécute sans erreur au chargement). Les fonctions globales définies par
`function ...() {}` dans le script (contrairement aux `const`/`let`, une
particularité de `node:vm`) deviennent alors accessibles depuis le test via
l'objet bac à sable, et peuvent être testées directement.

Ça veut dire que ces tests vérifient le vrai code de `index.html`, pas une
copie ou une réimplémentation — toute régression sur une fonction testée ici
fait échouer le test.
