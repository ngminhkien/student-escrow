import { formatEthAmount, formatVnd } from "../../domain/money";

export default function Money({ wei }: { wei: string }) {
  return <span className="money"><span className="money-vnd">{formatVnd(wei)}</span> <small className="money-eth">{formatEthAmount(wei)}</small></span>;
}
