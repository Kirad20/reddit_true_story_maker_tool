import { useEffect, useState } from "react";

type Toast = { id: number; text: string; kind: "ok" | "error" };
const EVENT = "tsm:toast";
let nextId = 1;

/** Non-blocking replacement for window.alert. */
export function toast(text: string, kind: Toast["kind"] = "ok") {
  window.dispatchEvent(new CustomEvent<Toast>(EVENT, { detail: { id: nextId++, text, kind } }));
}

export function Toasts() {
  const [items, setItems] = useState<Toast[]>([]);

  useEffect(() => {
    const onToast = (e: Event) => {
      const t = (e as CustomEvent<Toast>).detail;
      setItems((list) => [...list.slice(-3), t]);
      setTimeout(() => setItems((list) => list.filter((x) => x.id !== t.id)), t.kind === "error" ? 7000 : 3500);
    };
    window.addEventListener(EVENT, onToast);
    return () => window.removeEventListener(EVENT, onToast);
  }, []);

  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <span>{t.text}</span>
          <button aria-label="Cerrar" onClick={() => setItems((list) => list.filter((x) => x.id !== t.id))}>
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
