-- Transfers move bottles physically but do not alter total stock.
alter table public.wine_movements drop constraint if exists wine_movements_variation_check;
alter table public.wine_movements add constraint wine_movements_variation_check check (
  (type = 'transfert' and variation = 0 and quantite > 0)
  or (type <> 'transfert' and abs(variation) = quantite)
);
