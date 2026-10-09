import { MessageCircle } from "lucide-react";

export default function HomePage() {
  return (
    <div className="welcome">
      <MessageCircle size={120} strokeWidth={1.6} strokeDasharray="4 5" />
      <h2>Welcome to Signal Clone</h2>
      <p>Select a chat, or start a new one with the compose button.</p>
      <footer>A demo project. Encryption and verification are simulated.</footer>
    </div>
  );
}
