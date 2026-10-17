const paths = { orders: "M8 3h8l4 4v14H4V3h4M8 11h8M8 15h6", wallet: "M3 6h16v14H3V6Zm0 0 14-3v3m-2 6h6v5h-6v-5Z", shield: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6", arrow: "M5 12h14m-6-6 6 6-6 6", check: "m5 12 4 4L19 6", clock: "M12 8v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0", external: "M14 3h7v7m0-7L10 14M10 3H3v18h18v-7", refresh: "M20 7v5h-5M4 17v-5h5m-4-4a8 8 0 0 1 14-3l1 7M4 12l1 7a8 8 0 0 0 14-3", logout: "M9 3H3v18h6m6-15 6 6-6 6m-8-6h14", plus: "M12 5v14M5 12h14", close: "m6 6 12 12M6 18 18 6" };
export type IconName = keyof typeof paths;
export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}><path d={paths[name]} /></svg>;
}
export default Icon;
