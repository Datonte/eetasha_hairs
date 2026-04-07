-- ================================================================
-- ee_tasha.hairs — Product Seed Script
-- Run ONCE in Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- Safe to re-run: each INSERT is guarded by WHERE NOT EXISTS
-- Prices cross-referenced from the 6 wholesale price sheet images
-- ================================================================

-- Ensure variants column exists (run this separately if not done already)
ALTER TABLE products ADD COLUMN IF NOT EXISTS variants JSONB DEFAULT NULL;


-- ================================================================
-- 1. RAW HAIR BUNDLES
--    Source: Images 3 (natural) + 4 (coloured)
--    Key format: "{inches}-{bundles}-{colour}"
--    Colour tiers: Natural (1B) | Colours 1-6# | Other Colours
--    Bundle counts: <30" → 3 or 4 bundles; 30" → 3, 4, or 5 bundles
-- ================================================================
INSERT INTO products (name, price, category, description, in_stock, featured, variants)
SELECT
  'Raw Hair Bundles',
  192.00,
  'Bundles',
  'Premium raw hair bundles. Natural texture, full from root to tip. Choose your length, bundle count, and colour.',
  true, true,
  '{
    "enabled": true,
    "variant_type": "bundle",
    "inches": [12,14,16,18,20,22,24,26,28,30],
    "colours": ["Natural (1B)","Colours 1-6#","Other Colours"],
    "prices": {
      "12-3-Natural (1B)": 201,  "12-4-Natural (1B)": 268,
      "14-3-Natural (1B)": 213,  "14-4-Natural (1B)": 284,
      "16-3-Natural (1B)": 234,  "16-4-Natural (1B)": 312,
      "18-3-Natural (1B)": 270,  "18-4-Natural (1B)": 360,
      "20-3-Natural (1B)": 315,  "20-4-Natural (1B)": 420,
      "22-3-Natural (1B)": 336,  "22-4-Natural (1B)": 448,
      "24-3-Natural (1B)": 375,  "24-4-Natural (1B)": 500,
      "26-3-Natural (1B)": 390,  "26-4-Natural (1B)": 520,
      "28-3-Natural (1B)": 411,  "28-4-Natural (1B)": 548,
      "30-3-Natural (1B)": 447,  "30-4-Natural (1B)": 596,  "30-5-Natural (1B)": 745,

      "16-3-Colours 1-6#": 261,  "16-4-Colours 1-6#": 348,
      "18-3-Colours 1-6#": 192,  "18-4-Colours 1-6#": 256,
      "20-3-Colours 1-6#": 243,  "20-4-Colours 1-6#": 324,
      "22-3-Colours 1-6#": 270,  "22-4-Colours 1-6#": 360,
      "24-3-Colours 1-6#": 327,  "24-4-Colours 1-6#": 436,
      "26-3-Colours 1-6#": 348,  "26-4-Colours 1-6#": 464,

      "16-3-Other Colours": 276, "16-4-Other Colours": 368,
      "18-3-Other Colours": 207, "18-4-Other Colours": 276,
      "20-3-Other Colours": 255, "20-4-Other Colours": 340,
      "22-3-Other Colours": 285, "22-4-Other Colours": 380,
      "24-3-Other Colours": 342, "24-4-Other Colours": 456,
      "26-3-Other Colours": 363, "26-4-Other Colours": 484,
      "28-3-Other Colours": 411, "28-4-Other Colours": 548
    },
    "unavailable": []
  }'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name = 'Raw Hair Bundles');


-- ================================================================
-- 2. VIRGIN HAIR BUNDLES (Double Drawn)
--    Source: Image 1 — BW/ST column (~100g)
--    Natural colour only
-- ================================================================
INSERT INTO products (name, price, category, description, in_stock, featured, variants)
SELECT
  'Virgin Hair Bundles',
  183.00,
  'Bundles',
  'Double drawn virgin hair bundles. BW/ST texture (~100g). Silky, smooth, and full from root to tip.',
  true, false,
  '{
    "enabled": true,
    "variant_type": "bundle",
    "inches": [12,14,16,18,20,22,24,26,28,30],
    "colours": ["Natural (1B)"],
    "prices": {
      "12-3-Natural (1B)": 183,  "12-4-Natural (1B)": 244,
      "14-3-Natural (1B)": 198,  "14-4-Natural (1B)": 264,
      "16-3-Natural (1B)": 213,  "16-4-Natural (1B)": 284,
      "18-3-Natural (1B)": 222,  "18-4-Natural (1B)": 296,
      "20-3-Natural (1B)": 252,  "20-4-Natural (1B)": 336,
      "22-3-Natural (1B)": 273,  "22-4-Natural (1B)": 364,
      "24-3-Natural (1B)": 300,  "24-4-Natural (1B)": 400,
      "26-3-Natural (1B)": 321,  "26-4-Natural (1B)": 428,
      "28-3-Natural (1B)": 351,  "28-4-Natural (1B)": 468,
      "30-3-Natural (1B)": 360,  "30-4-Natural (1B)": 480,  "30-5-Natural (1B)": 600
    },
    "unavailable": []
  }'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name = 'Virgin Hair Bundles');


