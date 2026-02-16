"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getClientApiBaseUrl } from "../../lib/config";
import ConfirmDialog from "../../lib/confirm-dialog";

export default function DeleteAttemptButton(props: { attemptId: string }) {
  const router = useRouter();
  const apiBase = useMemo(() => getClientApiBaseUrl(), []);

  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const performDelete = useCallback(async () => {
    setShowConfirm(false);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/attempts/${props.attemptId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        // Reason: 204 has no body; only parse JSON on error responses.
        const json = (await res.json().catch(() => null)) as any;
        setError(json?.error ?? `HTTP ${res.status}`);
        return;
      }

      router.push("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [apiBase, props.attemptId, router]);

  return (
    <>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <button
          disabled={loading}
          onClick={() => setShowConfirm(true)}
          style={{ background: "#b91c1c", borderColor: "#b91c1c" }}
        >
          {loading ? "Deleting..." : "Delete Attempt"}
        </button>
        {error ? <span style={{ color: "#b91c1c" }}>{error}</span> : null}
      </div>

      <ConfirmDialog
        open={showConfirm}
        title="Delete Attempt"
        message="Are you sure? All answers and grades for this attempt will be permanently deleted."
        onConfirm={performDelete}
        onCancel={() => setShowConfirm(false)}
      />
    </>
  );
}
