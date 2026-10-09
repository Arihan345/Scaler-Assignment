"use client";
import { mockSafetyNumber } from "@/lib/format";
import { Modal } from "@/components/ui/Modal";

export function SafetyNumber({ a, b, name, onClose }: { a: string; b: string; name: string; onClose: () => void }) {
  return (
    <Modal title="Safety number" onClose={onClose}>
      <p className="muted" style={{ marginTop: 0 }}>In real Signal, comparing this number with {name} confirms your chat is end-to-end encrypted.</p>
      <div className="safety">{mockSafetyNumber(a, b).map((g, i) => <span key={i}>{g}</span>)}</div>
      <div className="demo-hint">Demo only: this number is derived from user IDs and is not a real cryptographic fingerprint.</div>
    </Modal>
  );
}
