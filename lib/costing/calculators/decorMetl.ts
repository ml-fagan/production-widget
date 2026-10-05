import { Calculator, line, sectionTotal } from '../engine/core';
import list from '../data/decormetl-pricelist.json';

/**
 * Port of DecorMetl_Pricelist_-_2025_-_1_0.xlsx. The workbook is a supplier
 * price list (AED per panel, 1×20ft container MOQ). Its "AUD / M2" column is
 * MAX(all perforation options) × 1.45, so it always prices the dearest option;
 * here the selected perforation is priced, and the workbook figure is shown.
 */
const PERFS = ['plain', 'RS0750', 'RD1850', 'RD3090'] as const;
type Perf = (typeof PERFS)[number];

export interface MetlInputs {
  system: string; perforation: Perf; m2: number;
  aedPerUsd: number; usdToAud: number; marginPct: number | null; applyOverhead: 'Yes' | 'No';
}

export const decorMetl: Calculator<MetlInputs> = {
  id: 'decormetl', name: 'DecorMetl', family: 'Metal ceilings', sourceFile: 'DecorMetl_Pricelist_-_2025_-_1_0.xlsx',
  description: 'Metal ceiling panels from the AED supplier list, converted to AUD per m² and per panel.',
  defaults: { system: list.items[0].system, perforation: 'plain', m2: 100, aedPerUsd: list.aedPerUsd, usdToAud: list.usdToAudFactor, marginPct: null, applyOverhead: 'No' },
  inputs: [
    { key: 'system', label: 'System', type: 'select', group: 'Specification', options: list.items.map((x) => x.system) },
    { key: 'perforation', label: 'Perforation', type: 'select', group: 'Specification',
      options: (i) => PERFS.filter((p) => (list.items.find((x) => x.system === i.system)?.aedPerPanel as any)?.[p] != null) },
    { key: 'm2', label: 'Area', unit: 'm²', type: 'number', group: 'Job' },
    { key: 'marginPct', label: 'Margin', type: 'percent', group: 'Job', help: 'Not set in the workbook' },
    { key: 'applyOverhead', label: 'Apply overhead recoveries', type: 'select', group: 'Job', options: ['No', 'Yes'], help: 'The workbook is a cost list with no overheads' },
    { key: 'aedPerUsd', label: 'AED per USD', type: 'number', group: 'Exchange', step: 0.01 },
    { key: 'usdToAud', label: 'USD → AUD factor', type: 'number', group: 'Exchange', step: 0.01,
      help: 'Workbook multiplies USD by 1.45 — confirm whether this is FX only or includes freight/duty' },
  ],
  compute(i, ctx) {
    const item = list.items.find((x) => x.system === i.system)!;
    const aed = (item.aedPerPanel as any)[i.perforation] as number;
    const audPerPanel = (aed / i.aedPerUsd) * i.usdToAud;
    const panels = Math.ceil(i.m2 / item.m2PerPanel);
    return {
      lines: [line(ctx, {
        id: 'panels', section: 'material', label: 'Panels', description: `${item.system} — ${i.perforation}`,
        qty: panels, unit: 'panel', rate: audPerPanel, rateSource: 'catalog', priceKey: `decormetl:${item.no}:${i.perforation}`,
        note: `AED ${aed} ea · workbook list $${item.excelAudM2.toFixed(2)}/m² (dearest option)`,
      })],
      warnings: [{ level: 'info', message: 'Supplier pricing is for a minimum of one 20ft container' }],
    };
  },
  summarise(lines, i, ctx) {
    const materialCost = sectionTotal(lines, 'material');
    const overhead = i.applyOverhead === 'Yes' ? materialCost * ctx.settings.overheadPct : 0;
    const totalCost = materialCost + overhead;
    const sell = i.marginPct == null ? null : totalCost / (1 - i.marginPct);
    return {
      materialCost, labourCost: 0, totalCost,
      adjustments: [{ id: 'overhead', label: `Overhead recoveries ${(ctx.settings.overheadPct * 100).toFixed(1)}%`, amount: overhead }],
      marginPct: i.marginPct, sell, basis: { unit: 'm2', qty: i.m2, label: 'm²' },
      costPerUnit: totalCost / i.m2, sellPerUnit: sell == null ? null : sell / i.m2,
    };
  },
};
