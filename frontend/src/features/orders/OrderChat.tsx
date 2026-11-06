import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, KeyboardEvent } from "react";
import { downloadOrderFile, uploadOrderFile } from "../../services/orders";
import { errorMessage } from "../../wallet";
import type { ChatFile, ChatMessage, OrderView } from "../../domain/types";
import { Icon } from "../../shared/ui/Icon";
import { useOrderChat } from "./useOrderChat";

const MAX_TEXT = 2000;
const MAX_FILE_BYTES = 5_000_000;
const ATTACH_STATES = ["Funded", "Delivered", "Disputed"];
const OFF_PLATFORM = /(?:\+?84|\b0)\d{9}\b|zalo|telegram|t\.me\//i;
const eventText: Record<string, string> = {
  OrderCreated: "Đơn đã được tạo trên blockchain.",
  OrderAccepted: "Seller đã chấp nhận đơn.",
  OrderCancelled: "Đơn đã bị hủy.",
  Deposited: "Buyer đã ký quỹ. Tiền đang được khóa trong hợp đồng.",
  Delivered: "Seller đã xác nhận bàn giao.",
  Released: "Đơn hoàn thành. Tiền đã được chuyển cho Seller.",
  Disputed: "Tranh chấp đã mở. Arbiter có thể đọc và trả lời trong cuộc trò chuyện này.",
  Resolved: "Arbiter đã phân xử.",
  Refunded: "Tiền đã được hoàn cho Buyer."
};
const clock = (value: string) => new Date(value).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
const sizeText = (bytes: number) => bytes < 1_000_000 ? `${Math.max(1, Math.round(bytes / 1000))} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`;

type Entry = { key: string; block: number; rank: number; order: number; message?: ChatMessage; system?: string };

