"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useMarketAuth } from "@/components/market-shell";
import { Button } from "@/components/ui/button";
import { errorText, getSupabase, imageExtension, invoke, MarketError, rpc } from "@/lib/marketplace";
import { statusText, type Refund, type SubOrder } from "./order-types";
import { useT } from "@/components/preferences";

type Viewer = "buyer" | "seller" | "admin";
type Message = { id: string; author_id: string; body: string; created_at: string };

export function RefundRequestForm({ order }: { order: SubOrder }) {
  const t = useT();
  const { session } = useMarketAuth();
  const cache = useQueryClient();
  const [opened, setOpened] = useState(false);
  const [reason, setReason] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [amount, setAmount] = useState("");
  const kind = order.status === "delivered" ? "return" : "cancel_before_shipping";
  const refundable = order.total_amount - order.refunded_amount;
  const create = useMutation({
    mutationFn: async () => {
      if (!session || !reason.trim()) throw new MarketError("INVALID_INPUT");
      if (files.length > 5 || files.some((file) => !imageExtension(file.type) || file.size > 20 * 1024 * 1024)) {
        throw new MarketError("INVALID_EVIDENCE");
      }
      const storage = getSupabase().storage.from("refund-evidence");
      const paths: string[] = [];
      try {
        for (const file of files) {
          const path = `${session.user.id}/${crypto.randomUUID()}.${imageExtension(file.type)}`;
          const { error } = await storage.upload(path, file, { contentType: file.type });
          if (error) throw error;
          paths.push(path);
        }
        await rpc("request_refund", { target_sub_order: order.id, request_kind: kind, request_reason: reason.trim(),
          requested_amount: kind === "return" && amount ? Number(amount) : null, evidence_paths: paths });
      } catch (error) {
        if (paths.length) await storage.remove(paths).catch(() => undefined);
        throw error;
      }
    },
    onSuccess: () => { setOpened(false); void cache.invalidateQueries({ queryKey: ["buyer-orders"] }); },
  });
  if (!["processing", "pending", "delivered"].includes(order.status) || (kind === "return" && refundable <= 0) ||
    order.refund_requests.some((claim) => claim.status !== "refunded" && claim.settlement_status !== "denied")) return null;
  if (!opened) return <Button variant="outline" onClick={() => setOpened(true)}>
    {kind === "return" ? t("Yêu cầu trả hàng / hoàn tiền") : t("Yêu cầu hủy trước khi giao")}
  </Button>;
  return <form className="market-form refund-form" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}>
    <label>{t("Lý do")}<textarea required maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
    {kind === "return" && <label>{t("Số tiền hoàn (đơn vị nhỏ nhất)")}<input type="number" min={1} max={refundable} step={1}
      value={amount} placeholder={String(refundable)} onChange={(event) => setAmount(event.target.value)} /></label>}
    <label>{t("Ảnh hoặc video bằng chứng (tối đa 5 tệp, 20 MB mỗi tệp)")}<input type="file" multiple accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
        onChange={(event) => setFiles(Array.from(event.target.files ?? []))} />
    </label>
    <div className="market-actions"><Button disabled={create.isPending}>{t("Gửi yêu cầu")}</Button>
      <Button type="button" variant="outline" onClick={() => setOpened(false)}>{t("Đóng")}</Button></div>
    {create.isError && <p role="alert">{t(errorText(create.error))}</p>}
  </form>;
}

