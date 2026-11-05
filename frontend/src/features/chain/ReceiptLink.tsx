import type { MouseEvent, ReactNode } from "react";
import { CopyButton, shorten } from "../../shared/ui/CopyButton";

const receiptPath = (hash: string) => `${location.pathname}?tx=${hash}`;
export const receiptUrl = (hash: string) => `${location.origin}${receiptPath(hash)}`;

export function openReceipt(hash: string) {
  history.pushState(null, "", receiptPath(hash));
  window.dispatchEvent(new PopStateEvent("popstate"));
}

// A real link, so it can also be opened in a new tab or copied from the browser's own menu.
export function ReceiptLink({ hash, children, label }: { hash: string; children: ReactNode; label?: string }) {
  function follow(event: MouseEvent<HTMLAnchorElement>) {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    openReceipt(hash);
  }
  return <a className="receipt-link" href={receiptPath(hash)} aria-label={label} onClick={follow}>{children}</a>;
}

export function TxHash({ hash, compact = false }: { hash: string; compact?: boolean }) {
  return <span className="copyable"><ReceiptLink hash={hash} label={`Xem biên lai ${hash}`}><span className="mono" title={hash}>{compact ? shorten(hash) : hash}</span></ReceiptLink><CopyButton value={hash} label="mã giao dịch" /></span>;
}
