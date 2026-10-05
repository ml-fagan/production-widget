import { Calculator, CostLine, Ctx, line, roundDown, roundUp, sectionTotal, Warning } from '../engine/core';

/**
 * Ports of DecorSlat_Calculator_-_2026_-_4_0.xlsx and
 * SlatCreate_Calculator_-_2026_-_1_0.xlsx (CALCULATIONS + CALCS + LABOUR).
 * Same engine; SlatCreate differs in slat count (grid), acoustic labour factor,
 * no 20% labour uplift, and several lines switched off with -1 wastage/extras
 * (modelled here as enabled:false so they can be switched back on explicitly).
 */

// CALCS!B3:J7 — SLATS
const SLATS: Record<string, { cutMin: number; edgeMinPerM: number; assemblyMin: number; sheet: boolean }> = {
  'Hardwood':        { cutMin: 1,   edgeMinPerM: 0,   assemblyMin: 2.5, sheet: false },
  'MDF - Laminated': { cutMin: 1.5, edgeMinPerM: 0.5, assemblyMin: 2,   sheet: true },
  'MDF - Veneered':  { cutMin: 1.5, edgeMinPerM: 0.5, assemblyMin: 2,   sheet: true },
  'Plywood':         { cutMin: 1.5, edgeMinPerM: 0.5, assemblyMin: 2.5, sheet: true },
  'Softwood':        { cutMin: 0.5, edgeMinPerM: 0,   assemblyMin: 1.5, sheet: false },
};
// CALCS!B15:C19 — RATE (machining rate by backing material)
const RATE: Record<string, number> = {
  'MDF - Fire Rated': 0.75, 'MDF - MR': 0.95, 'MDF - Standard': 1, 'No Backing - Framed': 1, 'Plywood': 0.8,
};
// CALCS!I15:J22 — THICK (approximate match, like the VLOOKUP)
const THICK: [number, number][] = [[0, 1], [9, 1.2], [12, 1], [16, 0.95], [18, 0.9], [19, 0.9], [25, 0.8], [32, 0.75]];
const thickRate = (t: number) => [...THICK].reverse().find(([k]) => t >= k)?.[1] ?? 1;
const BACKING_TYPES = ['No Backing - Framed', 'Slotted (Acoustic)', 'Solid  (Non-Acoustic)', 'Strip Battens (Rebated)', 'Strip Battens (Solid)'];

export interface SlatInputs {
  length: number; width: number;
  slatType: string; backingType: string; backingMaterial: string; backingThickness: number;
  backingPaint: string; acoustic: 'Y' | 'N';
  slatWidth: number; slatDepth: number;
  slatSpacing: number;          // DecorSlat only
  gridA: number; gridB: number; // SlatCreate only
  slatDescription: string; slatFinish: string;
  panels: number; marginPct: number;
  // procurement stock sizes
  slatStockLength: number; sheetStockLength: number; sheetStockWidth: number;
  backingStockLength: number; backingStockWidth: number;
  // stock costs (H column)
  rateSlatLM: number; rateSlatSheet: number; rateEdging: number; rateSlatPaint: number;
  rateBacking: number; rateBackingPaint: number; rateAcoustic: number;
  // wastage (J column) and extras (E column)
  wSlatLM: number; wSlatSheet: number; wEdging: number; wSlatPaint: number; wBacking: number; wBackingPaint: number; wAcoustic: number;
  xCnc: number; xAcoustic: number; xSaw: number; xEdging: number; xAssembly: number;
  labourUplift: number; // DecorSlat CALCULATIONS!G3
}

type Variant = 'decorslat' | 'slatcreate';

