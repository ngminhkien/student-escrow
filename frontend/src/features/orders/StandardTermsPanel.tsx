import { useEffect, useState } from "react";
import { sha256, toUtf8Bytes } from "ethers";
import { getStandardTerms } from "../../services/orders";
import { errorMessage } from "../../wallet";
import type { StandardTerms } from "../../domain/types";

// Loads the exact wording behind an order. With expectedHash set, wording that differs from what the order sealed is refused.
export function useStandardTerms(token: string, version?: string, expectedHash?: string) {
  const [terms, setTerms] = useState<StandardTerms | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setTerms(null); setError("");
    getStandardTerms(token, version, controller.signal).then(value => {
      if (sha256(toUtf8Bytes(value.text)) !== (expectedHash ?? value.hash)) throw new Error("Nội dung điều khoản không khớp với mã hash của đơn.");
      setTerms(value);
    }).catch(failure => { if (!controller.signal.aborted) setError(errorMessage(failure)); });
    return () => controller.abort();
  }, [token, version, expectedHash, revision]);
  return { terms, error, retry: () => setRevision(value => value + 1) };
}

export default function StandardTermsPanel({ terms, error, retry, agreed, onAgree, disabled, label }: { terms: StandardTerms | null; error: string; retry: () => void; agreed?: boolean; onAgree?: (value: boolean) => void; disabled?: boolean; label?: string }) {
  if (error) return <div className="banner" role="alert">Chưa tải được điều khoản giao dịch: {error} <button type="button" className="secondary" onClick={retry}>Thử lại</button></div>;
  if (!terms) return <p role="status">Đang tải điều khoản giao dịch…</p>;
  const sections = terms.text.split(/\n\s*\n/).map(section => { const [heading, ...body] = section.split("\n"); return { heading, body: body.join(" ") }; });
  return <section className="standard-terms" aria-label="Điều khoản giao dịch">
    <h4>{terms.title}</h4><p className="small muted">Phiên bản {terms.version}</p>
    <div className="standard-terms-body" tabIndex={0} role="group" aria-label="Nội dung điều khoản">{sections.map(section => <div key={section.heading}><strong>{section.heading}</strong><p>{section.body}</p></div>)}</div>
    {onAgree && <label className="checkbox"><input type="checkbox" checked={!!agreed} disabled={disabled} onChange={event => onAgree(event.target.checked)} />{label}</label>}
  </section>;
}
