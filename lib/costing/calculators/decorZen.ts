import { Calculator, CostLine, line, lineTotal, roundUp, safeDiv, sectionTotal } from '../engine/core';
import materialsRaw from '../data/decorzen-materials.json';
import profilesRaw from '../data/decorzen-profiles.json';
import L from '../data/decorzen-lookups.json';

/**
 * Port of DecorZen_Model_-_2026_V2_2.xlsm › Costing, with Materials, Profiles
 * and Factory Recovery. Materials is the price list Alice maintains (see the
 * Governance tab), so every substrate line carries a priceKey = Material ID.
 */
export interface Material {
  id: string; thickness: string; substrate: string; core: string; finish: string; sides: string; name: string;
  supplier: string | null; rateM2: number | null; moqM2: number; pricedOn: string | null; edgeTapePerLm: number | null;
  additionalFinishing: boolean;
}
export interface Profile {
  id: string; thickness: string; substrate: string; artistFee: number; productType: string; code: string;
  cncMinPerSheet: number; cncSetupMin: number; cncSetupEveryM2: number; cncOps: string;
  moulderMinPerSheet: number; moulderSetupMin: number; moulderOps: string;
}
// XLOOKUP returns the first match, so keep the first of any duplicate IDs.
const firstById = <T extends { id: string }>(xs: T[]) => { const m = new Map<string, T>(); xs.forEach((x) => m.has(x.id) || m.set(x.id, x)); return m; };
export const MATERIALS = materialsRaw as Material[];
export const PROFILES = profilesRaw as Profile[];
const MAT = firstById(MATERIALS);
const PROF = firstById(PROFILES);
const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter(Boolean) as string[])];
const productType = (p: string) => L.products.find((x) => x.name === p)?.type ?? '';
// Acoustic labour: Costing!BQ2 = ROUNDUP(5/60*rate/2.88,1) — 5 min per sheet is hardcoded.
const ACOUSTIC_LABOUR_MIN_PER_SHEET: Record<string, number> = { 'Yes - Black': 5 };

export interface DecorZenInputs {
  product: string; profileCode: string; panelSize: string; edgeDetail: string; acoustic: string;
  thickness: string; substrate: string; core: string; finish: string; sides: string; colour: string;
  painting: string; qtyM2: number; marginPct: number; wastagePct: number; complexity: string;
}

const matches = (i: DecorZenInputs) => MATERIALS.filter((m) =>
  (!i.thickness || m.thickness === i.thickness) && (!i.substrate || m.substrate === i.substrate) &&
  (!i.core || m.core === i.core) && (!i.finish || m.finish === i.finish) && (!i.sides || m.sides === i.sides));

export const materialId = (i: DecorZenInputs) =>                          // Costing!B13
  [i.thickness, i.substrate, i.core, i.finish, i.sides, i.colour].every(Boolean)
    ? `${i.thickness} ${i.substrate} ${i.core} - ${i.finish} ${i.colour} ${i.sides}` : '';
export const profileId = (i: DecorZenInputs) =>                           // Costing!B39
  i.thickness && i.substrate && i.profileCode ? `${i.thickness} ${i.substrate} - ${i.profileCode}` : '';

