"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getClientApiBaseUrl } from "../../lib/config";

export default function GeneratePaperForm(props: { sourceId: string }) {
  const router = useRouter();
  const apiBase = useMemo(() => {
    return getClientApiBaseUrl();
  }, []);

  const [numQuestions, setNumQuestions] = useState(10);
  const [difficulty, setDifficulty] = useState(2);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/papers`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceId: props.sourceId,
          config: {
            language: "zh",
            numQuestions,
            difficulty,
            mix: { mcq: 60, shortAnswer: 40 }
          }
        })
      });

      const json = (await res.json()) as any;
      if (!res.ok) {
        setError(json?.error ? `${json.error}: ${json?.message ?? ""}` : `HTTP ${res.status}`);
        return;
      }

      router.push(`/paper/${json.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>
        Requires `OPENAI_API_KEY` for generation. If missing, paper will be marked FAILED in the API.
      </p>

      <div className="row">
        <div>
          <label>Num questions</label>
          <input
            type="number"
            min={5}
            max={50}
            value={numQuestions}
            onChange={(e) => setNumQuestions(Number(e.target.value))}
          />
        </div>

        <div>
          <label>Difficulty (1-3)</label>
          <input
            type="number"
            min={1}
            max={3}
            value={difficulty}
            onChange={(e) => setDifficulty(Number(e.target.value))}
          />
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12 }}>
        <button disabled={loading} onClick={submit}>
          {loading ? "Generating..." : "Generate"}
        </button>
        <span className="muted">POST {apiBase}/papers</span>
      </div>

      {error ? <p style={{ color: "#b91c1c" }}>{error}</p> : null}
    </div>
  );
}
