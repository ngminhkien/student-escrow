import { api } from "../infrastructure/http/client";
import type { Kyc, KycSubmission, LinkedWallet, Session, WalletChallenge, WalletChallengeRequest, WalletLinkRequest } from "../domain/types";

export const getProfile = (token: string, signal?: AbortSignal): Promise<Session["user"]> => api("/users/me", token, "GET", undefined, signal);
export const getLinkedWallet = (token: string, signal?: AbortSignal): Promise<LinkedWallet> => api("/wallets/me", token, "GET", undefined, signal);
export const getKyc = (token: string, signal?: AbortSignal): Promise<Kyc> => api("/kyc/me", token, "GET", undefined, signal);
export const createWalletChallenge = (token: string, input: WalletChallengeRequest, signal?: AbortSignal): Promise<WalletChallenge> => api("/wallets/challenges", token, "POST", input, signal);
export const linkWallet = (token: string, input: WalletLinkRequest, signal?: AbortSignal): Promise<LinkedWallet> => api("/wallets/link", token, "POST", input, signal);
export const submitKyc = (token: string, input: KycSubmission, signal?: AbortSignal): Promise<Kyc> => api("/kyc/submissions", token, "POST", input, signal);
