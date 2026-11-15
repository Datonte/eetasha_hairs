-- ============================================================
--  eetashacollection — Security lockdown  (run ONCE, safe to re-run)
--  Supabase Dashboard → SQL Editor → New Query → paste → Run
--
--  WHY: the public "anon" key is sent to every visitor's browser
--  (it is needed for customer login). With Row Level Security
--  switched OFF, that key can also read and edit every table
--  directly — customer orders, admin password hashes, prices and
--  the bank details shown at checkout.
--
--  The website itself only touches these tables through the server,
--  which uses the service-role key. That key bypasses RLS, so turning
--  RLS on with NO policies blocks outsiders without breaking the site.
-- ============================================================

-- 1. Turn Row Level Security ON for every app table
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admins   ENABLE ROW LEVEL SECURITY;

-- 2. Belt and braces: remove direct table access from the public roles
REVOKE ALL ON public.products FROM anon, authenticated;
REVOKE ALL ON public.orders   FROM anon, authenticated;
REVOKE ALL ON public.settings FROM anon, authenticated;
REVOKE ALL ON public.admins   FROM anon, authenticated;

-- 3. Check the result — every row should show rls_enabled = true
SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY 1;

-- 4. Is the admin password still the old default that was published in the repo?
--    "still_default = true" means: log in to /admin now — the site will make you change it.
SELECT username,
       extensions.crypt('eetasha2024', password_hash) = password_hash AS still_default
FROM public.admins;
