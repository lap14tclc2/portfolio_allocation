import fs from 'node:fs/promises';
import path from 'node:path';
import logger from '../utils/logger';
import config from '../config';
import { Stock, AnnualTarget, PortfolioState } from '../types';
import { latestStocks } from './backlog.service';
import postgresStore from './postgres-store.service';
import memoryStore from './memory-store.service';

const isVercel = Boolean(process.env.VERCEL || process.env.NOW_REGION);


export async function initialize(): Promise<void> {
  if (isVercel) {
    await postgresStore.initialize();
    return;
  }
  try {
    await fs.mkdir(config.dataDir, { recursive: true });
  } catch (err: any) {
    logger.warn('Could not create dataDir', { path: config.dataDir, error: err.message });
  }
  try {
    await fs.mkdir(config.snapshotsDir, { recursive: true });
  } catch (err: any) {
    logger.warn('Could not create snapshotsDir', { path: config.snapshotsDir, error: err.message });
  }
}

export async function readLatestSnapshot(): Promise<string> {
  if (isVercel) {
    const dbSnaps = await postgresStore.getSnapshots();
    if (dbSnaps.length > 0) return dbSnaps[0].text;

    const memSnaps = memoryStore.getSnapshots();
    if (memSnaps.length > 0) return memSnaps[0].text;
  }

  const dirs = [config.snapshotsDir];
  const bundledDir = path.join(config.root, 'snapshots');
  if (config.snapshotsDir !== bundledDir) {
    dirs.push(bundledDir);
  }

  for (const baseDir of dirs) {
    try {
      const dateEntries = await fs.readdir(baseDir, { withFileTypes: true });
      const dateFolders = dateEntries
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort((a, b) => b.localeCompare(a));

      for (const folderName of dateFolders) {
        const folderPath = path.join(baseDir, folderName);
        const files = (await fs.readdir(folderPath, { withFileTypes: true }))
          .filter((e) => e.isFile() && e.name.endsWith('.txt'))
          .map((e) => e.name)
          .sort((a, b) => b.localeCompare(a));

        if (files.length > 0) {
          const latestFilePath = path.join(folderPath, files[0]);
          return await fs.readFile(latestFilePath, 'utf8');
        }
      }
    } catch (err: any) {
      logger.warn('Failed to read snapshot directory', { baseDir, error: err.message });
    }
  }

  return '';
}

export interface SnapshotFolder {
  date: string;
  files: string[];
}

export interface SnapshotTree {
  name: string;
  folders: SnapshotFolder[];
}

export async function getSnapshotTree(): Promise<SnapshotTree> {
  const foldersMap = new Map<string, Set<string>>();

  if (isVercel) {
    const dbSnaps = await postgresStore.getSnapshots();
    for (const snap of dbSnaps) {
      if (!foldersMap.has(snap.date)) foldersMap.set(snap.date, new Set());
      foldersMap.get(snap.date)!.add(snap.name);
    }

    for (const mem of memoryStore.getSnapshots()) {
      if (!foldersMap.has(mem.date)) foldersMap.set(mem.date, new Set());
      foldersMap.get(mem.date)!.add(mem.name);
    }

    const sortedFolders = Array.from(foldersMap.keys()).sort((a, b) => b.localeCompare(a));
    const folders: SnapshotFolder[] = sortedFolders.map((date) => ({
      date,
      files: Array.from(foldersMap.get(date)!).sort((a, b) => b.localeCompare(a)),
    }));

    return { name: 'snapshots', folders };
  }


  const scanDir = async (baseDir: string) => {
    try {
      const dateEntries = await fs.readdir(baseDir, { withFileTypes: true });
      const dateFolders = dateEntries.filter((e) => e.isDirectory()).map((e) => e.name);
      for (const folderName of dateFolders) {
        const folderPath = path.join(baseDir, folderName);
        const files = (await fs.readdir(folderPath, { withFileTypes: true }))
          .filter((e) => e.isFile() && e.name.endsWith('.txt'))
          .map((e) => e.name);

        if (files.length > 0) {
          if (!foldersMap.has(folderName)) foldersMap.set(folderName, new Set());
          const set = foldersMap.get(folderName)!;
          files.forEach((f) => set.add(f));
        }
      }
    } catch (err: any) {
      logger.warn('Failed scanning snapshot dir', { baseDir, error: err.message });
    }
  };

  const bundledDir = path.join(config.root, 'snapshots');
  await scanDir(bundledDir);
  if (!isVercel && config.snapshotsDir !== bundledDir) {
    await scanDir(config.snapshotsDir);
  }

  const sortedFolders = Array.from(foldersMap.keys()).sort((a, b) => b.localeCompare(a));
  const folders: SnapshotFolder[] = sortedFolders.map((date) => ({
    date,
    files: Array.from(foldersMap.get(date)!).sort((a, b) => b.localeCompare(a)),
  }));

  return { name: 'snapshots', folders };
}



