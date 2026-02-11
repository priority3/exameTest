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
  try {
    const res = await fetch(`${API_BASE_URL}/sources`, { cache: "no-store" });
    if (res.ok) {
      const json = (await res.json()) as { items?: SourceListItem[] };
      sources = json.items ?? [];
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

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Import (Paste)</h2>
        <ImportSourceForm />
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
