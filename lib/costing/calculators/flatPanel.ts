import { Calculator, CostLine, line, mround, roundUp, sectionTotal, sum } from '../engine/core';
import cncRates from '../data/flatpanel-cnc-rates.json';

/**
 * Port of Flat_Panel_Calculator_-_2026_-_6_0.xlsx › CALCULATIONS.
 * Every line is a $/m² rate. Where the workbook has a helper tab
 * (Edging & DecorSorb, CNC Rates) the rate is derived from it unless a
 * rate is typed in, so you get the same numbers without copy-pasting.
 */
const EDGE_SIZES: Record<string, { l: number; w: number; min: number; people: number }> = { // 'Edging & DecorSorb'!F3:K7
  '2400x1200': { l: 2400, w: 1200, min: 5, people: 1.5 },
  '2400x600': { l: 2400, w: 600, min: 4.5, people: 1 },
  '1200x1200': { l: 1200, w: 1200, min: 4.5, people: 1 },
  '1200x600': { l: 1200, w: 600, min: 4, people: 0.5 },
  '600x600': { l: 600, w: 600, min: 4, people: 0.25 },
};
const DECORSORB: Record<string, { material: number; min: number; people: number }> = { // 'Edging & DecorSorb'!A11:K13
  'Flat Panel - MDF': { material: 7, min: 3, people: 1 },
  'Plank Panels - MDF': { material: 7, min: 4, people: 1 },
  'FC / CFC Panels': { material: 7, min: 4, people: 1.5 },
};
const EDGE_TAPE_PER_LM = 1.5;
const CNC_OPTIONS = ['None', ...cncRates.groups.flatMap((g) => g.profiles.map((p) => `${g.range} › ${p.profile}`))];

type R = number | null; // null = use derived/blank value
export interface FlatPanelInputs {
  m2: number; marginPct: number; wasteAllowance: number; artwork: 'Yes' | 'No'; fuelLevyPct: number;
  edgeSize: string; decorsorbType: string; cncProfile: string; cncThickness: string;
  material1: R; material1Desc: string; material2: R; material2Desc: string;
  cncPanel: R; cncPlank: R; panelSaw: R; edgeTape: R; edging: R; moulder: R; paint: R;
  decorsorbLining: R; decorsorbApplication: R; dsbBatten: R; dsbAssembly: R;
}

// [id, label, section, wastage ratio (G), counts toward labour hours (N)]
const ROWS: [keyof FlatPanelInputs, string, 'material' | 'labour', number, boolean][] = [
  ['material1', 'Material', 'material', 1, false],
  ['fuelLevyPct', 'Fuel levy', 'material', 1, false],
  ['material2', 'Material', 'material', 1, false],
  ['cncPanel', 'CNC — panel products', 'labour', 0.5, true],
  ['cncPlank', 'CNC — plank products', 'labour', 0.5, true],
  ['panelSaw', 'Panel saw', 'labour', 0.5, false],
  ['edgeTape', 'Edge tape', 'material', 1, false],
  ['edging', 'Edging', 'labour', 0.5, true],
  ['moulder', 'Moulder', 'labour', 0.5, true],
  ['paint', 'Paint', 'material', 0, false],
  ['decorsorbLining', 'DecorSorb lining', 'material', 1, false],
  ['decorsorbApplication', 'DecorSorb application', 'labour', 0.5, true],
  ['dsbBatten', 'DSB batten', 'material', 1, false],
  ['dsbAssembly', 'DSB assembly', 'labour', 0.5, true],
];

