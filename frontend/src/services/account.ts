import { api } from "../infrastructure/http/client";
import type { Deposit, Kyc, KycSubmission, LinkedWallet, Session, WalletAccount, WalletChallenge, WalletChallengeRequest, WalletLinkRequest } from "../domain/types";

export const getProfile = (token: string, signal?: AbortSignal): Promise<Session["user"]> => api("/users/me", token, "GET", undefined, signal);
export const getLinkedWallet = (token: string, signal?: AbortSignal): Promise<LinkedWallet> => api("/wallets/me", token, "GET", undefined, signal);
export const getWalletAccount = (token: string, signal?: AbortSignal): Promise<WalletAccount> => api("/wallets/account", token, "GET", undefined, signal);
export const listDeposits = (token: string, signal?: AbortSignal): Promise<Deposit[]> => api("/wallets/deposits", token, "GET", undefined, signal);
export const createDeposit = (token: string, input: { amountVnd: number; reference: string }): Promise<Deposit> => api("/wallets/deposits", token, "POST", input);
export const cancelDeposit = (token: string, id: string): Promise<Deposit> => api(`/wallets/deposits/${id}/cancel`, token, "POST");
export const payMockDeposit = (token: string, id: string, outcome: "Succeeded" | "Failed"): Promise<Deposit> => api(`/wallets/deposits/${id}/mock-payment`, token, "POST", { outcome });
export const retryDepositPayout = (token: string, id: string): Promise<Deposit> => api(`/wallets/deposits/${id}/payout`, token, "POST");
export const getKyc = (token: string, signal?: AbortSignal): Promise<Kyc> => api("/kyc/me", token, "GET", undefined, signal);
export const createWalletChallenge = (token: string, input: WalletChallengeRequest, signal?: AbortSignal): Promise<WalletChallenge> => api("/wallets/challenges", token, "POST", input, signal);
export const linkWallet = (token: string, input: WalletLinkRequest, signal?: AbortSignal): Promise<LinkedWallet> => api("/wallets/link", token, "POST", input, signal);
export const submitKyc = (token: string, input: KycSubmission, signal?: AbortSignal): Promise<Kyc> => api("/kyc/submissions", token, "POST", input, signal);
