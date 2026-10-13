"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Captions,
  CaptionsOff,
  Hand,
  MessageSquare,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  Radio,
  Users,
  Video,
  VideoOff,
  X,
} from "lucide-react";
import type { ChannelList, CommsBackend } from "@/lib/comms/client";
import {
  BuiltinCall,
  CallRecorder,
  LiveCaptions,
  captionsSupported,
  liveKitCall,
  openLocalMedia,
  recordingType,
  type CallEngine,
  type LocalMedia,
} from "@/lib/comms/call-engine";
import type { Consent, Meeting, Peer, PeerState, TranscriptLine } from "@/lib/comms/types";
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
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (v.srcObject !== stream) v.srcObject = stream;
    if (stream) v.play().catch(() => undefined);
  }, [stream, version]);
  return (
    <div className={`call-tile ${className ?? ""}`} data-self={self ? "true" : undefined} data-screen={screen ? "true" : undefined}>
      {/* The element stays even with the camera off: it carries the person's sound. */}
      <video ref={ref} autoPlay playsInline muted={self} style={{ visibility: showVideo ? "visible" : "hidden" }} />
      {!showVideo && <span className="call-initials">{initials(name)}</span>}
      <span className="call-name">
        {state && !state.mic && <MicOff size={13} aria-label="Muted" />}
        {state?.hand && <Hand size={13} aria-label="Hand raised" />}
        <span className="truncate">{self ? `${name} (you)` : name}</span>
      </span>
      {note && <span className="call-state">{note}</span>}
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

type Phase = "lobby" | "joining" | "in" | "leaving";

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
  const engine = useRef<CallEngine | null>(null);
  const recorder = useRef<CallRecorder | null>(null);
  const captions = useRef<LiveCaptions | null>(null);
  const captionQueue = useRef<{ atMs: number; text: string }[]>([]);
  const cursor = useRef({ signal: 0, line: 0 });
  const stateRef = useRef(state);
  stateRef.current = state;
  const rerender = useCallback(() => setVersion((v) => v + 1), []);

  // The lobby's preview: the camera and microphone, asked for once.
  useEffect(() => {
    let cancelled = false;
    void openLocalMedia({ mic: true, cam: true }).then((m) => {
      if (cancelled) {
        m.stream.getTracks().forEach((t) => t.stop());
        return;
      }
      setMedia(m);
      setWantCam(m.cam);
      setWantMic(m.mic);
      if (m.problem) setProblem(m.problem);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
      let e: CallEngine;
      if (joined.join.provider === "livekit") e = await liveKitCall(joined.join, media, rerender);
      else e = new BuiltinCall(peerId, joined.join.iceServers, media.stream, (to, payloads) => backend.room(initial.id, { action: "signal", peerId, to, payloads }).then(() => undefined), rerender);
      e.setMic(first.mic);
      engine.current = e;
      setState(first);
      setPhase("in");
      // Keep a phone's screen awake during the call.
      (navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<unknown> } }).wakeLock?.request("screen").catch(() => undefined);
    } catch (err) {
      setPhase("lobby");
      setProblem(err instanceof Error ? err.message : "Could not join the call. Please retry.");
    }
  };

  const myConsent = me ? consents.find((c) => c.personKey === me.key) : undefined;
  const recordingHere = meeting.recording === "on";
  const iRecord = !!recorder.current;

  // Hearing from the call about once a second: who is here, their handshakes, agreement and captions.
  useEffect(() => {
    if (phase !== "in" || !me) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    const tick = async () => {
      try {
        const snap = await backend.room(initial.id, { action: "poll", peerId: me.peerId, state: stateRef.current, afterSignal: cursor.current.signal, afterLine: cursor.current.line });
        failures = 0;
        if (stopped) return;
        setNote("");
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

  const setMic = (on: boolean) => {
    engine.current?.setMic(on);
    setState((s) => ({ ...s, mic: on }));
  };
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
  const recent = lines.filter((l) => l.source === "live").slice(-2);
  const canShare = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia;

  if (phase === "lobby" || phase === "joining")
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
              <h2 style={{ fontSize: "1.4rem", margin: 0 }}>Ready to join?</h2>
              <p className="small" style={{ color: "#b9b7b0", marginTop: "0.3rem" }}>
                {meeting.inCall > 0 ? `${meeting.inCall} ${meeting.inCall === 1 ? "person is" : "people are"} in the call.` : "Nobody is in the call yet."}
                {backend.mode === "demo" && " In the demo you are alone in the call: sign in to call your team and clients."}
              </p>
            </div>
            {!media && <p className="small">Asking for your camera and microphone…</p>}
            {problem && <p className="call-note" style={{ margin: 0 }}>{problem}</p>}
            <div className="row" style={{ gap: "0.6rem" }}>
              <CallButton label={wantMic ? "Mic on" : "Mic off"} pressed={wantMic} onClick={() => setWantMic(!wantMic)} disabled={!media?.mic && !wantMic}>
                {wantMic ? <Mic size={20} /> : <MicOff size={20} />}
              </CallButton>
              <CallButton label={wantCam ? "Camera on" : "Camera off"} pressed={wantCam} onClick={() => setWantCam(!wantCam)} disabled={!media?.cam}>
                {wantCam ? <Video size={20} /> : <VideoOff size={20} />}
              </CallButton>
            </div>
            <button type="button" className="btn btn-accent btn-lg" disabled={!media || phase === "joining"} onClick={() => void join()}>
              <Video size={18} /> {phase === "joining" ? "Joining…" : "Join the call"}
            </button>
            {meeting.recording === "on" && <p className="tiny" style={{ color: "#b9b7b0" }}>This call is being recorded. You will be asked whether you agree when you join.</p>}
          </div>
        </div>
        <div />
      </div>
    );

  const e = engine.current;
  const peerNote = (p: Peer) => {
    const s = e?.status.get(p.id);
    return s && s !== "connected" && s !== "completed" ? (s === "failed" ? "Connection lost" : "Connecting…") : undefined;
  };
  const tiles = others.map((p) => (
    <Tile key={p.id} stream={e?.remote.get(p.id) ?? null} name={p.name} state={p.state} showVideo={p.state.cam || p.state.screen} screen={p.state.screen} note={peerNote(p)} version={version} />
  ));
  const selfTile = (className?: string) => <Tile stream={e?.local ?? null} name={me?.name ?? "You"} self state={state} showVideo={state.cam || state.screen} screen={state.screen} className={className} version={version} />;
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
        <div className="call-stage" style={{ flex: 1 }}>
          <div className="call-grid" style={{ ["--cols" as string]: cols, position: "relative" }}>
            {pip ? tiles : [selfTile(), ...tiles]}
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
              {side === "people" && (
                <ul className="stack" style={{ listStyle: "none", margin: 0, padding: "0.75rem 1rem", gap: "0.6rem" }}>
                  {[...(me ? [{ id: me.peerId, name: `${me.name} (you)`, personKey: me.key, state, kind: backend.audience }] : []), ...others].map((p) => {
                    const c = consents.find((x) => x.personKey === p.personKey);
                    return (
                      <li key={p.id} className="row-between" style={{ gap: "0.5rem" }}>
                        <span className="row" style={{ gap: "0.5rem", minWidth: 0 }}>
                          <span className="avatar" style={{ width: 28, height: 28, fontSize: "0.7rem" }}>{initials(p.name)}</span>
                          <span className="truncate">{p.name}</span>
                          {p.kind === "client" && <span className="tiny muted">Client</span>}
                        </span>
                        <span className="row tiny muted" style={{ gap: "0.4rem" }}>
                          {p.state.hand && <Hand size={14} aria-label="Hand raised" />}
                          {p.state.mic ? <Mic size={14} aria-label="Mic on" /> : <MicOff size={14} aria-label="Muted" />}
                          {recordingHere && <span>{c?.decision === "given" ? "Agreed" : c?.decision === "declined" ? "Not recorded" : "Not asked yet"}</span>}
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
        {canShare && (
          <CallButton label="Share" on={state.screen} className="call-hide-sm" onClick={() => void share(!state.screen)}>
            <MonitorUp size={20} />
          </CallButton>
        )}
        <CallButton label="Hand" on={state.hand} onClick={() => setState((s) => ({ ...s, hand: !s.hand }))}>
          <Hand size={20} />
        </CallButton>
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
