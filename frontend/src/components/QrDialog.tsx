import { useEffect, useRef, type ReactNode } from "react";

type Props = {
  titleId: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
};

export default function QrDialog({ titleId, title, onClose, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.focus();
    function onKey(ev: KeyboardEvent) {
      if (ev.key !== "Escape") {
        return;
      }
      ev.preventDefault();
      ev.stopPropagation();
      closeRef.current();
    }
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      if (prev && document.contains(prev)) {
        prev.focus();
      }
    };
  }, []);

  return (
    <div className="modal-backdrop" role="presentation" onClick={() => closeRef.current()}>
      <div
        ref={ref}
        className="glass modal qr-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(ev) => ev.stopPropagation()}
      >
        <h3 id={titleId}>{title}</h3>
        {children}
      </div>
    </div>
  );
}
