import { Calculator, line, roundDown, roundUp, sectionTotal, Warning } from '../engine/core';

/** Port of Cewood_Baffles_-_2026_-_1_0.xlsx › CALCS. All amounts are per baffle. */
export interface CewoodInputs {
  size: string;               // C2  e.g. "2395x595"
  painting: 'Yes' | 'No';     // C3
  fixing: 'Direct' | 'Suspended'; // C4
  paintRateM2: number;        // C5
  stockLength: number;        // C22
  stockWidth: number;         // C23
  stockRateM2: number;        // C24 landed rate
  channelStockLength: number; // C27
  channelCostEach: number;    // C28  Megastone 32x32x32x3 per 6m
  channelPaintPerLength: number; // C30 = 0.32 × 6 × 7.10
  suspensionKitEach: number;  // C32
  cutLabourRate: number;      // the 125 hardcoded in C8 and C31
  baffles: number;            // not in workbook — job quantity
  marginPct: number | null;   // not in workbook
}

export const cewood: Calculator<CewoodInputs> = {
  id: 'cewood-baffles',
  name: 'Cewood Baffles',
  family: 'Baffles',
  sourceFile: 'Cewood_Baffles_-_2026_-_1_0.xlsx',
  description: 'Per-baffle cost from stock sheet yield, cutting, fixing method and optional painting.',
  defaults: {
    size: '2395x595', painting: 'No', fixing: 'Suspended', paintRateM2: 35,
    stockLength: 2395, stockWidth: 595, stockRateM2: 26,
    channelStockLength: 6000, channelCostEach: 33, channelPaintPerLength: 0.32 * 6 * 7.1,
    suspensionKitEach: 15, cutLabourRate: 125, baffles: 1, marginPct: null,
  },
  inputs: [
    { key: 'size', label: 'Baffle size', type: 'select', group: 'Specification',
      options: ['1195x190', '1195x290', '1195x595', '2395x190', '2395x290', '2395x595'] },
    { key: 'fixing', label: 'Fixing method', type: 'select', group: 'Specification', options: ['Suspended', 'Direct'] },
    { key: 'painting', label: 'Painting required', type: 'select', group: 'Specification', options: ['No', 'Yes'] },
    { key: 'paintRateM2', label: 'Painting cost', unit: '$/m²', type: 'number', group: 'Specification',
      visible: (i) => i.painting === 'Yes', help: 'Check with David @ Classic Coatings for the colour/finish' },
    { key: 'baffles', label: 'Baffles on job', type: 'number', group: 'Job', min: 1 },
    { key: 'marginPct', label: 'Margin', type: 'percent', group: 'Job', help: 'Not set in the workbook' },
    { key: 'stockRateM2', label: 'Stock landed rate', unit: '$/m²', type: 'number', group: 'Rates' },
    { key: 'stockLength', label: 'Stock length', unit: 'mm', type: 'number', group: 'Rates' },
    { key: 'stockWidth', label: 'Stock width', unit: 'mm', type: 'number', group: 'Rates' },
    { key: 'suspensionKitEach', label: 'Suspension kit (ADS)', unit: '$ ea', type: 'number', group: 'Rates' },
    { key: 'channelCostEach', label: 'Alum channel per length', unit: '$', type: 'number', group: 'Rates' },
    { key: 'channelStockLength', label: 'Alum channel length', unit: 'mm', type: 'number', group: 'Rates' },
    { key: 'channelPaintPerLength', label: 'Channel painting per length', unit: '$', type: 'number', group: 'Rates' },
    { key: 'cutLabourRate', label: 'Cut/drill labour rate', unit: '$/hr', type: 'number', group: 'Rates' },
  ],
  compute(i, ctx) {
    const [L, D] = i.size.split('x').map(Number);           // C20, C21
    const n = i.baffles;
    const yieldPer = D === i.stockWidth ? 1
      : 1 / (roundDown(i.stockLength / L) * roundDown(i.stockWidth / (D + 5)));       // C26
    const stockM2 = (i.stockLength * i.stockWidth) / 1e6;
    const across = roundDown(i.stockWidth / D);
    const cutMin = D === i.stockWidth ? 0 : 1.5 * (1 + across);                         // C8
    const direct = i.fixing === 'Direct';
    const holes = roundUp((L + 10) / 550) * 2;                                          // C31
    const lines = [
      line(ctx, { id: 'stock', section: 'material', label: 'Cewood stock', description: `${i.stockLength}×${i.stockWidth} sheet, yield ${yieldPer.toFixed(3)} per baffle`,
        qty: n * yieldPer * stockM2, unit: 'm²', rate: i.stockRateM2, priceKey: 'cewood:stock' }),
      line(ctx, { id: 'cut', section: 'labour', label: 'Cut to size', description: `${cutMin} min per baffle`,
        qty: (n * cutMin) / 60, unit: 'hr', rate: i.cutLabourRate, enabled: cutMin > 0 }),
      line(ctx, { id: 'suspension', section: 'material', label: 'Suspension kit', description: 'ADS kit, 1 per 800mm',
        qty: n * roundUp(L / 800), unit: 'kit', rate: i.suspensionKitEach, priceKey: 'cewood:suspension-kit', enabled: !direct }),
      line(ctx, { id: 'channel', section: 'material', label: 'Alum channel', description: '32×32×32×3 Megastone',
        qty: n / roundDown(i.channelStockLength / L), unit: 'length', rate: i.channelCostEach, priceKey: 'cewood:alum-channel', enabled: direct }),
      line(ctx, { id: 'channel-paint', section: 'material', label: 'Alum channel painting', description: 'Full length per baffle, as workbook',
        qty: n, unit: 'length', rate: i.channelPaintPerLength, enabled: direct }),
      line(ctx, { id: 'channel-drill', section: 'labour', label: 'Channel drill & countersink', description: `${holes} holes × 2 min`,
        qty: (n * holes * 2) / 60, unit: 'hr', rate: i.cutLabourRate, enabled: direct }),
      line(ctx, { id: 'paint', section: 'material', label: 'Painting', description: 'Both faces',
        qty: (n * L * D * 2) / 1e6, unit: 'm²', rate: i.paintRateM2, enabled: i.painting === 'Yes' }),
    ];
    const warnings: Warning[] = [];
    if (L > i.stockLength) warnings.push({ level: 'warn', message: 'Check stock length or adjust baffle length' });
    const waste = (i.stockWidth - across * D) / i.stockWidth;
    if (waste > 0.15) warnings.push({ level: 'warn', message: `Width wastage ${(waste * 100).toFixed(0)}% — adjust depth to reduce wastage` });
    if (i.painting === 'Yes') warnings.push({ level: 'info', message: 'Check m² rate for the specified colour/finish' });
    return { lines, warnings };
  },
  summarise(lines, i, ctx) {
    const [L] = i.size.split('x').map(Number);
    const materialCost = sectionTotal(lines, 'material');
    const labourCost = sectionTotal(lines, 'labour');
    const sub = materialCost + labourCost;
    const overhead = sub * ctx.settings.overheadPct;                 // C14 "incl. 12.5%"
    const totalCost = sub + overhead;
    const sell = i.marginPct == null ? null : totalCost / (1 - i.marginPct);
    const each = totalCost / i.baffles;
    return {
      materialCost, labourCost, totalCost,
      adjustments: [{ id: 'overhead', label: `Overhead recoveries ${(ctx.settings.overheadPct * 100).toFixed(1)}%`, amount: overhead }],
      marginPct: i.marginPct, sell,
      basis: { unit: 'each', qty: i.baffles, label: 'baffle' },
      costPerUnit: each, sellPerUnit: sell == null ? null : sell / i.baffles,
      headline: [{ label: 'Cost per LM', value: (each / L) * 1000 }],
    };
  },
};
