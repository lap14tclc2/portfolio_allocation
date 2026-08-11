'use strict';

function write(level: string, message: string, details: Record<string, any> = {}): void {
  const suffix = Object.keys(details).length ? ` ${JSON.stringify(details)}` : '';
  console.log(`[${new Date().toISOString()}] [${level}] ${message}${suffix}`);
}

export const logger = {
  info(message: string, details?: Record<string, any>): void {
    write('INFO', message, details);
  },
  error(message: string, details?: Record<string, any>): void {
    write('ERROR', message, details);
  },
  warn(message: string, details?: Record<string, any>): void {
    write('WARN', message, details);
  },
  debug(message: string, details?: Record<string, any>): void {
    write('DEBUG', message, details);
  },
};

export default logger;
