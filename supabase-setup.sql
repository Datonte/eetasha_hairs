-- ============================================================
--  ee_tasha hairs — Supabase Database Setup
--  Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- PRODUCTS
CREATE TABLE IF NOT EXISTS products (
  id          UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT         NOT NULL,
  price       DECIMAL(10,2) NOT NULL CHECK (price >= 0),
  category    TEXT         NOT NULL,
  description TEXT         DEFAULT '',
  image_url   TEXT         DEFAULT '',
  in_stock    BOOLEAN      DEFAULT true,
  featured    BOOLEAN      DEFAULT false,
  created_at  TIMESTAMPTZ  DEFAULT now()
);

-- ORDERS  (items stored as a JSONB array)
CREATE TABLE IF NOT EXISTS orders (
  id               UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  order_number     TEXT         NOT NULL UNIQUE,
  user_id          UUID         REFERENCES auth.users(id) ON DELETE SET NULL,
  customer_name    TEXT         NOT NULL,
  customer_email   TEXT         NOT NULL,
  customer_phone   TEXT         NOT NULL,
  delivery_address TEXT         NOT NULL,
  subtotal         DECIMAL(10,2) NOT NULL DEFAULT 0,
  delivery_fee     DECIMAL(10,2) NOT NULL DEFAULT 0,
  total            DECIMAL(10,2) NOT NULL DEFAULT 0,
  payment_method   TEXT         NOT NULL CHECK (payment_method IN ('stripe','transfer')),
  payment_status   TEXT         NOT NULL DEFAULT 'pending',
  order_status     TEXT         NOT NULL DEFAULT 'pending',
  stripe_session_id TEXT,
  items            JSONB        NOT NULL DEFAULT '[]',
  created_at       TIMESTAMPTZ  DEFAULT now()
);

-- SETTINGS  (single row, enforced by CHECK on id)
CREATE TABLE IF NOT EXISTS settings (
  id             INT  DEFAULT 1 PRIMARY KEY CHECK (id = 1),
  whatsapp       TEXT DEFAULT '+447951828832',
  instagram      TEXT DEFAULT '@ee_tasha.hairs',
  bank_name      TEXT DEFAULT '',
  sort_code      TEXT DEFAULT '',
  account_number TEXT DEFAULT '',
  account_name   TEXT DEFAULT 'ee_tasha hairs',
  currency       TEXT DEFAULT '£',
  delivery_fee   TEXT DEFAULT '5.99'
);
INSERT INTO settings (id) VALUES (1) ON CONFLICT DO NOTHING;

-- ADMINS  (separate from Supabase Auth — keeps admin system unchanged)
CREATE TABLE IF NOT EXISTS admins (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  username      TEXT        NOT NULL UNIQUE,
  password_hash TEXT        NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
--  Row Level Security
--  All access goes through the Express API (service role key)
--  which bypasses RLS, so we disable it for simplicity.
-- ============================================================
ALTER TABLE products DISABLE ROW LEVEL SECURITY;
ALTER TABLE orders   DISABLE ROW LEVEL SECURITY;
ALTER TABLE settings DISABLE ROW LEVEL SECURITY;
ALTER TABLE admins   DISABLE ROW LEVEL SECURITY;

-- ============================================================
--  Done! The server will seed the admin account and
--  sample products automatically on first startup.
-- ============================================================
