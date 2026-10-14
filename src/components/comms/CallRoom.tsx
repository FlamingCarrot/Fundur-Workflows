"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Captions,
  CaptionsOff,
  Hand,
  LayoutGrid,
  MessageSquare,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  Pin,
  PinOff,
  Radio,
  Smile,
  Sparkles,
  UserMinus,
  Users,
  Video,
  VideoOff,
  X,
} from "lucide-react";
import type { ChannelList, CommsBackend, JoinResult } from "@/lib/comms/client";
import {
  BuiltinCall,
  CallRecorder,
  LiveCaptions,
  canBlur,
  captionsSupported,
  liveKitCall,
  setBlur,
  SpeakingMeter,
  listDevices,
  openLocalMedia,
  recordingType,
  type CallEngine,
  type Devices,
  type LocalMedia,
  type Quality,
} from "@/lib/comms/call-engine";
import { CALL_REACTIONS, type Consent, type HostAction, type Meeting, type Peer, type PeerState, type TranscriptLine } from "@/lib/comms/types";
import { ThreadView } from "./Conversations";
import "./comms.css";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

/** One person's picture (or their initials when the camera is off), with their sound. */
function Tile({
  stream,
  name,
  self,
  showVideo,
  screen,
  state,
  note,
  className,
  version,
  talking,
  reaction,
  pinned,
  onPin,
  sinkId,
}: {
  stream: MediaStream | null;
  name: string;
  self?: boolean;
  showVideo: boolean;
  screen?: boolean;
  state?: PeerState;
  note?: string;
  className?: string;
  version: number;
  talking?: boolean;
  reaction?: string;
  pinned?: boolean;
  onPin?: () => void;
  /** The speaker picked in the lobby. */
  sinkId?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (v.srcObject !== stream) v.srcObject = stream;
    if (stream) v.play().catch(() => undefined);
  }, [stream, version]);
  useEffect(() => {
    const v = ref.current as (HTMLVideoElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (v && sinkId && !self) v.setSinkId?.(sinkId).catch(() => undefined);
  }, [sinkId, self]);
  return (
    <div className={`call-tile ${className ?? ""}`} data-self={self ? "true" : undefined} data-screen={screen ? "true" : undefined} data-talking={talking ? "true" : undefined}>
      {/* The element stays even with the camera off: it carries the person's sound. */}
      <video ref={ref} autoPlay playsInline muted={self} style={{ visibility: showVideo ? "visible" : "hidden" }} />
      {!showVideo && <span className="call-initials">{initials(name)}</span>}
      <span className="call-name">
        {state && !state.mic && <MicOff size={13} aria-label="Muted" />}
        {state?.hand && <Hand size={13} aria-label="Hand raised" />}
        <span className="truncate">{self && name !== "You" ? `${name} (you)` : name}</span>
      </span>
      {note && <span className="call-state">{note}</span>}
      {reaction && (
        <span className="call-reaction" key={reaction} aria-live="polite">
          {reaction.split(":")[0]}
        </span>
      )}
      {onPin && (
        <button type="button" className="call-pin" aria-label={pinned ? `Unpin ${name}` : `Pin ${name}`} aria-pressed={pinned} onClick={onPin}>
          {pinned ? <PinOff size={15} /> : <Pin size={15} />}
        </button>
      )}
    </div>
  );
}

const DEVICES_KEY = "fundur.call.devices";
type DeviceChoice = { micId?: string; camId?: string; speakerId?: string; view?: "grid" | "speaker" };
function readChoice(): DeviceChoice {
  try {
    return JSON.parse(localStorage.getItem(DEVICES_KEY) ?? "{}") as DeviceChoice;
  } catch {
    return {};
  }
}
function keepChoice(c: DeviceChoice) {
  try {
    localStorage.setItem(DEVICES_KEY, JSON.stringify(c));
  } catch {
    /* Only the choice is lost. */
  }
}

function DevicePicker({ devices, choice, onChoice }: { devices: Devices; choice: DeviceChoice; onChoice: (c: DeviceChoice) => void }) {
  const select = (label: string, list: MediaDeviceInfo[], value: string | undefined, set: (id: string) => void) =>
    list.length > 1 && (
      <label className="call-device">
        <span className="tiny">{label}</span>
        <select value={value ?? ""} onChange={(e) => set(e.target.value)}>
          <option value="">Default</option>
          {list.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `${label} ${i + 1}`}
            </option>
          ))}
        </select>
      </label>
    );
  return (
    <div className="stack" style={{ gap: "0.45rem" }}>
      {select("Microphone", devices.mics, choice.micId, (micId) => onChoice({ ...choice, micId: micId || undefined }))}
      {select("Camera", devices.cams, choice.camId, (camId) => onChoice({ ...choice, camId: camId || undefined }))}
      {select("Speaker", devices.speakers, choice.speakerId, (speakerId) => onChoice({ ...choice, speakerId: speakerId || undefined }))}
    </div>
  );
}

