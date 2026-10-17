import { api, downloadFile } from "../infrastructure/http/client";
import type { ChainEvent, CreateOrderRequest, OrderFile, OrderView } from "../domain/types";

const segment = (id: string) => encodeURIComponent(id);
const offset = (skip: number) => Math.max(0, Math.floor(Number.isFinite(skip) ? skip : 0));
export const listOrders = (token: string, skip = 0, signal?: AbortSignal): Promise<OrderView[]> => api(`/orders?skip=${offset(skip)}`, token, "GET", undefined, signal);
export const getOrder = (token: string, id: string, signal?: AbortSignal): Promise<OrderView> => api(`/orders/${segment(id)}`, token, "GET", undefined, signal);
export const createOrder = (token: string, input: CreateOrderRequest, signal?: AbortSignal): Promise<OrderView> => api("/orders", token, "POST", input, signal);
export const getOrderEvents = (token: string, id: string, skip = 0, signal?: AbortSignal): Promise<ChainEvent[]> => api(`/orders/${segment(id)}/events?skip=${offset(skip)}`, token, "GET", undefined, signal);
export const uploadOrderFile = (token: string, id: string, data: FormData, signal?: AbortSignal): Promise<OrderFile> => api(`/orders/${segment(id)}/files`, token, "POST", data, signal);
export const downloadOrderFile = (token: string, id: string, fileId: string, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> => downloadFile(`/orders/${segment(id)}/files/${segment(fileId)}`, token, signal);
