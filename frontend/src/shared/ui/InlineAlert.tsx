import type { ReactNode } from "react";
export function InlineAlert({ children, tone = "info", title }: { children: ReactNode; tone?: "info" | "error" | "success"; title?: string }) {
  return <div className={`banner inline-alert alert-${tone}`} role={tone === "error" ? "alert" : "status"}>{title && <strong>{title}</strong>}<div>{children}</div></div>;
}
export default InlineAlert;
