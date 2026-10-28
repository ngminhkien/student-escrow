export type Session = { accessToken: string; expiresAt: string; user: { id: string; fullName: string; email: string } };
export type LinkedWallet = { linked: boolean; address: string | null; chainId: number | null };
export type Kyc = { status: string; isMock: boolean; reasonCode: string | null; maskedStudentNumber: string | null };
export type NetworkStatus = {
  status: string; deploymentId?: string; chainId?: string; contractAddress?: string;
  deploymentBlock?: number; deploymentBlockHash?: string; lastIndexedBlock?: number; checkedAt?: string;
};
export type Draft = {
  id: string; deploymentId: string; buyer: string; seller: string; arbiter: string;
  description: string; acceptanceCriteria: string; amountWei: string; deliveryDeadline: number;
  reviewWindow: number; clientReference: string; termsJson: string; termsHash: string; createdAt: string;
};
export type OrderState = "Created" | "Funded" | "Delivered" | "Completed" | "Disputed" | "Resolved" | "Refunded";
export type ChainOrder = {
  orderId: string; state: OrderState; deliveryHash: string | null; reviewDeadline: number | null;
  buyerRefundWei: string; sellerNetWei: string; platformFeeWei: string;
};
export type OrderFile = { id: string; kind: string; fileName: string; length: number; sha256: string; createdAt: string };
export type OrderView = {
  draft: Draft; chain: ChainOrder | null; termsMatch: boolean; syncStatus: string;
  lastIndexedBlock: number; checkedAt: string; files: OrderFile[]; deliveryFileMatchesChain: boolean;
};
export type ChainEvent = { name: string; blockNumber: number; transactionHash: string; logIndex: number; payload: string };
export type TxRecord = { hash: string; label: string; deploymentId: string; address: string; status: string; phase?: "pending" | "confirmed" | "failed" | "cancelled" | "unknown" };
export type RunAction = (label: string, action: () => Promise<void>, options?: { inlineError?: boolean }) => Promise<void>;
export interface LoginRequest { email: string; password: string }
export interface RegisterRequest extends LoginRequest { fullName: string }
export interface WalletChallenge { challengeId: string; address: string; chainId: number; message: string; expiresAt: string }
export interface WalletChallengeRequest { address: string; chainId: number }
export interface WalletLinkRequest { challengeId: string; signature: string }
export interface KycSubmission { fullName: string; studentNumber: string; documentReference: string; selfieReference: string }
export interface CreateOrderRequest {
  seller: string; arbiter: string; description: string; acceptanceCriteria: string;
  amountWei: string; deliveryDeadline: number; reviewWindow: number;
}