export const decorZen: Calculator<DecorZenInputs> = {
  id: 'decorzen', name: 'DecorZen Model', family: 'Panels', sourceFile: 'DecorZen_Model_-_2026_V2_2.xlsm',
  description: 'Database-driven panel costing: materials price list, profile cycle times, edging, acoustic, painting and complexity.',
  defaults: {
    product: 'DecorZen', profileCode: 'AP125/S/60', panelSize: '2400x1200', edgeDetail: 'Square - matching edging', acoustic: 'Yes - Black',
    thickness: '12mm', substrate: 'FR MDF', core: 'Fireguard (CharCore)', finish: 'Smartlook', sides: 'G1S', colour: 'Hoop Pine',
    painting: '', qtyM2: 200, marginPct: 0.6, wastagePct: 0.15, complexity: 'B',
  },
  presets: [ // the shortcut macros in the workbook
    { name: 'DecorZen SL', values: { product: 'DecorZen', profileCode: 'AP125/S/60', panelSize: '2400x1200', edgeDetail: 'Square - matching edging', acoustic: 'Yes - Black', thickness: '12mm', substrate: 'FR MDF', core: 'Fireguard (CharCore)', finish: 'Smartlook', sides: 'G1S', colour: 'Hoop Pine' } },
    { name: 'DecorTrend SL', values: { product: 'DecorTrend', profileCode: 'AS26-50/80', panelSize: '2400x1200', edgeDetail: 'Square - matching edging', acoustic: 'Yes - Black', thickness: '12mm', substrate: 'FR MDF', core: 'Fireguard (CharCore)', finish: 'Smartlook', sides: 'G1S', colour: 'Hoop Pine' } },
    { name: 'DecorStyle SL', values: { product: 'DecorStyle', profileCode: 'Solid', panelSize: '2400x1200', edgeDetail: 'Square - matching edging', acoustic: 'None', thickness: '12mm', substrate: 'FR MDF', core: 'Fireguard (CharCore)', finish: 'Smartlook', sides: 'G1S', colour: 'Hoop Pine' } },
  ],
  inputs: [
    { key: 'product', label: 'Product', type: 'select', group: 'Product', options: L.products.map((p) => p.name) },
    { key: 'thickness', label: 'Thickness', type: 'select', group: 'Material & substrate', options: () => uniq(MATERIALS.map((m) => m.thickness)) },
    { key: 'substrate', label: 'Substrate type', type: 'select', group: 'Material & substrate', options: (i) => uniq(matches({ ...i, substrate: '', core: '', finish: '', sides: '' }).map((m) => m.substrate)) },
    { key: 'core', label: 'Substrate core', type: 'select', group: 'Material & substrate', options: (i) => uniq(matches({ ...i, core: '', finish: '', sides: '' }).map((m) => m.core)) },
    { key: 'finish', label: 'Finish type', type: 'select', group: 'Material & substrate', options: (i) => uniq(matches({ ...i, finish: '', sides: '' }).map((m) => m.finish)) },
    { key: 'sides', label: 'G1S or G2S', type: 'select', group: 'Material & substrate', options: (i) => uniq(matches({ ...i, sides: '' }).map((m) => m.sides)) },
    { key: 'colour', label: 'Finish colour / species', type: 'select', group: 'Material & substrate', options: (i) => uniq(matches(i).map((m) => m.name)) },
    { key: 'profileCode', label: 'Profile code', type: 'select', group: 'Product',
      options: (i) => uniq(PROFILES.filter((p) => p.thickness === i.thickness && p.substrate === i.substrate && p.productType === i.product).map((p) => p.code)) },
    { key: 'panelSize', label: 'Panel size', type: 'select', group: 'Product', options: (i) => L.sheetSizes.filter((s) => s.type === productType(i.product)).map((s) => s.name) },
    { key: 'edgeDetail', label: 'Edge detail', type: 'select', group: 'Product', options: (i) => L.edgeDetails.filter((e) => e.productType === productType(i.product)).map((e) => e.name) },
    { key: 'acoustic', label: 'Acoustic lining', type: 'select', group: 'Product', options: L.acoustic.map((a) => a.option) },
    { key: 'painting', label: 'Additional finishing', type: 'select', group: 'Material & substrate',
      options: (i) => ['', ...uniq(L.paint.filter((p) => p.productType === productType(i.product)).map((p) => p.paint))],
      visible: (i) => !!MAT.get(materialId(i))?.additionalFinishing },
    { key: 'qtyM2', label: 'Quantity', unit: 'm²', type: 'number', group: 'Project', min: 1 },
    { key: 'marginPct', label: 'Margin', type: 'percent', group: 'Project' },
    { key: 'wastagePct', label: 'Wastage', type: 'percent', group: 'Project' },
    { key: 'complexity', label: 'Complexity', type: 'select', group: 'Project', options: L.complexity.map((c) => c.grade),
      help: L.complexity.map((c) => `${c.grade}: ${c.notes}`).join('\n') },
  ],
  compute(i, ctx) {
    const rate = ctx.settings.labourRate;
    const q = i.qtyM2, w = i.wastagePct;
    const type = productType(i.product);
    const mid = materialId(i), pid = profileId(i);
    const mat = MAT.get(mid);
    const prof = PROF.get(pid);
    const size = L.sheetSizes.find((s) => s.name === i.panelSize);
    const edge = L.edgeDetails.find((e) => e.name === i.edgeDetail);
    const ac = L.acoustic.find((a) => a.option === i.acoustic);
    const warnings = [] as { level: 'info' | 'warn'; message: string }[];
    if (mid && !mat) warnings.push({ level: 'warn', message: `No material in the price list for "${mid}"` });
    if (pid && !prof) warnings.push({ level: 'warn', message: `No profile cycle times for "${pid}"` });
    if (mat && mat.rateM2 == null) warnings.push({ level: 'warn', message: 'Custom material — enter the rate as an override' });

    // Materials!L — MOQ applied when the job is smaller than the minimum order
    const listRate = mat?.rateM2 ?? 0;
    const moqApplies = !!mat && q < mat.moqM2;
    if (moqApplies) warnings.push({ level: 'info', message: `Below MOQ of ${mat!.moqM2.toFixed(1)} m² — material rate scaled up` });
    const area = size ? (size.length * size.width) / 1e6 : 0;
    const tapePerM2 = size && size.minPerSheet != null ? roundUp(((size.length + size.width) * 2 / 1000) / area, 1) : 0; // BF
    const edgeLabourMinPerM2 = size && size.operators ? roundUp((size.operators * size.minPerSheet) / area, 1) : 0;     // BI
    const usesTape = edge?.usesTape ? 1 : 0;
    const paint = mat?.additionalFinishing ? L.paint.find((p) => p.productType === type && p.paint === i.painting) : undefined;
    const perM2Cost = (min: number) => roundUp((min / 60) * rate / 2.88, 1);
    const setupCost = (min: number, d = 0) => roundUp((min / 60) * rate, d);

    const lines: CostLine[] = [
      // ---- MATERIALS (wastage = H4)
      line(ctx, { id: 'substrate', section: 'material', label: 'Substrate', description: mid || 'Select material',
        qty: q, unit: 'm²', rate: moqApplies ? (listRate * mat!.moqM2) / q : listRate, wastagePct: w,
        rateSource: 'catalog', priceKey: mid ? `material:${mid}` : undefined,
        note: mat ? [mat.supplier, mat.pricedOn && `priced ${mat.pricedOn}`].filter(Boolean).join(' · ') : undefined }),
      line(ctx, { id: 'edge-tape', section: 'material', label: 'Edge tape', description: edge?.tape,
        qty: q * tapePerM2 * usesTape, unit: 'LM', rate: mat?.edgeTapePerLm ?? 0, wastagePct: w, rateSource: 'catalog',
        priceKey: mid ? `edgetape:${mid}` : undefined, enabled: usesTape === 1 }),
      line(ctx, { id: 'acoustic-material', section: 'material', label: 'Acoustic backing', description: ac?.material,
        qty: q, unit: 'm²', rate: ac?.materialRateM2 ?? 0, wastagePct: w, priceKey: 'decorsorb:black', enabled: !!ac?.materialRateM2 }),
      line(ctx, { id: 'painting', section: 'material', label: 'Painting', description: i.painting,
        qty: q, unit: 'm²', rate: paint?.rateM2 ?? 0, wastagePct: 0, priceKey: i.painting ? `paint:${type}:${i.painting}` : undefined, enabled: !!paint?.rateM2 }),
    ];
    // The price book replaces the list rate, which would also drop the MOQ
    // scaling above. A price typed in from an order is per m² like the list is,
    // so below the minimum order it scales up the same way.
    if (moqApplies && mid && ctx.prices.get(`material:${mid}`)) {
      lines[0].rate = (lines[0].rate * mat!.moqM2) / q;
      lines[0].total = lineTotal(lines[0]);
    }
    // ---- LABOUR (wastage = H4/2 when the calculated rate is non-zero)
    const lab = (id: string, label: string, perM2: number, setupPerM2: number, description?: string) =>
      line(ctx, { id, section: 'labour', label, description, qty: q, unit: 'm²', rate: perM2, setup: setupPerM2 * q,
        wastagePct: perM2 === 0 ? 0 : w / 2, rateSource: perM2 || setupPerM2 ? 'formula' : 'default', enabled: perM2 !== 0 || setupPerM2 !== 0 });
    const cncSetupEach = prof ? setupCost(prof.cncSetupMin) : 0;
    lines.push(
      lab('cnc-1', 'CNC op 1', prof ? perM2Cost(prof.cncMinPerSheet) : 0,
        prof ? safeDiv(cncSetupEach * Math.ceil(safeDiv(q, prof.cncSetupEveryM2)), q) : 0, prof?.cncOps),
      lab('cnc-2', 'CNC op 2', 0, 0),
      lab('edge-bander', 'Edge bander', usesTape * (edgeLabourMinPerM2 / 60) * rate,
        roundUp((edge?.usesTape ? roundUp((edge.setupMin / 60) * rate, 1) : 0) / q, 1), edge?.labourNote),
      lab('table-saw', 'Table saw', 0, 0),
      lab('hand-routing', 'Hand routing', 0, 0),
      lab('moulder', 'Moulder', prof ? perM2Cost(prof.moulderMinPerSheet) : 0,
        prof ? roundUp(setupCost(prof.moulderSetupMin) / q, 1) : 0, prof?.moulderOps || undefined),
      lab('acoustic-labour', 'Acoustic lining', perM2Cost(ACOUSTIC_LABOUR_MIN_PER_SHEET[i.acoustic] ?? 0),
        roundUp((ac?.setupMin ? roundUp((ac.setupMin / 60) * rate, 1) : 0) / q, 1), ac?.instruction),
      lab('assembly', 'Assembly', 0, 0),
      lab('other', 'Other', 0, 0),
    );
    // The workbook's manual labour rows start at zero; keep them visible so they can be overridden.
    for (const l of lines) if (['cnc-2', 'table-saw', 'hand-routing', 'assembly', 'other'].includes(l.id)) l.enabled = true;
    return { lines, warnings };
  },
  summarise(lines, i, ctx) {
    const q = i.qtyM2;
    const materialCost = sectionTotal(lines, 'material');
    const labourCost = sectionTotal(lines, 'labour');
    const factor = L.complexity.find((c) => c.grade === i.complexity)?.factor ?? 0;
    const complexity = labourCost * factor;                                              // J30
    const overhead = (materialCost + labourCost + complexity) * ctx.settings.overheadPct; // J31
    const prof = PROF.get(profileId(i));
    const fee = PROFILES.find((p) => p.code === i.profileCode)?.artistFee ?? prof?.artistFee ?? 0; // B32 looks up by code
    const artwork = fee > 0 ? (materialCost + labourCost) * fee : 0;                     // J32
    const totalCost = materialCost + labourCost + complexity + overhead + artwork;      // J34
    const m2Cost = roundUp(totalCost / q, 1);                                             // H7
    const m2Sell = roundUp(m2Cost / (1 - i.marginPct), 1);                                // H8
    return {
      materialCost, labourCost, totalCost,
      adjustments: [
        { id: 'complexity', label: `Complexity ${i.complexity} (${(factor * 100).toFixed(0)}% of labour)`, amount: complexity },
        { id: 'overhead', label: `Overhead recoveries ${(ctx.settings.overheadPct * 100).toFixed(1)}%`, amount: overhead },
        ...(artwork ? [{ id: 'artwork', label: `Indigenous artwork ${(fee * 100).toFixed(0)}% to artist`, amount: artwork }] : []),
      ],
      marginPct: i.marginPct, sell: m2Sell * q,
      basis: { unit: 'm2', qty: q, label: 'm²' },
      costPerUnit: m2Cost, sellPerUnit: m2Sell,
      labourHours: (labourCost + complexity) / ctx.settings.labourRate,
      headline: [{ label: 'Production hours', value: complexity / ctx.settings.labourRate }],
    };
  },
};
