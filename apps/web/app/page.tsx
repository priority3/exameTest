import ImportSourceForm from "./source-form";
import { API_BASE_URL } from "./lib/config";

type SourceListItem = {
  id: string;
  type: string;
  title: string;
  status: string;
  createdAt: string;
};

export default async function Page() {
  let sources: SourceListItem[] = [];
  let papers: Array<{ id: string; title: string; status: string; questionCount: number; createdAt: string }> = [];
  let attempts: Array<{
    id: string;
    paperTitle: string;
    status: string;
    startedAt: string;
    gradedQuestions: number;
    totalQuestions: number;
    score: number;
    maxScore: number;
  }> = [];

  try {
    const [sourcesRes, papersRes, attemptsRes] = await Promise.all([
      fetch(`${API_BASE_URL}/sources`, { cache: "no-store" }),
      fetch(`${API_BASE_URL}/papers?limit=8`, { cache: "no-store" }),
      fetch(`${API_BASE_URL}/attempts?limit=8`, { cache: "no-store" })
    ]);

    if (sourcesRes.ok) {
      const json = (await sourcesRes.json()) as { items?: SourceListItem[] };
      sources = json.items ?? [];
    }

    if (papersRes.ok) {
      const json = (await papersRes.json()) as { items?: any[] };
      papers = (json.items ?? []).map((p) => ({
        id: String(p.id),
        title: String(p.title),
        status: String(p.status),
        questionCount: Number(p.questionCount ?? 0),
        createdAt: String(p.createdAt)
      }));
    }

    if (attemptsRes.ok) {
      const json = (await attemptsRes.json()) as { items?: any[] };
      attempts = (json.items ?? []).map((a) => ({
        id: String(a.id),
        paperTitle: String(a.paperTitle ?? "Paper"),
        status: String(a.status),
        startedAt: String(a.startedAt),
        gradedQuestions: Number(a.gradedQuestions ?? 0),
        totalQuestions: Number(a.totalQuestions ?? 0),
        score: Number(a.score ?? 0),
        maxScore: Number(a.maxScore ?? 0)
      }));
    }
  } catch {
    // ignore fetch errors for now
  }

  return (
    <>
      <h1 style={{ margin: "0 0 8px" }}>exameTest</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        MVP: paste / upload content -&gt; generate paper -&gt; attempt -&gt; grade
      </p>

      <div className="pill" style={{ marginBottom: 12 }}>
        <a href="/history">History</a>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Import Source</h2>
        <ImportSourceForm />
      </div>

      <div style={{ height: 18 }} />

      <div className="card">
        <div className="row" style={{ alignItems: "baseline" }}>
          <h2 style={{ margin: 0 }}>Recent Papers</h2>
          <a href="/history" className="pill">
            View all
          </a>
        </div>

        {papers.length === 0 ? (
          <p className="muted">No papers yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
            {papers.map((p) => (
              <a
                key={p.id}
                href={`/paper/${p.id}`}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: 10,
                  borderRadius: 12,
                  border: "1px solid var(--border)",
                  background: "rgba(255,255,255,0.7)"
                }}
              >
                <span style={{ fontWeight: 650 }}>{p.title}</span>
                <span className="pill">
                  {p.status} · {p.questionCount} q
                </span>
              </a>
            ))}
          </div>
        )}
      </div>

      <div style={{ height: 18 }} />

      <div className="card">
        <div className="row" style={{ alignItems: "baseline" }}>
          <h2 style={{ margin: 0 }}>Recent Attempts</h2>
          <a href="/history" className="pill">
            View all
          </a>
        </div>

        {attempts.length === 0 ? (
          <p className="muted">No attempts yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
            {attempts.map((a) => {
              const href = a.status === "IN_PROGRESS" ? `/attempt/${a.id}` : `/attempt/${a.id}/result`;
              const right =
                a.status === "GRADED"
                  ? `${a.score}/${a.maxScore}`
                  : a.status === "SUBMITTED"
                    ? `grading ${a.gradedQuestions}/${a.totalQuestions}`
                    : "in progress";
              return (
                <a
                  key={a.id}
                  href={href}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: 10,
                    borderRadius: 12,
                    border: "1px solid var(--border)",
                    background: "rgba(255,255,255,0.7)"
                  }}
                >
                  <span style={{ fontWeight: 650 }}>{a.paperTitle}</span>
                  <span className="pill">
                    {a.status} · {right}
                  </span>
                </a>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ height: 18 }} />

      <div className="card">
        <div className="row" style={{ alignItems: "baseline" }}>
          <h2 style={{ margin: 0 }}>Recent Sources</h2>
          <span className="pill">{sources.length} items</span>
        </div>

        {sources.length === 0 ? (
          <p className="muted">No sources yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
            {sources.map((s) => (
              <a
                key={s.id}
                href={`/source/${s.id}`}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: 10,
                  borderRadius: 12,
                  border: "1px solid var(--border)",
                  background: "rgba(255,255,255,0.7)"
                }}
              >
                <span style={{ fontWeight: 650 }}>{s.title}</span>
                <span className="pill">
                  {s.type} · {s.status}
                </span>
              </a>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
