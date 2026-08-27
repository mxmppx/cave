# Sécurisation Supabase — étapes côté dashboard

Le code (`index.html`) demande maintenant une connexion Supabase Auth avant
de charger les données. Ça ne sert à rien tant que les étapes suivantes
n'ont pas été faites à la main dans le dashboard Supabase du projet
(`rtxwaupsjwfmczyopuhk`).

## 1. Créer l'utilisateur

*Authentication → Users → Add user*, coche **Auto Confirm User**.
À faire **avant** de déployer, sinon plus personne ne peut passer l'écran
de login.

## 2. Désactiver les inscriptions publiques

*Authentication → Providers → Email* (ou *Auth settings*) → décoche
**"Allow new users to sign up"**.

## 3. Activer RLS + policy sur les deux tables

```sql
alter table public.wines enable row level security;
alter table public.wines_archive enable row level security;

create policy "authenticated_full_access"
  on public.wines
  for all
  to authenticated
  using (true)
  with check (true);

create policy "authenticated_full_access"
  on public.wines_archive
  for all
  to authenticated
  using (true)
  with check (true);
```

## 4. GRANT explicite (piège classique)

Une policy RLS ne suffit pas : Postgres exige en plus un droit d'accès
classique sur la table pour le rôle `authenticated`. Sans ça : erreur
`permission denied for table ...` malgré une policy `using (true)`
correcte.

```sql
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema='public' and table_name in ('wines','wines_archive');

grant select, insert, update, delete on public.wines to authenticated;
grant select, insert, update, delete on public.wines_archive to authenticated;
```

## 5. Multi-utilisateurs (chacun voit sa propre cave)

Par défaut (étape 3), la policy `using (true)` donne accès à **toutes**
les lignes à **n'importe quel** utilisateur connecté : deux comptes
verraient la même cave mélangée. Pour isoler les données par personne,
il faut une colonne `user_id` + une policy qui filtre dessus. Aucune
modification de `index.html` n'est nécessaire : Postgres remplit et
filtre `user_id` tout seul.

**a) Ajouter la colonne (nullable pour l'instant) :**

```sql
alter table public.wines add column user_id uuid references auth.users(id);
alter table public.wines_archive add column user_id uuid references auth.users(id);
```

**b) Attribuer toutes les lignes existantes à votre compte** — remplacez
l'email ci-dessous par celui avec lequel vous vous connectez à l'app :

```sql
update public.wines
  set user_id = (select id from auth.users where email = 'VOTRE_EMAIL@exemple.com')
  where user_id is null;

update public.wines_archive
  set user_id = (select id from auth.users where email = 'VOTRE_EMAIL@exemple.com')
  where user_id is null;
```

**c) Rendre la colonne obligatoire, remplie automatiquement à l'insertion :**

```sql
alter table public.wines alter column user_id set default auth.uid();
alter table public.wines alter column user_id set not null;

alter table public.wines_archive alter column user_id set default auth.uid();
alter table public.wines_archive alter column user_id set not null;
```

**d) Remplacer les policies "tout le monde voit tout" par un filtre par utilisateur :**

```sql
drop policy "authenticated_full_access" on public.wines;
drop policy "authenticated_full_access" on public.wines_archive;

create policy "user_owns_data"
  on public.wines
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "user_owns_data"
  on public.wines_archive
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
```

**e) Créer le second compte** : *Authentication → Users → Add user*,
cochez **Auto Confirm User**, comme à l'étape 1. Sa cave démarre vide
et n'affichera jamais les vins des autres comptes.

**Limite connue** : les photos d'étiquette (bucket de storage
`wine-labels`) ne sont pas cloisonnées par utilisateur — les fichiers
uploadés ont un nom horodaté imprévisible et ne sont pas listés dans
l'app, mais un utilisateur qui devinerait une URL exacte pourrait y
accéder. Non bloquant pour un usage familial, mais à garder en tête.

## 6. Colonne "à boire avec" (accord mets-vin)

Le filtre "À boire avec" (accords mets-vin) nécessite une colonne
supplémentaire sur les deux tables. Sans elle, l'ajout/modification d'un
vin renverra une erreur `column "accord_mets" does not exist`.

```sql
alter table public.wines add column accord_mets text;
alter table public.wines_archive add column accord_mets text;
```

## 7. Colonne "emplacement" (localisation physique de la bouteille)

Champ libre affiché dans le formulaire et la fiche détaillée. Sans elle,
l'ajout/modification d'un vin renverra une erreur `column "emplacement"
does not exist`.

**Nécessaire sur les deux tables** : l'emplacement est recopié vers
`wines_archive` au moment de l'archivage (pour rester visible sur une
bouteille déjà bue et être restitué si elle est remise en cave). Sans
la colonne sur `wines_archive`, l'archivage d'un vin renverra une
erreur `column "emplacement" does not exist` et **la bouteille sera
décrémentée de la cave sans être enregistrée dans l'historique**.

