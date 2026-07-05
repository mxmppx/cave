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
