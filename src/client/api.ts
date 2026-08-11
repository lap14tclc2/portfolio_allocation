export async function getLatestSnapshot(): Promise<any> {
  return (await fetch('/api/snapshot/latest')).json();
}

export async function uploadHistory(ticker: string, text: string): Promise<void> {
  const response = await fetch(`/api/history/${encodeURIComponent(ticker)}`, { method: 'POST', body: text });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'History upload failed.');
}

export async function analyze(stocks: any[], cashReserve: number): Promise<any> {
  const response = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stocks, cashReserve }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Analysis failed.');
  return result;
}

export async function getPortfolioState(): Promise<any> {
  const response = await fetch('/api/portfolio-state');
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Failed to fetch portfolio state.');
  return result;
}

export async function getOutput(): Promise<any> {
  const response = await fetch('/api/output');
  if (!response.ok) return null;
  return response.json();
}

export async function fetchSnapshotTree(): Promise<any> {
  const response = await fetch('/api/snapshots/tree');
  return response.json();
}

export async function fetchSnapshotFile(date: string, name: string): Promise<any> {
  const response = await fetch(`/api/snapshots/file?date=${encodeURIComponent(date)}&name=${encodeURIComponent(name)}`);
  return response.json();
}

export async function deleteSnapshotFile(date: string, name: string): Promise<any> {
  const response = await fetch(`/api/snapshots/file?date=${encodeURIComponent(date)}&name=${encodeURIComponent(name)}`, {
    method: 'DELETE',
  });
  return response.json();
}

