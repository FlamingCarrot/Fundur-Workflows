"use client";
import type { JoinInfo, Peer, SignalPayload } from "./types";

/**
 * The call in the browser, behind one interface whichever service carries it.
 *
 * "builtin" connects each browser straight to every other (WebRTC). The app
 * passes their handshakes along. The browser with the smaller id offers, so
 * two never offer at once; the other answers with its own camera and
 * microphone. Turning the camera on or sharing the screen swaps the track on
 * the same connection, so nothing has to be agreed again.
 *
 * "livekit" sends everything through a LiveKit server, for larger calls.
 */

export interface CallEngine {
  /** This browser's camera, microphone or shared screen. */
  local: MediaStream;
  /** Everyone else's sound and picture, by their id in the call. */
  remote: Map<string, MediaStream>;
  /** How each connection is doing: "connecting", "connected", "failed"… */
  status: Map<string, string>;
  screen: boolean;
  camId?: string | null;
  setMic(on: boolean): void;
  setCam(on: boolean): Promise<boolean>;
  shareScreen(on: boolean): Promise<boolean>;
  /** Built-in only: who is in the call now. */
  sync(peers: Peer[]): void;
  /** Built-in only: a handshake from another browser. */
  signal(from: string, payload: SignalPayload): Promise<void>;
  close(): void;
}

export interface LocalMedia {
  stream: MediaStream;
  mic: boolean;
  cam: boolean;
  /** Why the camera or microphone could not be used, when it couldn't. */
  problem: string;
}

/** The camera and microphone, as much of them as the browser lets us have. */
export async function openLocalMedia(want: { mic: boolean; cam: boolean; micId?: string; camId?: string }): Promise<LocalMedia> {
  const stream = new MediaStream();
  let problem = "";
  if (!navigator.mediaDevices?.getUserMedia) return { stream, mic: false, cam: false, problem: "This browser cannot use a camera or microphone here." };
  const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, ...(want.micId ? { deviceId: { exact: want.micId } } : {}) };
  const video = cameraConstraints(want.camId);
  try {
    const got = await navigator.mediaDevices.getUserMedia({ audio, video: want.cam ? video : false });
    got.getTracks().forEach((t) => stream.addTrack(t));
  } catch {
    try {
      const got = await navigator.mediaDevices.getUserMedia({ audio });
      got.getTracks().forEach((t) => stream.addTrack(t));
      if (want.cam) problem = "The camera is not available, so you joined with sound only.";
    } catch {
      problem = "The browser did not allow the camera or microphone. You can still listen and watch.";
    }
  }
  stream.getAudioTracks().forEach((t) => (t.enabled = want.mic));
  return { stream, mic: want.mic && stream.getAudioTracks().length > 0, cam: stream.getVideoTracks().length > 0, problem };
}

/** The camera as calls want it: the one picked, or the front camera, at a size phones send smoothly. */
export function cameraConstraints(camId?: string | null): MediaTrackConstraints {
  return { width: { ideal: 960 }, height: { ideal: 540 }, frameRate: { ideal: 24 }, ...(camId ? { deviceId: { exact: camId } } : { facingMode: "user" }) };
}

export interface Devices {
  mics: MediaDeviceInfo[];
  cams: MediaDeviceInfo[];
  speakers: MediaDeviceInfo[];
}

/** The microphones, cameras and speakers the browser offers (named once it was allowed to use them). */
export async function listDevices(): Promise<Devices> {
  const all = (await navigator.mediaDevices?.enumerateDevices?.().catch(() => [])) ?? [];
  const named = (d: MediaDeviceInfo) => d.deviceId && d.deviceId !== "default" && d.deviceId !== "communications";
  return {
    mics: all.filter((d) => d.kind === "audioinput" && named(d)),
    cams: all.filter((d) => d.kind === "videoinput" && named(d)),
    speakers: all.filter((d) => d.kind === "audiooutput" && named(d)),
  };
}

/**
 * Who is talking: the loudness of each person's sound, measured a few times a
 * second, so the call can light up their tile and show them big in speaker view.
 */
