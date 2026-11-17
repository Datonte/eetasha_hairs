-- ============================================================
--  eetashacollection — shop extras (run once in Supabase → SQL Editor)
--  Adds:
--    products.details     → sale % and "ready to ship / made to order" per product
--    settings.shop_options → shop-wide switches (e.g. Pay in 3 with Klarna)
--  Safe to run more than once.
-- ============================================================
alter table public.products add column if not exists details jsonb not null default '{}'::jsonb;
alter table public.settings add column if not exists shop_options jsonb not null default '{}'::jsonb;

-- Make the API see the new columns straight away
notify pgrst, 'reload schema';
