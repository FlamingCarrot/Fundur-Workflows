"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Voice for the assistant chat: speech to text for what she says, and reading
 * replies aloud. Speech to text uses the browser's own recognition where it
 * has one (Chrome, Edge, Safari), which needs no key; elsewhere it records a
 * short clip and the server turns it into text with the OpenAI key saved for
 * AI models, if there is one. Replies are read with the browser's own voices.
 */

interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<RecognitionResult> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

/** "browser": the browser's own recognition. "server": recorded and sent to the server. "none": no way to listen. */
export type VoiceSupport = "browser" | "server" | "none" | "checking";

function recognitionCtor(): (new () => RecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, new () => RecognitionLike>;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const isTouch = () => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

export interface ListenOptions {
  /**
   * "dictate" keeps listening until she stops it (on a computer; phones stop
   * at a pause). "turn" stops once she pauses, for hands-free conversation.
   */
  mode: "dictate" | "turn";
  /** The words so far: settled text and the part still being heard. */
  onWords?: (settled: string, hearing: string) => void;
  /** Everything she said, once listening ends (empty if nothing was heard). */
  onDone: (text: string) => void;
}

const ERRORS: Record<string, string> = {
  "not-allowed": "Fundur can't use your microphone. Allow it for this site in your browser's settings.",
  "service-not-allowed": "Your browser's speech service is switched off.",
  "audio-capture": "No microphone was found.",
  network: "Your browser's speech service could not be reached. Check your connection.",
};

export function useVoice(opts: { onError: (message: string) => void }) {
  const [support, setSupport] = useState<VoiceSupport>("checking");
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const recRef = useRef<RecognitionLike | null>(null);
  const recorderRef = useRef<{ stop: () => void; cancel: () => void } | null>(null);
  const onError = useRef(opts.onError);
  useEffect(() => {
    onError.current = opts.onError;
  });
  const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window;

  useEffect(() => {
    let gone = false;
    // Known only in the browser, so it is worked out after the first render.
    const found: Promise<VoiceSupport> = recognitionCtor()
      ? Promise.resolve("browser")
      : !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined"
        ? Promise.resolve("none")
        : fetch("/api/assistant/transcribe", { cache: "no-store" })
            .then((r) => (r.ok ? r.json() : { available: false }))
            .then((b: { available?: boolean }) => (b.available ? "server" : "none"), () => "none" as const);
    void found.then((s) => !gone && setSupport(s));
    return () => {
      gone = true;
    };
  }, []);

  const listenInBrowser = useCallback((o: ListenOptions) => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = navigator.language || "en-ZA";
    // Phones repeat words in continuous mode, so they listen one phrase at a time.
    rec.continuous = o.mode === "dictate" && !isTouch();
    rec.interimResults = true;
    let settled = "";
    let failed = false;
    rec.onresult = (e) => {
      let done = "";
      let hearing = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) done += r[0].transcript;
        else hearing += r[0].transcript;
      }
      settled = done.trim();
      o.onWords?.(settled, hearing.trim());
    };
    rec.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      failed = true;
      onError.current(ERRORS[e.error] ?? "Listening stopped. Try again.");
    };
    rec.onend = () => {
      recRef.current = null;
      setListening(false);
      o.onDone(failed ? "" : settled);
    };
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      recRef.current = null;
      onError.current("Listening could not start. Tap the microphone to try again.");
    }
  }, []);

  const listenOnServer = useCallback(async (o: ListenOptions) => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      onError.current(ERRORS["not-allowed"]);
      return;
    }
    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    let cancelled = false;
    let audio: AudioContext | null = null;
    let timer = 0;
    const finish = () => {
      window.clearInterval(timer);
      void audio?.close().catch(() => {});
      stream.getTracks().forEach((t) => t.stop());
    };
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = async () => {
      finish();
      recorderRef.current = null;
      setListening(false);
      if (cancelled || !chunks.length) return o.onDone("");
      setTranscribing(true);
      const form = new FormData();
      form.append("audio", new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
      try {
        const res = await fetch("/api/assistant/transcribe", { method: "POST", body: form });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || "Could not turn that into text");
        o.onWords?.(body.text ?? "", "");
        o.onDone(body.text ?? "");
      } catch (err) {
        onError.current((err as Error).message);
        o.onDone("");
      }
      setTranscribing(false);
    };
    // A turn ends after a pause once she has spoken; dictation and very long turns end at two minutes.
    const startedAt = Date.now();
    try {
      audio = new AudioContext();
      const analyser = audio.createAnalyser();
      audio.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      let spoke = false;
      let quietSince = Date.now();
      timer = window.setInterval(() => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const v of data) sum += ((v - 128) / 128) ** 2;
        const loud = Math.sqrt(sum / data.length) > 0.03;
        if (loud) {
          spoke = true;
          quietSince = Date.now();
        }
        const quietFor = Date.now() - quietSince;
        if (Date.now() - startedAt > 120_000 || (o.mode === "turn" && ((spoke && quietFor > 1500) || (!spoke && quietFor > 8000)))) {
          if (recorder.state === "recording") recorder.stop();
        }
      }, 100);
    } catch {
      // Without level metering she stops it herself.
    }
    recorder.start();
    recorderRef.current = {
      stop: () => recorder.state === "recording" && recorder.stop(),
      cancel: () => {
        cancelled = true;
        if (recorder.state === "recording") recorder.stop();
      },
    };
    setListening(true);
  }, []);

  const listen = useCallback(
    (o: ListenOptions) => {
      if (recRef.current || recorderRef.current) return;
      if (support === "browser") listenInBrowser(o);
      else if (support === "server") void listenOnServer(o);
    },
    [support, listenInBrowser, listenOnServer]
  );

  /** Stops listening and keeps what was heard. */
  const stopListening = useCallback(() => {
    recRef.current?.stop();
    recorderRef.current?.stop();
  }, []);

  /** Stops listening and throws away what was heard. */
  const cancelListening = useCallback(() => {
    recRef.current?.abort();
    recorderRef.current?.cancel();
  }, []);

  const stopSpeaking = useCallback(() => {
    if (canSpeak) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [canSpeak]);

  /** Reads text aloud, sentence by sentence (long single utterances get cut off in Chrome). */
  const speak = useCallback(
    (text: string, onEnd?: () => void) => {
      if (!canSpeak) return onEnd?.();
      const synth = window.speechSynthesis;
      synth.cancel();
      const plain = speakable(text);
      const parts = plain.match(/[^.!?\n]+[.!?]*\s*/g)?.map((p) => p.trim()).filter(Boolean) ?? [];
      if (!parts.length) return onEnd?.();
      const lang = navigator.language || "en-ZA";
      const voices = synth.getVoices();
      const voice = voices.find((v) => v.lang === lang) ?? voices.find((v) => v.lang.startsWith(lang.slice(0, 2)) && v.localService) ?? voices.find((v) => v.lang.startsWith(lang.slice(0, 2)));
      setSpeaking(true);
      parts.forEach((part, i) => {
        const u = new SpeechSynthesisUtterance(part);
        u.lang = lang;
        if (voice) u.voice = voice;
        if (i === parts.length - 1) {
          u.onend = () => {
            setSpeaking(false);
            onEnd?.();
          };
          u.onerror = (e) => {
            setSpeaking(false);
            // Cancelled on purpose (she stopped it or started talking) is not the end of the turn.
            if (e.error !== "interrupted" && e.error !== "canceled") onEnd?.();
          };
        }
        synth.speak(u);
      });
    },
    [canSpeak]
  );

  useEffect(
    () => () => {
      recRef.current?.abort();
      recorderRef.current?.cancel();
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    },
    []
  );

  return { support, listening, transcribing, speaking, canSpeak, listen, stopListening, cancelListening, speak, stopSpeaking };
}

/** The words of a reply as they should be read: no Markdown marks, tables or links' addresses. */
export function speakable(text: string): string {
  return text
    .split("\n")
    .filter((l) => !l.trim().startsWith("|"))
    .map((l) => l.replace(/^\s*([-*•]|\d+[.)])\s+/, "").replace(/^#+\s*/, ""))
    .join("\n")
    .replace(/\*\*|__|`/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .trim();
}
