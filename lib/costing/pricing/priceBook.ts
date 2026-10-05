import type { PriceBook, PriceQuote } from '../engine/core';

/**
 * Builds the price book the calculators read from.
 *
 * Precedence for a priceKey:  latest material-order price  >  catalog price  >  workbook default.
 * (Manual overrides on a costing sit above all of these and are applied per job.)
 *
 * priceKey conventions used by the calculators:
 *   material:<DecorZen Material ID>     e.g. material:12mm FR MDF Fireguard (CharCore) - Smartlook Hoop Pine G1S
 *   edgetape:<DecorZen Material ID>     edge tape matched to that board
 *   board:<backing material>:<mm>       DecorSlat / SlatCreate backing board
 *   slat:lm:<type>:<w>x<d> · slat:sheet:<type>:<mm> · beam:sheet:<type>:<mm> · cleat:<name>
 *   decorsorb:lining · decorsorb:black · cewood:stock · cewood:suspension-kit · cewood:alum-channel
 *   decormetl:<item no>:<perforation> · paint:<product type>:<paint>
 */
export interface OrderPrice {
  priceKey: string;
  rate: number;          // in the line's unit ($/m², $/LM, $ each)
  unit?: string;
  orderId: string;
  orderedAt: string;     // ISO date
  supplier?: string;
}
export interface CatalogPrice { rate: number; unit?: string; label?: string; asOf?: string }

export function createPriceBook(opts: {
  catalog?: Record<string, CatalogPrice>;
  orders?: OrderPrice[];
  /** Ignore order prices older than this. Default 180 days. */
  maxOrderAgeDays?: number;
  now?: Date;
}): PriceBook {
  const now = opts.now ?? new Date();
  const maxAge = (opts.maxOrderAgeDays ?? 180) * 86_400_000;
  const latest = new Map<string, OrderPrice>();
  for (const o of opts.orders ?? []) {
    if (!(o.rate > 0)) continue;
    if (now.getTime() - new Date(o.orderedAt).getTime() > maxAge) continue;
    const cur = latest.get(o.priceKey);
    if (!cur || o.orderedAt > cur.orderedAt) latest.set(o.priceKey, o);
  }
  return {
    get(key): PriceQuote | undefined {
      const o = latest.get(key);
      if (o) return { rate: o.rate, unit: o.unit, source: 'order', label: `Order ${o.orderId}${o.supplier ? ' · ' + o.supplier : ''}`, asOf: o.orderedAt.slice(0, 10), ref: o.orderId };
      const c = opts.catalog?.[key];
      if (c) return { rate: c.rate, unit: c.unit, source: 'catalog', label: c.label, asOf: c.asOf };
      return undefined;
    },
  };
}