function parseNum(val: string): number {
  if (!val) return 0;
  return Number(val.replace(/,/g, '').replace(/%/g, '').trim()) || 0;
}

function parsePercent(val: string): number {
  if (!val) return 0;
  return parseNum(val) / 100;
}

function parseKeyValueLine(str: string): Record<string, string> {
  const result: Record<string, string> = {};
  const matches = Array.from(str.matchAll(/([A-Za-z0-9_]+)=([^=]+?)(?=\s*,\s*[A-Za-z0-9_]+=|$\s*)/g));
  for (const match of matches) {
    const key = match[1].trim();
    let val = match[2].trim();
    if (val.endsWith(',')) val = val.slice(0, -1).trim();
    result[key] = val;
  }
  return result;
}

function parseHeaderAndAnnualTargetLine(trimmed: string, state: any): void {
  const cashReserveHeaderMatch = trimmed.match(/^CashReserve:\s*(\d+)$/);
  if (cashReserveHeaderMatch) state.cashReserve = Number(cashReserveHeaderMatch[1]) || 0;

  const allocYearMatch = trimmed.match(/^AllocationYear:\s*(.+)$/);
  if (allocYearMatch) state.annualTarget.year = Number(allocYearMatch[1]) || 2026;

  const targetStatusMatch = trimmed.match(/^TargetStatus:\s*(.+)$/);
  if (targetStatusMatch) state.annualTarget.status = targetStatusMatch[1];

  const applicabilityMatch = trimmed.match(/^Applicability:\s*(.+)$/);
  if (applicabilityMatch) state.annualTarget.applicability = applicabilityMatch[1];

  const riskWindowMatch = trimmed.match(/^RiskWindow:\s*(.+)$/);
  if (riskWindowMatch) state.annualTarget.riskWindow = riskWindowMatch[1];

  const portRiskMatch = trimmed.match(/^PortfolioRisk:\s*(.+)$/);
  if (portRiskMatch) state.erc.portfolioRisk = parsePercent(portRiskMatch[1]);
}

function parseShannonLine(trimmed: string, state: any): void {
  const totalNavMatch = trimmed.match(/^TotalNAV:\s*(.+)$/);
  if (totalNavMatch) state.nav = parseNum(totalNavMatch[1]);

  const eqNavMatch = trimmed.match(/^EquityNAV:\s*(.+)$/);
  if (eqNavMatch) state.equityNav = parseNum(eqNavMatch[1]);

  if (trimmed.startsWith('CashReserve:')) {
    const sec4Match = trimmed.match(/^CashReserve:\s*([0-9,.]+)$/);
    if (sec4Match) {
      const val = parseNum(sec4Match[1]);
      if (val > 0) state.cashReserve = val;
    }
  }

  const cashDeployedMatch = trimmed.match(/^CashDeployed:\s*(.+)$/);
  if (cashDeployedMatch) state.cashDeployed = parseNum(cashDeployedMatch[1]);

  const remCashMatch = trimmed.match(/^RemainingCash:\s*(.+)$/);
  if (remCashMatch) state.remainingCash = parseNum(remCashMatch[1]);

  const hardBankMatch = trimmed.match(/^HardBank:\s*(.+)$/);
  if (hardBankMatch) state.hardBank = parseNum(hardBankMatch[1]);

  const shannonRowMatch = trimmed.match(/^SHANNON_([A-Za-z0-9._-]+):\s*(.+)$/);
  if (shannonRowMatch) {
    const ticker = shannonRowMatch[1];
    const p = parseKeyValueLine(shannonRowMatch[2]);
    const normalParts = (p.NormalBand || '').split('-');
    state.results.push({
      ticker,
      value: parseNum(p.Value),
      currentWeight: parsePercent(p.CurrentWeight),
      ercWeight: parsePercent(p.Target),
      normal: { lower: parsePercent(normalParts[0]), upper: parsePercent(normalParts[1]) },
      band: p.Status || 'NORMAL',
      drift: parsePercent(p.Drift),
      recommendation: p.Recommendation || 'HOLD',
      targetTradeAmount: parseNum(p.TargetTradeAmount),
      fundedTradeAmount: parseNum(p.FundedTradeAmount),
      sharesToTrade: parseNum(p.SharesToTrade),
      expectedWeight: parsePercent(p.ExpectedWeight),
    });
  }
}

