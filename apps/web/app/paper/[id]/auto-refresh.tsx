"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

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
    return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
  }, []);

  const [status, setStatus] = useState(props.initialStatus ?? "DRAFT");
  const [seconds, setSeconds] = useState(0);
  const [mode, setMode] = useState<"sse" | "poll">("sse");
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let es: EventSource | null = null;
    let pollTimer: any = null;

    const stopPolling = () => {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
    };

    const startPolling = () => {
      if (pollTimer) return;
      setMode("poll");
      pollTimer = setInterval(() => router.refresh(), 2000);
    };

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
        stopPolling();
      }
    };

    try {
      es = new EventSource(`${apiBase}/papers/${props.paperId}/events`);
      es.onopen = () => {
        setConnected(true);
        setMode("sse");
      };
      es.onerror = () => {
        setConnected(false);
        try {
          es?.close();
        } catch {
          // ignore
        }
        es = null;
        startPolling();
      };
      es.addEventListener("snapshot", (ev: MessageEvent) => handle(parsePayload(ev.data)));
      es.addEventListener("update", (ev: MessageEvent) => handle(parsePayload(ev.data)));
      es.onmessage = (ev) => handle(parsePayload((ev as any)?.data));
    } catch {
      startPolling();
    }

    return () => {
      try {
        es?.close();
      } catch {
        // ignore
      }
      stopPolling();
    };
  }, [apiBase, props.paperId, router]);

  const dots = ".".repeat((seconds % 3) + 1);

  return (
    <>
      <p className="muted" style={{ marginTop: 0, marginBottom: 0 }}>
        Paper is {status}. Generating questions{dots} (updates via {mode}
        {mode === "sse" ? (connected ? "" : ", reconnecting") : ""})
      </p>
      {seconds >= 16 ? (
        <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>
          Still waiting... If it never completes, make sure the worker is running (use `pnpm dev` at repo root) and Redis
          is up (`pnpm infra:up`).
        </p>
      ) : null}
    </>
  );
}
