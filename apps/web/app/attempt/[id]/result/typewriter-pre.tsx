"use client";

import { useEffect, useMemo, useState } from "react";

export default function TypewriterPre(props: {
  text: string;
  minDurationMs?: number;
  maxDurationMs?: number;
  charMs?: number;
}) {
  const minDurationMs = useMemo(() => props.minDurationMs ?? 450, [props.minDurationMs]);
  const maxDurationMs = useMemo(() => props.maxDurationMs ?? 1800, [props.maxDurationMs]);
  const charMs = useMemo(() => props.charMs ?? 6, [props.charMs]);

  const fullText = props.text ?? "";
  const [shown, setShown] = useState("");

  useEffect(() => {
    setShown("");
    if (!fullText) return;

    const duration = Math.min(maxDurationMs, Math.max(minDurationMs, fullText.length * charMs));
    const start = performance.now();
    let raf = 0;

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const n = Math.max(1, Math.floor(t * fullText.length));
      setShown(fullText.slice(0, n));
      if (t < 1) raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [charMs, fullText, maxDurationMs, minDurationMs]);

  return <pre style={{ whiteSpace: "pre-wrap" }}>{shown}</pre>;
}