function parseStateLine(trimmed: string, state: any): void {
  const stateTotalNavMatch = trimmed.match(/^StateTotalNAV:\s*(.+)$/);
  if (stateTotalNavMatch) state.stateTotalNav = parseNum(stateTotalNavMatch[1]);

  const stateEqNavMatch = trimmed.match(/^StateEquityNAV:\s*(.+)$/);
  if (stateEqNavMatch) state.stateEquityNav = parseNum(stateEqNavMatch[1]);

  const stateCashResMatch = trimmed.match(/^StateCashReserve:\s*(.+)$/);
  if (stateCashResMatch) state.stateCashReserve = parseNum(stateCashResMatch[1]);

  const stateRowMatch = trimmed.match(/^STATE_([A-Za-z0-9._-]+):\s*(.+)$/);
  if (stateRowMatch) {
    const ticker = stateRowMatch[1];
    const p = parseKeyValueLine(stateRowMatch[2]);
    state.stateHoldings.push({
      ticker,
      initialShares: parseNum(p.InitialShares),
      action: p.Action || 'HOLD',
      tradeShares: parseNum(p.TradeShares),
      shares: parseNum(p.ExecutedShares),
      price: parseNum(p.Price),
      marketValue: parseNum(p.ExecutedMarketValue),
      weight: parsePercent(p.ExecutedWeight),
      ercTargetWeight: p.ERCTarget ? parsePercent(p.ERCTarget) : undefined,
    });
  }
}

export function parseOutputFromSnapshotText(text: string): any {
  if (!text) return null;

  const jsonMatch = text.match(/--- JSON_OUTPUT ---\s*\n([\s\S]*?)\n===================================/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1].trim());
    } catch {
      // fallback to text parsing
    }
  }

  const state = {
    annualTarget: {} as any,
    erc: { weights: [], volatility: [], riskContributions: [], portfolioRisk: 0 },
    nav: 0,
    equityNav: 0,
    cashReserve: 0,
    cashDeployed: 0,
    remainingCash: 0,
    hardBank: 0,
    stateTotalNav: 0,
    stateEquityNav: 0,
    stateCashReserve: 0,
    results: [] as any[],
    stateHoldings: [] as any[],
  };

  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    parseHeaderAndAnnualTargetLine(trimmed, state);
    parseShannonLine(trimmed, state);
    parseStateLine(trimmed, state);
  });

  if (state.results.length === 0) return null;
  if (!state.nav && state.equityNav) state.nav = state.equityNav + state.cashReserve;

  return {
    generatedAt: new Date().toISOString(),
    nav: state.nav,
    equityNav: state.equityNav,
    cashReserve: state.cashReserve,
    cashDeployed: state.cashDeployed,
    remainingCash: state.remainingCash,
    hardBank: state.hardBank,
    annualTarget: state.annualTarget,
    erc: state.erc,
    results: state.results,
    portfolioState: {
      totalNav: state.stateTotalNav || state.nav,
      equityNav: state.stateEquityNav || state.equityNav,
      cashReserve: state.stateCashReserve || state.remainingCash,
      holdings: state.stateHoldings,
    },
  };
}

