export type Session = { accessToken: string; expiresAt: string; user: { id: string; fullName: string; email: string } };
export type LinkedWallet = { linked: boolean; address: string | null; chainId: number | null; custodial?: boolean };
export type LedgerEntry = { id: string; type: string; amountWei: string; amountVnd: string; balanceAfterWei: string; orderId: string | null; transactionHash: string | null; note: string | null; createdAt: string };
export type WalletAccount = { custodial: boolean; address: string | null; balanceWei: string; balanceVnd: string; lockedWei: string; lockedVnd: string; vndPerEth: number; entries: LedgerEntry[] };
export type DepositStatus = "Pending" | "Succeeded" | "Failed" | "Cancelled" | "Expired";
export type Deposit = { id: string; amountVnd: number; amountWei: string; status: DepositStatus; gateway: string; gatewayTransactionId: string | null; createdAt: string; expiresAt: string; completedAt: string | null; payoutAddress?: string | null; payoutStatus?: DepositPayoutStatus | null; payoutTransactionHash?: string | null };
export type AdminChainOrder = { orderId: string; state: string; amountWei: string };
export type DepositPayoutStatus = "Queued" | "Sending" | "Sent";
export type AdminAccount = { userId: string; email: string; fullName: string; address: string; custodial: boolean; balanceWei: string; balanceVnd: string; chainBalanceWei: string; kycStatus: string; verifiedOnChain: boolean; approvedArbiter: boolean };
export type AdminAccounts = { accounts: AdminAccount[]; ledgerTotalWei: string; ledgerTotalVnd: string; treasuryWei: string; contractWei: string };
export type OrderAction = "create" | "accept" | "cancel" | "deposit" | "deliver" | "confirm" | "dispute" | "refund" | "claim" | "timeout" | "resolve";
export type Kyc = { status: string; isMock: boolean; reasonCode: string | null; maskedStudentNumber: string | null };
export type NetworkStatus = {
  status: string; deploymentId?: string; chainId?: string; contractAddress?: string;
  deploymentBlock?: number; deploymentBlockHash?: string; lastIndexedBlock?: number; checkedAt?: string;
};
export type Draft = {
  id: string; deploymentId: string; buyer: string; seller: string; arbiter: string;
  description: string; acceptanceCriteria: string; amountWei: string; deliveryDeadline: number;
  reviewWindow: number; clientReference: string; termsJson: string; termsHash: string; createdAt: string;
  standardTermsVersion: string; buyerAcceptedTermsAt?: string | null;
};
export type StandardTerms = { version: string; title: string; text: string; hash: string };
export type PartyLookup = { fullName: string; maskedEmail: string; address: string };
export type Arbiter = { fullName: string; address: string };
export type OrderParty = { fullName: string; maskedEmail: string };
export type OrderState = "Created" | "Accepted" | "Cancelled" | "Funded" | "Delivered" | "Completed" | "Disputed" | "Resolved" | "Refunded";
export type ChainOrder = {
  orderId: string; state: OrderState; deliveryHash: string | null; reviewDeadline: number | null;
  buyerRefundWei: string; sellerNetWei: string; platformFeeWei: string;
};
export type OrderFile = { id: string; kind: string; fileName: string; length: number; sha256: string; createdAt: string };
export type OrderView = {
  draft: Draft; chain: ChainOrder | null; termsMatch: boolean; syncStatus: string;
  lastIndexedBlock: number; checkedAt: string; files: OrderFile[]; deliveryFileMatchesChain: boolean;
  parties?: { buyer: OrderParty | null; seller: OrderParty | null; arbiter: OrderParty | null };
};
export type ChainEvent = { name: string; blockNumber: number; transactionHash: string; logIndex: number; payload: string };
export type TxRecord = { hash: string; label: string; deploymentId: string; address: string; status: string; phase?: "pending" | "confirmed" | "failed" | "cancelled" | "unknown" };
export type RunAction = (label: string, action: () => Promise<void>, options?: { inlineError?: boolean }) => Promise<void>;
export interface LoginRequest { email: string; password: string }
export interface RegisterRequest extends LoginRequest { fullName: string; useExternalWallet?: boolean }
export interface WalletChallenge { challengeId: string; address: string; chainId: number; message: string; expiresAt: string }
export interface WalletChallengeRequest { address: string; chainId: number }
export interface WalletLinkRequest { challengeId: string; signature: string }
export interface KycSubmission { fullName: string; studentNumber: string; documentReference: string; selfieReference: string }
export interface CreateOrderRequest {
  sellerEmail: string; arbiter: string; acceptedTermsVersion: string; description: string; acceptanceCriteria: string;
  amountWei: string; deliveryDeadline: number; reviewWindow: number; category?: string;
}
