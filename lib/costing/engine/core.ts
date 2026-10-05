/**
 * Costing engine core — shared by every calculator.
 *
 * A calculator turns inputs into CostLines. The engine then applies the
 * person's manual overrides and hands the adjusted lines back to the
 * calculator's own summarise() so overheads, margin and rounding follow the
 * exact rules of the source spreadsheet.
 *
 * Line total = (qty × rate + setup) × (1 + wastagePct)
 * That one formula covers every workbook:
 *   DecorSlat / SlatCreate / Max  →  G × H, with G = base × (1 + J)
 *   Flat Panel                    →  C + C × G × waste%
 *   DecorZen                      →  (D + E + H) × (1 + I)
 */

export type Section = 'material' | 'labour' | 'other';

/** Where a line's rate came from — shown as a badge in the UI. */
export type RateSource =
  | 'order'     // latest material order price (Alice's material orders)
  | 'catalog'   // central price list (DecorZen Materials sheet, etc.)
  | 'default'   // value hardcoded in the source workbook
  | 'formula'   // derived from cycle times × labour rate
  | 'manual';   // overridden by a person, with a reason

export interface CostLine {
  id: string;
  section: Section;
  label: string;
  description?: string;
  qty: number;
  unit: string;
  rate: number;
  setup: number;
  wastagePct: number;
  rateSource: RateSource;
  /** Key into the price book. Lines with a key can take order/catalog prices. */
  priceKey?: string;
  enabled: boolean;
  total: number;
  /** Populated when an override was applied. */
  override?: AppliedOverride;
  /** Value before override, for the "was" display. */
  original?: { qty: number; rate: number; total: number };
  note?: string;
}

export interface LineOverride {
  rate?: number;
  qty?: number;
  total?: number;
  wastagePct?: number;
  enabled?: boolean;
  reason: string;
  by?: string;
  at?: string; // ISO timestamp
}
export type Overrides = Record<string, LineOverride>;
export interface AppliedOverride extends LineOverride { fields: string[] }

export interface PriceQuote {
  rate: number;
  unit?: string;
  source: 'order' | 'catalog';
  label?: string;
  asOf?: string;
  ref?: string; // e.g. material order id
}
export interface PriceBook {
  get(key: string): PriceQuote | undefined;
}
export const emptyPriceBook: PriceBook = { get: () => undefined };

export interface Settings {
  /** Factory recovery rate $/hr — 'Factory Recovery'!B3 / LABOUR!B1 */
  labourRate: number;
  /** Overhead recoveries — sum of factory recovery, legal, PM, TBC */
  overheadPct: number;
}
export const DEFAULT_SETTINGS: Settings = { labourRate: 175, overheadPct: 0.125 };

export interface Ctx {
  settings: Settings;
  prices: PriceBook;
}

export interface Adjustment { id: string; label: string; amount: number; note?: string }

export interface Summary {
  materialCost: number;
  labourCost: number;
  adjustments: Adjustment[];
  totalCost: number;
  marginPct: number | null;
  sell: number | null;
  basis: { unit: 'm2' | 'LM' | 'each'; qty: number; label: string };
  costPerUnit: number;
  sellPerUnit: number | null;
  labourHours?: number;
  headline?: { label: string; value: number }[];
}

/** `message` is plain words for whoever is quoting; `detail` keeps the workbook reference for the people who maintain the template. */
export interface Warning { level: 'info' | 'warn'; message: string; detail?: string }

export type InputType = 'number' | 'percent' | 'select' | 'text' | 'toggle';

export interface InputSpec<I = any> {
  key: string;
  label: string;
  type: InputType;
  group: string;
  unit?: string;
  help?: string;
  options?: string[] | ((inputs: I) => string[]);
  /** Hide when not relevant to the current inputs. */
  visible?: (inputs: I) => boolean;
  min?: number;
  step?: number;
}

export interface ComputeResult { lines: CostLine[]; warnings?: Warning[] }

export interface Calculator<I = any> {
  id: string;
  name: string;
  family: string;
  sourceFile: string;
  description: string;
  inputs: InputSpec<I>[];
  defaults: I;
  presets?: { name: string; values: Partial<I> }[];
  compute(inputs: I, ctx: Ctx): ComputeResult;
  summarise(lines: CostLine[], inputs: I, ctx: Ctx): Summary;
}