export class SpeakingMeter {
  private ctx: AudioContext | null = null;
  private nodes = new Map<string, { track: MediaStreamTrack; source: MediaStreamAudioSourceNode; analyser: AnalyserNode; level: number }>();
  private buf = new Uint8Array(512);

  /** The streams to listen to, by id; others are dropped. */
  watch(streams: Map<string, MediaStream>) {
    if (typeof AudioContext === "undefined") return;
    this.ctx ??= new AudioContext();
    if (this.ctx.state === "suspended") void this.ctx.resume().catch(() => undefined);
    for (const [id, n] of this.nodes) {
      const track = streams.get(id)?.getAudioTracks()[0];
      if (track !== n.track) {
        n.source.disconnect();
        this.nodes.delete(id);
      }
    }
    for (const [id, stream] of streams) {
      const track = stream.getAudioTracks()[0];
      if (!track || this.nodes.has(id)) continue;
      const source = this.ctx.createMediaStreamSource(new MediaStream([track]));
      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      this.nodes.set(id, { track, source, analyser, level: 0 });
    }
  }

  /** Ids whose sound is above speech level now, loudest first. */
  speaking(): string[] {
    const out: [string, number][] = [];
    for (const [id, n] of this.nodes) {
      n.analyser.getByteTimeDomainData(this.buf);
      let sum = 0;
      for (const v of this.buf) sum += (v - 128) * (v - 128);
      const rms = Math.sqrt(sum / this.buf.length) / 128;
      // Smoothed, so a word does not flicker the highlight on and off.
      n.level = n.level * 0.6 + rms * 0.4;
      if (n.level > 0.04 && n.track.enabled) out.push([id, n.level]);
    }
    return out.sort((a, b) => b[1] - a[1]).map(([id]) => id);
  }

  close() {
    this.nodes.forEach((n) => n.source.disconnect());
    this.nodes.clear();
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }
}

interface Conn {
  pc: RTCPeerConnection;
  /** This browser offers (it has the smaller id). */
  offers: boolean;
  stream: MediaStream;
  waiting: RTCIceCandidateInit[];
  outbox: SignalPayload[];
  timer: ReturnType<typeof setTimeout> | null;
}

export class BuiltinCall implements CallEngine {
  remote = new Map<string, MediaStream>();
  status = new Map<string, string>();
  screen = false;
  private conns = new Map<string, Conn>();
  private camTrack: MediaStreamTrack | null;
  private screenTrack: MediaStreamTrack | null = null;
  private closed = false;
  /** The camera picked in the lobby, used when the camera is turned back on. */
  camId: string | null = null;

  constructor(
    private me: string,
    private iceServers: RTCIceServer[],
    public local: MediaStream,
    private send: (to: string, payloads: SignalPayload[]) => Promise<void>,
    private onChange: () => void,
  ) {
    this.camTrack = local.getVideoTracks()[0] ?? null;
  }

  private videoOut(): MediaStreamTrack | null {
    return this.screenTrack ?? this.camTrack;
  }

  private queue(id: string, payload: SignalPayload) {
    const c = this.conns.get(id);
    if (!c || this.closed) return;
    c.outbox.push(payload);
    // Handshake pieces come in bursts; send them together.
    c.timer ??= setTimeout(() => {
      c.timer = null;
      const batch = c.outbox.splice(0, 50);
      if (batch.length) this.send(id, batch).catch(() => undefined);
      if (c.outbox.length) this.queue(id, c.outbox.shift()!);
    }, 120);
  }

