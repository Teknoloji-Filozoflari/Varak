import { useEffect } from "react";

export type ToastKind = "success" | "error" | "info";

export interface ToastState {
  kind: ToastKind;
  text: string;
}

interface Props {
  toast: ToastState | null;
  onClose: () => void;
  ms?: number;
}

export function Toast({ toast, onClose, ms = 4500 }: Props) {
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(onClose, ms);
    return () => window.clearTimeout(id);
  }, [toast, onClose, ms]);

  if (!toast) return null;

  return (
    <div className={`app-toast app-toast-${toast.kind}`} role="status" aria-live="polite">
      <span>{toast.text}</span>
      <button type="button" className="app-toast-close" onClick={onClose} aria-label="Kapat">
        ×
      </button>
    </div>
  );
}

export function formatInvokeError(err: unknown): string {
  if (err == null) return "Bilinmeyen hata";
  if (typeof err === "string") return err;
  if (typeof err === "object" && err !== null && "message" in err) {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === "string" && msg.trim()) return msg;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
