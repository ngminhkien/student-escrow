import type { NetworkStatus, RunAction, Session, TxRecord } from "../../domain/types";
export type OrdersProps = { session: Session; account: string; canSign: boolean; network: NetworkStatus; chainTime: number; busy: boolean; run: RunAction; record: (tx: TxRecord) => void; revision: number };