  private conn(id: string): Conn {
    const existing = this.conns.get(id);
    if (existing) return existing;
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const c: Conn = { pc, offers: this.me < id, stream: new MediaStream(), waiting: [], outbox: [], timer: null };
    this.conns.set(id, c);
    this.remote.set(id, c.stream);
    this.status.set(id, "connecting");
    pc.ontrack = (e) => {
      if (!c.stream.getTracks().includes(e.track)) c.stream.addTrack(e.track);
      e.track.onunmute = () => this.onChange();
      e.track.onmute = () => this.onChange();
      this.onChange();
    };
    pc.onicecandidate = (e) => {
      const c = e.candidate?.toJSON();
      this.queue(id, { kind: "candidate", candidate: c ? { ...c, candidate: c.candidate ?? "" } : null });
    };
    pc.onconnectionstatechange = () => {
      this.status.set(id, pc.connectionState);
      // The offering side starts over when a connection drops; the other answers again.
      if (pc.connectionState === "failed" && c.offers) pc.restartIce();
      this.onChange();
    };
    if (c.offers) {
      pc.onnegotiationneeded = async () => {
        try {
          await pc.setLocalDescription();
          if (pc.localDescription) this.queue(id, { kind: "description", description: pc.localDescription.toJSON() as { type: "offer"; sdp: string } });
        } catch {
          /* The next change or the restart tries again. */
        }
      };
      const audio = this.local.getAudioTracks()[0];
      pc.addTransceiver(audio ?? "audio", { direction: "sendrecv", ...(audio ? { streams: [this.local] } : {}) });
      const video = this.videoOut();
      pc.addTransceiver(video ?? "video", { direction: "sendrecv", ...(video ? { streams: [this.local] } : {}) });
    }
    return c;
  }

  private drop(id: string) {
    const c = this.conns.get(id);
    if (!c) return;
    if (c.timer) clearTimeout(c.timer);
    c.pc.close();
    this.conns.delete(id);
    this.remote.delete(id);
    this.status.delete(id);
  }

  sync(peers: Peer[]) {
    if (this.closed) return;
    const here = new Set(peers.filter((p) => p.id !== this.me).map((p) => p.id));
    for (const id of [...this.conns.keys()]) if (!here.has(id)) this.drop(id);
    // The offering side starts each connection; the other waits for its offer.
    for (const id of here) if (this.me < id) this.conn(id);
    this.onChange();
  }

  async signal(from: string, payload: SignalPayload) {
    if (this.closed || payload.kind === "hello") return;
    const c = this.conn(from);
    const pc = c.pc;
    try {
      if (payload.kind === "candidate") {
        if (!payload.candidate) return;
        if (!pc.remoteDescription) c.waiting.push(payload.candidate);
        else await pc.addIceCandidate(payload.candidate).catch(() => undefined);
        return;
      }
      const d = payload.description;
      if (d.type === "offer") {
        if (c.offers) return; // Only the other side offers on this connection.
        await pc.setRemoteDescription(d as RTCSessionDescriptionInit);
        // Answer with this browser's own sound and picture on the transceivers the offer made.
        for (const t of pc.getTransceivers()) {
          const kind = t.receiver.track.kind;
          t.direction = "sendrecv";
          const track = kind === "audio" ? this.local.getAudioTracks()[0] ?? null : this.videoOut();
          await t.sender.replaceTrack(track);
          if (track) t.sender.setStreams?.(this.local);
        }
        await pc.setLocalDescription();
        if (pc.localDescription) this.queue(from, { kind: "description", description: pc.localDescription.toJSON() as { type: "answer"; sdp: string } });
      } else if (d.type === "answer") {
        if (pc.signalingState !== "have-local-offer") return;
        await pc.setRemoteDescription(d as RTCSessionDescriptionInit);
      }
      for (const cand of c.waiting.splice(0)) await pc.addIceCandidate(cand).catch(() => undefined);
    } catch {
      this.status.set(from, "failed");
      this.onChange();
    }
  }

  private async replaceVideo(track: MediaStreamTrack | null) {
    for (const c of this.conns.values())
      for (const t of c.pc.getTransceivers())
        if (t.receiver.track.kind === "video" && t.currentDirection !== "stopped") await t.sender.replaceTrack(track).catch(() => undefined);
  }

  setMic(on: boolean) {
    this.local.getAudioTracks().forEach((t) => (t.enabled = on));
  }

  async setCam(on: boolean): Promise<boolean> {
    if (on && !this.camTrack) {
      try {
        const got = await navigator.mediaDevices.getUserMedia({ video: cameraConstraints(this.camId) });
        this.camTrack = got.getVideoTracks()[0];
      } catch {
        return false;
      }
    }
    if (!on && this.camTrack) {
      this.camTrack.stop();
      this.camTrack = null;
    }
    this.showLocalVideo();
    if (!this.screenTrack) await this.replaceVideo(this.camTrack);
    this.onChange();
    return true;
  }

