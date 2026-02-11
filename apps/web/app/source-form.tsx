"use client";

import { useMemo, useState } from "react";

type ApiResponse = unknown;

export default function ImportSourceForm() {
  const apiBase = useMemo(() => {
    return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
  }, []);

  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch(`${apiBase}/sources`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "PASTE",
          title: title || undefined,
          text
        })
      });

      const json = (await res.json()) as ApiResponse;
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
      }
      setResult(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="row">
        <div>
          <label>Title (optional)</label>
          <input
            value={title}
            placeholder="e.g. Redis notes"
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
      </div>

      <label>Text</label>
      <textarea
        value={text}
        placeholder="Paste your article / notes here..."
        onChange={(e) => setText(e.target.value)}
      />

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12 }}>
        <button disabled={loading || text.trim().length === 0} onClick={submit}>
          {loading ? "Submitting..." : "Submit"}
        </button>
        <span className="muted">POST {apiBase}/sources</span>
      </div>

      {error ? (
        <p style={{ color: "#b91c1c" }}>{error}</p>
      ) : null}

      {result ? (
        <>
          <p className="muted">Response</p>
          <pre>{JSON.stringify(result, null, 2)}</pre>
          {"id" in (result as any) ? (
            <p style={{ marginBottom: 0 }}>
              <a href={`/source/${(result as any).id}`}>Open source</a>
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
