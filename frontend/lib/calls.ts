"use client";
// 1:1 voice/video calls over WebRTC. The backend only relays signaling (invite/accept/offer/answer/ICE) through the
// existing WebSocket; media flows peer-to-peer. State lives in a small Zustand store so the overlay can render it.
import { create } from "zustand";
import type { User } from "./types";
import { useUi } from "@/store/ui";

export type CallPhase = "idle" | "outgoing" | "incoming" | "connecting" | "active";
type CallState = {
  phase: CallPhase;
  callId: string | null;
  conversationId: string | null;
  peer: User | null;
  video: boolean;
  muted: boolean;
  camOff: boolean;
  startedAt: number | null;
  local: MediaStream | null;
  remote: MediaStream | null;
};
const IDLE: CallState = { phase: "idle", callId: null, conversationId: null, peer: null, video: false, muted: false, camOff: false, startedAt: null, local: null, remote: null };
export const useCall = create<CallState>(() => IDLE);

// STUN only: works on the same network and most home NATs; strict corporate NATs would need a TURN server.
const ICE: RTCConfiguration = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

let send: (p: object) => void = () => {};
export const setCallSender = (fn: (p: object) => void) => { send = fn; };

let pc: RTCPeerConnection | null = null;
let pendingIce: RTCIceCandidateInit[] = [];
let ringTimer: ReturnType<typeof setInterval> | undefined;
let pendingConv: string | null = null; // outgoing call waiting for the server's call.ringing

// ---- ringtone (WebAudio, no asset)
function tone() {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    [480, 620].forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = f; g.gain.value = 0.08; o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.25); o.stop(ctx.currentTime + i * 0.25 + 0.2);
    });
    setTimeout(() => ctx.close(), 900);
  } catch { /* audio unavailable */ }
}
function startRing() { stopRing(); tone(); ringTimer = setInterval(tone, 2200); }
function stopRing() { if (ringTimer) clearInterval(ringTimer); ringTimer = undefined; }

async function getMedia(video: boolean): Promise<MediaStream | null> {
  if (!navigator.mediaDevices?.getUserMedia) { useUi.getState().toast("Calls need a secure origin (https or localhost).", "error"); return null; }
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: true, video });
  } catch {
    useUi.getState().toast(video ? "Camera or microphone permission was denied." : "Microphone permission was denied.", "error");
    return null;
  }
}

function cleanup() {
  stopRing();
  pc?.close(); pc = null; pendingIce = []; pendingConv = null;
  useCall.getState().local?.getTracks().forEach((t) => t.stop());
  useCall.setState(IDLE);
}

function makePc(callId: string) {
  const conn = new RTCPeerConnection(ICE);
  pc = conn;
  const remote = new MediaStream();
  useCall.setState({ remote });
  useCall.getState().local?.getTracks().forEach((t) => conn.addTrack(t, useCall.getState().local!));
  conn.onicecandidate = (e) => { if (e.candidate) send({ event: "call.signal", call_id: callId, data: { candidate: e.candidate.toJSON() } }); };
  conn.ontrack = (e) => { e.streams[0]?.getTracks().forEach((t) => remote.addTrack(t)); useCall.setState({ remote: new MediaStream(remote.getTracks()) }); };
  conn.onconnectionstatechange = () => {
    if (conn.connectionState === "connected" && useCall.getState().phase !== "active") useCall.setState({ phase: "active", startedAt: Date.now() });
    if (conn.connectionState === "failed") { useUi.getState().toast("Call connection failed.", "error"); hangUp(); }
  };
  return conn;
}

// ---- user actions
export async function startCall(conversationId: string, peer: User, video: boolean) {
  if (useCall.getState().phase !== "idle") return;
  const local = await getMedia(video);
  if (!local) return;
  pendingConv = conversationId;
  useCall.setState({ ...IDLE, phase: "outgoing", conversationId, peer, video, local });
  send({ event: "call.invite", conversation_id: conversationId, video });
}

export async function acceptCall() {
  const s = useCall.getState();
  if (s.phase !== "incoming" || !s.callId) return;
  stopRing();
  const local = await getMedia(s.video);
  if (!local) return declineCall();
  useCall.setState({ phase: "connecting", local });
  makePc(s.callId);
  send({ event: "call.accept", call_id: s.callId });
}

export function declineCall() {
  const s = useCall.getState();
  if (s.callId) send({ event: "call.decline", call_id: s.callId });
  cleanup();
}

export function hangUp() {
  const s = useCall.getState();
  if (s.callId) send({ event: "call.end", call_id: s.callId });
  cleanup();
}

export function toggleMute() {
  const s = useCall.getState();
  s.local?.getAudioTracks().forEach((t) => (t.enabled = s.muted));
  useCall.setState({ muted: !s.muted });
}
export function toggleCamera() {
  const s = useCall.getState();
  s.local?.getVideoTracks().forEach((t) => (t.enabled = s.camOff));
  useCall.setState({ camOff: !s.camOff });
}

// ---- server events
const REASONS: Record<string, string> = { declined: "Call declined", missed: "No answer", busy: "They're on another call", unavailable: "They're offline right now" };

export async function handleCallEvent(event: string, p: Record<string, any>, convId: string | null) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const s = useCall.getState();
  switch (event) {
    case "call.incoming":
      if (s.phase !== "idle") return;
      useCall.setState({ ...IDLE, phase: "incoming", callId: p.call_id, conversationId: convId, peer: p.caller, video: !!p.video });
      startRing();
      if (document.visibilityState !== "visible" && typeof Notification !== "undefined" && Notification.permission === "granted") {
        try { new Notification(`${p.caller?.display_name ?? "Someone"} is calling`, { body: p.video ? "Video call" : "Voice call", tag: "call" }); } catch { /* ignore */ }
      }
      break;
    case "call.ringing":
      if (s.phase === "outgoing" && pendingConv === convId) useCall.setState({ callId: p.call_id });
      break;
    case "call.accepted": {
      if (s.phase !== "outgoing" || s.callId !== p.call_id) return;
      useCall.setState({ phase: "connecting" });
      const conn = makePc(p.call_id);
      const offer = await conn.createOffer();
      await conn.setLocalDescription(offer);
      send({ event: "call.signal", call_id: p.call_id, data: { sdp: conn.localDescription } });
      break;
    }
    case "call.signal": {
      if (!pc || s.callId !== p.call_id) return;
      const d = p.data ?? {};
      if (d.sdp) {
        await pc.setRemoteDescription(d.sdp);
        for (const c of pendingIce.splice(0)) await pc.addIceCandidate(c).catch(() => {});
        if (d.sdp.type === "offer") {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          send({ event: "call.signal", call_id: p.call_id, data: { sdp: pc.localDescription } });
        }
      } else if (d.candidate) {
        if (pc.remoteDescription) await pc.addIceCandidate(d.candidate).catch(() => {});
        else pendingIce.push(d.candidate);
      }
      break;
    }
    case "call.ended": {
      // an invite that failed immediately has a call_id we never saw; treat it as ending our outgoing attempt
      const mine = s.callId === p.call_id || (s.phase === "outgoing" && !s.callId);
      if (!mine || s.phase === "idle") return;
      const reason: string = p.reason ?? "";
      if (reason.startsWith("error:")) useUi.getState().toast(reason.slice(6), "error");
      else if (s.phase !== "active" && s.phase !== "connecting" && REASONS[reason] && s.phase === "outgoing") useUi.getState().toast(REASONS[reason], "info");
      cleanup();
      break;
    }
  }
}