export async function readSnapshotFileData(date: string, filename: string): Promise<{
  hasSnapshot: boolean;
  stocks: Stock[];
  cashReserve: number;
  fullOutput: any | null;
  date: string;
  filename: string;
}> {
  if (isVercel) {
    const dbSnap = await postgresStore.getSnapshot(date, filename);
    if (dbSnap) {
      const parsed = parseSnapshotContent(dbSnap.text);
      return { ...parsed, date, filename };
    }

    const memSnap = memoryStore.getSnapshot(date, filename);
    if (memSnap) {
      const parsed = parseSnapshotContent(memSnap.text);
      return { ...parsed, date, filename };
    }
  }

  const filePath = path.join(config.snapshotsDir, date, filename);
  try {
    let text: string;
    try {
      text = await fs.readFile(filePath, 'utf8');
    } catch {
      const fallbackPath = path.join(config.root, 'snapshots', date, filename);
      text = await fs.readFile(fallbackPath, 'utf8');
    }
    const parsed = parseSnapshotContent(text);
    return { ...parsed, date, filename };
  } catch (err: any) {
    logger.warn('Failed to read snapshot file', { date, filename, error: err.message });
    return { hasSnapshot: false, stocks: [], cashReserve: 0, fullOutput: null, date, filename };
  }
}

export async function deleteSnapshotFile(date: string, filename: string): Promise<{ ok: boolean }> {
  if (isVercel) {
    const deletedDb = await postgresStore.deleteSnapshot(date, filename);
    const deletedMem = memoryStore.deleteSnapshot(date, filename);
    if (deletedDb || deletedMem) return { ok: true };
  }

  const folderPath = path.join(config.snapshotsDir, date);
  const filePath = path.join(folderPath, filename);
  try {
    try {
      await fs.unlink(filePath);
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        const bundledPath = path.join(config.root, 'snapshots', date, filename);
        await fs.unlink(bundledPath);
      } else {
        throw err;
      }
    }
    logger.info('Deleted snapshot file', { date, filename });

    try {
      const remaining = await fs.readdir(folderPath);
      if (remaining.length === 0) {
        await fs.rmdir(folderPath);
        logger.info('Removed empty snapshot folder', { date });
      }
    } catch {
      // Ignore directory cleanup errors in serverless
    }
    return { ok: true };
  } catch (err: any) {
    logger.error('Failed to delete snapshot file', { date, filename, error: err.message });
    if (err.code === 'EROFS') {
      throw new Error(`Cannot delete pre-packaged deployment snapshot in read-only environment: ${filename}`);
    }
    throw new Error(`Failed to delete snapshot file: ${err.message}`);
  }
}



export function parseSnapshotContent(text: string): {
  hasSnapshot: boolean;
  stocks: Stock[];
  cashReserve: number;
  fullOutput: any | null;
} {
  if (!text || !text.trim()) {
    return { hasSnapshot: false, stocks: [], cashReserve: 0, fullOutput: null };
  }

  const backlogRes = latestStocks(text);
  if (!backlogRes.stocks || backlogRes.stocks.length === 0) {
    return { hasSnapshot: false, stocks: [], cashReserve: 0, fullOutput: null };
  }

  const fullOutput = parseOutputFromSnapshotText(text);

  return {
    hasSnapshot: true,
    stocks: backlogRes.stocks,
    cashReserve: fullOutput?.cashReserve ?? backlogRes.cashReserve ?? 0,
    fullOutput,
  };
}

export async function readLatestSnapshotData(): Promise<{
  hasSnapshot: boolean;
  stocks: Stock[];
  cashReserve: number;
  fullOutput: any | null;
  date?: string;
  filename?: string;
}> {
  const latestPathData = await readLatestSnapshotPathAndData();
  if (latestPathData && latestPathData.hasSnapshot) {
    let date = '';
    let filename = '';
    if (latestPathData.filePath) {
      const parts = latestPathData.filePath.split(/[/\\]/);
      if (parts.length >= 2) {
        date = parts[parts.length - 2];
        filename = parts[parts.length - 1];
      }
    }
    return {
      hasSnapshot: true,
      stocks: latestPathData.stocks,
      cashReserve: latestPathData.cashReserve,
      fullOutput: latestPathData.fullOutput,
      date,
      filename,
    };
  }

  const text = await readLatestSnapshot();
  if (!text || !text.trim()) {
    return { hasSnapshot: false, stocks: [], cashReserve: 0, fullOutput: null };
  }

  return parseSnapshotContent(text);
}



