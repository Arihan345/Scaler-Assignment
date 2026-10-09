import { CircleDashed } from "lucide-react";

export default function StoriesHome() {
  return (
    <div className="welcome">
      <CircleDashed size={120} strokeWidth={1.6} strokeDasharray="4 5" />
      <h2>Stories</h2>
      <p>Share a text or photo update that disappears after 24 hours.</p>
    </div>
  );
}