// ---------------------------------------------------------------- Excel math
// Excel rounds on the 15-significant-digit display value, so clean the float
// first or ROUNDUP(5.1, 1) becomes 5.2.
const clean = (x: number) => Number(x.toPrecision(15));
export function roundUp(x: number, digits = 0): number {
  const f = 10 ** digits;
  return (Math.sign(x) * Math.ceil(clean(Math.abs(x) * f))) / f;
}
export function roundDown(x: number, digits = 0): number {
  const f = 10 ** digits;
  return (Math.sign(x) * Math.floor(clean(Math.abs(x) * f))) / f;
}
export function mround(x: number, multiple = 1): number {
  return Math.sign(x) * Math.round(clean(Math.abs(x) / multiple)) * multiple;
}
export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
export const safeDiv = (a: number, b: number) => (b === 0 ? 0 : a / b);

// -------------------------------------------------------------- line helpers
export function lineTotal(l: Pick<CostLine, 'qty' | 'rate' | 'setup' | 'wastagePct' | 'enabled'>) {
  if (!l.enabled) return 0;
  return (l.qty * l.rate + l.setup) * (1 + l.wastagePct);
}

type LineInit = Omit<CostLine, 'total' | 'setup' | 'wastagePct' | 'enabled' | 'rateSource'> &
  Partial<Pick<CostLine, 'setup' | 'wastagePct' | 'enabled' | 'rateSource'>> & { defaultRate?: number };

/**
 * Build a line. If it has a priceKey and the price book knows it, the book's
 * rate replaces the workbook default (order beats catalog inside the book).
 */
export function line(ctx: Ctx, init: LineInit): CostLine {
  const { defaultRate, ...rest } = init;
  let rate = init.rate;
  let rateSource: RateSource = init.rateSource ?? 'default';
  let note = init.note;
  if (init.priceKey) {
    const q = ctx.prices.get(init.priceKey);
    if (q) {
      rate = q.rate;
      rateSource = q.source;
      note = [note, q.label, q.asOf && `as of ${q.asOf}`].filter(Boolean).join(' · ') || undefined;
    }
  }
  const l: CostLine = {
    setup: 0,
    wastagePct: 0,
    enabled: true,
    ...rest,
    rate,
    rateSource,
    note,
    total: 0,
  };
  l.total = lineTotal(l);
  return l;
}

/** Apply manual overrides; every changed field is recorded on the line. */
export function applyOverrides(lines: CostLine[], overrides: Overrides = {}): CostLine[] {
  return lines.map((l) => {
    const o = overrides[l.id];
    if (!o) return l;
    const fields: string[] = [];
    const next: CostLine = { ...l, original: { qty: l.qty, rate: l.rate, total: l.total } };
    if (o.enabled !== undefined && o.enabled !== l.enabled) { next.enabled = o.enabled; fields.push('enabled'); }
    if (o.qty !== undefined) { next.qty = o.qty; fields.push('qty'); }
    if (o.rate !== undefined) { next.rate = o.rate; next.rateSource = 'manual'; fields.push('rate'); }
    if (o.wastagePct !== undefined) { next.wastagePct = o.wastagePct; fields.push('wastagePct'); }
    next.total = lineTotal(next);
    if (o.total !== undefined && next.enabled) { next.total = o.total; next.rateSource = 'manual'; fields.push('total'); }
    if (!fields.length) return l;
    next.override = { ...o, fields };
    return next;
  });
}

export const sectionTotal = (lines: CostLine[], s: Section) =>
  sum(lines.filter((l) => l.section === s && l.enabled).map((l) => l.total));

export interface CostingRun {
  calculator: string;
  inputs: any;
  lines: CostLine[];
  summary: Summary;
  warnings: Warning[];
  overrideCount: number;
}

export function runCosting<I>(
  calc: Calculator<I>,
  inputs: Partial<I>,
  opts: {
    overrides?: Overrides;
    settings?: Partial<Settings>;
    prices?: PriceBook;
    /** Lines a person added by hand. They join after the overrides, so they are never overridden — they are edited directly. */
    extraLines?: CostLine[];
  } = {},
): CostingRun {
  const ctx: Ctx = {
    settings: { ...DEFAULT_SETTINGS, ...opts.settings },
    prices: opts.prices ?? emptyPriceBook,
  };
  const full = { ...calc.defaults, ...inputs } as I;
  const { lines, warnings = [] } = calc.compute(full, ctx);
  const adjusted = [...applyOverrides(lines, opts.overrides), ...(opts.extraLines ?? [])];
  const summary = calc.summarise(adjusted, full, ctx);
  return {
    calculator: calc.id,
    inputs: full,
    lines: adjusted,
    summary,
    warnings,
    overrideCount: adjusted.filter((l) => l.override).length,
  };
}