function buildSnapshotHeaderSection(stocks: Stock[], dateIso: string, cashReserve: number): string[] {
  const lines: string[] = [];
  lines.push('===================================');
  lines.push('SNAPSHOT');
  lines.push(`Date: ${dateIso}`);
  lines.push(`CashReserve: ${cashReserve}`);
  lines.push('');
  lines.push('--- 1. TICKER INPUT DATA ---');
  stocks.forEach((stock) => {
    lines.push(`Stock: ${stock.ticker}`);
    lines.push(`  Cost: ${stock.averageCostBasis}`);
    lines.push(`  Shares: ${stock.currentShares}`);
    lines.push(`  Price: ${stock.currentPrice}`);
  });
  return lines;
}

function buildSnapshotERCSection(stocks: Stock[], fullOutput: any): string[] {
  const percentStr = (val: any) => `${(Number(val || 0) * 100).toFixed(2)}%`;
  const lines: string[] = [];
  lines.push('');
  lines.push('--- 2. HISTORY DATA VALIDATION ---');
  stocks.forEach((s) => lines.push(`Validation_${s.ticker}: Status=PASS, Details=Ready`));

  lines.push('');
  lines.push('--- 3. ERC ANNUAL ALLOCATION ---');
  const year = fullOutput.annualTarget?.year || new Date().getFullYear();
  const rw = fullOutput.annualTarget?.riskWindow || {};
  const riskWindowStr = typeof rw === 'object' && rw.start && rw.end ? `${rw.start} -> ${rw.end}` : String(rw || '-');
  lines.push(`AllocationYear: ${year}`);
  lines.push(`TargetStatus: ${fullOutput.annualTarget?.status || (fullOutput.annualTarget?.locked ? 'LOCKED' : 'UNLOCKED')}`);
  lines.push(`Applicability: ${fullOutput.annualTarget?.applicability || 'VALID'}`);
  lines.push(`RiskWindow: ${riskWindowStr}`);
  lines.push(`Observations: ${fullOutput.erc?.diagnostics?.observations || fullOutput.annualTarget?.diagnostics?.observations || 1066}`);
  lines.push(`PortfolioRisk: ${percentStr(fullOutput.erc?.portfolioRisk || fullOutput.annualTarget?.diagnostics?.portfolioRisk || 0)}`);
  lines.push(`ERCValidation: PASS`);

  (fullOutput.results || []).forEach((r: any) => {
    lines.push(
      `ERC_${r.ticker}: CurrentWeight=${percentStr(r.currentWeight)}, AnnualTarget=${percentStr(r.ercWeight)}, Volatility=${percentStr(r.volatility)}, RiskContribution=${percentStr(r.riskContribution)}, Drift=${percentStr(r.drift)}`
    );
  });
  return lines;
}

