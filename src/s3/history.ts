import { el } from '../utils/dom';

interface HistoryEntry {
  bucket: string;
  prefix: string;
}

const history: HistoryEntry[] = [];
let histIdx = -1;

const btnBack = el<HTMLButtonElement>('btn-s3-back');
const btnFwd  = el<HTMLButtonElement>('btn-s3-fwd');
const btnUp   = el<HTMLButtonElement>('btn-s3-up');

function updateNavBtns(prefix: string): void {
  btnBack.disabled = histIdx <= 0;
  btnFwd.disabled  = histIdx >= history.length - 1;
  btnUp.disabled   = !prefix;
}

export function s3PushHistory(bucket: string, prefix: string): void {
  const cur = history[histIdx];
  if (cur && cur.bucket === bucket && cur.prefix === prefix) return;
  history.splice(histIdx + 1);
  history.push({ bucket, prefix });
  histIdx = history.length - 1;
  updateNavBtns(prefix);
}

export function s3NavBack(): HistoryEntry | null {
  if (histIdx <= 0) return null;
  histIdx--;
  const entry = history[histIdx];
  updateNavBtns(entry.prefix);
  return entry;
}

export function s3NavFwd(): HistoryEntry | null {
  if (histIdx >= history.length - 1) return null;
  histIdx++;
  const entry = history[histIdx];
  updateNavBtns(entry.prefix);
  return entry;
}

export function s3NavUp(currentPrefix: string): string {
  const trimmed = currentPrefix.endsWith('/') ? currentPrefix.slice(0, -1) : currentPrefix;
  const lastSlash = trimmed.lastIndexOf('/');
  return lastSlash >= 0 ? trimmed.slice(0, lastSlash + 1) : '';
}