  private showLocalVideo() {
    this.local.getVideoTracks().forEach((t) => this.local.removeTrack(t));
    const v = this.videoOut();
    if (v) this.local.addTrack(v);
  }

  async shareScreen(on: boolean): Promise<boolean> {
    if (on) {
      try {
        const got = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        this.screenTrack = got.getVideoTracks()[0];
        this.screenTrack.onended = () => void this.shareScreen(false);
      } catch {
        return false;
      }
    } else {
      this.screenTrack?.stop();
      this.screenTrack = null;
    }
    this.screen = !!this.screenTrack;
    this.showLocalVideo();
    await this.replaceVideo(this.videoOut());
    this.onChange();
    return true;
  }

  close() {
    this.closed = true;
    for (const id of [...this.conns.keys()]) this.drop(id);
    this.screenTrack?.stop();
    this.camTrack?.stop();
    this.local.getTracks().forEach((t) => t.stop());
  }
}

/** A call carried by a LiveKit server. Everyone is known by their id in the call (the token's identity). */
export async function liveKitCall(join: Extract<JoinInfo, { provider: "livekit" }>, media: LocalMedia, onChange: () => void): Promise<CallEngine> {
  const { Room, RoomEvent, Track } = await import("livekit-client");
  const room = new Room({ adaptiveStream: true, dynacast: true });
  const remote = new Map<string, MediaStream>();
  const status = new Map<string, string>();
  const streamOf = (id: string) => {
    let s = remote.get(id);
    if (!s) remote.set(id, (s = new MediaStream()));
    return s;
  };
  room
    .on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
      streamOf(participant.identity).addTrack(track.mediaStreamTrack);
      status.set(participant.identity, "connected");
      onChange();
    })
    .on(RoomEvent.TrackUnsubscribed, (track, _pub, participant) => {
      remote.get(participant.identity)?.removeTrack(track.mediaStreamTrack);
      onChange();
    })
    .on(RoomEvent.ParticipantDisconnected, (participant) => {
      remote.delete(participant.identity);
      status.delete(participant.identity);
      onChange();
    })
    .on(RoomEvent.Reconnecting, () => onChange())
    .on(RoomEvent.Reconnected, () => onChange());
  await room.connect(join.url, join.token);
  // LiveKit takes over the camera and microphone the browser already gave us.
  const local = new MediaStream();
  const audio = media.stream.getAudioTracks()[0];
  const video = media.stream.getVideoTracks()[0];
  if (audio) await room.localParticipant.publishTrack(audio, { source: Track.Source.Microphone });
  if (video) await room.localParticipant.publishTrack(video, { source: Track.Source.Camera });
  media.stream.getTracks().forEach((t) => local.addTrack(t));
  let camTrack: MediaStreamTrack | null = video ?? null;
  let screenTrack: MediaStreamTrack | null = null;
  const engine: CallEngine = {
    local,
    remote,
    status,
    screen: false,
    camId: null,
    setMic(on) {
      local.getAudioTracks().forEach((t) => (t.enabled = on));
    },
    async setCam(on) {
      try {
        if (on && !camTrack) {
          const got = await navigator.mediaDevices.getUserMedia({ video: cameraConstraints(engine.camId) });
          camTrack = got.getVideoTracks()[0];
          await room.localParticipant.publishTrack(camTrack, { source: Track.Source.Camera });
        } else if (!on && camTrack) {
          await room.localParticipant.unpublishTrack(camTrack);
          camTrack.stop();
          camTrack = null;
        }
      } catch {
        return false;
      }
      local.getVideoTracks().forEach((t) => local.removeTrack(t));
      const v = screenTrack ?? camTrack;
      if (v) local.addTrack(v);
      onChange();
      return true;
    },
    async shareScreen(on) {
      try {
        if (on) {
          const got = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
          screenTrack = got.getVideoTracks()[0];
          screenTrack.onended = () => void engine.shareScreen(false);
          await room.localParticipant.publishTrack(screenTrack, { source: Track.Source.ScreenShare });
        } else if (screenTrack) {
          await room.localParticipant.unpublishTrack(screenTrack);
          screenTrack.stop();
          screenTrack = null;
        }
      } catch {
        return false;
      }
      engine.screen = !!screenTrack;
      local.getVideoTracks().forEach((t) => local.removeTrack(t));
      const v = screenTrack ?? camTrack;
      if (v) local.addTrack(v);
      onChange();
      return true;
    },
    sync() {},
    async signal() {},
    close() {
      void room.disconnect();
      screenTrack?.stop();
      camTrack?.stop();
      local.getTracks().forEach((t) => t.stop());
    },
  };
  return engine;
}

