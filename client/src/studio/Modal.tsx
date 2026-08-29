import { X } from "@phosphor-icons/react";
import { useEffect, useRef, type ReactNode } from "react";

/**
 * Shared dialog wrapper. Uses the native <dialog> element in modal mode, which
 * provides focus trapping, Escape-to-close, initial focus, and focus
 * restoration to the opener for free.
 */
export function Modal({
  label,
  kicker,
  title,
  subtitle,
  className,
  onClose,
  children,
  footer,
}: {
  label: string;
  kicker?: string;
  title: string;
  subtitle?: ReactNode;
  className?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      className={`modal ${className || ""}`}
      aria-label={label}
      onClose={onClose}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <header className="modal-header">
        <div>
          {kicker && <span className="kicker">{kicker}</span>}
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label={`Close ${label.toLowerCase()}`}
        >
          <X size={18} />
        </button>
      </header>
      <div className="modal-body">{children}</div>
      {footer && <footer className="modal-footer">{footer}</footer>}
    </dialog>
  );
}
