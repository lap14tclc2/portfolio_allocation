const $ = (id: string): HTMLElement => document.getElementById(id)!;
const money = (value: any): string => Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const percent = (value: any): string => `${(Number(value || 0) * 100).toFixed(2)}%`;

export function setStatus(message: string): void {
  $('status').textContent = message;
  $('validation').classList.remove('hidden');
}

export function addStock(
  stock: Record<string, any> = {},
  handlers: {
    onUpload: (row: HTMLTableRowElement, btn: HTMLButtonElement) => void;
    onRemove: (row: HTMLTableRowElement) => void;
    onLoad: (row: HTMLTableRowElement, btn: HTMLButtonElement) => void;
  }
): void {
  const row = document.createElement('tr');
  ([
      ['ticker', 'text'],
      ['averageCostBasis', 'number'],
      ['currentShares', 'number'],
      ['currentPrice', 'number'],
    ] as const).forEach(([name, type]) => {
    const cell = document.createElement('td');
    const input = document.createElement('input');
    input.type = type;
    input.dataset.field = name;
    input.value = stock[name] ?? '';
    cell.appendChild(input);
    row.appendChild(cell);
  });

  const historyCell = document.createElement('td');
  const upload = document.createElement('button');
  upload.textContent = 'Upload CSV';
  upload.onclick = () => handlers.onUpload(row, upload);
  historyCell.appendChild(upload);
  row.appendChild(historyCell);

  const actionCell = document.createElement('td');
  const remove = document.createElement('button');
  remove.textContent = 'X';
  remove.className = 'danger';
  remove.onclick = () => handlers.onRemove(row);
  actionCell.appendChild(remove);
  row.appendChild(actionCell);

  $('portfolio').appendChild(row);
  if (stock.ticker) handlers.onLoad(row, upload);
}

export function rowValue(row: HTMLTableRowElement, field: string): string | number {
  const input = row.querySelector<HTMLInputElement>(`[data-field="${field}"]`);
  return input?.type === 'number' ? Number(input.value) || 0 : input?.value.trim() || '';
}

export function readStocks(): any[] {
  return Array.from($('portfolio').querySelectorAll<HTMLTableRowElement>('tr'))
    .map((row) => ({
      ticker: rowValue(row, 'ticker'),
      averageCostBasis: rowValue(row, 'averageCostBasis'),
      currentShares: rowValue(row, 'currentShares'),
      currentPrice: rowValue(row, 'currentPrice'),
    }))
    .filter((stock) => stock.ticker);
}

export function renderValidation(stocks: any[], histories: Set<string> | Map<string, any>, failures: any[] = []): void {
  const errors = new Map(failures.map((item) => [item.ticker, item.reason]));
  $('validation-body').replaceChildren();
  stocks.forEach((stock) => {
    const loaded = histories.has(stock.ticker);
    const status = errors.has(stock.ticker) ? 'FAIL' : loaded ? 'PASS' : 'MISSING';
    const row = document.createElement('tr');
    [
      stock.ticker,
      status,
      errors.get(stock.ticker) || (loaded ? 'Ready' : 'Upload CSV or add data/TICKER.csv'),
    ].forEach((value, idx) => {
      const cell = document.createElement('td');
      cell.textContent = value;
      if (idx === 1) cell.className = `status-${status.toLowerCase()}`;
      row.appendChild(cell);
    });
    $('validation-body').appendChild(row);
  });
}

function renderAnnualTargetHeader(result: any): void {
  const at = result.annualTarget || {};
  $('alloc-year').textContent = at.year || '-';
  $('target-status').textContent = at.status || '-';
  const applicabilitySpan = $('target-applicability');
  if (applicabilitySpan) {
    applicabilitySpan.textContent = at.applicability || 'VALID';
    applicabilitySpan.style.color =
      at.applicability === 'INVALIDATED BY UNIVERSE CHANGE' ? 'var(--warning-color)' : 'var(--success-color)';
  }
  const rw = at.riskWindow || (result.erc && result.erc.diagnostics && result.erc.diagnostics.riskWindow) || {};
  $('risk-window').textContent = rw.start && rw.end ? `${rw.start} → ${rw.end}` : '-';
  $('risk').textContent = percent(result.erc?.portfolioRisk);
  $('observations').textContent =
    result.erc?.observations || (result.erc?.diagnostics && result.erc?.diagnostics?.observations) || '-';
  $('erc-status').textContent = 'PASS';
}

