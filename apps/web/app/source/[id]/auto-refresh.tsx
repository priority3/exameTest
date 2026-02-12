"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export default function SourceAutoRefresh(props: { intervalMs?: number }) {
  const router = useRouter();
  const intervalMs = useMemo(() => props.intervalMs ?? 2000, [props.intervalMs]);
  const [ticks, setTicks] = useState(0);

  useEffect(() => {
    const t = setInterval(() => {
      setTicks((v) => v + 1);
      router.refresh();
    }, intervalMs);
    return () => clearInterval(t);
  }, [intervalMs, router]);

  const dots = ".".repeat((ticks % 3) + 1);
  const seconds = Math.round((ticks * intervalMs) / 1000);

  return (
    <>
      <p className="muted" style={{ marginTop: 0, marginBottom: 0 }}>
        Processing source{dots} This page updates automatically.
      </p>
      {seconds >= 16 ? (
        <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>
          Still waiting... If it never completes, make sure the worker is running (use `pnpm dev` at repo root) and
          Redis is up (`pnpm infra:up`).
        </p>
      ) : null}
    </>
  );
}

