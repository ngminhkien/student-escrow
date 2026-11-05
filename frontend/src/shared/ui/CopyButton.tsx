import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // The clipboard API exists only on secure origins; a demo opened over a LAN address is not one.
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    if (!copied) throw new Error("Trình duyệt không cho sao chép.");
  }
}

export function CopyButton({ value, label, text }: { value: string; label: string; text?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy() {
    let next: "copied" | "failed" = "copied";
    try { await copyText(value); } catch { next = "failed"; }
    setState(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 1800);
  }
  const message = state === "copied" ? "Đã sao chép" : state === "failed" ? "Không sao chép được" : "";
  return <span className="copy-wrap">
    <button type="button" className={text ? "secondary copy-text-button" : "copy-button"} aria-label={`Sao chép ${label}`} title={message || `Sao chép ${label}`} onClick={() => void copy()}>
      <Icon name={state === "copied" ? "check" : "copy"} size={text ? 15 : 14} />{text && <span>{state === "idle" ? text : message}</span>}
    </button>
    <span className="sr-only" role="status">{message}</span>
  </span>;
}

export function Copyable({ value, label, display, className = "" }: { value: string; label: string; display?: string; className?: string }) {
  return <span className={`copyable ${className}`}><span className="mono" title={value}>{display ?? value}</span><CopyButton value={value} label={label} /></span>;
}

export const shorten = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;
export default CopyButton;
