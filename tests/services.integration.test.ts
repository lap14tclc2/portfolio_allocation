import { describe, it, expect, beforeAll } from 'vitest';
import storageService, {
  saveSnapshot,
  readLatestSnapshotData,
  parseSnapshotContent,
  getSnapshotTree,
  deleteSnapshotFile,
} from '../src/services/storage.service';
import { calculateERC, getRiskWindow } from '../src/services/erc.service';
import { buildPortfolioFromTarget } from '../src/services/portfolio.service';
import { latestStocks } from '../src/services/backlog.service';
import { parseHistory } from '../src/services/history.service';
import { Stock, AnnualTarget } from '../src/types';

beforeAll(async () => {
  await storageService.initialize();
});

describe('Services Integration Tests', () => {
  const mockStocks: Stock[] = [
    { ticker: 'ACB', averageCostBasis: 19760, currentShares: 19210, currentPrice: 22650 },
    { ticker: 'DGC', averageCostBasis: 52760, currentShares: 10000, currentPrice: 43600 },
    { ticker: 'FPT', averageCostBasis: 73800, currentShares: 3000, currentPrice: 71800 },
  ];

  it('ercService: getRiskWindow - should calculate 5-year lookback window', () => {
    const window = getRiskWindow(2026);
    expect(window.start).toBe('2021-01-01');
    expect(window.end).toBe('2025-12-31');
  });

  it('ercService: calculateERC - should calculate risk contributions and weights', async () => {
    const histories = await Promise.all(
      mockStocks.map(async (s) => parseHistory(await storageService.readHistory(s.ticker)))
    );

    const erc = calculateERC(mockStocks, histories, 2026);
    expect(erc.weights).toHaveLength(3);
    expect(erc.weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 4);
    expect(erc.volatility).toHaveLength(3);
    expect(erc.portfolioRisk).toBeGreaterThan(0);
  });

  it('portfolioService: buildPortfolioFromTarget - should rebalance portfolio with cash reserve', () => {
    const annualTarget: AnnualTarget = {
      year: 2026,
      allocationDate: '2026-01-01',
      riskWindow: { start: '2021-01-01', end: '2025-12-31' },
      method: 'ERC',
      targets: { ACB: 0.3942, DGC: 0.2482, FPT: 0.3576 },
      locked: true,
      createdAt: new Date().toISOString(),
    };

    const result = buildPortfolioFromTarget(mockStocks, annualTarget, undefined, 50000000);
    expect(result.cashReserve).toBe(50000000);
    expect(result.results).toHaveLength(3);
    expect(result.nav).toBe(result.equityNav + 50000000);
  });

  it('storageService: saveSnapshot - should overwrite when parameters match, create new when changed', async () => {
    const cash = 50000000;
    const fullOutput = { results: [], cashReserve: cash };
    const path1 = await saveSnapshot(mockStocks, fullOutput, new Date().toISOString(), cash);
    const path2 = await saveSnapshot(mockStocks, fullOutput, new Date().toISOString(), cash);
    expect(path1).toBe(path2);

    const changedStocks: Stock[] = [
      ...mockStocks,
      { ticker: 'TESTNEW', averageCostBasis: 25000, currentShares: 5000, currentPrice: 27000 },
    ];
    const path3 = await saveSnapshot(changedStocks, fullOutput, new Date().toISOString(), cash);
    expect(path3).not.toBe(path1);

    const dateFolder = path3.split(/[/\\]/).slice(-2, -1)[0];
    const filename = path3.split(/[/\\]/).pop()!;
    await deleteSnapshotFile(dateFolder, filename);
  });

  it('backlogService: latestStocks - should parse stock inputs from snapshot text block', () => {
    const snapshotText = `
===================================
SNAPSHOT
Date: 2026-08-10T12:00:00.000Z
CashReserve: 50,000,000

--- 1. TICKER INPUT DATA ---
Stock: ACB
  Cost: 19760
  Shares: 19210
  Price: 22650
Stock: DGC
  Cost: 52760
  Shares: 10000
  Price: 43600
===================================
`;

    const parsed = latestStocks(snapshotText);
    expect(parsed.cashReserve).toBe(50000000);
    expect(parsed.stocks).toHaveLength(2);
    expect(parsed.stocks[0].ticker).toBe('ACB');
    expect(parsed.stocks[0].currentPrice).toBe(22650);
  });
});
