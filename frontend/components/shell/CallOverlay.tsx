"use client";
import { Mic, MicOff, Phone, PhoneOff, Video, VideoOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { acceptCall, declineCall, hangUp, toggleCamera, toggleMute, useCall } from "@/lib/calls";
import { mmss } from "@/lib/format";
import { Avatar } from "@/components/ui/Avatar";

function StreamVideo({ stream, muted, className }: { stream: MediaStream | null; muted?: boolean; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (ref.current) ref.current.srcObject = stream; }, [stream]);
  return <video ref={ref} className={className} autoPlay playsInline muted={muted} />;
}

/** Incoming-call prompt and the in-call screen. Mounted once in the app shell. */
export function CallOverlay() {
  const c = useCall();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (c.phase !== "active") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [c.phase]);
  if (c.phase === "idle" || !c.peer) return null;
  const name = c.peer.display_name;
  const kind = c.video ? "Video call" : "Voice call";

  if (c.phase === "incoming") {
    return (
      <div className="call-incoming" role="alertdialog" aria-label={`Incoming ${kind.toLowerCase()} from ${name}`}>
        <Avatar id={c.peer.id} name={name} src={c.peer.avatar_url} size={56} />
        <div className="call-incoming__text"><b>{name}</b><span>Incoming {kind.toLowerCase()}…</span></div>
        <button className="call-btn call-btn--red" aria-label="Decline call" onClick={declineCall}><PhoneOff size={22} /></button>
        <button className="call-btn call-btn--green" aria-label="Accept call" onClick={() => void acceptCall()}>{c.video ? <Video size={22} /> : <Phone size={22} />}</button>
      </div>
    );
  }

  const status = c.phase === "outgoing" ? "Calling…" : c.phase === "connecting" ? "Connecting…" : mmss(((now - (c.startedAt ?? now)) / 1000));
  return (
    <div className="call-screen" role="dialog" aria-label={`${kind} with ${name}`}>
      {c.video && c.remote && c.phase === "active" ? <StreamVideo stream={c.remote} className="call-remote" /> : (
        <div className="call-avatar"><Avatar id={c.peer.id} name={name} src={c.peer.avatar_url} size={120} />{c.remote && <StreamVideo stream={c.remote} className="call-audio" />}</div>
      )}
      <div className="call-info"><b>{name}</b><span>{status}</span></div>
      {c.video && c.local && <StreamVideo stream={c.local} muted className={`call-local ${c.camOff ? "is-off" : ""}`} />}
      <div className="call-controls">
        <button className={`call-btn ${c.muted ? "is-on" : ""}`} aria-label={c.muted ? "Unmute microphone" : "Mute microphone"} onClick={toggleMute}>{c.muted ? <MicOff size={22} /> : <Mic size={22} />}</button>
        {c.video && <button className={`call-btn ${c.camOff ? "is-on" : ""}`} aria-label={c.camOff ? "Turn camera on" : "Turn camera off"} onClick={toggleCamera}>{c.camOff ? <VideoOff size={22} /> : <Video size={22} />}</button>}
        <button className="call-btn call-btn--red" aria-label="End call" onClick={hangUp}><PhoneOff size={22} /></button>
      </div>
    </div>
  );
}
