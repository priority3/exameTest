import { API_BASE_URL } from "../../lib/config";
import GeneratePaperForm from "./generate-paper-form";
import SourceAutoRefresh from "./auto-refresh";
import DeleteSourceButton from "./delete-source-button";

type SourceDetail = {
  id: string;
  type: string;
  title: string;
  status: string;
  error: string | null;
  counts?: { documents: number; chunks: number };
};

type SourcePreview = {
  sourceId: string;
  documents: Array<{
    id: string;
    docType: string;
    uri: string | null;
    meta: unknown;
    preview: string;
    bytes: number;
  }>;
};

export default async function SourcePage(props: { params: Promise<{ id: string }> }) {
  // Next.js 16 passes `params` as a Promise in Server Components.
  const { id } = await props.params;

  const [sourceRes, previewRes] = await Promise.all([
    fetch(`${API_BASE_URL}/sources/${id}`, { cache: "no-store" }),
    fetch(`${API_BASE_URL}/sources/${id}/preview`, { cache: "no-store" })
  ]);

  if (!sourceRes.ok) {
    return (
      <div className="card">
        <h1 style={{ marginTop: 0 }}>Source not found</h1>
        <p className="muted">id: {id}</p>
        <p>
          <a href="/">Back</a>
        </p>
      </div>
    );
  }

  const source = (await sourceRes.json()) as SourceDetail;
  const preview = previewRes.ok
    ? ((await previewRes.json()) as SourcePreview)
    : { sourceId: id, documents: [] };

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
        <div>
          <div className="pill" style={{ marginBottom: 10 }}>
            <a href="/">Home</a>
            <span> / </span>
            <span>Source</span>
          </div>
          <h1 style={{ margin: "0 0 6px" }}>{source.title}</h1>
          <div className="pill">
            {source.type} · {source.status} · docs {source.counts?.documents ?? "?"} · chunks{" "}
            {source.counts?.chunks ?? "?"}
          </div>
          {source.error ? (
            <p style={{ color: "#b91c1c", marginBottom: 0 }}>Error: {source.error}</p>
          ) : null}
        </div>

        <DeleteSourceButton sourceId={source.id} />
      </div>

      <div style={{ height: 18 }} />

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Preview</h2>

        {source.type === "GITHUB" ? (
          /* GitHub sources can have dozens of files — show a compact file
             list instead of dumping 800 chars per document. */
          <>
            <p className="muted" style={{ marginTop: 0 }}>
              {preview.documents.length} files fetched from repository
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {preview.documents.map((d) => {
                const meta = d.meta as Record<string, unknown> | null;
                const filePath = (meta?.path as string) ?? d.uri ?? d.id;
                const lang = (meta?.language as string) ?? "";
                return (
                  <div
                    key={d.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 10px",
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      background: "rgba(255,255,255,0.5)",
                      fontSize: "0.9em",
                    }}
                  >
                    <code style={{ wordBreak: "break-all" }}>{filePath}</code>
                    <span className="pill" style={{ flexShrink: 0 }}>
                      {lang ? `${lang} · ` : ""}{Math.round(d.bytes / 1024)} KB
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {preview.documents.map((d) => (
              <div key={d.id} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12 }}>
                <div className="pill" style={{ marginBottom: 10 }}>
                  {d.docType} · {Math.round(d.bytes / 1024)} KB
                </div>
                <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{d.preview}</pre>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ height: 18 }} />

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Generate Paper</h2>
        {source.status !== "READY" ? (
          source.status === "FAILED" ? (
            <p className="muted">Source processing failed. Fix the error and re-import the source.</p>
          ) : (
            <SourceAutoRefresh sourceId={source.id} initialStatus={source.status} />
          )
        ) : (
          <GeneratePaperForm sourceId={source.id} />
        )}
      </div>
    </>
  );
}
