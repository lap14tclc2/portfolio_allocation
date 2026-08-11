'use strict';

export interface Stock {
  ticker: string;
  averageCostBasis: number;
  currentShares: number;
  currentPrice: number;
  active?: boolean;
}

export interface PriceHistory {
  dates: string[];
  prices: number[];
}

export interface RiskWindow {
  start: string;
  end: string;
}

export interface ERCDiagnostics {
  valid: boolean;
  observations: number;
  dateRange: { start: string; end: string };
  riskWindow: RiskWindow;
  portfolioRisk: number;
  portfolioVariance: number;
  weightSum: number;
  crcSum: number;
  rcSum: number;
  ercError: number;
}

export interface ERCResult {
  weights: number[];
  volatility: number[];
  riskContributions: number[];
  portfolioRisk: number;
  observations: number;
  diagnostics: ERCDiagnostics;
}

export interface AnnualTarget {
  year: number;
  allocationDate: string;
  riskWindow: RiskWindow;
  method: string;
  targets: Record<string, number>;
  locked: boolean;
  createdAt: string;
  diagnostics?: ERCDiagnostics;
  applicability?: 'VALID' | 'INVALIDATED BY UNIVERSE CHANGE';
}

export interface BandLimits {
  lower: number;
  upper: number;
}

export interface ClassificationResult {
  band: 'NORMAL' | 'SOFT' | 'HARD';
  normal: BandLimits;
  soft: BandLimits;
}

export interface AssetAnalysisResult {
  ticker: string;
  averageCostBasis: number;
  currentShares: number;
  currentPrice: number;
  value: number;
  currentWeight: number;
  ercWeight: number;
  volatility?: number;
  riskContribution?: number;
  normal: BandLimits;
  soft: BandLimits;
  band: 'NORMAL' | 'SOFT' | 'HARD';
  drift: number;
  recommendation: 'HOLD' | 'BUY' | 'SELL';
  targetTradeAmount: number;
  fundedTradeAmount?: number;
  sharesToTrade?: number;
  expectedValue?: number;
  expectedWeight?: number;
  active?: boolean;
}

export interface PortfolioResult {
  generatedAt: string;
  nav: number;
  equityNav: number;
  cashReserve: number;
  cashDeployed: number;
  remainingCash: number;
  hardBank: number;
  fundedBuyTotal: number;
  annualTarget: {
    year: number;
    allocationDate: string;
    riskWindow: RiskWindow;
    status: string;
    targetSource: string;
    applicability?: 'VALID' | 'INVALIDATED BY UNIVERSE CHANGE';
  };
  erc?: ERCResult;
  results: AssetAnalysisResult[];
  inputs?: Stock[];
  portfolioState?: PortfolioState;
}

export interface Holding {
  ticker: string;
  shares: number;
  price: number;
  averageCost: number;
  marketValue: number;
  weight: number;
  active?: boolean;
  initialShares?: number;
  action?: 'HOLD' | 'BUY' | 'SELL';
  tradeShares?: number;
  ercTargetWeight?: number;
}

export interface PortfolioState {
  updatedAt: string;
  totalNav: number;
  equityNav: number;
  cashReserve: number;
  holdings: Holding[];
}
