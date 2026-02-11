import { API_BASE_URL } from "../../lib/config";
import StartAttemptButton from "./start-attempt";

type PaperDetail = {
  id: string;
  title: string;
  status: string;
  error: string | null;
  questions: Array<{
    id: string;
    type: string;
    difficulty: number;
    prompt: string;
    options: Array<{ id: string; text: string }> | null;
    tags: string[];
  }>;
};

export default async function PaperPage(props: { params: Promise<{ id: string }> }) {
  // Next.js 16 passes `params` as a Promise in Server Components.
  const { id } = await props.params;

  const res = await fetch(`${API_BASE_URL}/papers/${id}`, { cache: "no-store" });
  if (!res.ok) {
    return (
      <div className="card">
        <h1 style={{ marginTop: 0 }}>Paper not found</h1>
        <p className="muted">id: {id}</p>
        <p>
          <a href="/">Back</a>
        </p>
      </div>
    );
  }

  const paper = (await res.json()) as PaperDetail;

  return (
    <>
      <div className="pill" style={{ marginBottom: 10 }}>
        <a href="/">Home</a>
        <span> / </span>
        <span>Paper</span>
      </div>

      <h1 style={{ margin: "0 0 6px" }}>{paper.title}</h1>
      <div className="pill">
        {paper.status} · {paper.questions.length} questions
      </div>

      {paper.error ? <p style={{ color: "#b91c1c" }}>Error: {paper.error}</p> : null}

      <div style={{ height: 18 }} />

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Questions</h2>
        {paper.status !== "READY" ? (
          <p className="muted">Paper is {paper.status}. Refresh to see questions when it becomes READY.</p>
        ) : (
          <>
            <StartAttemptButton paperId={paper.id} />
            <div style={{ height: 12 }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {paper.questions.map((q, idx) => (
                <div key={q.id} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12 }}>
                  <div className="pill" style={{ marginBottom: 10 }}>
                    Q{idx + 1} · {q.type} · D{q.difficulty}
                  </div>
                  <p style={{ marginTop: 0 }}>{q.prompt}</p>
                  {q.type === "MCQ" && q.options ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {q.options.map((o) => (
                        <div key={o.id} className="pill">
                          <strong style={{ color: "var(--ink)" }}>{o.id}</strong>
                          <span>{o.text}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
