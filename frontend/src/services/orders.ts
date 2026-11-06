import { api, downloadFile } from "../infrastructure/http/client";
import type { Arbiter, ChainEvent, ChatMessage, ChatPage, ChatUnread, CreateOrderRequest, OrderAction, OrderFile, OrderView, PartyLookup, StandardTerms } from "../domain/types";

const segment = (id: string) => encodeURIComponent(id);
const offset = (skip: number) => Math.max(0, Math.floor(Number.isFinite(skip) ? skip : 0));
export const listOrders = (token: string, skip = 0, signal?: AbortSignal): Promise<OrderView[]> => api(`/orders?skip=${offset(skip)}`, token, "GET", undefined, signal);
export const getOrder = (token: string, id: string, signal?: AbortSignal): Promise<OrderView> => api(`/orders/${segment(id)}`, token, "GET", undefined, signal);
export const createOrder = (token: string, input: CreateOrderRequest, signal?: AbortSignal): Promise<OrderView> => api("/orders", token, "POST", input, signal);
export const runOrderAction = (token: string, id: string, action: OrderAction, options: { sellerShareBps?: number; acceptedTermsVersion?: string } = {}, signal?: AbortSignal): Promise<{ transactionHash: string }> => api(`/orders/${segment(id)}/actions`, token, "POST", { action, ...options }, signal);
export const getStandardTerms = (token: string, version?: string, signal?: AbortSignal): Promise<StandardTerms> => api(`/orders/terms${version ? `?version=${encodeURIComponent(version)}` : ""}`, token, "GET", undefined, signal);
export const listArbiters = (token: string, signal?: AbortSignal): Promise<Arbiter[]> => api("/orders/arbiters", token, "GET", undefined, signal);
export const findParty = (token: string, email: string, signal?: AbortSignal): Promise<PartyLookup> => api("/orders/party-lookup", token, "POST", { email }, signal);
export const getOrderEvents = (token: string, id: string, skip = 0, signal?: AbortSignal): Promise<ChainEvent[]> => api(`/orders/${segment(id)}/events?skip=${offset(skip)}`, token, "GET", undefined, signal);
export const uploadOrderFile = (token: string, id: string, data: FormData, signal?: AbortSignal): Promise<OrderFile> => api(`/orders/${segment(id)}/files`, token, "POST", data, signal);
export const downloadOrderFile = (token: string, id: string, fileId: string, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> => downloadFile(`/orders/${segment(id)}/files/${segment(fileId)}`, token, signal);
export function getChat(token: string, id: string, cursor: { afterSeq?: number; beforeSeq?: number } = {}, signal?: AbortSignal): Promise<ChatPage> {
  const query = new URLSearchParams();
  if (cursor.afterSeq !== undefined) query.set("afterSeq", String(cursor.afterSeq));
  if (cursor.beforeSeq !== undefined) query.set("beforeSeq", String(cursor.beforeSeq));
  const search = query.toString();
  return api(`/orders/${segment(id)}/chat${search ? `?${search}` : ""}`, token, "GET", undefined, signal);
}
export const sendChatMessage = (token: string, id: string, input: { text?: string; fileId?: string }, signal?: AbortSignal): Promise<ChatMessage> => api(`/orders/${segment(id)}/chat`, token, "POST", input, signal);
export const markChatRead = (token: string, id: string, seq: number, signal?: AbortSignal): Promise<void> => api(`/orders/${segment(id)}/chat/read`, token, "POST", { seq }, signal);
export const getChatUnread = (token: string, signal?: AbortSignal): Promise<ChatUnread[]> => api("/orders/chat/unread", token, "GET", undefined, signal);
