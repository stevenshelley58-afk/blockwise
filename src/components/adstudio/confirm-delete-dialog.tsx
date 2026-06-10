"use client";

type ConfirmDeleteDialogProps = {
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmDeleteDialog({ onCancel, onConfirm }: ConfirmDeleteDialogProps) {
  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(15,23,42,.55)", display: "grid", placeItems: "center", padding: 24 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-delete-title"
    >
      <div style={{ background: "var(--surface, #fff)", borderRadius: 12, padding: "28px 32px", maxWidth: 420, width: "100%", boxShadow: "0 8px 32px rgba(0,0,0,.2)" }}>
        <h2 id="confirm-delete-title" style={{ margin: "0 0 8px", fontSize: 18 }}>Delete campaign?</h2>
        <p style={{ margin: "0 0 24px", color: "var(--text-2, #666)" }}>Are you sure? This cannot be undone.</p>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button className="button secondary" type="button" onClick={onCancel}>Cancel</button>
          <button className="button" type="button" onClick={onConfirm} style={{ background: "var(--destructive, #dc2626)", color: "#fff", borderColor: "transparent" }}>Delete campaign</button>
        </div>
      </div>
    </div>
  );
}