function CallButton({
  label,
  onClick,
  pressed,
  on,
  children,
  className,
  disabled,
}: {
  label: string;
  onClick: () => void;
  pressed?: boolean;
  on?: boolean;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button type="button" className={`call-btn ${className ?? ""}`} aria-pressed={pressed} data-on={on ? "true" : undefined} onClick={onClick} disabled={disabled} title={label}>
      <span>{children}</span>
      <span>{label}</span>
    </button>
  );
}

type Phase = "lobby" | "joining" | "waiting" | "in" | "leaving";

/**
 * A meeting's video call: a lobby to check the camera and microphone, then the
 * call itself, full screen. Anyone in the studio can record; everyone in the
 * call is asked to agree first, and people who do not agree are kept out of
 * the recording and the transcript.
 */
export function CallRoom({
  backend,
  meeting: initial,
  onClose,
}: {
  backend: CommsBackend;
  meeting: Meeting;
  /** Called after leaving, with whether the call ended for everyone. */
  onClose: (ended: boolean) => void;
}) {
  const team = backend.audience === "team";
  const [phase, setPhase] = useState<Phase>("lobby");
  const [media, setMedia] = useState<LocalMedia | null>(null);
  const [wantMic, setWantMic] = useState(true);
  const [wantCam, setWantCam] = useState(true);
  const [meeting, setMeeting] = useState(initial);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [consents, setConsents] = useState<Consent[]>([]);
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [interim, setInterim] = useState("");
  const [state, setState] = useState<PeerState>({ mic: true, cam: true, screen: false, hand: false });
  const [problem, setProblem] = useState("");
  const [note, setNote] = useState("");
  const [side, setSide] = useState<"chat" | "people" | null>(null);
  const [showCaptions, setShowCaptions] = useState(true);
  const [version, setVersion] = useState(0);
  const [chatList, setChatList] = useState<ChannelList | null>(null);
  const [me, setMe] = useState<{ peerId: string; key: string; name: string } | null>(null);
  const [choice, setChoiceState] = useState<DeviceChoice>(() => (typeof window === "undefined" ? {} : readChoice()));
  const setChoice = (c: DeviceChoice) => {
    setChoiceState(c);
    keepChoice(c);
  };
  const [devices, setDevices] = useState<Devices>({ mics: [], cams: [], speakers: [] });
  const [talking, setTalking] = useState<string[]>([]);
  const [waiting, setWaiting] = useState<{ id: string; name: string }[]>([]);
  const [quality, setQuality] = useState<Map<string, Quality>>(new Map());
  const [offline, setOffline] = useState(false);
  const [blur, setBlurOn] = useState(false);
  const mutedAt = useRef<string | null>(null);
  const [lastSpeaker, setLastSpeaker] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [reacting, setReacting] = useState(false);
  // When each person's latest reaction was first seen here, so clocks on other devices don't matter.
  const seenReactions = useRef(new Map<string, { at: number; seen: number }>());
  const [, setClockTick] = useState(0);
  const engine = useRef<CallEngine | null>(null);
  const recorder = useRef<CallRecorder | null>(null);
  const captions = useRef<LiveCaptions | null>(null);
  const captionQueue = useRef<{ atMs: number; text: string }[]>([]);
  const cursor = useRef({ signal: 0, line: 0 });
  const stateRef = useRef(state);
  stateRef.current = state;
  const rerender = useCallback(() => setVersion((v) => v + 1), []);

  // The lobby's preview: the camera and microphone picked (the defaults at first), opened again when the choice changes.
  const micId = choice.micId;
  const camId = choice.camId;
  useEffect(() => {
    if (phase !== "lobby") return;
    let cancelled = false;
    let opened: LocalMedia | null = null;
    void openLocalMedia({ mic: true, cam: true, micId, camId }).then(async (m) => {
      opened = m;
      if (cancelled) {
        m.stream.getTracks().forEach((t) => t.stop());
        return;
      }
      setMedia((old) => {
        if (old && old !== m) old.stream.getTracks().forEach((t) => t.stop());
        return m;
      });
      setWantCam((w) => w && m.cam);
      setWantMic((w) => w && m.mic);
      setProblem(m.problem);
      // Device names are only given once the browser was allowed to use them.
      setDevices(await listDevices());
    });
    return () => {
      cancelled = true;
      void opened;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [micId, camId]);

  // The preview follows the lobby's switches.
  useEffect(() => {
    if (phase !== "lobby" || !media) return;
    media.stream.getAudioTracks().forEach((t) => (t.enabled = wantMic));
    media.stream.getVideoTracks().forEach((t) => (t.enabled = wantCam));
  }, [phase, media, wantMic, wantCam]);

  const stopEverything = useCallback(() => {
    captions.current?.stop();
    captions.current = null;
    engine.current?.close();
    engine.current = null;
    media?.stream.getTracks().forEach((t) => t.stop());
  }, [media]);

  // Leaving the page without the Leave button still lets go of the camera.
  useEffect(() => () => stopEverything(), [stopEverything]);

  const join = async () => {
    if (!media) return;
    setPhase("joining");
    setProblem("");
    const peerId = crypto.randomUUID();
    // A camera switched off in the lobby is let go, so its light goes out.
    if (!wantCam)
      media.stream.getVideoTracks().forEach((t) => {
        t.stop();
        media.stream.removeTrack(t);
      });
    const first: PeerState = { mic: wantMic && media.mic, cam: wantCam && media.cam, screen: false, hand: false };
    try {
      const joined = await backend.join(initial.id, peerId, first);
      setMeeting(joined.meeting);
      setMe({ peerId, key: joined.peer.personKey, name: joined.peer.name });
      if (!joined.join) {
        // The mic and camera are settled as they were when knocking.
        stateRef.current = first;
        setState(first);
        setPhase("waiting");
        return;
      }
      await enter(joined, peerId, first);
    } catch (err) {
      setPhase("lobby");
      setProblem(err instanceof Error ? err.message : "Could not join the call. Please retry.");
    }
  };

  /** Into the call proper, once there is a way in (straight away, or after waiting to be let in). */
  const enter = async (joined: JoinResult, peerId: string, first: PeerState) => {
    if (!media || !joined.join) return;
    let e: CallEngine;
    if (joined.join.provider === "livekit") e = await liveKitCall(joined.join, media, rerender);
    else e = new BuiltinCall(peerId, joined.join.iceServers, media.stream, (to, payloads) => backend.room(initial.id, { action: "signal", peerId, to, payloads }).then(() => undefined), rerender);
    e.setMic(first.mic);
    e.camId = camId ?? null;
    engine.current = e;
    setState(first);
    setPhase("in");
    // Keep a phone's screen awake during the call.
    (navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<unknown> } }).wakeLock?.request("screen").catch(() => undefined);
  };

  /** Taken out of the call, or not let in: back to the lobby with the reason. */
  const putOut = (reason: string) => {
    captions.current?.stop();
    captions.current = null;
    engine.current?.close();
    engine.current = null;
    setPeers([]);
    setWaiting([]);
    setMe(null);
    setPhase("lobby");
    setProblem(reason);
  };

  const myConsent = me ? consents.find((c) => c.personKey === me.key) : undefined;
  const recordingHere = meeting.recording === "on";
  const iRecord = !!recorder.current;

  // Hearing from the call about once a second: who is here, their handshakes, agreement and captions.
  useEffect(() => {
    if ((phase !== "in" && phase !== "waiting") || !me) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    const tick = async () => {
      try {
        const snap = await backend.room(initial.id, { action: "poll", peerId: me.peerId, state: stateRef.current, afterSignal: cursor.current.signal, afterLine: cursor.current.line });
        failures = 0;
        if (stopped) return;
        if (phase === "waiting") {
          setMeeting(snap.meeting);
          if (snap.meeting.status === "ended") return putOut("The call ended before you were let in.");
          if (snap.you?.admitted) {
            const joined = await backend.join(initial.id, me.peerId, stateRef.current);
            if (!stopped) await enter(joined, me.peerId, stateRef.current);
            return;
          }
          timer = setTimeout(tick, 1500);
          return;
        }
        // Someone in the studio muted this person: the mic goes off, and they can turn it on again.
        const muted = snap.you?.mutedAt ?? null;
        if (muted && muted !== mutedAt.current && stateRef.current.mic) {
          setMic(false);
          setNote("Someone in the studio muted you. Unmute when you want to speak.");
        } else setNote("");
        mutedAt.current = muted;
        setWaiting(snap.waiting ?? []);
        setMeeting(snap.meeting);
        setPeers(snap.peers);
        setConsents(snap.consents);
        engine.current?.sync(snap.peers);
        for (const s of snap.signals) {
          cursor.current.signal = Math.max(cursor.current.signal, s.id);
          await engine.current?.signal(s.from, s.payload);
        }
        if (snap.lines.length) {
          cursor.current.line = Math.max(cursor.current.line, ...snap.lines.map((l) => Number(l.id) || 0));
          setLines((old) => [...old, ...snap.lines].slice(-200));
        }
        if (snap.meeting.status === "ended") {
          setNote("The call was ended.");
          void leave(false);
          return;
        }
      } catch (err) {
        failures += 1;
        const status = (err as { status?: number }).status;
        if (status === 403) return putOut(err instanceof Error ? err.message : "You are no longer in this call.");
        // Dropped from the call (a long sleep or a lost connection): join again with the same id.
        if (status === 409) {
          await backend.join(initial.id, me.peerId, stateRef.current).catch(() => undefined);
        } else if (failures > 2) setNote("Reconnecting…");
      }
      if (!stopped) timer = setTimeout(tick, 1000);
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, me, backend, initial.id]);

  // How each connection is doing, every few seconds, and whether this device lost the internet.
  useEffect(() => {
    if (phase !== "in") return;
    const timer = setInterval(() => {
      void engine.current?.quality?.().then(setQuality).catch(() => undefined);
    }, 4000);
    const down = () => setOffline(true);
    const up = () => setOffline(false);
    window.addEventListener("offline", down);
    window.addEventListener("online", up);
    return () => {
      clearInterval(timer);
      window.removeEventListener("offline", down);
      window.removeEventListener("online", up);
    };
  }, [phase]);

  // The camera's own background blur follows the switch, also after the camera is turned off and on.
  useEffect(() => {
    const track = engine.current?.local.getVideoTracks()[0];
    if (phase === "in" && track && !state.screen && canBlur(track)) void setBlur(track, blur);
  }, [phase, blur, state.cam, state.screen, version]);

  // The recording mixes the sound of everyone who agreed, and no one else.
  useEffect(() => {
    const rec = recorder.current;
    const e = engine.current;
    if (!rec || !e || !me) return;
    const agreed = new Set(consents.filter((c) => c.decision === "given").map((c) => c.personKey));
    const streams = [...(agreed.has(me.key) ? [e.local] : [])];
    for (const p of peers) if (p.id !== me.peerId && agreed.has(p.personKey)) streams.push(e.remote.get(p.id) ?? new MediaStream());
    rec.mix(streams);
  }, [consents, peers, version, me]);

  // Live captions of my own speech, while transcription is on and I agreed.
  useEffect(() => {
    const wanted = phase === "in" && meeting.recording === "on" && meeting.captions && myConsent?.decision === "given" && state.mic && captionsSupported();
    if (wanted && !captions.current) {
      const since = Date.parse(meeting.startedAt ?? new Date().toISOString());
      captions.current = new LiveCaptions(since, (text, atMs) => captionQueue.current.push({ text, atMs: Math.max(0, atMs) }), setInterim);
      captions.current.start();
    } else if (!wanted && captions.current) {
      captions.current.stop();
      captions.current = null;
    }
  }, [phase, meeting.recording, meeting.captions, meeting.startedAt, myConsent?.decision, state.mic]);

  // Captions go to the transcript in small batches.
  useEffect(() => {
    if (phase !== "in" || !me) return;
    const t = setInterval(() => {
      const batch = captionQueue.current.splice(0, 20);
      if (batch.length) backend.room(initial.id, { action: "caption", peerId: me.peerId, lines: batch }).catch(() => undefined);
    }, 2500);
    return () => clearInterval(t);
  }, [phase, me, backend, initial.id]);

  const finishRecording = async () => {
    const rec = recorder.current;
    if (!rec) return;
    recorder.current = null;
    setNote("Saving the recording…");
    const { blob, durationSec } = await rec.stop();
    if (blob.size > 0) {
      try {
        await backend.saveRecording(initial.id, blob, durationSec);
        setNote(backend.mode === "server" ? "The recording was saved. Its transcript and notes follow shortly." : "The recording is kept on this page until you leave it.");
      } catch (err) {
        setNote(err instanceof Error ? `The recording was not saved: ${err.message}` : "The recording was not saved.");
      }
    }
  };

  // Warn before closing the tab while this browser holds the recording.
  useEffect(() => {
    if (!iRecord) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [iRecord]);

  const toggleRecording = async () => {
    if (!me) return;
    const turnOn = meeting.recording !== "on";
    if (turnOn && !recordingType()) {
      setNote("This browser cannot record. Try Chrome, Edge or Safari.");
      return;
    }
    try {
      const res = (await backend.room(initial.id, { action: "record", peerId: me.peerId, on: turnOn, captions: captionsSupported() || backend.mode === "server" })) as unknown as { meeting?: Meeting };
      if (res.meeting) setMeeting(res.meeting);
      if (turnOn) {
        recorder.current = new CallRecorder();
        setConsents((c) => [...c.filter((x) => x.personKey !== me.key), { personKey: me.key, name: me.name, decision: "given", decidedAt: new Date().toISOString() }]);
        rerender();
      } else await finishRecording();
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Recording did not start.");
    }
  };

  const decide = async (decision: "given" | "declined") => {
    if (!me) return;
    setConsents((c) => [...c.filter((x) => x.personKey !== me.key), { personKey: me.key, name: me.name, decision, decidedAt: new Date().toISOString() }]);
    await backend.room(initial.id, { action: "consent", decision }).catch(() => setNote("Your answer did not reach the call. It will be asked again."));
  };

  async function leave(endForAll: boolean) {
    if (phase === "leaving") return;
    setPhase("leaving");
    await finishRecording();
    const flush = captionQueue.current.splice(0, 20);
    let ended = false;
    if (me) {
      if (flush.length) await backend.room(initial.id, { action: "caption", peerId: me.peerId, lines: flush }).catch(() => undefined);
      const res = await backend.room(initial.id, { action: endForAll ? "end" : "leave", peerId: me.peerId }).catch(() => null);
      ended = !!res?.ended;
    }
    stopEverything();
    onClose(ended || endForAll);
  }

  const host = (what: HostAction, target?: string) => {
    if (!me) return;
    backend
      .room(initial.id, { action: "host", peerId: me.peerId, what, target })
      .then(() => what === "admit" || what === "decline" ? setWaiting((w) => w.filter((x) => x.id !== target)) : undefined)
      .catch((err) => setNote(err instanceof Error ? err.message : "That did not reach the call. Please retry."));
  };

  function setMic(on: boolean) {
    engine.current?.setMic(on);
    setState((s) => ({ ...s, mic: on }));
  }
  const setCam = async (on: boolean) => {
    const ok = await engine.current?.setCam(on);
    if (ok === false) setNote("The camera could not be used.");
    else setState((s) => ({ ...s, cam: on }));
  };
  const share = async (on: boolean) => {
    const ok = await engine.current?.shareScreen(on);
    if (on && ok === false) setNote("Screen sharing was not started.");
    setState((s) => ({ ...s, screen: !!engine.current?.screen }));
  };
  // The screen share can be stopped from the browser's own bar too.
  useEffect(() => {
    if (engine.current && state.screen !== engine.current.screen) setState((s) => ({ ...s, screen: !!engine.current?.screen }));
  }, [version, state.screen]);

  const openChat = async () => {
    setSide((s) => (s === "chat" ? null : "chat"));
    if (!chatList) setChatList(await backend.channels().catch(() => null));
  };

  const others = useMemo(() => (me ? peers.filter((p) => p.id !== me.peerId) : []), [peers, me]);

  // Who is talking, a few times a second.
  useEffect(() => {
    if (phase !== "in" || !me) return;
    const meter = new SpeakingMeter();
    const t = setInterval(() => {
      const e = engine.current;
      if (!e) return;
      const streams = new Map<string, MediaStream>([[me.peerId, e.local], ...e.remote]);
      meter.watch(streams);
      const now = meter.speaking();
      setTalking((old) => (old.join() === now.join() ? old : now));
      if (now[0]) setLastSpeaker(now[0]);
    }, 300);
    return () => {
      clearInterval(t);
      meter.close();
    };
  }, [phase, me]);

  // Reactions fade after a few seconds.
  useEffect(() => {
    if (phase !== "in") return;
    const t = setInterval(() => setClockTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);
  const reactionOf = (id: string, st: PeerState): string | undefined => {
    if (!st.reaction) return undefined;
    const seen = seenReactions.current.get(id);
    if (!seen || seen.at !== st.reaction.at) seenReactions.current.set(id, { at: st.reaction.at, seen: Date.now() });
    const shownSince = seenReactions.current.get(id)!.seen;
    return Date.now() - shownSince < 4000 ? `${st.reaction.emoji}:${st.reaction.at}` : undefined;
  };
  const sendReaction = (emoji: (typeof CALL_REACTIONS)[number]) => {
    setReacting(false);
    setState((st) => ({ ...st, reaction: { emoji, at: Date.now() } }));
  };
  const setView = (view: "grid" | "speaker") => setChoice({ ...choice, view });
  const recent = lines.filter((l) => l.source === "live").slice(-2);
  const canShare = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia;

  if (phase === "lobby" || phase === "joining" || phase === "waiting")
    return (
      <div className="call" role="dialog" aria-modal="true" aria-label={`Join ${meeting.title}`}>
        <div className="call-top">
          <h1 className="truncate">{meeting.title}</h1>
          <button type="button" className="icon-btn" aria-label="Close" style={{ color: "#f3f2ec" }} onClick={() => (stopEverything(), onClose(false))}>
            <X size={20} />
          </button>
        </div>
        <div className="call-lobby">
          <Tile stream={media?.stream ?? null} name="You" self showVideo={!!media?.cam && wantCam} version={version} />
          <div className="stack" style={{ gap: "0.9rem" }}>
            <div>
              <h2 style={{ fontSize: "1.4rem", margin: 0 }}>{phase === "waiting" ? "Waiting to be let in" : "Ready to join?"}</h2>
              <p className="small" style={{ color: "#b9b7b0", marginTop: "0.3rem" }} aria-live="polite">
                {phase === "waiting"
                  ? meeting.inCall > 0
                    ? "The studio knows you are here and will let you in shortly."
                    : "Nobody from the studio is in the call yet. You will be let in when they join."
                  : meeting.inCall > 0 ? `${meeting.inCall} ${meeting.inCall === 1 ? "person is" : "people are"} in the call.` : "Nobody is in the call yet."}
                {backend.mode === "demo" && " In the demo you are alone in the call: sign in to call your team and clients."}
              </p>
            </div>
            {!media && <p className="small">Asking for your camera and microphone…</p>}
            {problem && <p className="call-note" style={{ margin: 0 }}>{problem}</p>}
            {phase !== "waiting" && (
              <div className="row" style={{ gap: "0.6rem" }}>
              <CallButton label={wantMic ? "Mic on" : "Mic off"} pressed={wantMic} onClick={() => setWantMic(!wantMic)} disabled={!media?.mic && !wantMic}>
                {wantMic ? <Mic size={20} /> : <MicOff size={20} />}
              </CallButton>
              <CallButton label={wantCam ? "Camera on" : "Camera off"} pressed={wantCam} onClick={() => setWantCam(!wantCam)} disabled={!media?.cam}>
                {wantCam ? <Video size={20} /> : <VideoOff size={20} />}
              </CallButton>
            </div>
            )}
            {media && phase !== "waiting" && <DevicePicker devices={devices} choice={choice} onChoice={setChoice} />}
            {phase === "waiting" ? (
              <button type="button" className="btn btn-secondary btn-lg" onClick={() => void leave(false)}>
                <PhoneOff size={18} /> Stop waiting
              </button>
            ) : (
              <button type="button" className="btn btn-accent btn-lg" disabled={!media || phase === "joining"} onClick={() => void join()}>
                <Video size={18} /> {phase === "joining" ? "Joining…" : "Join the call"}
              </button>
            )}
            {meeting.recording === "on" && <p className="tiny" style={{ color: "#b9b7b0" }}>This call is being recorded. You will be asked whether you agree when you join.</p>}
          </div>
        </div>
        <div />
      </div>
    );

  const e = engine.current;
  const peerNote = (p: Peer) => {
    const s = e?.status.get(p.id);
    if (s && s !== "connected" && s !== "completed") return s === "failed" ? "Connection lost" : "Connecting…";
    return quality.get(p.id) === "poor" ? "Weak connection" : undefined;
  };
  const pin = (id: string) => setPinned((p) => (p === id ? null : id));
  const tileOf = (p: Peer, className?: string) => (
    <Tile
      key={p.id}
      stream={e?.remote.get(p.id) ?? null}
      name={p.name}
      state={p.state}
      showVideo={p.state.cam || p.state.screen}
      screen={p.state.screen}
      note={peerNote(p)}
      version={version}
      talking={talking.includes(p.id)}
      reaction={reactionOf(p.id, p.state)}
      pinned={pinned === p.id}
      onPin={others.length > 1 || pinned ? () => pin(p.id) : undefined}
      sinkId={choice.speakerId}
      className={className}
    />
  );
  const selfTile = (className?: string) => (
    <Tile
      key="self"
      stream={e?.local ?? null}
      name={me?.name ?? "You"}
      self
      state={state}
      showVideo={state.cam || state.screen}
      screen={state.screen}
      className={className}
      version={version}
      talking={!!me && talking.includes(me.peerId)}
      reaction={me ? reactionOf(me.peerId, state) : undefined}
    />
  );
  // One big tile: the person pinned, a shared screen, or in speaker view whoever spoke last.
  const sharer = others.find((p) => p.state.screen)?.id;
  const speakerView = choice.view === "speaker" && others.length > 1;
  const spotId = (pinned && others.some((p) => p.id === pinned) ? pinned : null) ?? sharer ?? (speakerView ? (others.find((p) => p.id === (talking.find((t) => t !== me?.peerId) ?? lastSpeaker))?.id ?? others[0]?.id) : null);
  const spot = spotId ? others.find((p) => p.id === spotId) : undefined;
  const pip = others.length === 1;
  const count = pip ? 1 : others.length + 1;
  const cols = count <= 1 ? 1 : count <= 4 ? 2 : 3;
  const askConsent = recordingHere && me && !myConsent && meeting.recordingBy !== me.key;
  const recorderName = consents.find((c) => c.personKey === meeting.recordingBy)?.name ?? "Someone";

  return (
    <div className="call" role="dialog" aria-modal="true" aria-label={meeting.title}>
      <div className="call-top">
        <div className="stack" style={{ gap: 0, minWidth: 0 }}>
          <h1 className="truncate">{meeting.title}</h1>
          <span className="tiny" style={{ color: "#b9b7b0" }}>
            {others.length ? `${others.length + 1} in the call` : "Waiting for others to join"}
          </span>
        </div>
        {recordingHere && <span className="call-rec">{meeting.captions ? "Recording and transcribing" : "Recording"}</span>}
      </div>
      <div className="stack" style={{ gap: "0.5rem", minHeight: 0 }}>
        {note && <p className="call-note">{note}</p>}
        {offline ? (
          <p className="call-note">This device is offline. The call picks up again when the internet is back.</p>
        ) : (
          others.length > 0 &&
          others.every((p) => quality.get(p.id) === "poor") && <p className="call-note">Your connection looks weak. Turning your camera off can help.</p>
        )}
        {team &&
          waiting.map((w) => (
            <div key={w.id} className="call-knock" role="alert">
              <span className="grow truncate">
                <strong>{w.name}</strong> is waiting to join
              </span>
              <button type="button" className="btn btn-accent btn-sm" onClick={() => host("admit", w.id)}>
                Let in
              </button>
              <button type="button" className="btn btn-ghost btn-sm" style={{ color: "#f3f2ec" }} onClick={() => host("decline", w.id)}>
                Turn away
              </button>
            </div>
          ))}
        <div className="call-stage" style={{ flex: 1 }}>
          <div className={spot && !pip ? "call-grid call-spot" : "call-grid"} style={{ ["--cols" as string]: spot && !pip ? 1 : cols, position: "relative" }}>
            {spot && !pip ? (
              <>
                {tileOf(spot, "call-spot-main")}
                <div className="call-strip">
                  {selfTile()}
                  {others.filter((p) => p.id !== spot.id).map((p) => tileOf(p))}
                </div>
              </>
            ) : pip ? (
              others.map((p) => tileOf(p))
            ) : (
              [selfTile(), ...others.map((p) => tileOf(p))]
            )}
            {pip && selfTile("call-pip")}
            {showCaptions && (recent.length > 0 || interim) && (
              <div className="call-captions" aria-live="polite">
                {recent.map((l) => (
                  <span key={l.id}>
                    <b>{l.speaker}:</b> {l.text}
                  </span>
                ))}
                {interim && (
                  <span style={{ opacity: 0.75 }}>
                    <b>{me?.name}:</b> {interim}
                  </span>
                )}
              </div>
            )}
          </div>
          {side && (
            <aside className="call-side" aria-label={side === "chat" ? "Meeting chat" : "People in the call"}>
              <header className="cv-head">
                <h2 className="cv-title">{side === "chat" ? "Meeting chat" : "In the call"}</h2>
                <button type="button" className="icon-btn" aria-label="Close" onClick={() => setSide(null)}>
                  <X size={18} />
                </button>
              </header>
              {side === "chat" &&
                (meeting.postId && chatList ? (
                  <ThreadView backend={backend} list={chatList} postId={meeting.postId} meetingHref={() => "#"} />
                ) : (
                  <p className="small muted" style={{ padding: "1rem" }}>{meeting.postId ? "Loading…" : "This meeting has no chat."}</p>
                ))}
              {side === "people" && team && backend.mode === "server" && others.some((p) => p.state.mic) && (
                <div style={{ padding: "0.75rem 1rem 0" }}>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => host("mute-all")}>
                    <MicOff size={15} /> Mute everyone else
                  </button>
                </div>
              )}
              {side === "people" && (
                <ul className="stack" style={{ listStyle: "none", margin: 0, padding: "0.75rem 1rem", gap: "0.6rem" }}>
                  {[...(me ? [{ id: me.peerId, name: `${me.name} (you)`, personKey: me.key, state, kind: backend.audience }] : []), ...others].map((p) => {
                    const c = consents.find((x) => x.personKey === p.personKey);
                    return (
                      <li key={p.id} className="row-between" style={{ gap: "0.5rem" }}>
                        <span className="row" style={{ gap: "0.5rem", minWidth: 0 }}>
                          <span className="avatar" style={{ width: 28, height: 28, fontSize: "0.7rem" }}>{initials(p.name.replace(/ \(you\)$/, ""))}</span>
                          <span className="truncate">{p.name}</span>
                          {p.kind === "client" && <span className="tiny muted">Client</span>}
                        </span>
                        <span className="row tiny muted" style={{ gap: "0.4rem" }}>
                          {p.state.hand && <Hand size={14} aria-label="Hand raised" />}
                          {p.state.mic ? <Mic size={14} aria-label="Mic on" /> : <MicOff size={14} aria-label="Muted" />}
                          {recordingHere && <span>{c?.decision === "given" ? "Agreed" : c?.decision === "declined" ? "Not recorded" : "Not asked yet"}</span>}
                          {team && p.id !== me?.peerId && backend.mode === "server" && (
                            <>
                              {p.state.mic && (
                                <button type="button" className="icon-btn" aria-label={`Mute ${p.name}`} title="Mute (they can unmute)" onClick={() => host("mute", p.id)}>
                                  <MicOff size={15} />
                                </button>
                              )}
                              <button
                                type="button"
                                className="icon-btn"
                                aria-label={`Take ${p.name} out of the call`}
                                title="Take out of the call"
                                onClick={() => confirm(`Take ${p.name} out of the call?`) && host("remove", p.id)}
                              >
                                <UserMinus size={15} />
                              </button>
                            </>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </aside>
          )}
          {askConsent && (
            <div className="call-consent" role="alertdialog" aria-labelledby="consent-title">
              <div>
                <h2 id="consent-title" style={{ fontSize: "1.2rem", margin: 0 }}>
                  {recorderName} is recording this call
                </h2>
                <p className="small">
                  The sound{meeting.captions ? " and a written transcript of what you say" : ""} will be kept with this project, and the studio may use the assistant to take notes from it. Do you agree to being recorded?
                </p>
                <p className="tiny muted">If you do not agree, you stay in the call and your voice is left out of the recording and the transcript.</p>
                <div className="row wrap" style={{ gap: "0.5rem" }}>
                  <button type="button" className="btn btn-primary" onClick={() => void decide("given")}>
                    I agree
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={() => void decide("declined")}>
                    Don&apos;t record me
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => void leave(false)}>
                    Leave the call
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="call-bar">
        <CallButton label={state.mic ? "Mute" : "Unmute"} pressed={state.mic} onClick={() => setMic(!state.mic)} disabled={!e?.local.getAudioTracks().length}>
          {state.mic ? <Mic size={20} /> : <MicOff size={20} />}
        </CallButton>
        <CallButton label={state.cam ? "Camera" : "Camera off"} pressed={state.cam} onClick={() => void setCam(!state.cam)}>
          {state.cam ? <Video size={20} /> : <VideoOff size={20} />}
        </CallButton>
        {state.cam && !state.screen && canBlur(e?.local.getVideoTracks()[0]) && (
          <CallButton label={blur ? "Blurred" : "Blur"} on={blur} onClick={() => setBlurOn(!blur)}>
            <Sparkles size={20} />
          </CallButton>
        )}
        {canShare && (
          <CallButton label="Share" on={state.screen} className="call-hide-sm" onClick={() => void share(!state.screen)}>
            <MonitorUp size={20} />
          </CallButton>
        )}
        <CallButton label="Hand" on={state.hand} onClick={() => setState((s) => ({ ...s, hand: !s.hand }))}>
          <Hand size={20} />
        </CallButton>
        <span className="call-react-wrap">
          <CallButton label="React" on={reacting} onClick={() => setReacting(!reacting)}>
            <Smile size={20} />
          </CallButton>
          {reacting && (
            <span className="call-react-menu" role="menu">
              {CALL_REACTIONS.map((r) => (
                <button key={r} type="button" role="menuitem" onClick={() => sendReaction(r)}>
                  {r}
                </button>
              ))}
            </span>
          )}
        </span>
        {others.length > 1 && (
          <CallButton label={choice.view === "speaker" ? "Speaker" : "Grid"} className="call-hide-sm" onClick={() => setView(choice.view === "speaker" ? "grid" : "speaker")}>
            <LayoutGrid size={20} />
          </CallButton>
        )}
        <CallButton label="Chat" on={side === "chat"} onClick={() => void openChat()}>
          <MessageSquare size={20} />
        </CallButton>
        <CallButton label="People" on={side === "people"} className="call-hide-sm" onClick={() => setSide((s) => (s === "people" ? null : "people"))}>
          <Users size={20} />
        </CallButton>
        {(recordingHere || team) && (
          <CallButton label={showCaptions ? "Captions" : "No captions"} on={showCaptions && recordingHere} onClick={() => setShowCaptions(!showCaptions)}>
            {showCaptions ? <Captions size={20} /> : <CaptionsOff size={20} />}
          </CallButton>
        )}
        {team && (
          <CallButton
            label={recordingHere ? (iRecord ? "Stop rec" : "Recording") : "Record"}
            on={recordingHere}
            disabled={recordingHere && !iRecord}
            onClick={() => void toggleRecording()}
          >
            <Radio size={20} />
          </CallButton>
        )}
        <CallButton label="Leave" className="call-leave" onClick={() => void leave(false)}>
          <PhoneOff size={20} />
        </CallButton>
        {team && others.length > 0 && (
          <button type="button" className="btn btn-ghost btn-sm" style={{ color: "#f3f2ec" }} onClick={() => void leave(true)}>
            End for all
          </button>
        )}
      </div>
    </div>
  );
}
