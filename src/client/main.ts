import {
  analyze,
  getLatestSnapshot,
  uploadHistory,
  getPortfolioState,
  fetchSnapshotTree,
  fetchSnapshotFile,
  deleteSnapshotFile,
} from './api.ts';
import {
  $,
  addStock,
  readStocks,
  renderResult,
  renderValidation,
  rowValue,
  setStatus,
  renderPortfolioState,
  hideResultSections,
  renderSnapshotTree,
} from './ui.ts';

const histories = new Set<string>();
let currentSelectedKey = '';

async function loadHistory(row: HTMLTableRowElement, button: HTMLButtonElement): Promise<void> {
  const ticker = String(rowValue(row, 'ticker') || '');
  if (!ticker) return;
  const response = await fetch(`/api/history/${encodeURIComponent(ticker)}`);
  if (response.ok) {
    histories.add(ticker);
    button.textContent = 'History loaded';
  }
}

function upload(row: HTMLTableRowElement, button: HTMLButtonElement): void {
  const ticker = String(rowValue(row, 'ticker') || '');
  if (!ticker) return setStatus('Enter a ticker before uploading history.');
  const picker = document.createElement('input');
  picker.type = 'file';
  picker.accept = '.csv,.tsv,text/csv';
  picker.onchange = async () => {
    const file = picker.files?.[0];
    if (!file) return;
    try {
      await uploadHistory(ticker, await file.text());
      histories.add(ticker);
      button.textContent = `CSV: ${file.name}`;
      setStatus(`${ticker} history uploaded.`);
    } catch (error: any) {
      setStatus(error.message);
    }
  };
  picker.click();
}

function remove(row: HTMLTableRowElement): void {
  row.remove();
}

function createStock(stock: Record<string, any> = {}): void {
  addStock(stock, { onUpload: upload, onRemove: remove, onLoad: loadHistory });
}

async function updateState(): Promise<void> {
  try {
    const state = await getPortfolioState();
    if (state) renderPortfolioState(state);
  } catch (err: any) {
    console.warn(err.message);
  }
}

async function loadSnapshotDataIntoPage(snapshotData: any, selectedKeyStr: string = ''): Promise<void> {
  currentSelectedKey = selectedKeyStr;
  $('portfolio').replaceChildren();

  if (!snapshotData || !snapshotData.hasSnapshot || !snapshotData.stocks || snapshotData.stocks.length === 0) {
    hideResultSections();
    createStock();
    setStatus('No snapshot found. Enter portfolio data manually.');
    return;
  }

  snapshotData.stocks.forEach(createStock);
  const cashVal = snapshotData.cashReserve ?? snapshotData.fullOutput?.cashReserve ?? 0;
  ($('cash') as HTMLInputElement).value = String(cashVal);

  await Promise.all(
    snapshotData.stocks.map(async (s: any) => {
      if (!s.ticker) return;
      try {
        const res = await fetch(`/api/history/${encodeURIComponent(s.ticker)}`);
        if (res.ok) histories.add(s.ticker);
      } catch {
        // ignore
      }
    })
  );

  if (snapshotData.fullOutput && snapshotData.fullOutput.results) {
    renderValidation(snapshotData.stocks, histories);
    renderResult(snapshotData.fullOutput);
    setStatus(`Snapshot loaded (${selectedKeyStr || 'latest'}).`);
  } else {
    hideResultSections();
    setStatus(`Snapshot loaded (${selectedKeyStr || 'latest'}).`);
  }
}

async function refreshSnapshotTree(): Promise<void> {
  try {
    const tree = await fetchSnapshotTree();
    if (!currentSelectedKey && tree.folders.length > 0 && tree.folders[0].files.length > 0) {
      currentSelectedKey = `${tree.folders[0].date}/${tree.folders[0].files[0]}`;
    }
    renderSnapshotTree(tree, { onSelect: onSelectSnapshotFile, onDelete: onDeleteSnapshotFile }, currentSelectedKey);
  } catch (err: any) {
    console.warn('Failed to fetch snapshot tree', err.message);
  }
}

async function onSelectSnapshotFile(date: string, filename: string): Promise<void> {
  const key = `${date}/${filename}`;
  setStatus(`Loading snapshot ${key}...`);
  try {
    const data = await fetchSnapshotFile(date, filename);
    await loadSnapshotDataIntoPage(data, key);
  } catch (err: any) {
    setStatus(`Failed to load snapshot: ${err.message}`);
  }
}

async function onDeleteSnapshotFile(date: string, filename: string): Promise<void> {
  const key = `${date}/${filename}`;
  if (!confirm(`Are you sure you want to delete snapshot "${filename}"?`)) return;

  try {
    await deleteSnapshotFile(date, filename);
    setStatus(`Deleted snapshot ${key}.`);

    if (currentSelectedKey === key) {
      currentSelectedKey = '';
      await sync();
    } else {
      await refreshSnapshotTree();
    }
  } catch (err: any) {
    setStatus(`Failed to delete snapshot: ${err.message}`);
  }
}

async function sync(): Promise<void> {
  let snapshotData: any = null;
  try {
    snapshotData = await getLatestSnapshot();
  } catch {
    snapshotData = null;
  }

  let defaultKey = '';
  if (snapshotData && snapshotData.date && snapshotData.filename) {
    defaultKey = `${snapshotData.date}/${snapshotData.filename}`;
  }

  await loadSnapshotDataIntoPage(snapshotData, defaultKey);
  await refreshSnapshotTree();
}

async function runAnalysis(): Promise<void> {
  const stocks = readStocks();
  if (!stocks.length) return setStatus('Add at least one ticker.');
  try {
    const result = await analyze(stocks, Number(($('cash') as HTMLInputElement).value) || 0);
    renderValidation(stocks, histories);
    renderResult(result);
    setStatus('Analysis saved and snapshot recorded.');
    await updateState();
    await refreshSnapshotTree();
  } catch (error: any) {
    const ticker = error.message.split(':')[0];
    renderValidation(stocks, histories, [{ ticker, reason: error.message }]);
    setStatus(`Analysis blocked: ${error.message}`);
  }
}

$('analyze').onclick = runAnalysis;
const addRowBtn = $('add-row');
if (addRowBtn) {
  addRowBtn.onclick = () => createStock();
}

sync().catch((error: any) => setStatus(`Sync failed: ${error.message}`));