export default function OrderChat({ token, view, onFilesChanged }: { token: string; view: OrderView; onFilesChanged: () => void }) {
  const chat = useOrderChat(token, view.draft.id);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState("");
  const [hasNew, setHasNew] = useState(false);
  const thread = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const restoreFrom = useRef<number | null>(null);

  const entries = useMemo<Entry[]>(() => {
    // By block, not by time: a local chain's clock can run ahead of the wall clock. An event comes before any message sent once its block was synced.
    const system = chat.events.filter(item => eventText[item.name]).map(item => ({ key: `e${item.blockNumber}-${item.logIndex}`, block: item.blockNumber, rank: 0, order: item.logIndex, system: eventText[item.name] }));
    const messages = chat.messages.map(message => ({ key: `m${message.seq}`, block: message.chainBlock, rank: 1, order: message.seq, message }));
    return [...system, ...messages].sort((left, right) => left.block - right.block || left.rank - right.rank || left.order - right.order);
  }, [chat.events, chat.messages]);
  const lastKey = entries[entries.length - 1]?.key;

  useLayoutEffect(() => {
    const element = thread.current;
    if (!element) return;
    if (restoreFrom.current !== null) {
      element.scrollTop += element.scrollHeight - restoreFrom.current;
      restoreFrom.current = null;
    } else if (pinned.current) element.scrollTop = element.scrollHeight;
    else if (lastKey) setHasNew(true);
  }, [lastKey, entries.length]);

  function onScroll() {
    const element = thread.current;
    if (!element) return;
    pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
    if (pinned.current) setHasNew(false);
  }
  function toBottom() {
    pinned.current = true;
    setHasNew(false);
    if (thread.current) thread.current.scrollTop = thread.current.scrollHeight;
  }

  const open = chat.canSend && view.syncStatus !== "Archived";
  const evidenceCount = view.files.filter(file => file.kind === "evidence").length;
  const canAttach = open && chat.role !== "Arbiter" && ATTACH_STATES.includes(chat.state) && view.termsMatch && view.syncStatus === "Ready" && evidenceCount < 5;
  const trimmed = text.trim();
  const readOnlyNote = chat.role === "Arbiter" ? "Đơn đã được phân xử. Cuộc trò chuyện chỉ còn để đọc." : "Đơn đã kết thúc. Cuộc trò chuyện chỉ còn để đọc.";

  async function deliver(action: () => Promise<void>) {
    setSending(true);
    setFailure("");
    pinned.current = true;
    try { await action(); }
    catch (error) { setFailure(errorMessage(error)); }
    finally { setSending(false); }
  }
  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!trimmed || sending || !open) return;
    if (trimmed.length > MAX_TEXT) { setFailure(`Tin nhắn không vượt quá ${MAX_TEXT} ký tự.`); return; }
    void deliver(async () => { await chat.send({ text: trimmed }); setText(""); });
  }
  // Vietnamese input methods press Enter while still composing a word.
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); }
  }
  function attach(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!["png", "jpg", "jpeg", "pdf"].includes(extension)) { setFailure("Chỉ đính kèm được ảnh PNG, JPG hoặc file PDF."); return; }
    if (!file.size || file.size > MAX_FILE_BYTES) { setFailure("File phải có nội dung và không quá 5 MB."); return; }
    void deliver(async () => {
      const data = new FormData();
      data.set("kind", "evidence");
      data.set("file", file);
      const saved = await uploadOrderFile(token, view.draft.id, data);
      onFilesChanged();
      await chat.send({ text: trimmed || undefined, fileId: saved.id });
      setText("");
    });
  }
  function older() {
    restoreFrom.current = thread.current?.scrollHeight ?? null;
    void chat.loadOlder().catch(error => { restoreFrom.current = null; setFailure(errorMessage(error)); });
  }
  async function download(file: ChatFile) {
    try {
      const bytes = await downloadOrderFile(token, view.draft.id, file.id);
      const link = document.createElement("a");
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
      link.href = url; link.download = file.fileName; document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (error) { setFailure(errorMessage(error)); }
  }
  const senderName = (message: ChatMessage) => {
    const parties = view.parties;
    const party = message.senderRole === "Buyer" ? parties?.buyer : message.senderRole === "Seller" ? parties?.seller : parties?.arbiter;
    return party ? `${party.fullName} · ${message.senderRole}` : message.senderRole;
  };

  return <section className="order-chat" aria-label="Trò chuyện trong đơn">
    <div className="section-heading"><h3>Trò chuyện trong đơn</h3>{chat.role && <span className="muted">Bạn là {chat.role}</span>}</div>
    {chat.error && <p className="banner" role="alert">Chưa cập nhật được tin nhắn: {chat.error} Hệ thống sẽ tự thử lại.</p>}
    <div className="chat-frame">
      <div ref={thread} className="chat-thread" role="log" aria-live="polite" aria-label="Tin nhắn" tabIndex={0} onScroll={onScroll}>
        {chat.hasOlder && <button type="button" className="secondary compact-button chat-older" onClick={older}>Xem tin cũ hơn</button>}
        {chat.loading && <p role="status" className="muted">Đang tải tin nhắn…</p>}
        {!chat.loading && !entries.length && !chat.error && <p className="muted chat-empty">Chưa có tin nhắn. Hãy trao đổi yêu cầu ngay tại đây để có căn cứ khi cần phân xử.</p>}
        {entries.map(entry => entry.message
          ? <div key={entry.key} className={entry.message.mine ? "chat-row mine" : "chat-row"}>
              <div className="chat-bubble">
                {!entry.message.mine && <p className="chat-sender">{senderName(entry.message)}</p>}
                {entry.message.text && <p className="chat-text">{entry.message.text}</p>}
                {entry.message.file && <button type="button" className="chat-file" onClick={() => void download(entry.message!.file!)}><Icon name="upload" size={14} />{entry.message.file.fileName} · {sizeText(entry.message.file.length)}</button>}
                <time className="chat-time" dateTime={entry.message.createdAt}>{clock(entry.message.createdAt)}</time>
              </div>
            </div>
          : <p key={entry.key} className="chat-system">{entry.system}</p>)}
      </div>
      {hasNew && <button type="button" className="secondary compact-button chat-new" onClick={toBottom}>Có tin mới</button>}
    </div>
    {failure && <p className="banner" role="alert">{failure}</p>}
    {open
      ? <form className="chat-composer" onSubmit={submit}>
          <label className="sr-only" htmlFor="chat-input">Nội dung tin nhắn</label>
          <textarea id="chat-input" rows={2} maxLength={MAX_TEXT} value={text} placeholder="Nhập tin nhắn. Enter để gửi, Shift + Enter để xuống dòng." onChange={event => setText(event.target.value)} onKeyDown={onKeyDown} />
          <div className="chat-composer-actions">
            {canAttach && <label className={sending ? "button secondary compact-button is-disabled" : "button secondary compact-button"}>Đính kèm<input className="sr-only" type="file" accept=".png,.jpg,.jpeg,.pdf" disabled={sending} onChange={attach} /></label>}
            <button type="submit" className="compact-button" disabled={sending || !trimmed}>{sending ? "Đang gửi…" : "Gửi"}</button>
          </div>
        </form>
      : !chat.loading && !chat.error && <p className="muted">{view.syncStatus === "Archived" ? "Đơn thuộc deployment cũ. Cuộc trò chuyện chỉ còn để đọc." : readOnlyNote}</p>}
    {open && OFF_PLATFORM.test(text) && <p className="muted chat-hint">Giao dịch ngoài sàn sẽ không được ký quỹ bảo vệ.</p>}
    <p className="muted chat-hint">Tin nhắn không sửa hoặc xóa được, và sẽ là căn cứ khi có tranh chấp.</p>
  </section>;
}
