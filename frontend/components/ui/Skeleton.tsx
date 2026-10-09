export function Skeleton({ w = "100%", h = 14, r = 6 }: { w?: number | string; h?: number; r?: number }) {
  return <span className="skeleton" style={{ width: w, height: h, borderRadius: r }} />;
}

export function ListSkeleton({ rows = 7 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading conversations">
      {Array.from({ length: rows }).map((_, i) => (
        <div className="conv-row conv-row--skeleton" key={i}>
          <Skeleton w={48} h={48} r={24} />
          <div style={{ flex: 1, display: "grid", gap: 8 }}>
            <Skeleton w="55%" />
            <Skeleton w="80%" h={12} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ThreadSkeleton() {
  const rows: [boolean, string][] = [[false, "46%"], [false, "30%"], [true, "38%"], [false, "52%"], [true, "28%"], [true, "44%"]];
  return (
    <div className="timeline__inner" aria-busy="true" aria-label="Loading messages">
      {rows.map(([out, w], i) => (
        <div key={i} className={`msg-row msg-row--${out ? "out" : "in"}`}>
          <Skeleton w={w} h={38} r={18} />
        </div>
      ))}
    </div>
  );
}