-- ================================================================
-- 3. RAW HAIR WIG — HD LACE
--    Source: Image 2 (HD section)
--    Key format: "{inches}-{lace_size}"
--    16–20": made with 2 bundles | 22–28": made with 3 bundles
-- ================================================================
INSERT INTO products (name, price, category, description, in_stock, featured, variants)
SELECT
  'Raw Hair Wig — HD Lace',
  221.00,
  'Wigs',
  'Raw hair HD lace wigs. Choose your length and lace size. 16-20" uses 2 bundles; 22-28" uses 3 bundles.',
  true, true,
  '{
    "enabled": true,
    "variant_type": "wig",
    "inches": [16,18,20,22,24,26,28],
    "lace_sizes": ["2x6","5x5","6x6","13x4","13x6"],
    "prices": {
      "16-2x6": 221,  "16-5x5": 259,  "16-6x6": 256,  "16-13x4": 264,  "16-13x6": 345,
      "18-2x6": 228,  "18-5x5": 273,  "18-6x6": 307,  "18-13x4": 316,  "18-13x6": 363,
      "20-2x6": 244,  "20-5x5": 316,  "20-6x6": 352,  "20-13x4": 365,  "20-13x6": 414,
      "22-2x6": 339,  "22-5x5": 398,  "22-6x6": 421,  "22-13x4": 434,  "22-13x6": 483,
      "24-2x6": 384,  "24-5x5": 430,  "24-6x6": 466,  "24-13x4": 479,  "24-13x6": 564,
      "26-2x6": 420,  "26-5x5": 466,  "26-6x6": 502,  "26-13x4": 515,  "26-13x6": 497,
      "28-2x6": 462,  "28-5x5": 508,  "28-6x6": 544,  "28-13x4": 557,  "28-13x6": 641
    },
    "unavailable": []
  }'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name = 'Raw Hair Wig — HD Lace');


-- ================================================================
-- 4. RAW HAIR WIG — TRANSPARENT LACE
--    Source: Image 2 (TP / Transparent section)
--    Includes U/V Part option
-- ================================================================
INSERT INTO products (name, price, category, description, in_stock, featured, variants)
SELECT
  'Raw Hair Wig — Transparent Lace',
  159.00,
  'Wigs',
  'Raw hair transparent lace wigs. Lightweight, natural-looking hairline. Also available in U/V part style.',
  true, false,
  '{
    "enabled": true,
    "variant_type": "wig",
    "inches": [16,18,20,22,24,26,28],
    "lace_sizes": ["2x6","5x5","6x6","13x4","13x6","U/V Part"],
    "prices": {
      "16-2x6": 213,  "16-5x5": 213,  "16-6x6": 233,  "16-13x4": 242,  "16-13x6": 315,  "16-U/V Part": 159,
      "18-2x6": 197,  "18-5x5": 245,  "18-6x6": 284,  "18-13x4": 293,  "18-13x6": 333,  "18-U/V Part": 171,
      "20-2x6": 237,  "20-5x5": 304,  "20-6x6": 329,  "20-13x4": 342,  "20-13x6": 384,  "20-U/V Part": 164,
      "22-2x6": 332,  "22-5x5": 373,  "22-6x6": 398,  "22-13x4": 411,  "22-13x6": 453,  "22-U/V Part": 259,
      "24-2x6": 377,  "24-5x5": 418,  "24-6x6": 443,  "24-13x4": 456,  "24-13x6": 498,  "24-U/V Part": 304,
      "26-2x6": 413,  "26-5x5": 454,  "26-6x6": 479,  "26-13x4": 492,  "26-13x6": 534,  "26-U/V Part": 340,
      "28-2x6": 455,  "28-5x5": 490,  "28-6x6": 521,  "28-13x4": 534,  "28-13x6": 611,  "28-U/V Part": 417
    },
    "unavailable": []
  }'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name = 'Raw Hair Wig — Transparent Lace');


-- ================================================================
-- 5. RAW HD LACE CLOSURE
--    Source: Image 3 (Closure HD columns)
--    Key format: "{lace_size}-{inches}"
-- ================================================================
INSERT INTO products (name, price, category, description, in_stock, featured, variants)
SELECT
  'Raw HD Lace Closure',
  62.00,
  'Closures',
  'Raw hair HD lace closures. Available in 2x6, 4x4, 5x5, and 6x6 sizes. Natural (1B) colour.',
  true, false,
  '{
    "enabled": true,
    "variant_type": "closure",
    "lace_sizes": ["2x6","4x4","5x5","6x6"],
    "inches": [12,14,16,18,20,22],
    "prices": {
      "2x6-12": 62,  "2x6-14": 65,  "2x6-16": 72,  "2x6-18": 81,  "2x6-20": 88,  "2x6-22": 98,
      "4x4-12": 69,  "4x4-14": 73,  "4x4-16": 81,  "4x4-18": 93,  "4x4-20": 102, "4x4-22": 114,
      "5x5-12": 82,  "5x5-14": 88,  "5x5-16": 97,  "5x5-18": 110, "5x5-20": 121, "5x5-22": 132,
      "6x6-12": 97,  "6x6-14": 106, "6x6-16": 118, "6x6-18": 131, "6x6-20": 145, "6x6-22": 153
    },
    "unavailable": []
  }'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name = 'Raw HD Lace Closure');


