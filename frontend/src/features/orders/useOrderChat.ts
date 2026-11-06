import { useCallback, useEffect, useRef, useState } from "react";
import { getChat, getChatUnread, markChatRead, sendChatMessage } from "../../services/orders";
import { errorMessage } from "../../wallet";
import type { ChatEvent, ChatMessage, ChatPage } from "../../domain/types";

export const CHAT_POLL_MS = 3000;
const CHAT_MAX_BACKOFF_MS = 30000;
const CHAT_PAGE_SIZE = 100;
const UNREAD_POLL_MS = 15000;

type ChatState = { role: string; state: string; canSend: boolean; messages: ChatMessage[]; events: ChatEvent[]; loading: boolean; error: string };
const initial: ChatState = { role: "", state: "", canSend: false, messages: [], events: [], loading: true, error: "" };

const merge = (current: ChatMessage[], incoming: ChatMessage[]) => {
  if (!incoming.length) return current;
  const bySeq = new Map(current.map(message => [message.seq, message]));
  for (const message of incoming) bySeq.set(message.seq, message);
  return [...bySeq.values()].sort((left, right) => left.seq - right.seq);
};

function assertPage(page: ChatPage) {
  if (!Array.isArray(page?.messages) || !Array.isArray(page?.events)) throw new Error("Dữ liệu trò chuyện không hợp lệ.");
  return page;
}

// One request at a time, and none while the tab is hidden, so an open order stays cheap to keep on screen.
export function useOrderChat(token: string, id: string) {
  const [chat, setChat] = useState<ChatState>(initial);
  const [hasOlder, setHasOlder] = useState(false);
  const lastSeq = useRef(0);
  const firstSeq = useRef(0);
  const markedSeq = useRef(0);
  const wake = useRef<() => void>(() => undefined);

  const absorb = useCallback((messages: ChatMessage[]) => {
    if (!messages.length) return;
    lastSeq.current = Math.max(lastSeq.current, messages[messages.length - 1].seq);
    firstSeq.current = firstSeq.current ? Math.min(firstSeq.current, messages[0].seq) : messages[0].seq;
    setHasOlder(firstSeq.current > 1);
  }, []);

  useEffect(() => {
    let stopped = false;
    let inFlight = false;
    let again = false;
    let delay = CHAT_POLL_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    setChat(initial);
    setHasOlder(false);
    lastSeq.current = 0;
    firstSeq.current = 0;
    markedSeq.current = 0;

    async function tick() {
      if (stopped) return;
      if (timer) clearTimeout(timer);
      if (document.hidden) return;
      if (inFlight) { again = true; return; }
      inFlight = true;
      let backlog = false;
      try {
        const forward = lastSeq.current > 0;
        const page = assertPage(await getChat(token, id, forward ? { afterSeq: lastSeq.current } : {}, controller.signal));
        if (stopped) return;
        absorb(page.messages);
        backlog = forward && page.messages.length === CHAT_PAGE_SIZE;
        setChat(previous => ({ role: page.role, state: page.state, canSend: page.canSend, messages: merge(previous.messages, page.messages), events: page.events, loading: false, error: "" }));
        delay = CHAT_POLL_MS;
        if (lastSeq.current > markedSeq.current) {
          markedSeq.current = lastSeq.current;
          void markChatRead(token, id, lastSeq.current, controller.signal).catch(() => undefined);
        }
      } catch (failure) {
        if (stopped) return;
        delay = Math.min(delay * 2, CHAT_MAX_BACKOFF_MS);
        setChat(previous => ({ ...previous, loading: false, error: errorMessage(failure) }));
      } finally {
        inFlight = false;
        if (!stopped) {
          if (again || backlog) { again = false; void tick(); }
          else timer = setTimeout(() => void tick(), delay);
        }
      }
    }
    const onVisibility = () => { if (!document.hidden) { delay = CHAT_POLL_MS; void tick(); } };
    wake.current = () => void tick();
    document.addEventListener("visibilitychange", onVisibility);
    void tick();
    return () => {
      stopped = true;
      controller.abort();
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [token, id, absorb]);

  const send = useCallback(async (input: { text?: string; fileId?: string }) => {
    const saved = await sendChatMessage(token, id, input);
    absorb([saved]);
    setChat(previous => ({ ...previous, messages: merge(previous.messages, [saved]) }));
    wake.current();
  }, [token, id, absorb]);

  const loadOlder = useCallback(async () => {
    const page = assertPage(await getChat(token, id, { beforeSeq: firstSeq.current }));
    absorb(page.messages);
    setChat(previous => ({ ...previous, messages: merge(previous.messages, page.messages) }));
  }, [token, id, absorb]);

  return { ...chat, hasOlder, send, loadOlder };
}

export function useChatUnread(token: string) {
  const [unread, setUnread] = useState<Record<string, number>>({});
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function refresh() {
      if (!document.hidden) {
        try {
          const rows = await getChatUnread(token, controller.signal);
          if (!controller.signal.aborted && Array.isArray(rows)) setUnread(Object.fromEntries(rows.map(row => [row.draftId, row.count])));
        } catch { /* A badge is not worth interrupting the order list. The next round retries. */ }
      }
      if (!controller.signal.aborted) timer = setTimeout(() => void refresh(), UNREAD_POLL_MS);
    }
    void refresh();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [token]);
  return unread;
}
