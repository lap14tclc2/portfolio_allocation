'use strict';

import path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');

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

export const config: Config = {
  root: ROOT,
  dataDir: path.join(ROOT, 'data'),
  snapshotsDir: path.join(ROOT, 'snapshots'),
  outputFile: path.join(ROOT, 'output.json'),
  outputHistoryFile: path.join(ROOT, 'data', 'output-history.json'),
  annualTargetFile: path.join(ROOT, 'data', 'annual-target.json'),
  portfolioStateFile: path.join(ROOT, 'data', 'portfolio-state.json'),
  suggestionsFile: path.join(ROOT, 'data', 'suggestions.json'),
  eventLogFile: path.join(ROOT, 'data', 'event.log'),
  port: Number(process.env.PORT) || 3000,
  erc: { annualizationFactor: 252, minimumObservations: 60, lookbackYears: 5 },
  bands: { normal: 0.1, soft: 0.2 },
};

export default config;
