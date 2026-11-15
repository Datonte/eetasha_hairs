/* ============================================================
   eetashacollection — Pricing engine (shared by browser + server)

   All supplier prices are stored in US dollars, exactly as on the
   supplier sheets, and converted to pounds with ONE exchange rate.
   When the dollar moves, change the rate and every price follows.

   Unit cost = bundles × weft price (per 100g bundle)
             + closure/frontal price
             + pieces × (texture add-on + colour add-on)
   where pieces = number of bundles + 1 if a closure/frontal is included.

   SUPPLIER COSTS ARE PRIVATE. This file is public (the site serves it and
   the repo is public), so it contains NO prices — only the table layout.
   The real numbers live in the database and are only sent to the admin.
   ============================================================ */
(function (root) {
  'use strict';

  const WEFT_LENGTHS = [8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30];
  const LACE_LENGTHS = [8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28];
  const blank = lengths => Object.fromEntries(lengths.map(l => [l, null]));
  const blankGrades = () => ({ single: blank(WEFT_LENGTHS), double: blank(WEFT_LENGTHS), sdd: blank(WEFT_LENGTHS) });

  // Empty layout. Fill it in the admin Pricing tab (or import the private price file).
  const DEFAULT_PRICING = {
    version: 1,
    usdToGbp: 0.757,                 // $1 = £0.757 (mid-market, 15 Nov 2026)
    markupPercent: null,             // set later — selling price = cost × (1 + markup%)
    wigMakingGbp: 15,                // optional service added to a unit
    weftLists: {
      list1: { label: 'Weft list 1', grades: blankGrades() },
      list2: { label: 'Weft list 2', grades: blankGrades() },
    },
    laces: {
      closure: { '2x4': blank(LACE_LENGTHS), '2x6': blank(LACE_LENGTHS), '4x4': blank(LACE_LENGTHS), '5x5': blank(LACE_LENGTHS), '6x6': blank(LACE_LENGTHS) },
      frontal: { '13x4': blank(LACE_LENGTHS), '13x6': blank(LACE_LENGTHS) },
    },
    // Supplier surcharges in USD, charged on EVERY piece (each bundle and the closure/frontal)
    addons: {
      texture: { 'Natural straight': 0, 'Bone straight': null, 'Body wave': null, 'Wave': null, 'Curly': null },
      colour:  { 'Natural colour': 0, 'Colour #2–#18': null, 'Colour #24 / #613 / #60 / Ash': null },
    },
  };

  const GRADE_LABELS = { single: 'Single drawn', double: 'Double drawn', sdd: 'Super double drawn' };
  const money = n => Math.round(n * 100) / 100;

  // Find a lace (closure or frontal) price table by size, e.g. '5x5' or '13x6'
  function laceTable(pricing, size) {
    for (const kind of Object.keys(pricing.laces || {})) {
      if (pricing.laces[kind][size]) return { kind, table: pricing.laces[kind][size] };
    }
    return null;
  }

  /**
   * sel = {
   *   weftList: 'list1', grade: 'sdd', length: 20, bundles: 3,
   *   lace: '13x6' | null, laceLength: 18,
   *   texture: 'Body wave', colour: 'Natural colour', wigMaking: false
   * }
   * Returns a full breakdown, or { error } when a combination is not on the supplier list.
   */
  function computeUnit(pricing, sel) {
    const p = pricing || DEFAULT_PRICING;
    const rate = Number(p.usdToGbp) || DEFAULT_PRICING.usdToGbp;
    const list = p.weftLists?.[sel.weftList];
    if (!list) return { error: 'Unknown weft list.' };
    const grade = list.grades?.[sel.grade];
    if (!grade) return { error: 'Unknown hair grade.' };
    const bundles = Math.max(0, Math.floor(Number(sel.bundles) || 0));
    const lines = [];
    let usd = 0;

    if (bundles > 0) {
      const each = Number(grade[sel.length]);
      if (!(each > 0)) return { error: `${sel.length}" ${GRADE_LABELS[sel.grade] || sel.grade} bundles are not on the supplier list.` };
      usd += each * bundles;
      lines.push({ label: `${bundles} × ${sel.length}" ${GRADE_LABELS[sel.grade] || sel.grade} bundle${bundles > 1 ? 's' : ''}`, usd: each * bundles });
    }

    let lacePieces = 0;
    if (sel.lace) {
      const found = laceTable(p, sel.lace);
      const laceLen = sel.laceLength || sel.length;
      const price = Number(found?.table?.[laceLen]);
      if (!(price > 0)) return { error: `${laceLen}" ${sel.lace} ${found?.kind || 'lace'} is not on the supplier list.` };
      usd += price;
      lacePieces = 1;
      lines.push({ label: `${laceLen}" ${sel.lace} ${found.kind}`, usd: price });
    }

    const pieces = bundles + lacePieces;
    if (pieces === 0) return { error: 'Choose at least one bundle or a closure/frontal.' };

    const texUsd = Number(p.addons?.texture?.[sel.texture] || 0);
    const colUsd = Number(p.addons?.colour?.[sel.colour] || 0);
    if (texUsd) { usd += texUsd * pieces; lines.push({ label: `${sel.texture}: ${pieces} piece${pieces > 1 ? 's' : ''} × $${texUsd}`, usd: texUsd * pieces }); }
    if (colUsd) { usd += colUsd * pieces; lines.push({ label: `${sel.colour}: ${pieces} piece${pieces > 1 ? 's' : ''} × $${colUsd}`, usd: colUsd * pieces }); }

    const costGbp = money(usd * rate);
    for (const l of lines) l.gbp = money(l.usd * rate);

    const wigMakingGbp = sel.wigMaking ? Number(p.wigMakingGbp || 0) : 0;
    const markup = p.markupPercent === null || p.markupPercent === '' || p.markupPercent === undefined ? null : Number(p.markupPercent);
    const sellGbp = markup === null || !isFinite(markup) ? null : money(costGbp * (1 + markup / 100) + wigMakingGbp);

    return { pieces, lines, costUsd: money(usd), costGbp, wigMakingGbp, markupPercent: markup, sellGbp };
  }

  // Copy only known fields with sane numbers onto a fresh layout (used before saving).
  function sanitizePricing(input) {
    const src = input && typeof input === 'object' ? input : {};
    const out = JSON.parse(JSON.stringify(DEFAULT_PRICING));
    const num = (v, max) => { if (v === null || v === '' || v === undefined) return null; const n = Number(v); return isFinite(n) && n >= 0 && n <= max ? Math.round(n * 100) / 100 : null; };

    const rate = Number(src.usdToGbp);
    out.usdToGbp = isFinite(rate) && rate > 0.2 && rate < 3 ? Math.round(rate * 100000) / 100000 : DEFAULT_PRICING.usdToGbp;
    out.markupPercent = num(src.markupPercent, 1000);
    out.wigMakingGbp = num(src.wigMakingGbp, 1000) ?? DEFAULT_PRICING.wigMakingGbp;

    for (const listId of Object.keys(out.weftLists)) {
      const s = src.weftLists?.[listId];
      if (!s) continue;
      if (typeof s.label === 'string' && s.label.trim()) out.weftLists[listId].label = s.label.trim().slice(0, 60);
      for (const g of Object.keys(out.weftLists[listId].grades)) {
        for (const len of WEFT_LENGTHS) out.weftLists[listId].grades[g][len] = num(s.grades?.[g]?.[len], 10000);
      }
    }
    for (const kind of Object.keys(out.laces)) {
      for (const size of Object.keys(out.laces[kind])) {
        for (const len of LACE_LENGTHS) out.laces[kind][size][len] = num(src.laces?.[kind]?.[size]?.[len], 10000);
      }
    }
    for (const group of Object.keys(out.addons)) {
      for (const name of Object.keys(out.addons[group])) {
        const v = num(src.addons?.[group]?.[name], 1000);
        out.addons[group][name] = v === null ? out.addons[group][name] : v;
      }
    }
    return out;
  }

  const api = { DEFAULT_PRICING, WEFT_LENGTHS, LACE_LENGTHS, GRADE_LABELS, computeUnit, laceTable, sanitizePricing };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Pricing = api;
})(typeof window !== 'undefined' ? window : this);
