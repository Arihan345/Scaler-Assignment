"use client";
import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { IconButton } from "./Button";

type Props = {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  variant?: "modal" | "drawer";
  width?: number;
};

export function Modal({ title, onClose, children, footer, variant = "modal", width = 440 }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey, true);
      prev?.focus?.();
    };
  }, [onClose]);

  return (
    <div className={`modal-backdrop modal-backdrop--${variant}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`modal modal--${variant}`}
        style={variant === "modal" ? { width } : undefined}
      >
        <div className="modal__header">
          <h2>{title}</h2>
          <IconButton label="Close" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </div>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__footer">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  danger,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopImmediatePropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog-card" role="alertdialog" aria-label={title}>
        <h2>{title}</h2>
        <p>{message}</p>
        <div className="dialog-card__actions">
          <button className="btn btn--secondary" autoFocus onClick={onClose}>Cancel</button>
          <button className={`btn btn--secondary ${danger ? "is-danger" : "is-primary"}`} onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
