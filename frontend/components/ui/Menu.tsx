"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type MenuItem = {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  hidden?: boolean;
  separatorBefore?: boolean;
};

export function MenuPopup({
  x,
  y,
  alignRight,
  items,
  onClose,
}: {
  x: number;
  y: number;
  alignRight?: boolean;
  items: MenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    let left = alignRight ? x - width : x;
    let top = y;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    if (top + height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - height - 8);
    setPos({ left, top });
  }, [x, y, alignRight]);

  // Esc closes from anywhere; arrows move between items (focus starts on the first one).
  useEffect(() => {
    const items = () => Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("button[role=menuitem]") ?? []);
    items()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); onClose(); return; }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const list = items();
      const i = list.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.key === "ArrowDown" ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
      list[next]?.focus();
    };
    window.addEventListener("keydown", onKey, true); // capture: run before the global Esc shortcut
    return () => window.removeEventListener("keydown", onKey, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="menu-overlay"
      onMouseDown={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div
        ref={ref}
        className="menu"
        role="menu"
        style={pos}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        {items
          .filter((i) => !i.hidden)
          .map((item) => (
            <div key={item.label}>
              {item.separatorBefore && <div className="menu__sep" />}
              <button
                role="menuitem"
                className={`menu__item ${item.danger ? "is-danger" : ""}`}
                onClick={() => {
                  onClose();
                  item.onClick();
                }}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            </div>
          ))}
      </div>
    </div>
  );
}

/** Click-to-open dropdown anchored under its trigger. */
export function Menu({ trigger, items, align = "right" }: { trigger: React.ReactNode; items: MenuItem[]; align?: "left" | "right" }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  return (
    <>
      <span
        ref={ref}
        className="menu-trigger"
        onClick={(e) => {
          e.stopPropagation();
          const r = ref.current!.getBoundingClientRect();
          setAnchor({ x: align === "right" ? r.right : r.left, y: r.bottom + 4 });
        }}
      >
        {trigger}
      </span>
      {anchor && <MenuPopup x={anchor.x} y={anchor.y} alignRight={align === "right"} items={items} onClose={() => setAnchor(null)} />}
    </>
  );
}
