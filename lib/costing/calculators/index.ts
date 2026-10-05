import { cewood } from './cewood';
import { decorMetl } from './decorMetl';
import { decorSlat, slatCreate } from './slat';
import { decorSlatMax } from './slatMax';
import { decorZen } from './decorZen';
import { flatPanel } from './flatPanel';
import type { Calculator } from '../engine/core';

export const CALCULATORS: Calculator[] = [decorZen, flatPanel, decorSlat, slatCreate, decorSlatMax, cewood, decorMetl];
export const getCalculator = (id: string) => CALCULATORS.find((c) => c.id === id);
export { cewood, decorMetl, decorSlat, slatCreate, decorSlatMax, decorZen, flatPanel };
