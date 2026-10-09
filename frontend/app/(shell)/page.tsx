import { Lock } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";

export default function HomePage() {
  return (
    <EmptyState icon={<Lock size={44} />} title="Signal">
      Select a chat to start messaging. Encryption is simulated in this demo.
    </EmptyState>
  );
}
