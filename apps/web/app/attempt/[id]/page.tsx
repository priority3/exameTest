"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getClientApiBaseUrl } from "../../lib/config";

type AttemptPayload = {
  attempt: {
    id: string;
    paperId: string;
    status: string;
    error?: string | null;
    startedAt: string;
    submittedAt: string | null;
    gradedAt: string | null;
  };
  paper: { id: string; title: string; status: string };
  questions: Array<{
    id: string;
    type: "MCQ" | "SHORT_ANSWER";
    difficulty: number;
    prompt: string;
    options: Array<{ id: "A" | "B" | "C" | "D"; text: string }> | null;
    tags: string[];
  }>;
  answers: Array<{
    questionId: string;
    answerText: string | null;
    answerOptionId: string | null;
  }>;
};

type AnswerDraft = { optionId?: "A" | "B" | "C" | "D"; text?: string };

export default function AttemptPage() {
  const params = useParams();
  const idParam = (params as any)?.id as string | string[] | undefined;
  const id = Array.isArray(idParam) ? idParam[0] : idParam;
  const router = useRouter();
  const apiBase = useMemo(() => {
    return getClientApiBaseUrl();
  }, []);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<AttemptPayload | null>(null);
  const [draft, setDraft] = useState<Record<string, AnswerDraft>>({});

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        if (!id) {
          setError("Missing attempt id in route params.");
          return;
        }
        const res = await fetch(`${apiBase}/attempts/${id}`, { cache: "no-store" });
        const json = (await res.json()) as AttemptPayload | any;
        if (!res.ok) {
          setError(json?.error ? String(json.error) : `HTTP ${res.status}`);
          return;
        }
        if (cancelled) return;
        setPayload(json);

        const initDraft: Record<string, AnswerDraft> = {};
        for (const a of json.answers ?? []) {
          initDraft[a.questionId] = {
            optionId: (a.answerOptionId ?? undefined) as any,
            text: a.answerText ?? undefined
          };
        }
        setDraft(initDraft);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [apiBase, id]);

  const submit = async () => {
    if (!payload) return;
    setSubmitting(true);
    setError(null);
    try {
      const answers = payload.questions.map((q) => ({
        questionId: q.id,
        optionId: draft[q.id]?.optionId,
        text: draft[q.id]?.text
      }));

      const res = await fetch(`${apiBase}/attempts/${id}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answers })
      });
      const json = (await res.json()) as any;
      if (!res.ok) {
        setError(json?.error ? String(json.error) : `HTTP ${res.status}`);
        return;
      }
      router.push(`/attempt/${id}/result`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="card">
        <p className="muted">Loading attempt…</p>
      </div>
    );
  }

  if (error || !payload) {
    return (
      <div className="card">
        <h1 style={{ marginTop: 0 }}>Attempt</h1>
        <p style={{ color: "#b91c1c" }}>{error ?? "Unknown error"}</p>
        <p>
          <a href="/">Home</a>
        </p>
      </div>
    );
  }

  const { attempt, paper, questions } = payload;

  return (
    <>
      <div className="pill" style={{ marginBottom: 10 }}>
        <a href="/">Home</a>
        <span> / </span>
        <a href={`/paper/${paper.id}`}>Paper</a>
        <span> / </span>
        <span>Attempt</span>
      </div>

      <h1 style={{ margin: "0 0 6px" }}>{paper.title}</h1>
      <div className="pill">Attempt {attempt.status}</div>

      <div style={{ height: 18 }} />

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <h2 style={{ margin: 0 }}>Answer</h2>
          {attempt.status === "IN_PROGRESS" ? (
            <button disabled={submitting} onClick={submit}>
              {submitting ? "Submitting..." : "Submit"}
            </button>
          ) : (
            <a href={`/attempt/${id}/result`} className="pill">
              View Result
            </a>
          )}
        </div>

        {error ? <p style={{ color: "#b91c1c" }}>{error}</p> : null}

        <div style={{ height: 12 }} />

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {questions.map((q, idx) => (
            <div key={q.id} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12 }}>
              <div className="pill" style={{ marginBottom: 10 }}>
                Q{idx + 1} · {q.type} · D{q.difficulty}
              </div>

              <p style={{ marginTop: 0 }}>{q.prompt}</p>

              {q.type === "MCQ" && q.options ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {q.options.map((o) => (
                    <label
                      key={o.id}
                      style={{
                        display: "flex",
                        gap: 10,
                        alignItems: "center",
                        border: "1px solid var(--border)",
                        borderRadius: 12,
                        padding: "10px 12px",
                        margin: 0,
                        background: "rgba(255,255,255,0.55)"
                      }}
                    >
                      <input
                        type="radio"
                        name={q.id}
                        value={o.id}
                        checked={draft[q.id]?.optionId === o.id}
                        disabled={attempt.status !== "IN_PROGRESS"}
                        onChange={() =>
                          setDraft((d) => ({
                            ...d,
                            [q.id]: { ...(d[q.id] ?? {}), optionId: o.id }
                          }))
                        }
                      />
                      <strong style={{ minWidth: 22 }}>{o.id}</strong>
                      <span>{o.text}</span>
                    </label>
                  ))}
                </div>
              ) : null}

              {q.type === "SHORT_ANSWER" ? (
                <>
                  <label>Your answer</label>
                  <textarea
                    value={draft[q.id]?.text ?? ""}
                    disabled={attempt.status !== "IN_PROGRESS"}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        [q.id]: { ...(d[q.id] ?? {}), text: e.target.value }
                      }))
                    }
                    placeholder="Write your answer here…"
                  />
                </>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