function compute(variant: Variant, i: SlatInputs, ctx: Ctx) {
  const L = i.length, W = i.width, P = i.panels;
  const s = SLATS[i.slatType];
  const n = variant === 'decorslat'
    ? roundDown(W / (i.slatWidth + i.slatSpacing))                                  // C13
    : roundDown(L / i.gridA) * W / L + roundDown(W / i.gridB) * L / L;              // D12 + D13 (as written)
  const maxS = Math.max(i.slatWidth, i.slatDepth), minS = Math.min(i.slatWidth, i.slatDepth);
  const faceMult = i.slatWidth === maxS ? 2 : 1;
  const Db = i.backingStockLength, Eb = i.backingStockWidth;
  const Ds = i.sheetStockLength, Es = i.sheetStockWidth;

  // CALCS!E15:G19 — BACKING machining minutes (F) and sheets per panel (G)
  const battens = roundUp(L / 550);
  const backing: Record<string, { min: number; sheets: number }> = {
    'No Backing - Framed': { min: 1e-10, sheets: 0 },
    // Note: divides by the MDF - MR rate (0.95) regardless of selected material, then C34 divides by RATE again.
    'Slotted (Acoustic)': { min: ((2 * L + 2 * W + L * n) / RATE['MDF - MR']) / 4500, sheets: 1 / (roundDown(Db / L) * roundDown(Eb / W)) },
    'Solid  (Non-Acoustic)': { min: ((2 * L + 2 * W) / RATE['MDF - MR']) / 4500, sheets: 1 / (roundDown(Db / L) * roundDown(Eb / W)) },
    'Strip Battens (Rebated)': {
      min: (battens * (100 + 2 * W)) / 3500 + (50 * roundUp(minS / 8) * (n * battens)) / 3500,
      sheets: 1 / (roundDown(Db / (55 * battens)) * roundDown(Eb / W)),
    },
    'Strip Battens (Solid)': { min: (battens * (100 + 2 * W)) / 3500, sheets: 1 / (roundDown(Db / (55 * battens)) * roundDown(Eb / W)) },
  };
  const bk = backing[i.backingType];

  // CALCS row for the slat type
  const cutTotal = bk.sheets === 0 ? s.cutMin * (2 + n) : s.cutMin * n;                       // D
  let slatYield: number;                                                                         // E
  let edgeTotal = 0, edgeLm = 0;                                                                 // G, H
  if (!s.sheet) {
    slatYield = roundDown(((bk.sheets === 0 ? (W * 2) / n : 0) + L) / i.slatStockLength, 5);
  } else {
    const perSheet = roundDown((Ds / L) * (Es / (maxS + 5)));
    const pieces = bk.sheets > 0 ? perSheet : perSheet - (roundDown((Ds / W) * (Es / (maxS + 5))) / 2) / n;
    slatYield = (Ds * Es / 1e6) / pieces;
    const k = faceMult + (maxS * 2) / 1000;
    edgeTotal = s.edgeMinPerM * (L / 1000) * n * k + (bk.sheets > 0 ? 0 : s.edgeMinPerM * (W / 1000) * 2 * k);
    edgeLm = edgeTotal * 2;
  }
  const assemblyTotal = s.assemblyMin * n;
  const lm = !s.sheet; // C25 = "" when the slat type has no edging minutes

  const m: CostLine[] = [
    line(ctx, { id: 'slat-lm', section: 'material', label: 'Slat material — lineal', description: i.slatDescription || `${i.slatType} slats`,
      qty: lm ? slatYield * (n * P * i.slatStockLength / 1000) : 0, unit: 'LM', rate: i.rateSlatLM, wastagePct: i.wSlatLM,
      priceKey: `slat:lm:${i.slatType}:${minS}x${maxS}`, enabled: lm && i.wSlatLM > -1 }),
    line(ctx, { id: 'slat-sheet', section: 'material', label: 'Slat material — sheet', description: `${minS}mm ${i.slatType}${i.slatDescription ? ' - ' + i.slatDescription : ''}`,
      qty: !lm ? n * P * slatYield : 0, unit: 'm²', rate: i.rateSlatSheet, wastagePct: i.wSlatSheet,
      priceKey: `slat:sheet:${i.slatType}:${minS}`, enabled: !lm && i.wSlatSheet > -1 }),
    line(ctx, { id: 'slat-edging', section: 'material', label: 'Slat edging', description: i.slatDescription,
      qty: !lm ? edgeLm * P : 0, unit: 'LM', rate: i.rateEdging, wastagePct: i.wEdging,
      priceKey: `edgetape:${maxS}`, enabled: !lm && i.wEdging > -1 }),
    line(ctx, { id: 'slat-paint', section: 'material', label: 'Slat painting', description: i.slatFinish,
      qty: (L * n * P) / 1000, unit: 'LM', rate: i.rateSlatPaint, wastagePct: i.wSlatPaint, enabled: !!i.slatFinish && i.wSlatPaint > -1 }),
  ];
  // Note: workbook sizes backing board on the slat SHEET stock (D24×E24), not the backing stock (D27×E27).
  const backingQty = bk.sheets * P * (Ds * Es / 1e6);
  m.push(
    line(ctx, { id: 'backing', section: 'material', label: 'Backing board', description: `${i.backingThickness}mm ${i.backingMaterial}`,
      qty: backingQty, unit: 'm²', rate: i.rateBacking, wastagePct: i.wBacking,
      priceKey: `board:${i.backingMaterial}:${i.backingThickness}`, enabled: i.wBacking > -1 }),
    line(ctx, { id: 'backing-paint', section: 'material', label: 'Backing painting', description: i.backingPaint,
      qty: backingQty * (1 + i.wBacking), unit: 'm²', rate: i.rateBackingPaint, wastagePct: i.wBackingPaint,
      enabled: !!i.backingPaint && i.wBackingPaint > -1 }),
    line(ctx, { id: 'acoustic', section: 'material', label: 'Acoustic lining', description: 'DecorSorb Acoustic Lining',
      qty: (L * W * P) / 1e6, unit: 'm²', rate: i.rateAcoustic, wastagePct: i.wAcoustic,
      priceKey: 'decorsorb:lining', enabled: i.acoustic === 'Y' && i.wAcoustic > -1 }),
  );

  const rate = ctx.settings.labourRate;
  const acousticFactor = variant === 'decorslat' ? 1 : 0.5;
  const lab = (id: string, label: string, minPerPanel: number, extra: number, people = 1, description?: string) =>
    line(ctx, { id, section: 'labour', label, description: description ?? `${(minPerPanel * (1 + extra)).toFixed(2)} min/panel`,
      qty: (minPerPanel * P) / 60, unit: 'hr', rate: rate * people, wastagePct: extra, rateSource: 'formula', enabled: extra > -1 });
  const l: CostLine[] = [
    lab('cnc', 'CNC routing', bk.min / RATE[i.backingMaterial] / thickRate(i.backingThickness), i.xCnc),
    // Note: charged regardless of the Acoustic Y/N input, as in the workbook.
    lab('acoustic-labour', 'Acoustic lining', (acousticFactor / 1000) * L, i.xAcoustic),
    lab('saw', 'Saw cutting', cutTotal, i.xSaw),
    lab('edging', 'Edging', edgeTotal, i.xEdging),
    lab('assembly', 'Assembly (2 people)', assemblyTotal, i.xAssembly, 2),
  ];

  const warnings: Warning[] = [];
  if (n <= 0) warnings.push({ level: 'warn', message: 'Slat quantity is zero — check spacing/grid' });
  if (i.labourUplift) warnings.push({ level: 'info', message: `Labour carries a ${(i.labourUplift * 100).toFixed(0)}% uplift (CALCULATIONS!G3)` });
  return { lines: [...m, ...l], warnings, n };
}

