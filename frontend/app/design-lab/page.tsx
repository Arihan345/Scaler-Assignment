"use client";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Toggle } from "@/components/ui/Toggle";

/** Visual QA page: tokens and primitives side by side, used to tune against Signal screenshots. */
export default function DesignLab() {
  return (
    <main style={{ padding: 24, display: "grid", gap: 20, maxWidth: 720 }}>
      <h1>Design lab</h1>
      <div style={{ display: "flex", gap: 10 }}>
        <Button variant="primary">Primary</Button><Button>Secondary</Button><Button variant="danger">Danger</Button><Toggle label="demo" checked onChange={() => {}} />
      </div>
      <div style={{ display: "flex", gap: 10 }}>{["Priya Sharma", "Rohan Mehta", "Ananya"].map((n) => <Avatar key={n} id={n} name={n} />)}</div>
      <div style={{ display: "grid", gap: 6 }}>
        <div className="bubble bubble--in" style={{ justifySelf: "start" }}>Incoming message</div>
        <div className="bubble bubble--out" style={{ justifySelf: "end" }}>Outgoing message</div>
      </div>
    </main>
  );
}