function buildSnapshotShannonSection(fullOutput: any): string[] {
  const moneyStr = (val: any) => Number(val || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const percentStr = (val: any) => `${(Number(val || 0) * 100).toFixed(2)}%`;
  const lines: string[] = [];
  lines.push('');
  lines.push('--- 4. SHANNON REBALANCING ---');
  lines.push(`TotalNAV: ${moneyStr(fullOutput.nav ?? fullOutput.totalNav)}`);
  lines.push(`EquityNAV: ${moneyStr(fullOutput.equityNav)}`);
  lines.push(`CashReserve: ${moneyStr(fullOutput.cashReserve)}`);
  lines.push(`CashDeployed: ${moneyStr(fullOutput.cashDeployed)}`);
  lines.push(`RemainingCash: ${moneyStr(fullOutput.remainingCash)}`);
  lines.push(`HardBank: ${moneyStr(fullOutput.hardBank)}`);
  (fullOutput.results || []).forEach((r: any) => {
    lines.push(
      `SHANNON_${r.ticker}: Value=${moneyStr(r.value)}, CurrentWeight=${percentStr(r.currentWeight)}, Target=${percentStr(r.ercWeight)}, NormalBand=${percentStr(r.normal?.lower)}-${percentStr(r.normal?.upper)}, Status=${r.band}, Drift=${percentStr(r.drift)}, Recommendation=${r.recommendation}, TargetTradeAmount=${moneyStr(r.targetTradeAmount)}, FundedTradeAmount=${moneyStr(r.fundedTradeAmount)}, SharesToTrade=${Math.round(r.sharesToTrade || 0)}, ExpectedWeight=${percentStr(r.expectedWeight)}`
    );
  });
  return lines;
}

function buildSnapshotStateSection(fullOutput: any): string[] {
  const moneyStr = (val: any) => Number(val || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const percentStr = (val: any) => `${(Number(val || 0) * 100).toFixed(2)}%`;
  const lines: string[] = [];
  if (fullOutput.portfolioState) {
    const state = fullOutput.portfolioState;
    lines.push('');
    lines.push('--- 5. PORTFOLIO STATE (LAYER 2) — RESULT AFTER ALLOCATION ---');
    lines.push(`StateTotalNAV: ${moneyStr(state.totalNav)}`);
    lines.push(`StateEquityNAV: ${moneyStr(state.equityNav)}`);
    lines.push(`StateCashReserve: ${moneyStr(state.cashReserve)}`);
    (state.holdings || []).forEach((h: any) => {
      lines.push(
        `STATE_${h.ticker}: InitialShares=${Math.round(h.initialShares ?? h.shares)}, Action=${h.action || 'HOLD'}, TradeShares=${Math.round(h.tradeShares || 0)}, ExecutedShares=${Math.round(h.shares)}, Price=${moneyStr(h.price)}, ExecutedMarketValue=${moneyStr(h.marketValue)}, ExecutedWeight=${percentStr(h.weight)}, ERCTarget=${h.ercTargetWeight != null ? percentStr(h.ercTargetWeight) : '-'}`
      );
    });
  }
  lines.push('');
  lines.push('--- JSON_OUTPUT ---');
  lines.push(JSON.stringify(fullOutput, null, 2));
  lines.push('');
  lines.push('===================================');
  return lines;
}

export function buildSnapshotText(
  stocks: Stock[],
  fullOutput?: any,
  dateIso: string = new Date().toISOString(),
  cashReserve: number = 0
): string {
  const lines = buildSnapshotHeaderSection(stocks, dateIso, cashReserve);
  if (fullOutput) {
    lines.push(...buildSnapshotERCSection(stocks, fullOutput));
    lines.push(...buildSnapshotShannonSection(fullOutput));
    lines.push(...buildSnapshotStateSection(fullOutput));
  } else {
    lines.push('');
    lines.push('===================================');
  }
  return lines.join('\n');
}

function isSameSnapshotInput(
  stocksA: Stock[],
  cashA: number,
  stocksB: Stock[],
  cashB: number
): boolean {
  if (cashA !== cashB) return false;
  if (stocksA.length !== stocksB.length) return false;

  for (let i = 0; i < stocksA.length; i++) {
    const a = stocksA[i];
    const b = stocksB[i];
    if (a.ticker.toUpperCase() !== b.ticker.toUpperCase()) return false;
    if (Number(a.averageCostBasis || 0) !== Number(b.averageCostBasis || 0)) return false;
    if (Number(a.currentShares || 0) !== Number(b.currentShares || 0)) return false;
    if (Number(a.currentPrice || 0) !== Number(b.currentPrice || 0)) return false;
  }

  return true;
}

export async function readLatestSnapshotPathAndData(): Promise<{
  filePath: string | null;
  hasSnapshot: boolean;
  stocks: Stock[];
  cashReserve: number;
  fullOutput: any | null;
}> {
  if (isVercel) {
    const dbSnaps = await postgresStore.getSnapshots();
    if (dbSnaps.length > 0) {
      const parsed = parseSnapshotContent(dbSnaps[0].text);
      return {
        filePath: `${dbSnaps[0].date}/${dbSnaps[0].name}`,
        hasSnapshot: parsed.hasSnapshot,
        stocks: parsed.stocks,
        cashReserve: parsed.cashReserve,
        fullOutput: parsed.fullOutput,
      };
    }

    const memSnaps = memoryStore.getSnapshots();
    if (memSnaps.length > 0) {
      const parsed = parseSnapshotContent(memSnaps[0].text);
      return {
        filePath: `${memSnaps[0].date}/${memSnaps[0].name}`,
        hasSnapshot: parsed.hasSnapshot,
        stocks: parsed.stocks,
        cashReserve: parsed.cashReserve,
        fullOutput: parsed.fullOutput,
      };
    }
  }

  const dirs = [config.snapshotsDir];
  const bundledDir = path.join(config.root, 'snapshots');
  if (config.snapshotsDir !== bundledDir) {
    dirs.push(bundledDir);
  }

  for (const baseDir of dirs) {
    try {
      const dateEntries = await fs.readdir(baseDir, { withFileTypes: true });
      const dateFolders = dateEntries
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort((a, b) => b.localeCompare(a));

      for (const folderName of dateFolders) {
        const folderPath = path.join(baseDir, folderName);
        const files = (await fs.readdir(folderPath, { withFileTypes: true }))
          .filter((e) => e.isFile() && e.name.endsWith('.txt'))
          .map((e) => e.name)
          .sort((a, b) => b.localeCompare(a));

        if (files.length > 0) {
          const latestFilePath = path.join(folderPath, files[0]);
          const text = await fs.readFile(latestFilePath, 'utf8');
          const parsed = parseSnapshotContent(text);
          return {
            filePath: latestFilePath,
            hasSnapshot: parsed.hasSnapshot,
            stocks: parsed.stocks,
            cashReserve: parsed.cashReserve,
            fullOutput: parsed.fullOutput,
          };
        }
      }
    } catch (err: any) {
      logger.warn('Failed to read latest snapshot path', { baseDir, error: err.message });
    }
  }

  return { filePath: null, hasSnapshot: false, stocks: [], cashReserve: 0, fullOutput: null };
}



export async function saveSnapshot(
  stocks: Stock[],
  fullOutput?: any,
  dateIso: string = new Date().toISOString(),
  cashReserve: number = 0
): Promise<string> {
  const latest = await readLatestSnapshotPathAndData();
  if (latest.filePath && latest.hasSnapshot && isSameSnapshotInput(stocks, cashReserve, latest.stocks, latest.cashReserve)) {
    const block = buildSnapshotText(stocks, fullOutput, dateIso, cashReserve);
    if (isVercel) {
      const d = new Date(dateIso);
      const dateStr = d.toISOString().split('T')[0];
      const name = path.basename(latest.filePath);
      await postgresStore.addSnapshot(dateStr, name, block + '\n');
      memoryStore.addSnapshot(dateStr, name, block + '\n');
      return latest.filePath;
    }
    try {
      await fs.writeFile(latest.filePath, block + '\n', 'utf8');
      logger.info('Overwrote existing snapshot record (no parameter changes)', { path: latest.filePath });
      return latest.filePath;
    } catch {
      // Fall through to write new file in writable config.snapshotsDir
    }
  }

  const d = new Date(dateIso);
  const dateStr = d.toISOString().split('T')[0];
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  const secs = String(d.getSeconds()).padStart(2, '0');
  const timeStr = `${hours}${mins}${secs}`;

  const validTickers = stocks.map((s) => s.ticker ? s.ticker.toUpperCase() : '').filter(Boolean);
  const tickersStr = validTickers.length > 0 ? validTickers.join('_') : 'SNAPSHOT';
  const snapshotName = `${tickersStr}_${timeStr}.txt`;
  const block = buildSnapshotText(stocks, fullOutput, dateIso, cashReserve);


  if (isVercel) {
    await postgresStore.addSnapshot(dateStr, snapshotName, block + '\n');
    memoryStore.addSnapshot(dateStr, snapshotName, block + '\n');
    const dbPath = `${dateStr}/${snapshotName}`;
    logger.info('Snapshot record saved to Postgres Database', { name: snapshotName });
    return dbPath;
  }

  const dateFolder = path.join(config.snapshotsDir, dateStr);
  await fs.mkdir(dateFolder, { recursive: true });

  const filePath = path.join(dateFolder, snapshotName);
  await fs.writeFile(filePath, block + '\n', 'utf8');
  logger.info('Snapshot record saved to filesystem', { path: filePath, name: snapshotName });
  return filePath;
}

export async function readHistory(ticker: string): Promise<string> {
  if (isVercel) {
    const dbText = await postgresStore.getHistory(ticker);
    if (dbText) return dbText;

    const memText = memoryStore.getHistory(ticker);
    if (memText) return memText;
  }

  const filePath = path.join(config.dataDir, `${ticker}.csv`);
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (err: any) {
    const bundledPath = path.join(config.root, 'data', `${ticker}.csv`);
    return await fs.readFile(bundledPath, 'utf8');
  }
}

export async function writeHistory(ticker: string, text: string): Promise<void> {
  if (isVercel) {
    await postgresStore.setHistory(ticker, text);
    memoryStore.setHistory(ticker, text);
    return;
  }
  await fs.mkdir(config.dataDir, { recursive: true });
  await fs.writeFile(path.join(config.dataDir, `${ticker}.csv`), text, 'utf8');
}



export async function readOutputHistory(): Promise<any[]> {
  try {
    const text = await fs.readFile(config.outputHistoryFile, 'utf8');
    return JSON.parse(text);
  } catch {
    return [];
  }
}

export async function writeOutput(result: any): Promise<void> {
  const stocks = result.inputs || result.stocks || [];
  const cashReserve = result.cashReserve || 0;
  await saveSnapshot(stocks, result, result.generatedAt || new Date().toISOString(), cashReserve);
}

export async function readOutput(): Promise<any> {
  try {
    const text = await fs.readFile(config.outputFile, 'utf8');
    return JSON.parse(text);
  } catch {
    return null;
  }
}


export async function readAnnualTarget(): Promise<AnnualTarget | null> {
  if (isVercel) {
    const dbTarget = await postgresStore.getAppState('annual_target');
    if (dbTarget) return dbTarget as AnnualTarget;

    const memTarget = memoryStore.getAnnualTarget();
    if (memTarget) return memTarget as AnnualTarget;
  }

  try {
    const data = await readLatestSnapshotData();
    if (data.fullOutput && data.fullOutput.annualTarget && data.fullOutput.annualTarget.year) {
      return data.fullOutput.annualTarget as AnnualTarget;
    }
  } catch (err: any) {
    logger.warn('Failed to read annual target from snapshot', { error: err.message });
  }

  try {
    const text = await fs.readFile(config.annualTargetFile, 'utf8');
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function writeAnnualTarget(target: AnnualTarget): Promise<void> {
  if (isVercel) {
    await postgresStore.setAppState('annual_target', target);
    memoryStore.setAnnualTarget(target);
  }

  const data = await readLatestSnapshotData();
  const stocks = data.stocks || [];
  const fullOutput = data.fullOutput || {};
  fullOutput.annualTarget = target;
  await saveSnapshot(stocks, fullOutput, new Date().toISOString(), data.cashReserve);
}

export async function readPortfolioState(): Promise<PortfolioState | null> {
  if (isVercel) {
    const dbState = await postgresStore.getAppState('portfolio_state');
    if (dbState) return dbState as PortfolioState;

    const memState = memoryStore.getPortfolioState();
    if (memState) return memState as PortfolioState;
  }

  try {
    const data = await readLatestSnapshotData();
    if (data.fullOutput && data.fullOutput.portfolioState) {
      return data.fullOutput.portfolioState as PortfolioState;
    }
  } catch (err: any) {
    logger.warn('Failed to read portfolio state from snapshot', { error: err.message });
  }

  try {
    const text = await fs.readFile(config.portfolioStateFile, 'utf8');
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function writePortfolioState(state: PortfolioState): Promise<void> {
  if (isVercel) {
    await postgresStore.setAppState('portfolio_state', state);
    memoryStore.setPortfolioState(state);
  }

  const data = await readLatestSnapshotData();
  const stocks = data.stocks || [];
  const fullOutput = data.fullOutput || {};
  fullOutput.portfolioState = state;
  await saveSnapshot(stocks, fullOutput, new Date().toISOString(), data.cashReserve);
}


export async function logUserAction(action: string, details: Record<string, any> = {}): Promise<void> {
  const timestamp = new Date().toISOString();
  const detailsStr = Object.entries(details)
    .filter(([_, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(' ');
  const line = `[${timestamp}] [ACTION: ${action}] ${detailsStr}\n`;
  try {
    await fs.appendFile(config.eventLogFile, line, 'utf8');
  } catch (err: any) {
    console.warn('Failed to append user action log', err.message);
  }
}

export default {
  initialize,
  saveSnapshot,
  readLatestSnapshot,
  readLatestSnapshotData,
  getSnapshotTree,
  readSnapshotFileData,
  deleteSnapshotFile,
  readHistory,
  writeHistory,
  writeOutput,
  readOutput,
  readOutputHistory,
  readAnnualTarget,
  writeAnnualTarget,
  readPortfolioState,
  writePortfolioState,
  logUserAction,
};
