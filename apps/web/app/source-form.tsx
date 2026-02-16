"use client";

import { useMemo, useState } from "react";
import { getClientApiBaseUrl } from "./lib/config";

type ApiResponse = unknown;
type Tab = "paste" | "github";

export default function ImportSourceForm() {
  const apiBase = useMemo(() => {
    return getClientApiBaseUrl();
  }, []);

  const [tab, setTab] = useState<Tab>("paste");

  // --- Paste state ---
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");

  // --- GitHub state ---
  const [ghUrl, setGhUrl] = useState("");
  const [ghTitle, setGhTitle] = useState("");

  // --- Shared state ---
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resetResult = () => {
    setResult(null);
    setError(null);
  };

  const submitPaste = async () => {
    setLoading(true);
    resetResult();

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

  const submitGithub = async () => {
    setLoading(true);
    resetResult();

    try {
      const res = await fetch(`${apiBase}/sources`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "GITHUB",
          title: ghTitle || undefined,
          url: ghUrl
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

  const tabStyle = (t: Tab): React.CSSProperties => ({
    padding: "6px 16px",
    cursor: "pointer",
    borderBottom: tab === t ? "2px solid var(--fg, #111)" : "2px solid transparent",
    fontWeight: tab === t ? 650 : 400,
    background: "none",
    border: "none",
    borderBottomStyle: "solid",
    borderBottomWidth: 2,
    borderBottomColor: tab === t ? "var(--fg, #111)" : "transparent",
    fontSize: "inherit",
    color: "inherit"
  });

  return (
    <div>
      {/* Tab bar */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: "1px solid var(--border, #ddd)" }}>
        <button style={tabStyle("paste")} onClick={() => { setTab("paste"); resetResult(); }}>
          Paste
        </button>
        <button style={tabStyle("github")} onClick={() => { setTab("github"); resetResult(); }}>
          GitHub
        </button>
      </div>

      {/* Paste tab */}
      {tab === "paste" && (
        <>
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
            <button disabled={loading || text.trim().length === 0} onClick={submitPaste}>
              {loading ? "Submitting..." : "Submit"}
            </button>
            <span className="muted">POST {apiBase}/sources</span>
          </div>
        </>
      )}

      {/* GitHub tab */}
      {tab === "github" && (
        <>
          <div className="row">
            <div>
              <label>Title (optional)</label>
              <input
                value={ghTitle}
                placeholder="e.g. Vue Pinia"
                onChange={(e) => setGhTitle(e.target.value)}
              />
            </div>
          </div>

          <label>Repository URL</label>
          <input
            value={ghUrl}
            placeholder="https://github.com/owner/repo"
            onChange={(e) => setGhUrl(e.target.value)}
            style={{ width: "100%", boxSizing: "border-box" }}
          />
          <p className="muted" style={{ margin: "4px 0 0", fontSize: "0.85em" }}>
            Supports: github.com/owner/repo or github.com/owner/repo/tree/branch/subdir
          </p>

          <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12 }}>
            <button disabled={loading || ghUrl.trim().length === 0} onClick={submitGithub}>
              {loading ? "Fetching repo..." : "Import"}
            </button>
            <span className="muted">Public repos only</span>
          </div>
        </>
      )}

      {/* Shared result / error display */}
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
