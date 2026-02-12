"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { API_BASE_URL } from "../../../lib/config";

type AttemptResult = {
  attempt: { id: string; paperId: string; status: string; error?: string | null; gradedAt: string | null };
  totals: { score: number; max: number };
  questions: Array<{
    id: string;
    type: string;
    prompt: string;
    options: Array<{ id: string; text: string }> | null;
    answerKey?: any;
    rubric?: any;
    tags?: string[];
  }>;
  answers: Array<{
    questionId: string;
    answerText: string | null;
    answerOptionId: string | null;
  }>;
  grades: Array<{
    questionId: string;
    // NOTE: pg NUMERIC often comes back as string in JSON.
    score: number | string;
    maxScore: number | string;
    feedbackMd: string;
    verdict: unknown;
    citations: string[];
    confidence: number | null;
  }>;
};

export default function AttemptResultPage() {
  const params = useParams();
  const idParam = (params as any)?.id as string | string[] | undefined;
  const id = Array.isArray(idParam) ? idParam[0] : idParam;

  const apiBase = useMemo(() => {
    return process.env.NEXT_PUBLIC_API_BASE_URL ?? API_BASE_URL;
  }, []);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [pollCount, setPollCount] = useState(0);
  const [mode, setMode] = useState<"sse" | "poll">("sse");

  useEffect(() => {
    if (!id) return;

    let cancelled = false;
    let pollTimer: any = null;
    let es: EventSource | null = null;

    const fetchOnce = async () => {
      try {
        const res = await fetch(`${apiBase}/attempts/${id}/result`, { cache: "no-store" });
        const json = (await res.json()) as any;
        if (!res.ok) {
          throw new Error(json?.error ? String(json.error) : `HTTP ${res.status}`);
        }
        if (cancelled) return;
        setResult(json as AttemptResult);
        setError(null);

        const status = String(json?.attempt?.status ?? "");
        const done = status === "GRADED" || Boolean(json?.attempt?.error);
        if (done) {
          if (pollTimer) clearInterval(pollTimer);
          pollTimer = null;
          try {
            es?.close();
          } catch {
            // ignore
          }
          es = null;
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const startPolling = () => {
      if (pollTimer) return;
      setMode("poll");
      pollTimer = setInterval(async () => {
        await fetchOnce();
        if (cancelled) return;
        setPollCount((c) => c + 1);
      }, 2000);
    };

    const parseEvent = (data: any): any => {
      if (!data) return null;
      if (typeof data === "string") {
        try {
          return JSON.parse(data);
        } catch {
          return { raw: data };
        }
      }
      return data;
    };

    const handleAttemptEvent = async (payload: any) => {
      const status = String(payload?.status ?? "");
      const hasErr = Boolean(payload?.error);

      // Re-fetch result whenever we hear something relevant.
      if (status || hasErr) {
        await fetchOnce();
      }

      if (status === "GRADED" || hasErr) {
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = null;
        try {
          es?.close();
        } catch {
          // ignore
        }
        es = null;
      }
    };

    // Fetch once immediately for first paint.
    fetchOnce();

    // Prefer SSE; fallback to polling if SSE fails.
    try {
      es = new EventSource(`${apiBase}/attempts/${id}/events`);
      es.onopen = () => {
        setMode("sse");
      };
      es.onerror = () => {
        try {
          es?.close();
        } catch {
          // ignore
        }
        es = null;
        startPolling();
      };
      es.addEventListener("snapshot", (ev: MessageEvent) => void handleAttemptEvent(parseEvent(ev.data)));
      es.addEventListener("update", (ev: MessageEvent) => void handleAttemptEvent(parseEvent(ev.data)));
      es.onmessage = (ev) => void handleAttemptEvent(parseEvent((ev as any)?.data));
    } catch {
      startPolling();
    }

    return () => {
      cancelled = true;
      if (pollTimer) clearInterval(pollTimer);
      try {
        es?.close();
      } catch {
        // ignore
      }
    };
  }, [apiBase, id]);

  if (!id) {
    return (
      <div className="card">
        <h1 style={{ marginTop: 0 }}>Result</h1>
        <p style={{ color: "#b91c1c" }}>Missing attempt id in route params.</p>
        <p>
          <a href="/">Home</a>
        </p>
      </div>
    );
  }

  if (loading && !result) {
    return (
      <div className="card">
        <p className="muted">Loading result…</p>
      </div>
    );
  }

  if (error && !result) {
    return (
      <div className="card">
        <h1 style={{ marginTop: 0 }}>Result</h1>
        <p style={{ color: "#b91c1c" }}>{error}</p>
        <p>
          <a href="/">Home</a>
        </p>
      </div>
    );
  }

  const safe = result;
  const gradeByQuestionId = new Map((safe?.grades ?? []).map((g) => [g.questionId, g]));
  const answerByQuestionId = new Map((safe?.answers ?? []).map((a) => [a.questionId, a]));

  return (
    <>
      <div className="pill" style={{ marginBottom: 10 }}>
        <a href="/">Home</a>
        <span> / </span>
        <a href={`/attempt/${id}`}>Attempt</a>
        <span> / </span>
        <span>Result</span>
      </div>

      <h1 style={{ margin: "0 0 6px" }}>Result</h1>
      <div className="pill">
        status {safe?.attempt.status ?? "?"} · total {safe?.totals.score ?? 0}/{safe?.totals.max ?? 0}
      </div>

      {error ? <p style={{ color: "#b91c1c" }}>Network error: {error}</p> : null}

      {safe?.attempt.error ? <p style={{ color: "#b91c1c" }}>Grading error: {safe.attempt.error}</p> : null}

      <div style={{ height: 18 }} />

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Review</h2>

        {safe?.attempt.error ? (
          <p className="muted">This attempt failed to grade. Fix the issue and resubmit (or re-run the job).</p>
        ) : safe?.attempt.status !== "GRADED" ? (
          <p className="muted">
            Grading is still running. This page updates automatically via {mode}. (status: {safe?.attempt.status ?? "?"})
          </p>
        ) : null}

        {safe?.attempt.status !== "GRADED" && pollCount >= 8 ? (
          <p className="muted">
            Still waiting… If it never completes, make sure the worker is running (use `pnpm dev` at repo root) and
            Redis is up (`pnpm infra:up`).
          </p>
        ) : null}

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {(safe?.questions ?? []).map((q, idx) => {
            const g = gradeByQuestionId.get(q.id);
            const a = answerByQuestionId.get(q.id);
            const qAnswerKey = (q as any)?.answerKey ?? {};
            const verdict = (g as any)?.verdict ?? {};

            const boxStyle: React.CSSProperties = {
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: 12,
              background: "rgba(255,255,255,0.55)"
            };
            return (
              <div key={q.id} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12 }}>
                <div className="pill" style={{ marginBottom: 10 }}>
                  Q{idx + 1} · {q.type} · {g ? `${g.score}/${g.maxScore}` : "pending"}
                </div>
                <p style={{ marginTop: 0 }}>{q.prompt}</p>

                {q.type === "MCQ" ? (
                  <p className="muted" style={{ marginTop: 0 }}>
                    your answer: <strong style={{ color: "var(--ink)" }}>{a?.answerOptionId ?? "-"}</strong> · correct:{" "}
                    <strong style={{ color: "var(--ink)" }}>{qAnswerKey?.correctOptionId ?? "-"}</strong>
                  </p>
                ) : null}

                {q.type === "SHORT_ANSWER" ? (
                  <>
                    <label>Your answer</label>
                    <div style={boxStyle}>
                      <div style={{ whiteSpace: "pre-wrap" }}>{a?.answerText?.trim() || "(empty)"}</div>
                    </div>

                    <div style={{ height: 10 }} />

                    <label>Reference answer</label>
                    <div style={boxStyle}>
                      <div style={{ whiteSpace: "pre-wrap" }}>{qAnswerKey?.referenceAnswer?.trim() || "(missing)"}</div>
                    </div>

                    {g && typeof verdict?.suggestedAnswer === "string" && verdict.suggestedAnswer.trim() ? (
                      <>
                        <div style={{ height: 10 }} />
                        <label>Suggested corrected answer</label>
                        <div style={boxStyle}>
                          <div style={{ whiteSpace: "pre-wrap" }}>{verdict.suggestedAnswer.trim()}</div>
                        </div>
                      </>
                    ) : null}
                  </>
                ) : null}

                {g ? (
                  <>
                    <label>Feedback</label>
                    <pre style={{ whiteSpace: "pre-wrap" }}>{g.feedbackMd}</pre>

                    {Array.isArray(verdict?.actionableSuggestions) && verdict.actionableSuggestions.length > 0 ? (
                      <>
                        <label>Actionable suggestions</label>
                        <div style={boxStyle}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            {verdict.actionableSuggestions.map((s: any, i: number) => (
                              <div key={i} className="muted" style={{ whiteSpace: "pre-wrap" }}>
                                - {String(s)}
                              </div>
                            ))}
                          </div>
                        </div>
                      </>
                    ) : null}

                    {Array.isArray(verdict?.missingPoints) && verdict.missingPoints.length > 0 ? (
                      <>
                        <label>Missing points</label>
                        <div style={boxStyle}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            {verdict.missingPoints.map((m: any, i: number) => (
                              <div key={i} className="muted" style={{ whiteSpace: "pre-wrap" }}>
                                - {String(m)}
                              </div>
                            ))}
                          </div>
                        </div>
                      </>
                    ) : null}

                    {Array.isArray(verdict?.misconceptions) && verdict.misconceptions.length > 0 ? (
                      <>
                        <label>Misconceptions</label>
                        <div style={boxStyle}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            {verdict.misconceptions.map((m: any, i: number) => (
                              <div key={i} className="muted" style={{ whiteSpace: "pre-wrap" }}>
                                - {String(m)}
                              </div>
                            ))}
                          </div>
                        </div>
                      </>
                    ) : null}

                    <p className="muted" style={{ marginBottom: 0 }}>
                      citations: {g.citations?.length ?? 0}
                    </p>
                  </>
                ) : (
                  <p className="muted">No grade yet.</p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
