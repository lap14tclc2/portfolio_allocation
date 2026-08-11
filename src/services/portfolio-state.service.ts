'use strict';

import storage from './storage.service';
import logger from '../utils/logger';
import { Stock, Holding, PortfolioState } from '../types';

export function buildState(stocks: Stock[], cashReserve: number = 0): PortfolioState {
  const holdings: Holding[] = stocks.map((stock) => {
    const value = stock.currentPrice * stock.currentShares;
    return {
      ticker: stock.ticker,
      shares: stock.currentShares,
      price: stock.currentPrice,
      averageCost: stock.averageCostBasis || (stock.currentShares === 0 ? stock.currentPrice : 0),
      marketValue: value,
      weight: 0,
      active: (stock.currentShares > 0 || (stock.averageCostBasis ?? 0) === 0) && stock.active !== false,
    };
  });

  const equityNav = holdings.reduce((sum, h) => sum + h.marketValue, 0);
  const totalNav = equityNav + cashReserve;

  holdings.forEach((h) => {
    h.weight = totalNav > 0 ? h.marketValue / totalNav : 0;
  });

  return {
    updatedAt: new Date().toISOString(),
    totalNav,
    equityNav,
    cashReserve,
    holdings,
  };
}

export function buildExecutedState(
  results: any[],
  remainingCash: number = 0
): PortfolioState {
  const holdings: Holding[] = results.map((r) => {
    const tradeShares = Math.round(r.sharesToTrade || 0);
    let shares = Math.round(r.currentShares);
    if (r.recommendation === 'BUY') {
      shares = Math.round(r.currentShares + (r.sharesToTrade || 0));
    } else if (r.recommendation === 'SELL') {
      shares = Math.max(0, Math.round(r.currentShares - (r.sharesToTrade || 0)));
    }
    const marketValue = r.currentPrice * shares;

    return {
      ticker: r.ticker,
      shares,
      price: r.currentPrice,
      averageCost: r.averageCostBasis || r.currentPrice || 0,
      marketValue,
      weight: 0,
      active: shares > 0 && r.active !== false,
      initialShares: Math.round(r.currentShares),
      action: r.recommendation,
      tradeShares,
      ercTargetWeight: r.ercWeight,
    };
  });

  const equityNav = holdings.reduce((sum, h) => sum + h.marketValue, 0);
  const totalNav = equityNav + remainingCash;

  holdings.forEach((h) => {
    h.weight = totalNav > 0 ? h.marketValue / totalNav : 0;
  });

  return {
    updatedAt: new Date().toISOString(),
    totalNav,
    equityNav,
    cashReserve: remainingCash,
    holdings,
  };
}

export async function updateState(stocks: Stock[], cashReserve: number = 0): Promise<PortfolioState> {
  const state = buildState(stocks, cashReserve);
  await storage.writePortfolioState(state);
  logger.info('Portfolio state updated', { totalNav: state.totalNav, holdings: state.holdings.length });
  return state;
}

export async function updateStateFromAnalysis(
  results: any[],
  remainingCash: number = 0
): Promise<PortfolioState> {
  const state = buildExecutedState(results, remainingCash);
  await storage.writePortfolioState(state);
  logger.info('Portfolio state updated after execution', { totalNav: state.totalNav, holdings: state.holdings.length });
  return state;
}

export async function getState(): Promise<PortfolioState | null> {
  return storage.readPortfolioState();
}

export default { buildState, buildExecutedState, updateState, updateStateFromAnalysis, getState };
