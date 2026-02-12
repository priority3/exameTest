"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getClientApiBaseUrl } from "../../lib/config";

export default function StartAttemptButton(props: { paperId: string }) {
  const router = useRouter();
  const apiBase = useMemo(() => {
    return getClientApiBaseUrl();
  }, []);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/attempts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paperId: props.paperId })
      });
      const json = (await res.json()) as any;
      if (!res.ok) {
        setError(json?.error ? `${json.error}` : `HTTP ${res.status}`);
        return;
      }
      router.push(`/attempt/${json.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <button disabled={loading} onClick={start}>
        {loading ? "Starting..." : "Start Attempt"}
      </button>
      {error ? <span style={{ color: "#b91c1c" }}>{error}</span> : null}
    </div>
  );
}
