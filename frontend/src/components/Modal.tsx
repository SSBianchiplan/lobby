import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Modal sobre <dialog> nativo: `showModal()` dá camada superior, fundo escurecido, foco preso dentro,
 * Esc para fechar e devolve o foco a quem abriu. Clique no fundo também fecha.
 */
export function Modal({ open, onClose, title, children, footer, width = 560 }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: number;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="modal" style={{ width: `min(${width}px, calc(100vw - 24px))` }}
      onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} aria-labelledby="modal-title">
      {open && (
        <div className="modal-box">
          <header className="modal-head">
            <h2 id="modal-title" className="italic-title">{title}</h2>
            <button type="button" className="modal-x" onClick={onClose} aria-label="Fechar">✕</button>
          </header>
          <div className="modal-body">{children}</div>
          {footer && <footer className="modal-foot">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

type ConfirmOpts = { title: string; message?: ReactNode; confirmLabel?: string; cancelLabel?: string; danger?: boolean };
type Pending = ConfirmOpts & { resolve: (ok: boolean) => void };
const ConfirmCtx = createContext<((o: ConfirmOpts) => Promise<boolean>) | null>(null);

/** Confirmação com o visual do sistema, no lugar do window.confirm. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [p, setP] = useState<Pending | null>(null);
  const ask = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setP({ ...o, resolve })), []);
  const done = (ok: boolean) => { p?.resolve(ok); setP(null); };
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      <Modal open={!!p} onClose={() => done(false)} title={p?.title ?? ""} width={440}
        footer={<>
          <button type="button" className="btn btn-outline" onClick={() => done(false)}>{p?.cancelLabel ?? "Voltar"}</button>
          <button type="button" className={`btn ${p?.danger ? "btn-dark" : "btn-primary"}`} onClick={() => done(true)} autoFocus>{p?.confirmLabel ?? "Confirmar"}</button>
        </>}>
        {p?.message && <div style={{ fontSize: 15, fontWeight: 500, lineHeight: 1.5 }}>{p.message}</div>}
      </Modal>
    </ConfirmCtx.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmCtx);
  if (!ctx) throw new Error("useConfirm fora do ConfirmProvider");
  return ctx;
}