-- ================================================================
-- 6. RAW HD LACE FRONTAL
--    Source: Image 3 (Frontal HD columns)
-- ================================================================
INSERT INTO products (name, price, category, description, in_stock, featured, variants)
SELECT
  'Raw HD Lace Frontal',
  108.00,
  'Frontals',
  'Raw hair HD lace frontals. Available in 13x4 and 13x6 sizes. Ear-to-ear coverage. Natural (1B) colour.',
  true, false,
  '{
    "enabled": true,
    "variant_type": "frontal",
    "lace_sizes": ["13x4","13x6"],
    "inches": [12,14,16,18,20,22],
    "prices": {
      "13x4-12": 108, "13x4-14": 115, "13x4-16": 131, "13x4-18": 147, "13x4-20": 162, "13x4-22": 173,
      "13x6-12": 124, "13x6-14": 131, "13x6-16": 150, "13x6-18": 170, "13x6-20": 186, "13x6-22": 197
    },
    "unavailable": []
  }'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name = 'Raw HD Lace Frontal');


-- ================================================================
-- 7. RAW TRANSPARENT LACE CLOSURE
--    Source: Image 4 (Transparent Lace Closure section)
-- ================================================================
INSERT INTO products (name, price, category, description, in_stock, featured, variants)
SELECT
  'Raw Transparent Lace Closure',
  54.00,
  'Closures',
  'Raw hair transparent lace closures. Light, breathable lace for a natural finish. Available in 2x6, 5x5, and 6x6.',
  true, false,
  '{
    "enabled": true,
    "variant_type": "closure",
    "lace_sizes": ["2x6","5x5","6x6"],
    "inches": [16,18,20],
    "prices": {
      "2x6-16": 54,  "2x6-18": 61,  "2x6-20": 108,
      "5x5-16": 86,  "5x5-18": 97,  "5x5-20": 114,
      "6x6-16": 109, "6x6-18": 120, "6x6-20": 139
    },
    "unavailable": []
  }'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name = 'Raw Transparent Lace Closure');


-- ================================================================
-- 8. RAW TRANSPARENT LACE FRONTAL
--    Source: Image 4 (Transparent Lace Frontal section)
-- ================================================================
INSERT INTO products (name, price, category, description, in_stock, featured, variants)
SELECT
  'Raw Transparent Lace Frontal',
  118.00,
  'Frontals',
  'Raw hair transparent lace frontals. 13x4 and 13x6 options. Light and blendable for all skin tones.',
  true, false,
  '{
    "enabled": true,
    "variant_type": "frontal",
    "lace_sizes": ["13x4","13x6"],
    "inches": [16,18,20],
    "prices": {
      "13x4-16": 118, "13x4-18": 130, "13x4-20": 152,
      "13x6-16": 156, "13x6-18": 169, "13x6-20": 194
    },
    "unavailable": []
  }'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name = 'Raw Transparent Lace Frontal');


-- ================================================================
-- 9. BIG LACE WIG — BLACK (32"–40")
--    Source: Image 5 (HD Lace, Black colour)
--    Key format: "{inches}-{lace_size}"
-- ================================================================
INSERT INTO products (name, price, category, description, in_stock, featured, variants)
SELECT
  'Big Lace Wig — Black (32"–40")',
  641.00,
  'Wigs',
  'Luxury extra-long HD lace wigs in black. Available from 32 to 40 inches. Make a statement.',
  true, false,
  '{
    "enabled": true,
    "variant_type": "big-wig",
    "inches": [32,34,36,38,40],
    "lace_sizes": ["2x6","4x4","5x5","6x6","13x4","13x6"],
    "prices": {
      "32-2x6": 641,  "32-4x4": 668,  "32-5x5": 692,  "32-6x6": 716,  "32-13x4": 745,  "32-13x6": 850,
      "34-2x6": 704,  "34-4x4": 721,  "34-5x5": 748,  "34-6x6": 772,  "34-13x4": 776,  "34-13x6": 825,
      "36-2x6": 742,  "36-4x4": 721,  "36-5x5": 784,  "36-6x6": 804,  "36-13x4": 825,  "36-13x6": 894,
      "38-2x6": 803,  "38-4x4": 803,  "38-5x5": 842,  "38-6x6": 866,  "38-13x4": 879,  "38-13x6": 950,
      "40-2x6": 864,  "40-4x4": 864,  "40-5x5": 898,  "40-6x6": 914,  "40-13x4": 943,  "40-13x6": 1034
    },
    "unavailable": []
  }'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name = 'Big Lace Wig — Black (32"–40")');


-- ================================================================
-- Done! Verify with:
-- SELECT name, category, (variants->>'variant_type') as type,
--        jsonb_array_length(variants->'inches') as inch_count,
--        jsonb_object_keys(variants->'prices')
-- FROM products WHERE variants IS NOT NULL;
-- ================================================================
