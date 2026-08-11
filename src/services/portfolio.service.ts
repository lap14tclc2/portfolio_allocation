'use strict';

import config from '../config';
import { calculateERC, getRiskWindow } from './erc.service';
import storage from './storage.service';
import logger from '../utils/logger';
import { HistoryEntry } from './history.service';
import { Stock, AnnualTarget, ERCResult, AssetAnalysisResult, PortfolioResult, ClassificationResult } from '../types';

export function getAllocationYear(date: Date = new Date()): number {
  return date.getFullYear();
}

export async function resolveAnnualTarget(
  stocks: Stock[],
  histories: HistoryEntry[][]
): Promise<{ target: AnnualTarget; freshERC: boolean; erc?: ERCResult }> {
  const year = getAllocationYear();
  const existing = await storage.readAnnualTarget();

  if (existing && existing.locked && existing.year === year) {
    const existingTickers = Object.keys(existing.targets || {}).sort();
    const currentTickers = stocks.map((s) => s.ticker.toUpperCase()).sort();
    const isSameTickers =
      existingTickers.length === currentTickers.length &&
      existingTickers.every((t, i) => t === currentTickers[i]);

    if (isSameTickers) {
      logger.info('Using locked annual target', { year });
      return { target: existing, freshERC: false };
    }
    logger.info('Portfolio tickers changed; unlocking and recalculating annual target', {
      existingTickers,
      currentTickers,
    });
  }


  logger.info('Calculating new ERC for annual target', { year });
  const erc = calculateERC(stocks, histories, year);
  const riskWindow = getRiskWindow(year);

  const target: AnnualTarget = {
    year,
    allocationDate: `${year}-01-01`,
    riskWindow,
    method: 'ERC',
    targets: Object.fromEntries(stocks.map((stock, i) => [stock.ticker, erc.weights[i]])),
    locked: true,
    createdAt: new Date().toISOString(),
    diagnostics: erc.diagnostics,
  };

  await storage.writeAnnualTarget(target);
  logger.info('Annual target locked', { year, targets: target.targets });
  return { target, freshERC: true, erc };
}

export function classifyBand(currentWeight: number, ercWeight: number): ClassificationResult {
  const normalBand = config.bands.normal;
  const softBand = config.bands.soft;

  const normal = { lower: ercWeight * (1 - normalBand), upper: ercWeight * (1 + normalBand) };
  const soft = { lower: ercWeight * (1 - softBand), upper: ercWeight * (1 + softBand) };

  let band: 'NORMAL' | 'SOFT' | 'HARD';
  if (currentWeight >= normal.lower && currentWeight <= normal.upper) {
    band = 'NORMAL';
  } else if (currentWeight >= soft.lower && currentWeight <= soft.upper) {
    band = 'SOFT';
  } else {
    band = 'HARD';
  }

  return { band, normal, soft };
}

function applyHardBankAndExpected(
  results: AssetAnalysisResult[],
  stocks: Stock[],
  navContext: { totalNav: number; cashReserve: number }
): { hardBank: number; cashDeployed: number; remainingCash: number; fundedBuyTotal: number } {
  const { totalNav, cashReserve } = navContext;
  const totalSell = results.filter((r) => r.recommendation === 'SELL').reduce((sum, r) => sum + r.targetTradeAmount, 0);
  const totalBuy = results.filter((r) => r.recommendation === 'BUY').reduce((sum, r) => sum + r.targetTradeAmount, 0);

  const availableFunding = totalSell + cashReserve;
  const fundedBuyTotal = Math.min(totalBuy, availableFunding);
  const buyScale = totalBuy > 0 ? fundedBuyTotal / totalBuy : 0;

  results.forEach((r, i) => {
    if (r.recommendation === 'SELL') {
      r.fundedTradeAmount = r.targetTradeAmount;
    } else if (r.recommendation === 'BUY' && totalBuy > 0) {
      r.fundedTradeAmount = r.targetTradeAmount * buyScale;
    } else {
      r.fundedTradeAmount = 0;
    }

    const price = stocks[i].currentPrice || stocks[i].averageCostBasis || 0;
    r.sharesToTrade = price ? r.fundedTradeAmount / price : 0;

    if (r.recommendation === 'BUY') {
      r.expectedValue = r.value + r.fundedTradeAmount;
    } else if (r.recommendation === 'SELL') {
      r.expectedValue = r.value - r.fundedTradeAmount;
    } else {
      r.expectedValue = r.value;
    }
    r.expectedWeight = totalNav ? r.expectedValue / totalNav : 0;
  });

  const cashDeployed = Math.min(cashReserve, Math.max(0, fundedBuyTotal - totalSell));
  const remainingCash = cashReserve - cashDeployed;
  return { hardBank: totalSell, cashDeployed, remainingCash, fundedBuyTotal };
}