// ---------------------------------------------------------------------------
// Recording and live captions
// ---------------------------------------------------------------------------

/** The best sound-only format this browser records in. */
export function recordingType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}

/**
 * Records the call's sound in this browser: everyone who agreed, mixed into
 * one track. People who did not agree are left out of the mix.
 */
export class CallRecorder {
  private ctx = new AudioContext();
  private dest = this.ctx.createMediaStreamDestination();
  private sources = new Map<string, MediaStreamAudioSourceNode>();
  private recorder: MediaRecorder;
  private chunks: Blob[] = [];
  readonly startedAt = Date.now();

  constructor() {
    const type = recordingType();
    this.recorder = new MediaRecorder(this.dest.stream, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 32_000 });
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.recorder.start(5_000);
  }

  /** The streams to hear now; anything no longer listed is dropped from the mix. */
  mix(streams: MediaStream[]) {
    const tracks = new Map(streams.flatMap((s) => s.getAudioTracks()).filter((t) => t.readyState === "live").map((t) => [t.id, t]));
    for (const [id, node] of this.sources)
      if (!tracks.has(id)) {
        node.disconnect();
        this.sources.delete(id);
      }
    for (const [id, track] of tracks)
      if (!this.sources.has(id)) {
        const node = this.ctx.createMediaStreamSource(new MediaStream([track]));
        node.connect(this.dest);
        this.sources.set(id, node);
      }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  stop(): Promise<{ blob: Blob; durationSec: number }> {
    return new Promise((resolve) => {
      this.recorder.onstop = () => {
        this.sources.forEach((n) => n.disconnect());
        void this.ctx.close();
        resolve({ blob: new Blob(this.chunks, { type: this.recorder.mimeType || "audio/webm" }), durationSec: Math.round((Date.now() - this.startedAt) / 1000) });
      };
      if (this.recorder.state !== "inactive") this.recorder.stop();
      else this.recorder.onstop(new Event("stop"));
    });
  }
}

interface SpeechResultEvent {
  resultIndex: number;
  results: { isFinal: boolean; 0: { transcript: string } }[] & { length: number };
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
}

/** Whether this browser can caption speech live (Chrome, Edge and Safari can). */
export function captionsSupported(): boolean {
  return typeof window !== "undefined" && !!((window as unknown as Record<string, unknown>).SpeechRecognition || (window as unknown as Record<string, unknown>).webkitSpeechRecognition);
}

/**
 * Live captions of this person's own speech, from the browser's speech
 * service. Each finished sentence is handed on with when it was said.
 */
export class LiveCaptions {
  private rec: SpeechRecognitionLike | null = null;
  private running = false;
  constructor(
    private since: number,
    private onFinal: (text: string, atMs: number) => void,
    private onInterim: (text: string) => void,
    private lang = "en-ZA",
  ) {}

  start() {
    const W = window as unknown as Record<string, new () => SpeechRecognitionLike>;
    const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!Ctor || this.running) return;
    this.running = true;
    const rec = new Ctor();
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0].transcript.trim();
        if (r.isFinal && text) this.onFinal(text, Date.now() - this.since);
        else interim += r[0].transcript;
      }
      this.onInterim(interim.trim());
    };
    // The service stops after a silence; keep it going while captions are on.
    rec.onend = () => {
      if (this.running) setTimeout(() => this.running && this.rec === rec && rec.start(), 250);
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") this.stop();
    };
    this.rec = rec;
    try {
      rec.start();
    } catch {
      this.running = false;
    }
  }

  stop() {
    this.running = false;
    this.rec?.stop();
    this.rec = null;
    this.onInterim("");
  }
}