function summarise(lines: CostLine[], i: SlatInputs, ctx: Ctx) {
  const materialCost = sectionTotal(lines, 'material');
  const labourBase = sectionTotal(lines, 'labour');
  const uplift = labourBase * i.labourUplift;
  const labourCost = labourBase + uplift;
  const overhead = (materialCost + labourCost) * ctx.settings.overheadPct;
  const totalCost = materialCost + labourCost + overhead;
  const sell = totalCost / (1 - i.marginPct);
  const m2 = i.panels * (i.length * i.width) / 1e6;
  return {
    materialCost, labourCost, totalCost,
    adjustments: [
      ...(uplift ? [{ id: 'labour-uplift', label: `Labour uplift ${(i.labourUplift * 100).toFixed(0)}% (included in labour)`, amount: 0, note: `+$${uplift.toFixed(2)}` }] : []),
      { id: 'overhead', label: `Overhead recoveries ${(ctx.settings.overheadPct * 100).toFixed(1)}%`, amount: overhead },
    ],
    marginPct: i.marginPct, sell,
    basis: { unit: 'm2' as const, qty: m2, label: 'm²' },
    costPerUnit: totalCost / m2, sellPerUnit: sell / m2,
  };
}

const common = {
  length: 2400, width: 600, backingType: 'Slotted (Acoustic)', backingMaterial: 'MDF - Standard', backingThickness: 12,
  backingPaint: '', slatDescription: '', slatFinish: '', panels: 1, marginPct: 0.475,
  slatStockLength: 2700, sheetStockLength: 2420, sheetStockWidth: 1210, backingStockLength: 2400, backingStockWidth: 1200,
  rateSlatLM: 0, rateSlatSheet: 0, rateEdging: 0, rateSlatPaint: 0, rateBackingPaint: 0,
  wSlatPaint: 0, wBackingPaint: 0, xAcoustic: 0, slatSpacing: 23, gridA: 550, gridB: 550,
};

