-- ============================================================
--  eetashacollection — add storage for the private price lists
--  Run ONCE: Supabase Dashboard → SQL Editor → New query → paste → Run
--  Safe to re-run. Does not change any existing data.
-- ============================================================
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS pricing JSONB;

-- Make the website's server notice the new column straight away
NOTIFY pgrst, 'reload schema';

-- Check: should list "pricing"
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'settings' AND column_name = 'pricing';