export const flatPanel: Calculator<FlatPanelInputs> = {
  id: 'flat-panel', name: 'Flat Panel', family: 'Panels', sourceFile: 'Flat_Panel_Calculator_-_2026_-_6_0.xlsx',
  description: 'Build-up of $/m² rates for flat panels, with edging, DecorSorb and CNC rates pulled from the helper tables.',
  defaults: {
    m2: 1, marginPct: 0.65, wasteAllowance: 0.05, artwork: 'No', fuelLevyPct: 0,
    edgeSize: '2400x1200', decorsorbType: 'Flat Panel - MDF', cncProfile: 'None', cncThickness: '12mm MDF',
    material1: null, material1Desc: '', material2: null, material2Desc: '',
    cncPanel: null, cncPlank: null, panelSaw: null, edgeTape: null, edging: null, moulder: null, paint: null,
    decorsorbLining: null, decorsorbApplication: null, dsbBatten: null, dsbAssembly: null,
  },
  inputs: [
    { key: 'm2', label: 'M² on job', type: 'number', group: 'Job', min: 0 },
    { key: 'marginPct', label: 'Margin', type: 'percent', group: 'Job' },
    { key: 'wasteAllowance', label: 'Wastage allowance', type: 'percent', group: 'Job' },
    { key: 'artwork', label: 'Indigenous artwork (15%)', type: 'select', group: 'Job', options: ['No', 'Yes'] },
    { key: 'material1Desc', label: 'Material', type: 'text', group: 'Materials' },
    { key: 'material1', label: 'Material rate', unit: '$/m²', type: 'number', group: 'Materials' },
    { key: 'fuelLevyPct', label: 'Fuel levy on material', type: 'percent', group: 'Materials' },
    { key: 'material2Desc', label: 'Second material', type: 'text', group: 'Materials' },
    { key: 'material2', label: 'Second material rate', unit: '$/m²', type: 'number', group: 'Materials' },
    { key: 'paint', label: 'Paint', unit: '$/m²', type: 'number', group: 'Materials' },
    { key: 'dsbBatten', label: 'DSB batten', unit: '$/m²', type: 'number', group: 'Materials' },
    { key: 'edgeSize', label: 'Panel size (edging)', type: 'select', group: 'Edging & DecorSorb', options: ['None', ...Object.keys(EDGE_SIZES)] },
    { key: 'decorsorbType', label: 'DecorSorb product', type: 'select', group: 'Edging & DecorSorb', options: ['None', ...Object.keys(DECORSORB)] },
    { key: 'edgeTape', label: 'Edge tape (override)', unit: '$/m²', type: 'number', group: 'Edging & DecorSorb' },
    { key: 'edging', label: 'Edging labour (override)', unit: '$/m²', type: 'number', group: 'Edging & DecorSorb' },
    { key: 'decorsorbLining', label: 'DecorSorb lining (override)', unit: '$/m²', type: 'number', group: 'Edging & DecorSorb' },
    { key: 'decorsorbApplication', label: 'DecorSorb application (override)', unit: '$/m²', type: 'number', group: 'Edging & DecorSorb' },
    { key: 'cncProfile', label: 'CNC profile', type: 'select', group: 'Machining', options: CNC_OPTIONS },
    { key: 'cncThickness', label: 'CNC substrate', type: 'select', group: 'Machining', options: cncRates.thicknessColumns, visible: (i) => i.cncProfile !== 'None' },
    { key: 'cncPanel', label: 'CNC panel (override)', unit: '$/m²', type: 'number', group: 'Machining' },
    { key: 'cncPlank', label: 'CNC plank', unit: '$/m²', type: 'number', group: 'Machining' },
    { key: 'panelSaw', label: 'Panel saw', unit: '$/m²', type: 'number', group: 'Machining' },
    { key: 'moulder', label: 'Moulder', unit: '$/m²', type: 'number', group: 'Machining' },
    { key: 'dsbAssembly', label: 'DSB assembly', unit: '$/m²', type: 'number', group: 'Machining' },
  ],
  compute(i, ctx) {
    const lr = ctx.settings.labourRate;
    const sz = EDGE_SIZES[i.edgeSize], ds = DECORSORB[i.decorsorbType];
    const area = sz ? (sz.l * sz.w) / 1e6 : 0;
    let cncDerived = 0;
    if (i.cncProfile !== 'None') {
      const [range, prof] = i.cncProfile.split(' › ');
      const min = (cncRates.groups.find((g) => g.range === range)?.profiles.find((p) => p.profile === prof)?.minPerSheet as any)?.[i.cncThickness];
      cncDerived = min ? mround((min / 2.88) * lr / 60, 1) : 0;
    }
    const derived: Partial<Record<keyof FlatPanelInputs, number>> = {
      edgeTape: sz ? roundUp((EDGE_TAPE_PER_LM * ((sz.l + sz.w) * 2 / 1000)) / area, 1) : 0,
      edging: sz ? roundUp(((sz.min * sz.people) / 60 / area) * lr, 1) : 0,
      decorsorbLining: ds?.material ?? 0,
      decorsorbApplication: ds ? roundUp(((ds.min * ds.people) / 60) * lr, 1) : 0,
      cncPanel: cncDerived,
    };
    const lines: CostLine[] = ROWS.map(([key, label, section, ratio]) => {
      const typed = key === 'fuelLevyPct' ? (i.material1 ?? 0) * i.fuelLevyPct : (i[key] as R);
      const rate = typed ?? derived[key] ?? 0;
      const desc = key === 'material1' ? i.material1Desc : key === 'material2' ? i.material2Desc
        : key === 'cncPanel' && i.cncProfile !== 'None' ? `${i.cncProfile}, ${i.cncThickness}` : undefined;
      return line(ctx, {
        id: key, section, label, description: desc, qty: i.m2, unit: 'm²', rate,
        wastagePct: ratio * i.wasteAllowance,
        rateSource: typed != null ? 'default' : derived[key] ? 'formula' : 'default',
        priceKey: key === 'material1' || key === 'material2' ? (desc ? `material:${desc}` : undefined) : undefined,
        enabled: rate !== 0,
      });
    });
    return { lines };
  },
  summarise(lines, i, ctx) {
    const materialCost = sectionTotal(lines, 'material'), labourCost = sectionTotal(lines, 'labour');
    const base = materialCost + labourCost;                                     // C27 × m²
    const artwork = i.artwork === 'Yes' ? base * 0.15 : 0;                      // C16
    const overhead = (base + artwork) * ctx.settings.overheadPct;
    const totalCost = base + artwork + overhead;
    const sell = totalCost / (1 - i.marginPct);
    const hours = sum(lines.filter((l) => ROWS.find((r) => r[0] === l.id)?.[4] && l.enabled).map((l) => (l.rate / ctx.settings.labourRate) * i.m2));
    return {
      materialCost, labourCost, totalCost,
      adjustments: [
        ...(artwork ? [{ id: 'artwork', label: 'Indigenous artwork 15%', amount: artwork }] : []),
        { id: 'overhead', label: `Overhead recoveries ${(ctx.settings.overheadPct * 100).toFixed(1)}%`, amount: overhead },
      ],
      marginPct: i.marginPct, sell, basis: { unit: 'm2', qty: i.m2, label: 'm²' },
      costPerUnit: totalCost / i.m2, sellPerUnit: sell / i.m2, labourHours: hours,
    };
  },
};