const inputSpecs = (variant: Variant) => [
  { key: 'length', label: 'Panel length', unit: 'mm', type: 'number', group: 'Specification' },
  { key: 'width', label: 'Panel width', unit: 'mm', type: 'number', group: 'Specification' },
  { key: 'panels', label: 'Panels required', type: 'number', group: 'Specification', min: 1 },
  { key: 'slatType', label: 'Slat type', type: 'select', group: 'Specification', options: Object.keys(SLATS) },
  { key: 'slatWidth', label: 'Slat width', unit: 'mm', type: 'number', group: 'Specification' },
  { key: 'slatDepth', label: 'Slat depth', unit: 'mm', type: 'number', group: 'Specification' },
  ...(variant === 'decorslat'
    ? [{ key: 'slatSpacing', label: 'Slat spacing', unit: 'mm', type: 'number', group: 'Specification' }]
    : [{ key: 'gridA', label: 'Grid spacing A', unit: 'mm', type: 'number', group: 'Specification' },
       { key: 'gridB', label: 'Grid spacing B', unit: 'mm', type: 'number', group: 'Specification' }]),
  { key: 'slatDescription', label: 'Slat description (material)', type: 'text', group: 'Specification' },
  { key: 'slatFinish', label: 'Slat finish', type: 'text', group: 'Specification' },
  { key: 'backingType', label: 'Backing type', type: 'select', group: 'Backing', options: BACKING_TYPES },
  { key: 'backingMaterial', label: 'Backing material', type: 'select', group: 'Backing', options: Object.keys(RATE) },
  { key: 'backingThickness', label: 'Backing thickness', unit: 'mm', type: 'select', group: 'Backing', options: THICK.slice(1).map(([t]) => String(t)) },
  { key: 'backingPaint', label: 'Backing paint finish', type: 'text', group: 'Backing' },
  { key: 'acoustic', label: 'Acoustic lining', type: 'select', group: 'Backing', options: ['Y', 'N'] },
  { key: 'marginPct', label: 'Margin', type: 'percent', group: 'Job' },
  { key: 'rateSlatLM', label: 'Slat stock — lineal', unit: '$/LM', type: 'number', group: 'Stock costs' },
  { key: 'rateSlatSheet', label: 'Slat stock — sheet', unit: '$/m²', type: 'number', group: 'Stock costs' },
  { key: 'rateEdging', label: 'Edging', unit: '$/LM', type: 'number', group: 'Stock costs' },
  { key: 'rateSlatPaint', label: 'Slat painting', unit: '$/LM', type: 'number', group: 'Stock costs' },
  { key: 'rateBacking', label: 'Backing board', unit: '$/m²', type: 'number', group: 'Stock costs' },
  { key: 'rateBackingPaint', label: 'Backing painting', unit: '$/m²', type: 'number', group: 'Stock costs' },
  { key: 'rateAcoustic', label: 'Acoustic lining', unit: '$/m²', type: 'number', group: 'Stock costs' },
  ...(variant === 'decorslat' ? [{ key: 'labourUplift', label: 'Labour uplift', type: 'percent', group: 'Job' }] : []),
] as any;

export const decorSlat: Calculator<SlatInputs> = {
  id: 'decorslat', name: 'DecorSlat', family: 'Slat panels', sourceFile: 'DecorSlat_Calculator_-_2026_-_4_0.xlsx',
  description: 'Slatted panels on a backing, with CNC, saw, edging and assembly time from the CALCS tables.',
  defaults: {
    ...common, slatType: 'Softwood', acoustic: 'Y', slatWidth: 17, slatDepth: 38,
    rateBacking: 10, rateAcoustic: 6,
    wSlatLM: 0.15, wSlatSheet: 0.2, wEdging: 0.15, wBacking: 0.1, wAcoustic: 0.1,
    xCnc: 0, xSaw: 0, xEdging: 0, xAssembly: 0, labourUplift: 0.2,
  },
  inputs: inputSpecs('decorslat'),
  compute: (i, ctx) => compute('decorslat', i, ctx),
  summarise,
};

export const slatCreate: Calculator<SlatInputs> = {
  id: 'slatcreate', name: 'SlatCreate', family: 'Slat panels', sourceFile: 'SlatCreate_Calculator_-_2026_-_1_0.xlsx',
  description: 'Grid-based slat panels. Shares the DecorSlat engine; several lines are switched off by default as in the workbook.',
  defaults: {
    ...common, slatType: 'MDF - Laminated', acoustic: 'N', slatWidth: 50, slatDepth: 145,
    rateBacking: 0, rateAcoustic: 0,
    wSlatLM: -1, wSlatSheet: 0.1, wEdging: 0.1, wBacking: -1, wBackingPaint: -1, wAcoustic: -1,
    xCnc: 4, xAcoustic: -1, xSaw: -1, xEdging: 3, xAssembly: -1, labourUplift: 0,
  },
  inputs: inputSpecs('slatcreate'),
  compute: (i, ctx) => compute('slatcreate', i, ctx),
  summarise,
};
