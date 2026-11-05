import { api } from "../infrastructure/http/client";
import type { AdminAccounts, AdminChainOrder, WalletAccount } from "../domain/types";

export const getAdminAccounts = (token: string, signal?: AbortSignal): Promise<AdminAccounts> => api("/admin/accounts", token, "GET", undefined, signal);
export const getAdminChainOrders = (token: string, signal?: AbortSignal): Promise<AdminChainOrder[]> => api("/admin/chain-orders", token, "GET", undefined, signal);
export const setWalletVerification = (token: string, address: string, verified: boolean): Promise<{ transactionHash: string }> => api("/admin/wallets/verification", token, "POST", { address, verified });
export const setKycAdmin = (token: string, address: string, grant: boolean): Promise<{ transactionHash: string }> => api("/admin/wallets/kyc-admin", token, "POST", { address, grant });
export const setArbiterApproval = (token: string, address: string, approved: boolean): Promise<{ transactionHash: string }> => api("/admin/arbiters", token, "POST", { address, approved });
export const creditWallet = (token: string, input: { address: string; amountVnd: number; reference: string; note?: string }): Promise<WalletAccount> => api("/admin/wallets/credits", token, "POST", input);
