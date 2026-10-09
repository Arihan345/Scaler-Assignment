import { Phone } from "lucide-react";

export default function CallsHome() {
  return (
    <div className="welcome welcome--quiet">
      <Phone size={44} strokeWidth={1.6} />
      <p>Click the new call button above the list to start a new voice or video call.</p>
    </div>
  );
}
