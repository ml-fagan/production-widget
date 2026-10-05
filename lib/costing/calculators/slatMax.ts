import { Calculator, line, roundDown, roundUp, sectionTotal } from '../engine/core';

/** Port of DecorSlat_Max_-_2026_-_1_0.xlsx › MAIN + CALCS. Beams costed per lineal metre. */
const BEAMS: Record<string, { cutMin: number; edgeMinPerM: number }> = {   // CALCS!B3:G5
  'Balsa Core': { cutMin: 4.5, edgeMinPerM: 1.8 },
  'Cardboard Honeycomb Core': { cutMin: 4.5, edgeMinPerM: 1.8 },
  'MDF - Dual Layer': { cutMin: 4.5, edgeMinPerM: 1.8 },
};
const CLEATS: Record<string, { unit: string; stockLength: number; stockWidth?: number; minEach: number }> = { // CALCS!B15:H17
  '32mm MDF Sheet': { unit: 'm²', stockLength: 2400, stockWidth: 1200, minEach: 0.5 },
  '32mm Plywood': { unit: 'm²', stockLength: 2400, stockWidth: 1200, minEach: 0.5 },
  'Hardwood Slat': { unit: 'LM', stockLength: 2400, minEach: 0.25 },
};

export interface MaxInputs {
  length: number; depth: number; beamType: string; thickness: number; cleat: string;
  beamMaterial: string; paintFinish: string; beams: number; marginPct: number;
  sheetLength: number; sheetWidth: number; edgeRollLm: number;
  rateSheet: number; rateEdging: number; ratePaint: number; rateCleat: number;
  wSheet: number; wEdging: number; wPaint: number; wCleat: number;
  xSaw: number; xEdging: number;
}

