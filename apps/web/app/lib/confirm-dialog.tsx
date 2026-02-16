"use client";

import { useCallback, useEffect, useRef } from "react";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "确认删除",
  cancelLabel = "取消",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Reason: Focus the cancel button on open so the user doesn't accidentally
  // press Enter to confirm; Escape closes the dialog.
  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onCancel]);

  // Prevent body scroll while dialog is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div style={styles.backdrop} onClick={onCancel}>
      <div
        style={styles.dialog}
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-msg"
      >
        <h3 id="confirm-dialog-title" style={styles.title}>
          {title}
        </h3>
        <p id="confirm-dialog-msg" style={styles.message}>
          {message}
        </p>
        <div style={styles.actions}>
          <button style={styles.cancelBtn} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button ref={confirmRef} style={styles.confirmBtn} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 9999,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(11, 16, 32, 0.35)",
    backdropFilter: "blur(4px)",
    animation: "confirmFadeIn 0.15s ease-out",
  },
  dialog: {
    background: "var(--card, #fff)",
    border: "1px solid var(--border)",
    borderRadius: 16,
    padding: "24px 28px",
    maxWidth: 400,
    width: "calc(100% - 40px)",
    boxShadow: "0 20px 60px rgba(2, 6, 23, 0.18)",
    animation: "confirmSlideUp 0.18s ease-out",
  },
  title: {
    margin: "0 0 8px",
    fontSize: 17,
    letterSpacing: "-0.02em",
  },
  message: {
    margin: "0 0 20px",
    fontSize: 14,
    lineHeight: 1.6,
    color: "var(--muted)",
  },
  actions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 10,
  },
  cancelBtn: {
    background: "transparent",
    color: "var(--ink)",
    border: "1px solid var(--border)",
    borderRadius: 10,
    padding: "8px 16px",
    fontSize: 14,
    cursor: "pointer",
  },
  confirmBtn: {
    background: "#b91c1c",
    color: "#fff",
    border: 0,
    borderRadius: 10,
    padding: "8px 16px",
    fontSize: 14,
    cursor: "pointer",
  },
};
