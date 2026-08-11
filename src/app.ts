'use strict';

import http from 'node:http';
import logger from './utils/logger';
import { handleRoutes } from './routes/api.routes';

export function requestListener(req: http.IncomingMessage, res: http.ServerResponse): void {
  const startedAt = Date.now();
  logger.info('Request started', { method: req.method, url: req.url });
  res.on('finish', () => {
    logger.info('Request completed', {
      method: req.method,
      url: req.url,
      status: res.statusCode,
      durationMs: Date.now() - startedAt,
    });
  });
  handleRoutes(req, res).catch((error: any) => {
    logger.error('Request failed', {
      method: req.method,
      url: req.url,
      error: error.message,
    });
    if (res.headersSent) {
      res.end();
      return;
    }
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: error.message }));
  });
}

export function createApp(): http.Server {
  return http.createServer(requestListener);
}

export default requestListener;


