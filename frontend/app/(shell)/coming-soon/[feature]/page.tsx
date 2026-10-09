"use client";
import { Circle, Monitor } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { EmptyState } from "@/components/ui/EmptyState";

const FEATURES: Record<string, { title: string; icon: React.ReactNode; text: string }> = {
  stories: { title: "Stories", icon: <Circle size={44} />, text: "Stories are not part of this demo." },
  "linked-devices": { title: "Linked devices", icon: <Monitor size={44} />, text: "Linking other devices is not part of this demo." },
};

export default function ComingSoon() {
  const { feature } = useParams<{ feature: string }>();
  const f = FEATURES[feature] ?? { title: "Coming soon", icon: null, text: "This feature is not available yet." };
  return (
    <EmptyState icon={f.icon} title={`${f.title}: coming soon`}>
      {f.text} <br /><Link href="/">Back to chats</Link>
    </EmptyState>
  );
}
