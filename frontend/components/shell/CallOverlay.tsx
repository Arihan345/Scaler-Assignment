"use client";
import { Mic, MicOff, Phone, PhoneOff, Video, VideoOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { acceptCall, declineCall, hangUp, toggleCamera, toggleMute, useCall } from "@/lib/calls";
import { mmss } from "@/lib/format";
import { useAuth } from "@/store/auth";
import { Avatar } from "@/components/ui/Avatar";

function StreamVideo({ stream, muted, className }: { stream: MediaStream | null; muted?: boolean; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (ref.current) ref.current.srcObject = stream; }, [stream]);
  return <video ref={ref} className={className} autoPlay playsInline muted={muted} />;
}

/** Incoming-call prompt and the in-call screen. Mounted once in the app shell. */
export function CallOverlay() {
  const c = useCall();
  const me = useAuth((s) => s.user)!;
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
        <Avatar id={c.peer.id} name={name} src={c.peer.avatar_url} size={44} />
        <div className="call-incoming__text"><b>{name}</b><span>Incoming {kind.toLowerCase()}</span></div>
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
      {c.video && c.local && <StreamVideo stream={c.local} muted className={`call-local ${c.camOff ? "is-off" : ""}`} />}
      {!c.video && <div className="call-self"><Avatar id={me.id} name={me.display_name} src={me.avatar_url} size={44} />{c.muted && <MicOff size={14} className="call-self__off" />}</div>}
      <div className="call-bar">
        <div className="call-bar__who"><b>{name}</b><span>{status}</span></div>
        <div className="call-bar__btns">
          <button className={`call-btn call-btn--sm ${c.camOff || !c.video ? "is-on" : ""}`} title={c.camOff || !c.video ? "Turn camera on" : "Turn camera off"} aria-label={c.camOff ? "Turn camera on" : "Turn camera off"} onClick={toggleCamera} disabled={!c.video}>{c.camOff || !c.video ? <VideoOff size={20} /> : <Video size={20} />}</button>
          <button className={`call-btn call-btn--sm ${c.muted ? "is-on" : ""}`} title={c.muted ? "Unmute" : "Mute"} aria-label={c.muted ? "Unmute microphone" : "Mute microphone"} onClick={toggleMute}>{c.muted ? <MicOff size={20} /> : <Mic size={20} />}</button>
        </div>
        <button className="call-end" aria-label="End call" onClick={hangUp}>End</button>
      </div>
    </div>
  );
}
