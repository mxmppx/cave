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

## Checklist de vérification

- [ ] Navigation privée → écran de login apparaît, aucune donnée visible
      sans connexion
- [ ] Connexion avec les bons identifiants → les données s'affichent
- [ ] Fermer/rouvrir l'onglet → **pas** de nouveau login demandé (la
      session persiste dans `localStorage` et se rafraîchit toute seule)
- [ ] Bouton 🔒 dans l'en-tête → déconnexion + retour à l'écran de login
- [ ] Simuler une erreur (policy désactivée, mauvais GRANT) → message
      d'erreur Supabase affiché clairement, pas un écran vide