function buildAssetResults(
  stocks: Stock[],
  values: number[],
  navContext: { totalNav: number; annualTarget: AnnualTarget; erc?: ERCResult }
): AssetAnalysisResult[] {
  const { totalNav, annualTarget, erc } = navContext;
  return stocks.map((stock, i) => {
    const currentWeight = totalNav ? values[i] / totalNav : 0;
    const ercWeight = annualTarget.targets[stock.ticker] || 0;
    const drift = currentWeight - ercWeight;
    const { band, normal, soft } = classifyBand(currentWeight, ercWeight);
    const active = stock.active !== false;
    const recommendation = !active ? 'HOLD' : band === 'NORMAL' ? 'HOLD' : drift < 0 ? 'BUY' : 'SELL';
    const targetValue = ercWeight * totalNav;
    const targetTradeAmount = band === 'NORMAL' || !active ? 0 : Math.abs(targetValue - values[i]);

    return {
      ticker: stock.ticker,
      averageCostBasis: stock.averageCostBasis || 0,
      currentShares: stock.currentShares || 0,
      currentPrice: stock.currentPrice || 0,
      value: values[i],
      currentWeight,
      ercWeight,
      volatility: erc ? erc.volatility[i] : undefined,
      riskContribution: erc ? erc.riskContributions[i] : undefined,
      normal,
      soft,
      band,
      drift,
      recommendation,
      targetTradeAmount,
      active,
    };
  });
}

export function buildPortfolioFromTarget(
  stocks: Stock[],
  annualTarget: AnnualTarget,
  erc?: ERCResult,
  cashReserve: number = 0
): PortfolioResult {
  const values = stocks.map((stock) => stock.currentPrice * stock.currentShares);
  const equityNav = values.reduce((sum, value) => sum + value, 0);
  const totalNav = equityNav + cashReserve;

  const hasRemovedTicker = stocks.some(
    (s) => s.active === false && (annualTarget.targets[s.ticker] || 0) > 0
  );
  const applicability: 'VALID' | 'INVALIDATED BY UNIVERSE CHANGE' = hasRemovedTicker
    ? 'INVALIDATED BY UNIVERSE CHANGE'
    : 'VALID';

  const results = buildAssetResults(stocks, values, { totalNav, annualTarget, erc });
  const { hardBank, cashDeployed, remainingCash, fundedBuyTotal } = applyHardBankAndExpected(results, stocks, {
    totalNav,
    cashReserve,
  });

  return {
    generatedAt: new Date().toISOString(),
    nav: totalNav,
    equityNav,
    cashReserve,
    cashDeployed,
    remainingCash,
    hardBank,
    fundedBuyTotal,
    annualTarget: {
      year: annualTarget.year,
      allocationDate: annualTarget.allocationDate,
      riskWindow: annualTarget.riskWindow,
      status: annualTarget.locked ? 'LOCKED' : 'UNLOCKED',
      targetSource: 'Annual ERC Target',
      applicability,
    },
    erc: erc
      ? {
        weights: erc.weights,
        volatility: erc.volatility,
        riskContributions: erc.riskContributions,
        portfolioRisk: erc.portfolioRisk,
        observations: erc.observations,
        diagnostics: erc.diagnostics,
      }
      : undefined,
    results,
  };
}

export function calculatePortfolio(stocks: Stock[], histories: HistoryEntry[][], cashReserve: number): PortfolioResult {
  const year = getAllocationYear();
  const erc = calculateERC(stocks, histories, year);
  const annualTarget: AnnualTarget = {
    year,
    allocationDate: `${year}-01-01`,
    riskWindow: getRiskWindow(year),
    method: 'ERC',
    targets: Object.fromEntries(stocks.map((stock, i) => [stock.ticker, erc.weights[i]])),
    locked: false,
    createdAt: new Date().toISOString(),
    diagnostics: erc.diagnostics,
  };
  return buildPortfolioFromTarget(stocks, annualTarget, erc, cashReserve);
}

export default {
  calculatePortfolio,
  resolveAnnualTarget,
  buildPortfolioFromTarget,
  getAllocationYear,
  classifyBand,
};