export const decorSlatMax: Calculator<MaxInputs> = {
  id: 'decorslat-max', name: 'DecorSlat Max', family: 'Beams', sourceFile: 'DecorSlat_Max_-_2026_-_1_0.xlsx',
  description: 'Hollow beams from sheet stock with edging and cleats, priced per lineal metre.',
  defaults: {
    length: 2400, depth: 290, beamType: 'MDF - Dual Layer', thickness: 50, cleat: 'Hardwood Slat',
    beamMaterial: '', paintFinish: '', beams: 1, marginPct: 0.5,
    sheetLength: 2400, sheetWidth: 1200, edgeRollLm: 25,
    rateSheet: 85, rateEdging: 4, ratePaint: 0, rateCleat: 6,
    wSheet: 0, wEdging: 0, wPaint: 0, wCleat: 0, xSaw: 0, xEdging: 0,
  },
  inputs: [
    { key: 'length', label: 'Beam length', unit: 'mm', type: 'number', group: 'Specification' },
    { key: 'depth', label: 'Beam depth', unit: 'mm', type: 'number', group: 'Specification' },
    { key: 'thickness', label: 'Beam thickness', unit: 'mm', type: 'number', group: 'Specification' },
    { key: 'beamType', label: 'Beam type', type: 'select', group: 'Specification', options: Object.keys(BEAMS) },
    { key: 'cleat', label: 'Cleat material', type: 'select', group: 'Specification', options: Object.keys(CLEATS) },
    { key: 'beamMaterial', label: 'Beam material / finish', type: 'text', group: 'Specification' },
    { key: 'paintFinish', label: 'Paint finish', type: 'text', group: 'Specification' },
    { key: 'beams', label: 'Beams required', type: 'number', group: 'Job', min: 1 },
    { key: 'marginPct', label: 'Margin', type: 'percent', group: 'Job' },
    { key: 'rateSheet', label: 'Beam sheet', unit: '$/m²', type: 'number', group: 'Stock costs' },
    { key: 'rateEdging', label: 'Edging (ABS)', unit: '$/LM', type: 'number', group: 'Stock costs' },
    { key: 'ratePaint', label: 'Painting', unit: '$/m²', type: 'number', group: 'Stock costs' },
    { key: 'rateCleat', label: 'Cleat', unit: '$/unit', type: 'number', group: 'Stock costs' },
  ],
  compute(i, ctx) {
    const b = BEAMS[i.beamType], c = CLEATS[i.cleat];
    const perSheet = roundDown(i.sheetLength / i.length) * roundDown(i.sheetWidth / (i.depth + 10));   // CALCS D
    const girthM = (i.length + i.depth * 2) / 1000;
    const perRoll = roundDown(i.edgeRollLm / girthM);                                                  // CALCS I
    const cleatsPerBeam = roundUp(i.length / 1200);
    const cleatQty = c.stockWidth
      ? (1 / ((c.stockLength / 200) * (c.stockWidth / i.thickness))) * cleatsPerBeam                 // CALCS H15
      : 1 / (c.stockLength / (200 * cleatsPerBeam));                                                  // CALCS H17
    const rate = ctx.settings.labourRate; // workbook hardcodes 175 on MAIN!H28:H29 (LABOUR!B1 = 125 is unused)
    const lines = [
      line(ctx, { id: 'sheet', section: 'material', label: 'Beam material — sheet', description: `${i.thickness}mm ${i.beamType}${i.beamMaterial ? ' - ' + i.beamMaterial : ''}, ${perSheet}/sheet`,
        qty: (i.beams / perSheet) * (i.sheetLength * i.sheetWidth / 1e6), unit: 'm²', rate: i.rateSheet, wastagePct: i.wSheet, priceKey: `beam:sheet:${i.beamType}:${i.thickness}` }),
      line(ctx, { id: 'edging', section: 'material', label: 'Edging', description: `${i.thickness}mm × 2mm ABS UG, ${perRoll} beams/roll`,
        qty: (i.beams / perRoll) * i.edgeRollLm, unit: 'LM', rate: i.rateEdging, wastagePct: i.wEdging, priceKey: `edgetape:abs:${i.thickness}` }),
      line(ctx, { id: 'paint', section: 'material', label: 'Paint finish', description: i.paintFinish,
        qty: i.beams * (i.length * (i.depth + i.thickness + i.depth)) / 1e6, unit: 'm²', rate: i.ratePaint, wastagePct: i.wPaint, enabled: !!i.paintFinish }),
      line(ctx, { id: 'cleat', section: 'material', label: 'Cleats', description: i.cleat,
        qty: cleatQty * i.beams, unit: c.unit, rate: i.rateCleat, wastagePct: i.wCleat, priceKey: `cleat:${i.cleat}` }),
      line(ctx, { id: 'saw', section: 'labour', label: 'Saw cutting', description: `${b.cutMin} min/beam`,
        qty: (b.cutMin * i.beams) / 60, unit: 'hr', rate, wastagePct: i.xSaw, rateSource: 'formula' }),
      line(ctx, { id: 'edging-labour', section: 'labour', label: 'Edging', description: `${(b.edgeMinPerM * girthM).toFixed(2)} min/beam`,
        qty: (b.edgeMinPerM * girthM * i.beams) / 60, unit: 'hr', rate, wastagePct: i.xEdging, rateSource: 'formula' }),
    ];
    return { lines, warnings: [{ level: 'info' as const, message: 'Cleat cutting time is not charged in this template', detail: `${c.minEach} min/cleat is defined in CALCS but not charged on MAIN` }] };
  },
  summarise(lines, i, ctx) {
    const materialCost = sectionTotal(lines, 'material'), labourCost = sectionTotal(lines, 'labour');
    const overhead = (materialCost + labourCost) * ctx.settings.overheadPct;
    const totalCost = materialCost + labourCost + overhead;
    const sell = totalCost / (1 - i.marginPct);
    const lm = i.beams * i.length / 1000;
    return {
      materialCost, labourCost, totalCost,
      adjustments: [{ id: 'overhead', label: `Overhead recoveries ${(ctx.settings.overheadPct * 100).toFixed(1)}%`, amount: overhead }],
      marginPct: i.marginPct, sell, basis: { unit: 'LM', qty: lm, label: 'LM' },
      costPerUnit: totalCost / lm, sellPerUnit: sell / lm,
    };
  },
};
