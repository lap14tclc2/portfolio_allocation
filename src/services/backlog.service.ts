'use strict';

import { Stock } from '../types';

export interface BacklogResult {
  stocks: Stock[];
  cashReserve: number;
}

function parseStockBlockLines(lines: string[]): BacklogResult {
  const stocks: Stock[] = [];
  let current: Partial<Stock> | null = null;
  let cashReserve = 0;

  lines.forEach((line) => {
    const cashMatch = line.match(/^CashReserve:\s*(.+)$/);
    if (cashMatch) {
      cashReserve = Number(cashMatch[1].replace(/,/g, '').trim()) || 0;
      return;
    }
    const stock = line.match(/^Stock:\s*(.+)$/);
    if (stock) {
      current = { ticker: stock[1].trim() };
      stocks.push(current as Stock);
      return;
    }
    const field = line.trim().match(/^(Cost|Shares|Price):\s*(.*)$/);
    if (field && current) {
      const keyMap: Record<string, keyof Stock> = {
        Cost: 'averageCostBasis',
        Shares: 'currentShares',
        Price: 'currentPrice',
      };
      const key = keyMap[field[1]];
      if (key) (current as any)[key] = Number(field[2]) || 0;
    }
  });

  return { stocks, cashReserve };
}

export function latestStocks(text: string): BacklogResult {
  if (!text || !text.trim()) return { stocks: [], cashReserve: 0 };
  const parts = text.split('===================================').filter((part) => part.includes('SNAPSHOT'));
  if (!parts.length) return { stocks: [], cashReserve: 0 };

  parts.sort((a, b) => {
    const matchA = a.match(/Date:\s*(.+)/);
    const matchB = b.match(/Date:\s*(.+)/);
    const dateA = matchA ? new Date(matchA[1].trim()).getTime() : 0;
    const dateB = matchB ? new Date(matchB[1].trim()).getTime() : 0;
    return dateB - dateA;
  });

  return parseStockBlockLines(parts[0].split(/\r?\n/));
}

export default { latestStocks };
