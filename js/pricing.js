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
    wigMakingGbp: 15,                // optional service added to a unit
    stylingGbp: 10,                  // optional styling on top of wig-making
    // Costs on top of the supplier price (filled in on the admin Pricing tab)
    costs: {
      inboundPerPieceGbp: null,      // FedEx from supplier, spread per piece
      dutyPercent: 0,                // UK import duty (about 0% bundles/lace)
      importVatPercent: 20,          // not VAT-registered → import VAT is a real cost
      cardFeePercent: 2,             // card fees can't be charged separately (UK law) → built in
      cardFeeFixedGbp: 0.20,
      packagingGbp: null,            // per order (branded bag, tag, mailer)
    },
    // How the selling price is set:
    //  'fixed'   → real cost + a fixed £ profit that depends on what the customer buys
    //  'percent' → real cost × (1 + markup %)
    profitMode: 'fixed',
    // Fixed £ profit per order type (filled in on the Pricing tab — kept out of public code)
    profits: {
      loose: null,          // bundles + closure/frontal, sent loose (not customised)
      wig: null,            // made into a wig
      customised: null,     // customised wig, straight
      styled: null,         // customised wig, styled (body wave, curls)
      baseBundles: 3,       // the profits above are for this many bundles…
      extraBundle: null,    // …plus this much for each extra bundle
      perBundle: null,      // bundles on their own, per bundle
      laceOnly: null,       // a closure or frontal on its own
    },
    // Markup on the landed cost, by what is being sold (used when profitMode = 'percent')
    markups: { bundles: null, lace: null, units: null },
    rounding: 'x9',                  // 'x9' → £249, £319 · 'pound' → whole pounds · 'none'
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
  // How a bundles + closure/frontal unit is supplied (fixed-profit mode)
  const FINISHES = {
    loose:      'Bundles + closure/frontal (loose)',
    wig:        'Made into a wig',
    customised: 'Customised wig, straight',
    styled:     'Customised wig, styled (body wave, curls)',
  };
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

    const costGbp = money(usd * rate);          // supplier price in pounds
    for (const l of lines) l.gbp = money(l.usd * rate);

    // ── Landed cost: what the unit really costs once it's in your hands ──
    const c = p.costs || {};
    const n = v => (v === null || v === undefined || v === '' || !isFinite(Number(v))) ? 0 : Number(v);
    const inboundGbp   = money(n(c.inboundPerPieceGbp) * pieces);
    const dutyGbp      = money((costGbp + inboundGbp) * n(c.dutyPercent) / 100);
    const vatGbp       = money((costGbp + inboundGbp + dutyGbp) * n(c.importVatPercent) / 100);
    const packagingGbp = money(n(c.packagingGbp));
    const landedGbp    = money(costGbp + inboundGbp + dutyGbp + vatGbp + packagingGbp);

    // ── Selling price ──
    const category = bundles > 0 && lacePieces ? 'units' : (bundles > 0 ? 'bundles' : 'lace');
    const isNum = v => v !== null && v !== undefined && v !== '' && isFinite(Number(v));
    const mode = p.profitMode === 'percent' ? 'percent' : 'fixed';
    const finish = category === 'units' ? (FINISHES[sel.finish] ? sel.finish : 'loose') : null;

    // Card fees come out of the price, so gross the price up to cover them, then round
    const pct = n(c.cardFeePercent) / 100, fixed = n(c.cardFeeFixedGbp);
    const finishPrice = beforeFees => {
      let price = pct < 1 ? (beforeFees + fixed) / (1 - pct) : beforeFees;
      if (p.rounding === 'x9')         price = Math.ceil((price + 1) / 10) * 10 - 1;   // 343.20 → 349
      else if (p.rounding === 'pound') price = Math.ceil(price);
      return money(price);
    };

    let markup = null, targetProfitGbp = null, wigMakingGbp = 0, stylingGbp = 0, servicesGbp = 0, beforeFees = null;
    if (mode === 'fixed') {
      const pr = p.profits || {};
      let target = null;
      if (category === 'units') {
        const base  = Math.max(1, Math.floor(n(pr.baseBundles) || 3));
        const extra = Math.max(0, bundles - base) * n(pr.extraBundle);
        if (isNum(pr[finish])) target = Number(pr[finish]) + extra;
      } else if (category === 'bundles') {
        if (isNum(pr.perBundle)) target = Number(pr.perBundle) * bundles;
      } else if (isNum(pr.laceOnly)) {
        target = Number(pr.laceOnly);
      }
      if (target !== null) { targetProfitGbp = money(target); beforeFees = landedGbp + target; }
    } else {
      const rawMarkup = p.markups?.[category];
      markup = isNum(rawMarkup) ? Number(rawMarkup) : null;
      wigMakingGbp = sel.wigMaking ? n(p.wigMakingGbp) : 0;
      stylingGbp   = sel.styling   ? n(p.stylingGbp)   : 0;
      servicesGbp  = money(wigMakingGbp + stylingGbp);
      if (markup !== null) beforeFees = landedGbp * (1 + markup / 100) + servicesGbp;
    }

    let sellGbp = null, cardFeeGbp = null, profitGbp = null;
    if (beforeFees !== null) {
      sellGbp    = finishPrice(beforeFees);
      cardFeeGbp = money(sellGbp * pct + fixed);
      profitGbp  = money(sellGbp - landedGbp - cardFeeGbp);
    }

    return {
      pieces, lines, costUsd: money(usd), costGbp,
      inboundGbp, dutyGbp, vatGbp, packagingGbp, landedGbp,
      category, mode, finish, targetProfitGbp,
      markupPercent: markup, wigMakingGbp, stylingGbp, servicesGbp,
      sellGbp, cardFeeGbp, profitGbp,
    };
  }

  // Copy only known fields with sane numbers onto a fresh layout (used before saving).
  function sanitizePricing(input) {
    const src = input && typeof input === 'object' ? input : {};
    const out = JSON.parse(JSON.stringify(DEFAULT_PRICING));
    const num = (v, max) => { if (v === null || v === '' || v === undefined) return null; const n = Number(v); return isFinite(n) && n >= 0 && n <= max ? Math.round(n * 100) / 100 : null; };

    const rate = Number(src.usdToGbp);
    out.usdToGbp = isFinite(rate) && rate > 0.2 && rate < 3 ? Math.round(rate * 100000) / 100000 : DEFAULT_PRICING.usdToGbp;
    out.wigMakingGbp = num(src.wigMakingGbp, 1000) ?? DEFAULT_PRICING.wigMakingGbp;
    out.stylingGbp   = num(src.stylingGbp, 1000) ?? DEFAULT_PRICING.stylingGbp;
    for (const k of Object.keys(out.costs)) {
      const max = k.endsWith('Percent') ? 100 : 1000;
      const v = num(src.costs?.[k], max);
      if (v !== null || src.costs?.[k] === null || src.costs?.[k] === '') out.costs[k] = v;
    }
    for (const k of Object.keys(out.markups)) out.markups[k] = num(src.markups?.[k], 1000);
    // Older saved files had one markup for everything — use it as the starting point
    if (src.markups === undefined && num(src.markupPercent, 1000) !== null) {
      for (const k of Object.keys(out.markups)) out.markups[k] = num(src.markupPercent, 1000);
    }
    out.rounding = ['x9', 'pound', 'none'].includes(src.rounding) ? src.rounding : DEFAULT_PRICING.rounding;
    out.profitMode = ['fixed', 'percent'].includes(src.profitMode) ? src.profitMode : DEFAULT_PRICING.profitMode;
    for (const k of Object.keys(out.profits)) {
      if (k === 'baseBundles') {
        const b = Math.floor(Number(src.profits?.baseBundles));
        out.profits.baseBundles = b >= 1 && b <= 10 ? b : DEFAULT_PRICING.profits.baseBundles;
      } else {
        out.profits[k] = num(src.profits?.[k], 5000);
      }
    }

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

  // ============================================================
  //  PRODUCTS PRICED BY THIS ENGINE  (variant_type: 'built')
  //  A product only stores WHICH options it offers; prices always come from
  //  the private pricing settings, so changing a cost updates every product.
  // ============================================================
  const TEXTURES = ['Natural straight', 'Bone straight', 'Body wave', 'Wave', 'Curly'];
  const COLOUR_NATURAL = 'Natural colour', COLOUR_MID = 'Colour #2–#18', COLOUR_HIGH = 'Colour #24 / #613 / #60 / Ash';
  const COLOUR_GROUPS = [COLOUR_NATURAL, COLOUR_MID, COLOUR_HIGH];
  const MAX_LACE_LENGTH = LACE_LENGTHS[LACE_LENGTHS.length - 1];

  // Which supplier colour surcharge a colour code falls under
  function colourGroup(code) {
    const c = String(code || '').toUpperCase().trim();
    if (c === '1B' || c === '1') return COLOUR_NATURAL;
    if (/^(2|4|6|8|10|12|14|16|18)$/.test(c)) return COLOUR_MID;
    return COLOUR_HIGH;   // #24, #613, #60, ash, ombres, fashion colours…
  }
  const laceLengthFor = len => Math.min(Number(len), MAX_LACE_LENGTH);   // 30" bundles → 28" lace
  const allLaceSizes = pricing => Object.values((pricing || DEFAULT_PRICING).laces || {}).flatMap(k => Object.keys(k));

  // Keep only known values in a product's option settings
  function sanitizeBuiltConfig(input, pricing) {
    const s = input && typeof input === 'object' ? input : {};
    const p = pricing || DEFAULT_PRICING;
    const kind = ['unit', 'bundles', 'lace'].includes(s.kind) ? s.kind : 'unit';
    const pick = (list, allowed, fallback) => {
      const out = (Array.isArray(list) ? list : []).filter(v => allowed.includes(v));
      return out.length ? [...new Set(out)] : fallback;
    };
    const ints = list => (Array.isArray(list) ? list : []).map(Number).filter(Number.isFinite);
    const laceSizes = allLaceSizes(p);
    const lengthPool = kind === 'lace' ? LACE_LENGTHS : WEFT_LENGTHS;
    const cfg = {
      enabled: true,
      variant_type: 'built',
      kind,
      weftList: Object.keys(p.weftLists || {}).includes(s.weftList) ? s.weftList : 'list1',
      grade: Object.keys(GRADE_LABELS).includes(s.grade) ? s.grade : 'sdd',
      lengths: pick(ints(s.lengths), lengthPool, lengthPool.filter(l => l >= 12)).sort((a, b) => a - b),
      bundleCounts: kind === 'lace' ? [] : pick(ints(s.bundleCounts), [1, 2, 3, 4, 5, 6], kind === 'unit' ? [3, 4] : [1, 2, 3, 4]).sort((a, b) => a - b),
      laces: kind === 'bundles' ? [] : pick(s.laces, laceSizes, laceSizes),
      textures: pick(s.textures, TEXTURES, ['Natural straight']),
      colourMode: s.colourMode === 'fixed' ? 'fixed' : 'choose',
      colours: (Array.isArray(s.colours) ? s.colours : []).map(c => String(c).trim().slice(0, 20)).filter(Boolean).slice(0, 80),
      fixedColour: null,
      finishes: kind === 'unit' ? pick(s.finishes, Object.keys(FINISHES), Object.keys(FINISHES)) : [],
    };
    if (cfg.colourMode === 'fixed') {
      const code = String(s.fixedColour?.code || '').trim().slice(0, 20);
      const name = String(s.fixedColour?.name || code || 'Natural').trim().slice(0, 40);
      cfg.fixedColour = { code: code || '1B', name };
    }
    // Combinations this product doesn't come in: "length|bundles|*" (e.g. 12" × 4 bundles)
    // or "length|*|lace" (e.g. 12" with a 13x6 frontal). Customers never see them.
    cfg.excluded = [...new Set((Array.isArray(s.excluded) ? s.excluded : [])
      .map(String).filter(k => /^\d{1,2}\|(\d|\*)\|(\d{1,2}x\d{1,2}|\*)$/.test(k)))].slice(0, 500);
    if (s.legacy && typeof s.legacy === 'object') cfg.legacy = s.legacy;   // old price table kept as a backup
    return cfg;
  }
  function isExcluded(cfg, length, bundles, lace) {
    const ex = cfg.excluded;
    if (!ex || !ex.length) return false;
    return ex.includes(`${length}|${bundles}|*`) || (!!lace && ex.includes(`${length}|*|${lace}`));
  }

  // Turn a customer's choices into an engine selection
  function builtSelection(cfg, s) {
    const colourCode = cfg.colourMode === 'fixed' ? cfg.fixedColour?.code : s.colour;
    return {
      weftList: cfg.weftList, grade: cfg.grade,
      length: Number(s.length),
      bundles: cfg.kind === 'lace' ? 0 : Number(s.bundles),
      lace: cfg.kind === 'bundles' ? null : s.lace,
      laceLength: cfg.kind === 'lace' ? Number(s.length) : laceLengthFor(s.length),
      texture: s.texture,
      colour: s.colourGroup || colourGroup(colourCode),
      finish: cfg.kind === 'unit' ? s.finish : null,
    };
  }

  // Colour groups a product can actually be sold in
  function builtColourGroups(cfg) {
    if (cfg.colourMode === 'fixed') return [colourGroup(cfg.fixedColour?.code)];
    if (!cfg.colours.length) return COLOUR_GROUPS.slice();
    return COLOUR_GROUPS.filter(g => cfg.colours.some(c => colourGroup(c) === g));
  }

  /**
   * Every selling price for a product, as nested arrays:
   * prices[length][bundleCount][lace][texture][colourGroup][finish] = £ or null.
   * Contains ONLY selling prices — safe to send to customers.
   */
  function buildPriceTable(pricing, cfgIn) {
    const cfg = sanitizeBuiltConfig(cfgIn, pricing);
    const dims = {
      lengths: cfg.lengths,
      bundleCounts: cfg.kind === 'lace' ? [0] : cfg.bundleCounts,
      laces: cfg.kind === 'bundles' ? [null] : cfg.laces,
      textures: cfg.textures,
      colourGroups: builtColourGroups(cfg),
      finishes: cfg.kind === 'unit' ? cfg.finishes : [null],
    };
    let fromPrice = null, maxPrice = null;
    const prices = dims.lengths.map(length => dims.bundleCounts.map(bundles => dims.laces.map(lace =>
      dims.textures.map(texture => dims.colourGroups.map(colourGroupName => dims.finishes.map(finish => {
        if (isExcluded(cfg, length, bundles, lace)) return null;   // switched off for this product
        const r = computeUnit(pricing, builtSelection(cfg, { length, bundles, lace, texture, colourGroup: colourGroupName, finish }));
        const v = r.error ? null : r.sellGbp;
        if (v !== null) { fromPrice = fromPrice === null ? v : Math.min(fromPrice, v); maxPrice = maxPrice === null ? v : Math.max(maxPrice, v); }
        return v;
      }))))));
    return { kind: cfg.kind, options: dims, prices, fromPrice, maxPrice };
  }

  // Price + description for one customer choice (used by the server at checkout)
  function quoteBuilt(pricing, cfgIn, s) {
    const cfg = sanitizeBuiltConfig(cfgIn, pricing);
    const len = Number(s.length);
    if (!cfg.lengths.includes(len)) return { error: 'That length is not available.' };
    if (cfg.kind !== 'lace' && !cfg.bundleCounts.includes(Number(s.bundles))) return { error: 'That number of bundles is not available.' };
    if (cfg.kind !== 'bundles' && !cfg.laces.includes(s.lace)) return { error: 'That closure/frontal is not available.' };
    if (!cfg.textures.includes(s.texture)) return { error: 'That texture is not available.' };
    if (cfg.kind === 'unit' && !cfg.finishes.includes(s.finish)) return { error: 'That option is not available.' };
    if (isExcluded(cfg, len, cfg.kind === 'lace' ? 0 : Number(s.bundles), cfg.kind === 'bundles' ? null : s.lace)) return { error: 'That combination is not available for this product.' };
    let colourName;
    if (cfg.colourMode === 'fixed') colourName = cfg.fixedColour.name;
    else {
      const code = String(s.colour || '').trim();
      if (!code || (cfg.colours.length && !cfg.colours.includes(code))) return { error: 'Please choose an available colour.' };
      colourName = code;
    }
    const r = computeUnit(pricing, builtSelection(cfg, s));
    if (r.error || r.sellGbp === null) return { error: 'This option is not available right now.' };
    const lace = cfg.kind === 'bundles' ? null : s.lace;
    const laceKind = lace ? (laceTable(pricing, lace)?.kind || 'lace') : null;
    const parts = [
      `${len}"`,
      cfg.kind === 'lace' ? null : `${s.bundles} bundle${Number(s.bundles) > 1 ? 's' : ''}`,
      lace ? `${cfg.kind === 'lace' ? '' : `${laceLengthFor(len)}" `}${lace} ${laceKind}`.trim() : null,
      s.texture,
      colourName,
      cfg.kind === 'unit' ? FINISHES[s.finish] : null,
    ].filter(Boolean);
    return { price: r.sellGbp, label: parts.join(' · ') };
  }

  // Cart key for a built item: B|length|bundles|lace|texture|colour|finish
  const builtKey = s => ['B', s.length, s.bundles ?? 0, s.lace || '-', s.texture, s.colour || '-', s.finish || '-'].join('|');
  function parseBuiltKey(key) {
    const parts = String(key || '').split('|');
    if (parts.length !== 7 || parts[0] !== 'B') return null;
    return { length: Number(parts[1]), bundles: Number(parts[2]), lace: parts[3] === '-' ? null : parts[3], texture: parts[4], colour: parts[5] === '-' ? null : parts[5], finish: parts[6] === '-' ? null : parts[6] };
  }

  const api = {
    DEFAULT_PRICING, WEFT_LENGTHS, LACE_LENGTHS, GRADE_LABELS, FINISHES, TEXTURES, COLOUR_GROUPS,
    computeUnit, laceTable, sanitizePricing,
    colourGroup, sanitizeBuiltConfig, buildPriceTable, quoteBuilt, builtKey, parseBuiltKey, laceLengthFor,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Pricing = api;
})(typeof window !== 'undefined' ? window : this);