function renderFundingSummary(result: any): void {
  const fp = $('funding-panel');
  fp.replaceChildren();
  ([
      ['Total NAV', money(result.nav)],
      ['Equity NAV', money(result.equityNav)],
      ['Cash Reserve', money(result.cashReserve)],
      ['Cash Deployed', money(result.cashDeployed)],
      ['Remaining Cash', money(result.remainingCash)],
      ['Hard Bank (Sell→Buy)', money(result.hardBank)],
    ] as const).forEach(([label, value]) => {
    const item = document.createElement('div');
    item.className = 'summary-item';
    const lbl = document.createElement('span');
    lbl.className = 'label';
    lbl.textContent = label;
    const val = document.createElement('span');
    val.className = 'value';
    val.textContent = value;
    item.appendChild(lbl);
    item.appendChild(val);
    fp.appendChild(item);
  });
}

function renderAnalysisRows(resultsList: any[]): void {
  $('erc-body').replaceChildren();
  $('results-body').replaceChildren();
  resultsList.forEach((item: any) => {
    const ercRow = document.createElement('tr');
    [
      item.ticker,
      percent(item.currentWeight),
      percent(item.ercWeight),
      percent(item.volatility),
      percent(item.riskContribution),
      percent(item.drift),
    ].forEach((value) => {
      const cell = document.createElement('td');
      cell.textContent = value;
      ercRow.appendChild(cell);
    });
    $('erc-body').appendChild(ercRow);

    const row = document.createElement('tr');
    [
      item.ticker,
      money(item.value),
      percent(item.currentWeight),
      percent(item.ercWeight),
      `${percent(item.normal.lower)}-${percent(item.normal.upper)}`,
      item.band,
      percent(item.drift),
      item.recommendation,
      money(item.targetTradeAmount),
      money(item.fundedTradeAmount),
      money(Math.round(item.sharesToTrade || 0)),
      percent(item.expectedWeight),
    ].forEach((value, idx) => {
      const cell = document.createElement('td');
      cell.textContent = String(value);
      if (idx === 5) cell.className = `band-${item.band.toLowerCase()}`;
      if (idx === 7) cell.className = `rec-${item.recommendation.toLowerCase()}`;
      row.appendChild(cell);
    });
    $('results-body').appendChild(row);
  });
}

export function renderResult(result: any): void {
  $('erc').classList.remove('hidden');
  $('results').classList.remove('hidden');

  renderAnnualTargetHeader(result);
  renderFundingSummary(result);
  renderAnalysisRows(result.results || []);

  if (result.portfolioState) {
    renderPortfolioState(result.portfolioState);
  }
}

export function renderPortfolioState(state: any): void {
  $('portfolio-state-section').classList.remove('hidden');
  const summary = $('state-summary');
  summary.replaceChildren();
  ([
      ['Total NAV', money(state.totalNav)],
      ['Equity NAV', money(state.equityNav)],
      ['Cash Reserve', money(state.cashReserve)],
    ] as const).forEach(([label, value]) => {
    const item = document.createElement('div');
    item.className = 'summary-item';
    const lbl = document.createElement('span');
    lbl.className = 'label';
    lbl.textContent = label;
    const val = document.createElement('span');
    val.className = 'value';
    val.textContent = value;
    item.appendChild(lbl);
    item.appendChild(val);
    summary.appendChild(item);
  });

  const body = $('state-body');
  body.replaceChildren();
  (state.holdings || []).forEach((h: any) => {
    const row = document.createElement('tr');
    const action = h.action || 'HOLD';
    const values = [
      h.ticker,
      money(Math.round(h.initialShares ?? h.shares)),
      action,
      money(Math.round(h.tradeShares || 0)),
      money(Math.round(h.shares)),
      money(h.price),
      money(h.marketValue),
      percent(h.weight),
      h.ercTargetWeight != null ? percent(h.ercTargetWeight) : '-',
    ];
    values.forEach((val, idx) => {
      const cell = document.createElement('td');
      cell.textContent = String(val);
      if (idx === 2) {
        cell.className = `rec-${action.toLowerCase()}`;
      } else if (idx === 1 || idx === 3 || idx === 4) {
        cell.className = 'col-shares';
      } else if (idx === 6) {
        cell.className = 'col-market-value';
      }
      row.appendChild(cell);
    });
    body.appendChild(row);
  });
}

export function hideResultSections(): void {
  $('validation').classList.add('hidden');
  $('erc').classList.add('hidden');
  $('results').classList.add('hidden');
  $('portfolio-state-section').classList.add('hidden');
}

