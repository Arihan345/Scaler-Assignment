"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { EmptyState } from "@/components/ui/EmptyState";

// On wide screens there is room for list + content, so open General straight away
// (like Signal Desktop). On mobile the section list is the landing page.
export default function SettingsHome() {
  const router = useRouter();
  useEffect(() => {
    if (window.matchMedia("(min-width: 761px)").matches) router.replace("/settings/devices");
  }, [router]);
  return <EmptyState title="Settings">Choose a section.</EmptyState>;
}