```sql
alter table public.wines add column emplacement text;
alter table public.wines_archive add column emplacement text;
```

## 8. Colonnes "date_achat" et "caviste" (traçabilité de l'achat)

**Nécessaire sur les deux tables**, pour la même raison qu'au point 7 :
ces informations sont recopiées vers `wines_archive` à l'archivage.

```sql
alter table public.wines add column date_achat date;
alter table public.wines add column caviste text;
alter table public.wines_archive add column date_achat date;
alter table public.wines_archive add column caviste text;
```

## 9. Colonne "a_racheter" (liste à racheter)

Permet de marquer un vin dégusté et apprécié pour un futur réachat,
depuis sa fiche dans l'historique (bouton "Marquer à racheter"), et de
le retrouver via le filtre "🛒 À racheter" de l'onglet Historique.

```sql
alter table public.wines_archive add column a_racheter boolean not null default false;
```

## 10. Restauration d'une sauvegarde JSON

Le bouton "Restaurer une sauvegarde JSON" (modale Export) relit un
fichier exporté par "Sauvegarde complète (JSON)" et propose de
fusionner (ajout aux données actuelles, doublons détectés par nom +
domaine + millésime) ou de remplacer entièrement la cave et
l'historique. Aucune nouvelle colonne requise — utilise les policies
RLS déjà en place (étape 3 ou 5 selon votre configuration).

## 11. ⚠️ Correctif urgent : colonnes manquantes sur `wines_archive`

Si vous aviez déjà exécuté les sections 7 et 8 dans leur ancienne
version (colonnes uniquement sur `wines`), exécutez ce correctif
maintenant. Depuis le commit `d84c67d`, l'archivage d'un vin
(`−1 bue` / `Tout marquer comme bu`) recopie `emplacement`,
`date_achat` et `caviste` vers `wines_archive`. Sans ces colonnes,
**l'insertion dans l'historique échoue et la bouteille peut être
décrémentée ou supprimée de la cave sans laisser de trace.**

Idempotent — sans danger à exécuter même si les colonnes existent déjà :

```sql
alter table public.wines_archive add column if not exists emplacement text;
alter table public.wines_archive add column if not exists date_achat date;
alter table public.wines_archive add column if not exists caviste text;
```

## 12. 🔍 Fonction de diagnostic (pour que Claude Code puisse vérifier le schéma)

Cette session n'a pas d'accès direct à la base Supabase du projet — impossible
de lister les colonnes existantes ou de savoir quelles migrations ci-dessus
restent à exécuter. Cette fonction expose en lecture seule la liste des
colonnes de `wines` et `wines_archive` (noms et types uniquement, aucune
donnée), appelable via l'API REST publique avec la clé `anon` déjà présente
dans `index.html` — elle ne donne accès à rien de plus que ce que révèle déjà
le code source public du dépôt.

```sql
create or replace function public.debug_schema_check()
returns table(table_name text, column_name text, data_type text, is_nullable text)
language sql
security definer
set search_path = public
as $$
  select c.table_name, c.column_name, c.data_type, c.is_nullable
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name in ('wines', 'wines_archive')
  order by c.table_name, c.ordinal_position;
$$;

grant execute on function public.debug_schema_check() to anon, authenticated;
```

Une fois exécutée, n'importe qui (moi y compris, via `curl`) peut vérifier
l'état réel du schéma avec :

```sh
curl -s 'https://rtxwaupsjwfmczyopuhk.supabase.co/rest/v1/rpc/debug_schema_check' \
  -H 'apikey: sb_publishable_3sIlqi_GerHO1T2A9hHv4A_oFsC48lP' \
  -H 'Content-Type: application/json' \
  -d '{}'
```

Pour révoquer l'accès une fois le diagnostic terminé (optionnel) :

```sql
drop function public.debug_schema_check();
```

## Checklist de vérification

- [ ] Navigation privée → écran de login apparaît, aucune donnée visible
      sans connexion
- [ ] Connexion avec les bons identifiants → les données s'affichent
- [ ] Fermer/rouvrir l'onglet → **pas** de nouveau login demandé (la
      session persiste dans `localStorage` et se rafraîchit toute seule)
- [ ] Bouton 🔒 dans l'en-tête → déconnexion + retour à l'écran de login
- [ ] Simuler une erreur (policy désactivée, mauvais GRANT) → message
      d'erreur Supabase affiché clairement, pas un écran vide
- [ ] Après la migration multi-utilisateurs : vos vins existants sont
      toujours visibles sur votre compte
- [ ] Le second compte, une fois connecté, voit une cave vide et ne
      peut pas voir/modifier vos vins
