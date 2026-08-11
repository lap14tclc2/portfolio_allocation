'use strict';

import config from '../config';

export interface HistoryEntry {
  date: string;
  price: number;
}

export function parseHistory(text: string): HistoryEntry[] {
  const lines = String(text)
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim());
  if (!lines.length) throw new Error('History file is empty.');
  const delimiter = lines[0].includes('\t') ? '\t' : ',';
  const fields = (line: string) => line.split(delimiter).map((value) => value.trim().replace(/^"|"$/g, ''));
  const headers = fields(lines[0]).map((value) => value.toLowerCase());
  const dateIndex = headers.findIndex((value) => ['date', 'datetime', 'time', 'timestamp'].includes(value));
  const priceIndex =
    ['adj close', 'adjusted close', 'close', 'price']
      .map((name) => headers.indexOf(name))
      .find((index) => index >= 0) ?? -1;
  if (dateIndex < 0 || priceIndex < 0) throw new Error('Date/Time and Close columns are required.');

  const entries: HistoryEntry[] = lines
    .slice(1)
    .map((line) => {
      const values = fields(line);
      const date = new Date(values[dateIndex]);
      const price = Number(values[priceIndex]);
      return Number.isNaN(date.getTime()) || !Number.isFinite(price) || price <= 0
        ? null
        : { date: date.toISOString().slice(0, 10), price };
    })
    .filter((entry): entry is HistoryEntry => entry !== null)
    .sort((a, b) => a.date.localeCompare(b.date));

  const unique = [...new Map(entries.map((entry) => [entry.date, entry])).values()];
  if (unique.length < config.erc.minimumObservations) {
    throw new Error(`at least ${config.erc.minimumObservations} observations are required`);
  }
  return unique;
}

export default { parseHistory };
