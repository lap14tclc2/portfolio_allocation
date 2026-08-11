'use strict';

import path from 'node:path';

const ROOT = process.env.VERCEL || process.env.NOW_REGION ? process.cwd() : path.resolve(__dirname, '..', '..');

export interface Config {
  root: string;
  dataDir: string;
  snapshotsDir: string;
  outputFile: string;
  outputHistoryFile: string;
  annualTargetFile: string;
  portfolioStateFile: string;
  suggestionsFile: string;
  eventLogFile: string;
  port: number;
  erc: {
    annualizationFactor: number;
    minimumObservations: number;
    lookbackYears: number;
  };
  bands: {
    normal: number;
    soft: number;
  };
}

const isVercel = Boolean(process.env.VERCEL || process.env.NOW_REGION);
const WRITABLE_ROOT = isVercel ? '/tmp' : ROOT;

export const config: Config = {
  root: ROOT,
  dataDir: path.join(WRITABLE_ROOT, 'data'),
  snapshotsDir: path.join(WRITABLE_ROOT, 'snapshots'),
  outputFile: path.join(WRITABLE_ROOT, 'output.json'),
  outputHistoryFile: path.join(WRITABLE_ROOT, 'data', 'output-history.json'),
  annualTargetFile: path.join(WRITABLE_ROOT, 'data', 'annual-target.json'),
  portfolioStateFile: path.join(WRITABLE_ROOT, 'data', 'portfolio-state.json'),
  suggestionsFile: path.join(WRITABLE_ROOT, 'data', 'suggestions.json'),
  eventLogFile: path.join(WRITABLE_ROOT, 'data', 'event.log'),
  port: Number(process.env.PORT) || 3000,
  erc: { annualizationFactor: 252, minimumObservations: 60, lookbackYears: 5 },
  bands: { normal: 0.1, soft: 0.2 },
};



export default config;
