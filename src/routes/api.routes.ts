'use strict';

import fs from 'node:fs/promises';
import path from 'node:path';
import { URL } from 'node:url';
import { IncomingMessage, ServerResponse } from 'node:http';
import config from '../config';
import storageService from '../services/storage.service';
import { parseHistory } from '../services/history.service';
import { latestStocks } from '../services/backlog.service';
import { resolveAnnualTarget, buildPortfolioFromTarget, getAllocationYear } from '../services/portfolio.service';
import { calculateERC, getRiskWindow } from '../services/erc.service';
import portfolioStateService from '../services/portfolio-state.service';
import logger from '../utils/logger';
import ts from 'typescript';
import { Stock, AnnualTarget } from '../types';

function sendJson(res: ServerResponse, status: number, value: any): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function handleServeIndex(res: ServerResponse): Promise<void> {
  let html: string;
  try {
    html = await fs.readFile(path.join(config.root, 'index.html'), 'utf8');
  } catch {
    html = await fs.readFile(path.join(process.cwd(), 'index.html'), 'utf8');
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}


async function handleServeClientAsset(pathname: string, res: ServerResponse): Promise<void> {
  const relativePath = pathname.replace(/^\/(src\/)?client\//, '');
  let targetPath = path.join(config.root, 'src', 'client', relativePath);

  try {
    if (relativePath.endsWith('.css')) {
      const css = await fs.readFile(targetPath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
      res.end(css);
      return;
    }

    if (!targetPath.endsWith('.ts')) {
      targetPath = targetPath.replace(/\.js$/, '') + '.ts';
    }

    const tsSource = await fs.readFile(targetPath, 'utf8');
    const jsOutput = ts.transpileModule(tsSource, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;

    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
    res.end(jsOutput);
  } catch (err: any) {
    logger.error('Client asset request failed', { url: pathname, targetPath, error: err.message });
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: `Client asset error: ${err.message}` }));
  }
}

async function handleGetLatestSnapshot(res: ServerResponse): Promise<void> {
  const data = await storageService.readLatestSnapshotData();
  sendJson(res, 200, data);
}

async function handleGetSnapshotTree(res: ServerResponse): Promise<void> {
  const tree = await storageService.getSnapshotTree();
  sendJson(res, 200, tree);
}

async function handleGetSnapshotFile(url: URL, res: ServerResponse): Promise<void> {
  const date = url.searchParams.get('date') || '';
  const name = url.searchParams.get('name') || '';
  if (!date || !name) {
    return sendJson(res, 400, { error: 'Missing date or name query parameter.' });
  }
  const data = await storageService.readSnapshotFileData(date, name);
  sendJson(res, 200, data);
}

async function handleDeleteSnapshotFile(url: URL, res: ServerResponse): Promise<void> {
  const date = url.searchParams.get('date') || '';
  const name = url.searchParams.get('name') || '';
  if (!date || !name) {
    return sendJson(res, 400, { error: 'Missing date or name query parameter.' });
  }
  try {
    const result = await storageService.deleteSnapshotFile(date, name);
    sendJson(res, 200, result);
  } catch (err: any) {
    sendJson(res, 500, { error: err.message });
  }
}

async function handleGetHistory(ticker: string, res: ServerResponse): Promise<void> {
  try {
    const history = await storageService.readHistory(ticker);
    sendJson(res, 200, { file: ticker, history });
  } catch {
    sendJson(res, 404, { error: 'History file not found.' });
  }
}

async function handleUploadHistory(ticker: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const text = await readBody(req);
  parseHistory(text);
  await storageService.writeHistory(ticker, text);
  sendJson(res, 201, { ok: true });
}

async function loadHistoriesForStocks(stocks: Stock[]) {
  return Promise.all(
    stocks.map(async (stock) => {
      try {
        return parseHistory(await storageService.readHistory(stock.ticker));
      } catch (error: any) {
        throw new Error(`${stock.ticker}: ${error.message}`);
      }
    })
  );
}

async function handleAnalyzePortfolio(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const payload = JSON.parse(await readBody(req));
  const stocks: Stock[] = payload.stocks || payload;
  const histories = await loadHistoriesForStocks(stocks);

  const { target: annualTarget, erc } = await resolveAnnualTarget(stocks, histories);
  const year = getAllocationYear();
  const ercData = erc || calculateERC(stocks, histories, year);
  const cashReserve = Number(payload.cashReserve) || 0;
  const result = buildPortfolioFromTarget(stocks, annualTarget, ercData, cashReserve);
  const state = portfolioStateService.buildExecutedState(result.results, result.remainingCash);

  const fullOutput = {
    ...result,
    inputs: stocks,
    portfolioState: state,
  };

  await storageService.saveSnapshot(stocks, fullOutput, result.generatedAt, cashReserve);
  sendJson(res, 200, fullOutput);
}

async function handleGetAnnualTarget(res: ServerResponse): Promise<void> {
  const target = await storageService.readAnnualTarget();
  if (!target) return sendJson(res, 404, { error: 'No annual target found.' });
  sendJson(res, 200, target);
}

async function handleAnnualReset(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const payload = JSON.parse(await readBody(req));
  const stocks: Stock[] = payload.stocks || payload;
  const histories = await loadHistoriesForStocks(stocks);
  const year = getAllocationYear();
  const ercData = calculateERC(stocks, histories, year);
  const riskWindow = getRiskWindow(year);

  const target: AnnualTarget = {
    year,
    allocationDate: `${year}-01-01`,
    riskWindow,
    method: 'ERC',
    targets: Object.fromEntries(stocks.map((stock, i) => [stock.ticker, ercData.weights[i]])),
    locked: true,
    createdAt: new Date().toISOString(),
    diagnostics: ercData.diagnostics,
  };

  await storageService.writeAnnualTarget(target);
  sendJson(res, 200, target);
}

async function handleGetPortfolioState(res: ServerResponse): Promise<void> {
  const state = await portfolioStateService.getState();
  if (!state) return sendJson(res, 404, { error: 'No portfolio state found. Run /api/analyze first.' });
  sendJson(res, 200, state);
}

async function handleGetOutput(res: ServerResponse): Promise<void> {
  const output = await storageService.readOutput();
  if (!output) return sendJson(res, 404, { error: 'No output analysis found.' });
  sendJson(res, 200, output);
}

async function handleStaticAndSnapshotRoutes(
  method: string,
  pathname: string,
  url: URL,
  res: ServerResponse
): Promise<boolean> {
  if (method === 'GET' && pathname === '/') {
    await handleServeIndex(res);
    return true;
  }
  if (method === 'GET' && (pathname.startsWith('/src/client/') || pathname.startsWith('/client/'))) {
    await handleServeClientAsset(pathname, res);
    return true;
  }
  if (method === 'GET' && (pathname === '/api/snapshot/latest' || pathname === '/api/backlog')) {
    await handleGetLatestSnapshot(res);
    return true;
  }
  if (method === 'GET' && pathname === '/api/snapshots/tree') {
    await handleGetSnapshotTree(res);
    return true;
  }
  if (pathname === '/api/snapshots/file') {
    if (method === 'GET') await handleGetSnapshotFile(url, res);
    else if (method === 'DELETE') await handleDeleteSnapshotFile(url, res);
    return true;
  }
  return false;
}

async function handleApiDataRoutes(
  method: string,
  pathname: string,
  req: IncomingMessage,
  res: ServerResponse
): Promise<boolean> {
  const historyMatch = pathname.match(/^\/api\/history\/([A-Za-z0-9._-]+)$/);
  if (historyMatch) {
    const ticker = historyMatch[1];
    if (method === 'GET') await handleGetHistory(ticker, res);
    if (method === 'POST') await handleUploadHistory(ticker, req, res);
    return true;
  }
  if (method === 'POST' && pathname === '/api/analyze') {
    await handleAnalyzePortfolio(req, res);
    return true;
  }
  if (method === 'GET' && pathname === '/api/annual-target') {
    await handleGetAnnualTarget(res);
    return true;
  }
  if (method === 'POST' && pathname === '/api/annual-reset') {
    await handleAnnualReset(req, res);
    return true;
  }
  if (method === 'GET' && pathname === '/api/portfolio-state') {
    await handleGetPortfolioState(res);
    return true;
  }
  if (method === 'GET' && pathname === '/api/output') {
    await handleGetOutput(res);
    return true;
  }
  return false;
}

export async function handleRoutes(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  const method = req.method || 'GET';

  const handledStatic = await handleStaticAndSnapshotRoutes(method, pathname, url, res);
  if (handledStatic) return;

  const handledApi = await handleApiDataRoutes(method, pathname, req, res);
  if (handledApi) return;

  return sendJson(res, 404, { error: 'Not found.' });
}

export default { handleRoutes };
