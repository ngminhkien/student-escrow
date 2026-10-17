export function Address({ value, short = false }: { value?: string | null; short?: boolean }) {
  return <span className="mono address" title={value || undefined}>{value ? short ? `${value.slice(0, 6)}…${value.slice(-4)}` : value : "Chưa kết nối"}</span>;
}
export default Address;