export function RefundControls({ claim, currency, viewer }: { claim: Refund; currency: string; viewer: Viewer }) {
  const t = useT();
  const { session } = useMarketAuth();
  const cache = useQueryClient();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [evidence, setEvidence] = useState<Array<{ path: string; url: string }>>([]);
  const messages = useQuery({
    queryKey: ["dispute", claim.id, session?.user.id], enabled: open && Boolean(session),
    queryFn: async () => {
      const { data, error } = await getSupabase().from("dispute_messages").select("id,author_id,body,created_at")
        .eq("refund_request_id", claim.id).order("created_at").limit(200);
      if (error) throw error;
      return data as Message[];
    },
  });
  const send = useMutation({
    mutationFn: async () => {
      const { error } = await getSupabase().from("dispute_messages").insert({ refund_request_id: claim.id, body: text.trim() });
      if (error) throw error;
    },
    onSuccess: () => { setText(""); void messages.refetch(); },
  });
  const action = useMutation({
    mutationFn: async (action: "approve" | "reject" | "dispute" | "deny") => action === "approve"
      ? invoke<{ status: string }>("process-refund", { action, refund_request_id: claim.id }).then((result) => result.status)
      : rpc<string>("update_refund_dispute", { target_request: claim.id, action }),
    onSettled: () => {
      for (const name of ["buyer-orders", "seller-orders", "admin-disputes"]) void cache.invalidateQueries({ queryKey: [name] });
    },
  });
  const loadEvidence = useMutation({
    mutationFn: async () => Promise.all(claim.evidence_urls.map(async (path) => {
      const { data, error } = await getSupabase().storage.from("refund-evidence").createSignedUrl(path, 300);
      if (error) throw error;
      return { path, url: data.signedUrl };
    })),
    onSuccess: setEvidence,
  });
  const finished = claim.status === "refunded" || claim.settlement_status === "denied";
  const canApprove = (viewer === "seller" && ["requested", "seller_approved"].includes(claim.status))
    || (viewer === "admin" && (["disputed", "admin_resolved"].includes(claim.status)
      || claim.status === "seller_approved" && claim.settlement_status === "failed"));
  function sendMessage(event: FormEvent) {
    event.preventDefault();
    if (text.trim()) send.mutate();
  }
  return <details className="refund-details" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>{claim.kind === "return" ? t("Trả hàng") : t("Hủy trước khi giao")} · {t(statusText(claim.status))} · {t.money(claim.refund_amount, currency)}</summary>
    <p>{claim.reason}</p>
    {claim.settlement_status === "failed" && <p role="alert">{t("Stripe báo hoàn tiền thất bại. Có thể thử lại.")}</p>}
    {claim.settlement_status === "pending" && <p role="status">{t("Đang chờ Stripe xác nhận hoàn tiền.")}</p>}
    {claim.settlement_status === "denied" && <p>{t("Admin đã từ chối hoàn tiền.")}</p>}
    {claim.evidence_urls.length > 0 && <>
      <Button variant="outline" disabled={loadEvidence.isPending} onClick={() => loadEvidence.mutate()}>{t("Tải liên kết bằng chứng")}</Button>
      {loadEvidence.isError && <p role="alert">{t(errorText(loadEvidence.error))}</p>}
      {evidence.length > 0 && <ul>{evidence.map(({ path, url }, index) =>
        <li key={path}><a href={url} target="_blank" rel="noreferrer">{t("Bằng chứng") + " "}{index + 1}</a></li>)}</ul>}
    </>}
    {!finished && <div className="market-actions">
      {canApprove && <Button disabled={action.isPending} onClick={() => action.mutate("approve")}>
        {claim.settlement_status === "pending" ? t("Kiểm tra hoàn tiền") : claim.settlement_status === "failed" ? t("Thử hoàn tiền lại") : t("Duyệt hoàn tiền")}
      </Button>}
      {viewer === "seller" && claim.status === "requested" && <Button variant="outline" disabled={action.isPending} onClick={() => action.mutate("reject")}>{t("Từ chối")}</Button>}
      {viewer === "buyer" && claim.status === "seller_rejected" && <Button variant="outline" disabled={action.isPending} onClick={() => action.mutate("dispute")}>{t("Mở tranh chấp")}</Button>}
      {viewer === "admin" && claim.status === "disputed" && <Button variant="outline" disabled={action.isPending} onClick={() => action.mutate("deny")}>{t("Phán quyết từ chối")}</Button>}
    </div>}
    {action.isError && <p role="alert">{t(errorText(action.error))}</p>}
    {action.data === "failed" && <p role="alert">{t("Stripe chưa thể hoàn tiền. Vui lòng thử lại.")}</p>}
    <div className="dispute-thread">
      <h3>{t("Trao đổi")}</h3>
      {messages.isError && <p role="alert">{t(errorText(messages.error))}</p>}
      {messages.data?.length === 0 && <p>{t("Chưa có tin nhắn.")}</p>}
      <ul>{messages.data?.map((message) => <li key={message.id}>
        <span>{message.author_id === session?.user.id ? t("Bạn") : t("Bên tham gia")} · {new Date(message.created_at).toLocaleString(t.intl)}</span>
        <p>{message.body}</p>
      </li>)}</ul>
      {!finished && <form className="market-form" onSubmit={sendMessage}>
        <label>{t("Tin nhắn")}<textarea required maxLength={4000} value={text} onChange={(event) => setText(event.target.value)} /></label>
        <Button disabled={send.isPending}>{t("Gửi tin nhắn")}</Button>
        {send.isError && <p role="alert">{t(errorText(send.error))}</p>}
      </form>}
    </div>
  </details>;
}