function buildTreeFileNode(
  folderDate: string,
  file: string,
  handlers: { onSelect: (date: string, filename: string) => void; onDelete?: (date: string, filename: string) => void },
  selectedKey: string
): HTMLLIElement {
  const fileLi = document.createElement('li');
  const fileRow = document.createElement('div');
  fileRow.className = 'tree-file';
  const fileKey = `${folderDate}/${file}`;
  if (selectedKey === fileKey) fileRow.classList.add('selected');
  const fileIcon = document.createElement('span');
  fileIcon.className = 'tree-icon';
  fileIcon.textContent = '📄';
  const fileLabel = document.createElement('span');
  fileLabel.className = 'tree-label';
  fileLabel.textContent = file;
  const deleteBtn = document.createElement('span');
  deleteBtn.className = 'tree-delete-btn';
  deleteBtn.textContent = '🗑️';
  deleteBtn.title = 'Delete snapshot';
  deleteBtn.onclick = (e) => {
    e.stopPropagation();
    if (handlers.onDelete) handlers.onDelete(folderDate, file);
  };
  fileRow.appendChild(fileIcon);
  fileRow.appendChild(fileLabel);
  fileRow.appendChild(deleteBtn);
  fileRow.onclick = (e) => {
    e.stopPropagation();
    document.querySelectorAll('.tree-file').forEach((el) => el.classList.remove('selected'));
    fileRow.classList.add('selected');
    handlers.onSelect(folderDate, file);
  };
  fileLi.appendChild(fileRow);
  return fileLi;
}

function buildTreeFolderNode(
  folder: { date: string; files: string[] },
  folderIdx: number,
  handlers: { onSelect: (date: string, filename: string) => void; onDelete?: (date: string, filename: string) => void },
  selectedKey: string
): HTMLLIElement {
  const folderLi = document.createElement('li');
  const folderHeader = document.createElement('div');
  folderHeader.className = 'tree-folder';
  let folderExpanded = folderIdx === 0;
  const folderToggle = document.createElement('span');
  folderToggle.className = 'tree-toggle';
  folderToggle.textContent = folderExpanded ? '▼' : '▶';
  const folderIcon = document.createElement('span');
  folderIcon.className = 'tree-icon';
  folderIcon.textContent = folderExpanded ? '📂' : '📁';
  const folderLabel = document.createElement('span');
  folderLabel.className = 'tree-label';
  folderLabel.textContent = folder.date;
  folderHeader.appendChild(folderToggle);
  folderHeader.appendChild(folderIcon);
  folderHeader.appendChild(folderLabel);
  folderLi.appendChild(folderHeader);
  const filesUl = document.createElement('ul');
  filesUl.style.display = folderExpanded ? 'block' : 'none';
  folderHeader.onclick = () => {
    folderExpanded = !folderExpanded;
    filesUl.style.display = folderExpanded ? 'block' : 'none';
    folderToggle.textContent = folderExpanded ? '▼' : '▶';
    folderIcon.textContent = folderExpanded ? '📂' : '📁';
  };
  folder.files.forEach((file) => {
    filesUl.appendChild(buildTreeFileNode(folder.date, file, handlers, selectedKey));
  });
  folderLi.appendChild(filesUl);
  return folderLi;
}

export function renderSnapshotTree(
  treeData: { name: string; folders: Array<{ date: string; files: string[] }> },
  handlers: {
    onSelect: (date: string, filename: string) => void;
    onDelete?: (date: string, filename: string) => void;
  },
  selectedKey: string = ''
): void {
  const container = $('snapshot-tree');
  if (!container) return;
  container.replaceChildren();
  if (!treeData || !treeData.folders || treeData.folders.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.style.color = 'var(--text-secondary)';
    emptyMsg.style.fontSize = '0.85rem';
    emptyMsg.textContent = 'No snapshot records found.';
    container.appendChild(emptyMsg);
    return;
  }
  const rootUl = document.createElement('ul');
  rootUl.className = 'tree-node';
  const rootLi = document.createElement('li');
  const rootHeader = document.createElement('div');
  rootHeader.className = 'tree-folder';
  const rootToggle = document.createElement('span');
  rootToggle.className = 'tree-toggle';
  rootToggle.textContent = '▼';
  const rootIcon = document.createElement('span');
  rootIcon.className = 'tree-icon';
  rootIcon.textContent = '📂';
  const rootLabel = document.createElement('span');
  rootLabel.className = 'tree-label';
  rootLabel.textContent = treeData.name || 'snapshots';
  rootHeader.appendChild(rootToggle);
  rootHeader.appendChild(rootIcon);
  rootHeader.appendChild(rootLabel);
  rootLi.appendChild(rootHeader);
  const foldersUl = document.createElement('ul');
  let rootExpanded = true;
  rootHeader.onclick = () => {
    rootExpanded = !rootExpanded;
    foldersUl.style.display = rootExpanded ? 'block' : 'none';
    rootToggle.textContent = rootExpanded ? '▼' : '▶';
    rootIcon.textContent = rootExpanded ? '📂' : '📁';
  };
  treeData.folders.forEach((folder, folderIdx) => {
    foldersUl.appendChild(buildTreeFolderNode(folder, folderIdx, handlers, selectedKey));
  });
  rootLi.appendChild(foldersUl);
  rootUl.appendChild(rootLi);
  container.appendChild(rootUl);
}

export { $ };
