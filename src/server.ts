'use strict';

import config from './config';
import storageService from './services/storage.service';
import logger from './utils/logger';
import { createApp } from './app';

storageService
  .initialize()
  .then(() => {
    const server = createApp();

    server.on('error', (error: any) => {
      if (error.code === 'EADDRINUSE') {
        logger.error('Port is already in use', { port: config.port });
        process.exitCode = 1;
        return;
      }
      throw error;
    });

    let shuttingDown = false;
    const shutdown = (signal: string) => {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info('Server shutting down', { signal, port: config.port });
      const forceExit = setTimeout(() => {
        server.closeAllConnections();
        process.exit(1);
      }, 5000);
      forceExit.unref();
      server.close(() => {
        clearTimeout(forceExit);
        logger.info('Server stopped', { port: config.port });
        process.exit(0);
      });
    };

    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));

    server.listen(config.port, () => {
      logger.info('Server listening', { url: `http://localhost:${config.port}` });
    });
  })
  .catch((error: any) => {
    logger.error('Unable to initialize IPDPS v4', { error: error.message });
    process.exitCode = 1;
  });
