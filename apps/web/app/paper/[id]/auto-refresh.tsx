"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getClientApiBaseUrl } from "../../lib/config";

type PaperEventPayload = {
  type?: string;
  paperId?: string;
  status?: string;
  error?: string | null;
  raw?: unknown;
};

const parsePayload = (data: any): PaperEventPayload | null => {
  if (!data) return null;
  if (typeof data === "string") {
    try {
      return JSON.parse(data) as PaperEventPayload;
    } catch {
      return { raw: data };
    }
  }
  if (typeof data === "object") return data as PaperEventPayload;
  return { raw: data };
};

export default function PaperAutoRefresh(props: { paperId: string; initialStatus?: string }) {
  const router = useRouter();
  const apiBase = useMemo(() => {
    return getClientApiBaseUrl();
  }, []);

  const [status, setStatus] = useState(props.initialStatus ?? "DRAFT");
  const [seconds, setSeconds] = useState(0);
  const [connected, setConnected] = useState(false);
  const [sseError, setSseError] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let es: EventSource | null = null;

    const handle = (payload: PaperEventPayload | null) => {
      const next = payload?.status ? String(payload.status) : "";
      if (!next) return;
      setStatus(next);

      if (next === "READY" || next === "FAILED") {
        // Re-fetch the server component data (questions / error).
        router.refresh();
        try {
          es?.close();
        } catch {
          // ignore
        }
      }
    };

    try {
      es = new EventSource(`${apiBase}/papers/${props.paperId}/events`);
      es.onopen = () => {
        setConnected(true);
        setSseError(null);
      };
      es.onerror = () => {
        // EventSource auto-reconnects; keep it simple and just reflect the state.
        setConnected(false);
      };
      es.addEventListener("snapshot", (ev: MessageEvent) => handle(parsePayload(ev.data)));
      es.addEventListener("update", (ev: MessageEvent) => handle(parsePayload(ev.data)));
      es.onmessage = (ev) => handle(parsePayload((ev as any)?.data));
    } catch (e) {
      setConnected(false);
      setSseError(e instanceof Error ? e.message : String(e));
    }

    return () => {
      try {
        es?.close();
      } catch {
        // ignore
      }
    };
  }, [apiBase, props.paperId, router]);

  const dots = ".".repeat((seconds % 3) + 1);

  return (
    <>
      <p className="muted" style={{ marginTop: 0, marginBottom: 0 }}>
        Paper is {status}. Generating questions{dots} (SSE: {connected ? "connected" : "disconnected"})
      </p>
      {sseError ? (
        <p style={{ color: "#b91c1c", marginTop: 10, marginBottom: 0 }}>Realtime error: {sseError}</p>
      ) : null}
      {seconds >= 16 ? (
        <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>
          Still waiting... If it never completes, make sure the worker is running (use `pnpm dev` at repo root) and Redis
          is up (`pnpm infra:up`).
        </p>
      ) : null}
    </>
  );
}
