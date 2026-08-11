import { describe, it, expect, beforeAll } from 'vitest';
import supertest from 'supertest';
import { createServer, Server } from 'node:http';
import { handleRoutes } from '../src/routes/api.routes';
import storageService from '../src/services/storage.service';

let server: Server;
let request: ReturnType<typeof supertest>;

beforeAll(async () => {
  await storageService.initialize();
  server = createServer((req, res) => handleRoutes(req, res));
  request = supertest(server);
});

describe('API Integration Tests', () => {
  it('GET / - should serve index.html', async () => {
    const response = await request.get('/');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.text).toContain('<html');
  });

  it('GET /src/client/main.js - should compile and serve client TypeScript asset', async () => {
    const response = await request.get('/src/client/main.js');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/javascript');
    expect(response.text).toBeTruthy();
  });

  it('POST /api/analyze - should execute ERC allocation and return portfolio result', async () => {
    const payload = {
      cashReserve: 50000000,
      stocks: [
        { ticker: 'ACB', averageCostBasis: 19760, currentShares: 19210, currentPrice: 22650 },
        { ticker: 'DGC', averageCostBasis: 52760, currentShares: 10000, currentPrice: 43600 },
        { ticker: 'FPT', averageCostBasis: 73800, currentShares: 3000, currentPrice: 71800 },
      ],
    };

    const response = await request.post('/api/analyze').send(payload);
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('nav');
    expect(response.body).toHaveProperty('equityNav');
    expect(response.body.cashReserve).toBe(50000000);
    expect(response.body.results).toHaveLength(3);
    expect(response.body).toHaveProperty('portfolioState');
    expect(response.body.portfolioState.holdings).toHaveLength(3);
  });

  it('GET /api/snapshot/latest - should retrieve latest snapshot data', async () => {
    const response = await request.get('/api/snapshot/latest');
    expect(response.status).toBe(200);
    expect(response.body.hasSnapshot).toBe(true);
    expect(response.body.stocks.length).toBeGreaterThan(0);
    // cashReserve may vary depending on recent analyses; ensure it's a number
    expect(typeof response.body.cashReserve).toBe('number');
  });

  it('GET /api/snapshots/tree - should return snapshot folder tree', async () => {
    const response = await request.get('/api/snapshots/tree');
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('name', 'snapshots');
    expect(response.body).toHaveProperty('folders');
    expect(Array.isArray(response.body.folders)).toBe(true);
  });

  it('GET /api/portfolio-state - should return portfolio state (Layer 2)', async () => {
    const response = await request.get('/api/portfolio-state');
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('totalNav');
    expect(response.body).toHaveProperty('equityNav');
    expect(response.body).toHaveProperty('holdings');
  });

  it('GET /api/history/ACB - should read stock history file', async () => {
    const response = await request.get('/api/history/ACB');
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('file', 'ACB');
    expect(response.body).toHaveProperty('history');
  });

  it('POST /api/analyze with different cashReserve should produce separate snapshot isolation', async () => {
    const stocks = [
      { ticker: 'ACB', averageCostBasis: 19760, currentShares: 19210, currentPrice: 22650 },
      { ticker: 'DGC', averageCostBasis: 52760, currentShares: 10000, currentPrice: 43600 },
      { ticker: 'FPT', averageCostBasis: 73800, currentShares: 3000, currentPrice: 71800 },
    ];

    const res1 = await request.post('/api/analyze').send({ cashReserve: 50000000, stocks });
    expect(res1.status).toBe(200);

    const res2 = await request.post('/api/analyze').send({ cashReserve: 20000, stocks });
    expect(res2.status).toBe(200);

    expect(res1.body.cashReserve).toBe(50000000);
    expect(res2.body.cashReserve).toBe(20000);
    expect(res1.body.portfolioState.cashReserve).not.toBe(res2.body.portfolioState.cashReserve);
  });
});
