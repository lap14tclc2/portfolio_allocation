'use strict';

import config from '../config';
import { HistoryEntry } from './history.service';
import { Stock, ERCResult, RiskWindow } from '../types';

function covariance(a: number[], b: number[]): number {
  const meanA = a.reduce((sum, value) => sum + value, 0) / a.length;
  const meanB = b.reduce((sum, value) => sum + value, 0) / b.length;
  return a.reduce((sum, value, i) => sum + (value - meanA) * (b[i] - meanB), 0) / (a.length - 1);
}

interface MetricsResult {
  variance: number;
  risk: number;
  crc: number[];
  rc: number[];
}

function metrics(weights: number[], matrix: number[][]): MetricsResult {
  const marginal = matrix.map((row) => row.reduce((sum, value, i) => sum + value * weights[i], 0));
  const variance = weights.reduce((sum, weight, i) => sum + weight * marginal[i], 0);
  const risk = Math.sqrt(Math.max(variance, 0));
  const crc = weights.map((weight, i) => (weight * marginal[i]) / (risk || 1));
  return { variance, risk, crc, rc: crc.map((value) => value / (risk || 1)) };
}

function filterByWindow(history: HistoryEntry[], startDate: string, endDate: string): HistoryEntry[] {
  return history.filter((entry) => entry.date >= startDate && entry.date <= endDate);
}

export function getRiskWindow(allocationYear: number): RiskWindow {
  const startYear = allocationYear - config.erc.lookbackYears;
  const start = `${startYear}-01-01`;
  const end = `${allocationYear - 1}-12-31`;
  return { start, end };
}

function validateCovarianceSymmetry(matrix: number[][], tolerance = 1e-10): void {
  for (let i = 0; i < matrix.length; i++) {
    for (let j = i + 1; j < matrix.length; j++) {
      if (Math.abs(matrix[i][j] - matrix[j][i]) > tolerance) {
        throw new Error(
          `Covariance matrix not symmetric: cov[${i}][${j}]=${matrix[i][j]} vs cov[${j}][${i}]=${matrix[j][i]}`
        );
      }
    }
  }
}

function buildReturnsAndMatrix(histories: HistoryEntry[][], riskWindow: RiskWindow) {
  const windowed = histories.map((series) => filterByWindow(series, riskWindow.start, riskWindow.end));
  const commonDates = windowed[0].filter((entry) =>
    windowed.every((series) => series.some((item) => item.date === entry.date))
  );

  if (commonDates.length < config.erc.minimumObservations) {
    throw new Error(
      `date intersection has ${commonDates.length} observations; at least ${config.erc.minimumObservations} required`
    );
  }

  const prices = windowed.map((series) => {
    const byDate = new Map(series.map((entry) => [entry.date, entry.price]));
    return commonDates.map((entry) => byDate.get(entry.date)!);
  });

  const returns = prices.map((series) => series.slice(1).map((value, i) => Math.log(value / series[i])));
  const dailyVolatility = returns.map((series) => Math.sqrt(covariance(series, series)));
  const volatility = dailyVolatility.map((value) => value * Math.sqrt(config.erc.annualizationFactor));
  const matrix = returns.map((row) =>
    returns.map((_, i) => covariance(row, returns[i]) * config.erc.annualizationFactor)
  );

  validateCovarianceSymmetry(matrix);
  return { commonDates, volatility, matrix };
}

function solveERCWeights(count: number, matrix: number[][]): number[] {
  const target = 1 / count;
  let weights = Array(count).fill(target);
  for (let iteration = 0; iteration < 1000; iteration += 1) {
    const current = metrics(weights, matrix);
    if (current.risk && Math.max(...current.rc.map((value) => Math.abs(value - target))) < 1e-7) break;
    if (!current.risk || current.rc.some((value) => value <= 0)) throw new Error('ERC solver failed.');
    weights = weights.map(
      (weight, i) =>
        weight *
        Math.pow(
          (current.variance * target) /
            ((weight * matrix[i].reduce((sum, value, j) => sum + value * weights[j], 0)) / current.risk),
          0.25
        )
    );
    const total = weights.reduce((sum, value) => sum + value, 0);
    weights = weights.map((weight) => weight / total);
  }
  return weights;
}


export function calculateERC(stocks: Stock[], histories: HistoryEntry[][], allocationYear: number): ERCResult {
  const riskWindow = getRiskWindow(allocationYear);
  const { commonDates, volatility, matrix } = buildReturnsAndMatrix(histories, riskWindow);
  const weights = solveERCWeights(stocks.length, matrix);

  const target = 1 / stocks.length;
  const result = metrics(weights, matrix);
  const weightSum = weights.reduce((sum, value) => sum + value, 0);
  const crcSum = result.crc.reduce((sum, value) => sum + value, 0);
  const rcSum = result.rc.reduce((sum, value) => sum + value, 0);
  const ercError = Math.max(...result.rc.map((value) => Math.abs(value - target)));

  if (ercError >= 1e-5) throw new Error('ERC validation failed.');

  const diagnostics = {
    valid: true,
    observations: commonDates.length,
    dateRange: { start: commonDates[0].date, end: commonDates[commonDates.length - 1].date },
    riskWindow,
    portfolioRisk: result.risk,
    portfolioVariance: result.variance,
    weightSum,
    crcSum,
    rcSum,
    ercError,
  };

  return {
    weights,
    volatility,
    riskContributions: result.rc,
    portfolioRisk: result.risk,
    observations: commonDates.length,
    diagnostics,
  };
}

export default { calculateERC, getRiskWindow };
