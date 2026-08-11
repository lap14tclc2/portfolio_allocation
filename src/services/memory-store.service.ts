'use strict';

export interface MemorySnapshotRecord {
  date: string;
  name: string;
  text: string;
}

class MemoryStore {
  private historyMap: Map<string, string> = new Map();
  private snapshots: MemorySnapshotRecord[] = [];
  private annualTarget: any = null;
  private portfolioState: any = null;
  private output: any = null;
  private outputHistory: any[] = [];
  private logs: string[] = [];

  constructor() {}

  public setHistory(ticker: string, text: string): void {
    this.historyMap.set(ticker.toUpperCase(), text);
  }

  public getHistory(ticker: string): string | null {
    return this.historyMap.get(ticker.toUpperCase()) || null;
  }

  public addSnapshot(date: string, name: string, text: string): void {
    const existingIndex = this.snapshots.findIndex((s) => s.date === date && s.name === name);
    if (existingIndex >= 0) {
      this.snapshots[existingIndex].text = text;
    } else {
      this.snapshots.unshift({ date, name, text });
    }
  }

  public getSnapshots(): MemorySnapshotRecord[] {
    return this.snapshots;
  }

  public getSnapshot(date: string, name: string): MemorySnapshotRecord | null {
    return this.snapshots.find((s) => s.date === date && s.name === name) || null;
  }

  public deleteSnapshot(date: string, name: string): boolean {
    const idx = this.snapshots.findIndex((s) => s.date === date && s.name === name);
    if (idx >= 0) {
      this.snapshots.splice(idx, 1);
      return true;
    }
    return false;
  }

  public setAnnualTarget(target: any): void {
    this.annualTarget = target;
  }

  public getAnnualTarget(): any {
    return this.annualTarget;
  }

  public setPortfolioState(state: any): void {
    this.portfolioState = state;
  }

  public getPortfolioState(): any {
    return this.portfolioState;
  }

  public setOutput(output: any): void {
    this.output = output;
  }

  public getOutput(): any {
    return this.output;
  }

  public addOutputHistory(item: any): void {
    this.outputHistory.push(item);
  }

  public getOutputHistory(): any[] {
    return this.outputHistory;
  }

  public appendLog(log: string): void {
    this.logs.push(log);
  }
}

export const memoryStore = new MemoryStore();
export default memoryStore;
