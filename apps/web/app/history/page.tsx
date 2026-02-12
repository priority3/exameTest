import { API_BASE_URL } from "../lib/config";

type PaperListItem = {
  id: string;
  sourceId: string;
  title: string;
  status: string;
  error: string | null;
  createdAt: string;
  questionCount: number;
};

type AttemptListItem = {
  id: string;
  paperId: string;
  paperTitle: string;
  status: string;
  error: string | null;
  startedAt: string;
  submittedAt: string | null;
  gradedAt: string | null;
  totalQuestions: number;
  gradedQuestions: number;
  score: number;
  maxScore: number;
};

const fmt = (iso: string | null | undefined): string => {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString();
};

export default async function HistoryPage() {
  const [papersRes, attemptsRes] = await Promise.all([
    fetch(`${API_BASE_URL}/papers?limit=50`, { cache: "no-store" }),
    fetch(`${API_BASE_URL}/attempts?limit=50`, { cache: "no-store" })
  ]);

  const papersJson = papersRes.ok ? ((await papersRes.json()) as { items?: PaperListItem[] }) : { items: [] };
  const attemptsJson = attemptsRes.ok ? ((await attemptsRes.json()) as { items?: AttemptListItem[] }) : { items: [] };

  const papers = papersJson.items ?? [];
  const attempts = attemptsJson.items ?? [];

  return (
    <>
      <div className="pill" style={{ marginBottom: 10 }}>
        <a href="/">Home</a>
        <span> / </span>
        <span>History</span>
      </div>

      <h1 style={{ margin: "0 0 6px" }}>History</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Your generated papers and attempts.
      </p>

      <div className="card">
        <div className="row" style={{ alignItems: "baseline" }}>
          <h2 style={{ margin: 0 }}>Papers</h2>
          <span className="pill">{papers.length} items</span>
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
                  {p.status} · {p.questionCount} q · {fmt(p.createdAt)}
                </span>
              </a>
            ))}
          </div>
        )}
      </div>

      <div style={{ height: 18 }} />

      <div className="card">
        <div className="row" style={{ alignItems: "baseline" }}>
          <h2 style={{ margin: 0 }}>Attempts</h2>
          <span className="pill">{attempts.length} items</span>
        </div>

        {attempts.length === 0 ? (
          <p className="muted">No attempts yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
            {attempts.map((a) => {
              const href = a.status === "IN_PROGRESS" ? `/attempt/${a.id}` : `/attempt/${a.id}/result`;
              const progress =
                a.status === "IN_PROGRESS"
                  ? "in progress"
                  : a.status === "SUBMITTED"
                    ? `grading ${a.gradedQuestions}/${a.totalQuestions}`
                    : `${a.score}/${a.maxScore}`;

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
                    {a.status} · {progress} · {fmt(a.startedAt)}
                  </span>
                </a>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

