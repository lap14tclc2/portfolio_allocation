'use strict';

import { Pool } from 'pg';
import logger from '../utils/logger';
import { AnnualTarget, PortfolioState, Stock } from '../types';

export interface DbSnapshotRecord {
  date: string;
  name: string;
  text: string;
}

class PostgresStoreService {
  private pool: Pool | null = null;
  private initialized = false;

  private getPool(): Pool | null {
    const connectionString =
      process.env.POSTGRES_URL ||
      process.env.POSTGRES_URL_NON_POOLING ||
      process.env.DATABASE_URL;

    if (!connectionString) {
      return null;
    }

    if (!this.pool) {
      this.pool = new Pool({
        connectionString,
        ssl: { rejectUnauthorized: false },
      });
    }

    return this.pool;
  }

  public async initialize(): Promise<void> {
    const pool = this.getPool();
    if (!pool || this.initialized) return;

    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS history_files (
          ticker VARCHAR(50) PRIMARY KEY,
          text TEXT NOT NULL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS snapshot_records (
          id SERIAL PRIMARY KEY,
          date_str VARCHAR(20) NOT NULL,
          name VARCHAR(255) NOT NULL UNIQUE,
          content TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS app_state (
          key VARCHAR(100) PRIMARY KEY,
          value JSONB NOT NULL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
      this.initialized = true;
      logger.info('Postgres store schema initialized successfully.');
    } catch (err: any) {
      logger.warn('Failed to initialize Postgres schema', { error: err.message });
    }
  }

  public async setHistory(ticker: string, text: string): Promise<void> {
    const pool = this.getPool();
    if (!pool) return;
    await this.initialize();
    await pool.query(
      `INSERT INTO history_files (ticker, text, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (ticker) DO UPDATE SET text = EXCLUDED.text, updated_at = NOW();`,
      [ticker.toUpperCase(), text]
    );
  }

  public async getHistory(ticker: string): Promise<string | null> {
    const pool = this.getPool();
    if (!pool) return null;
    await this.initialize();
    const res = await pool.query(`SELECT text FROM history_files WHERE ticker = $1;`, [ticker.toUpperCase()]);
    if (res.rows.length > 0) {
      return res.rows[0].text;
    }
    return null;
  }

  public async addSnapshot(dateStr: string, name: string, content: string): Promise<void> {
    const pool = this.getPool();
    if (!pool) return;
    await this.initialize();
    await pool.query(
      `INSERT INTO snapshot_records (date_str, name, content, created_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (name) DO UPDATE SET content = EXCLUDED.content, created_at = NOW();`,
      [dateStr, name, content]
    );
  }

  public async getSnapshots(): Promise<DbSnapshotRecord[]> {
    const pool = this.getPool();
    if (!pool) return [];
    await this.initialize();
    const res = await pool.query(
      `SELECT date_str as date, name, content as text FROM snapshot_records ORDER BY created_at DESC;`
    );
    return res.rows;
  }

  public async getSnapshot(dateStr: string, name: string): Promise<DbSnapshotRecord | null> {
    const pool = this.getPool();
    if (!pool) return null;
    await this.initialize();
    const res = await pool.query(
      `SELECT date_str as date, name, content as text FROM snapshot_records WHERE date_str = $1 AND name = $2;`,
      [dateStr, name]
    );
    if (res.rows.length > 0) return res.rows[0];
    return null;
  }

  public async deleteSnapshot(dateStr: string, name: string): Promise<boolean> {
    const pool = this.getPool();
    if (!pool) return false;
    await this.initialize();
    const res = await pool.query(`DELETE FROM snapshot_records WHERE date_str = $1 AND name = $2;`, [dateStr, name]);
    return (res.rowCount || 0) > 0;
  }

  public async setAppState(key: string, value: any): Promise<void> {
    const pool = this.getPool();
    if (!pool) return;
    await this.initialize();
    await pool.query(
      `INSERT INTO app_state (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();`,
      [key, JSON.stringify(value)]
    );
  }

  public async getAppState(key: string): Promise<any | null> {
    const pool = this.getPool();
    if (!pool) return null;
    await this.initialize();
    const res = await pool.query(`SELECT value FROM app_state WHERE key = $1;`, [key]);
    if (res.rows.length > 0) return res.rows[0].value;
    return null;
  }
}

export const postgresStore = new PostgresStoreService();
export default postgresStore;
