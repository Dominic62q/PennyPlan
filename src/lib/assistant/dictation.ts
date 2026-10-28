"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

// Speech to text with the browser's own recognition (Chrome, Edge, Android and
// recent Safari). Nothing is recorded or stored by the app; the browser turns
// the voice into words and hands them over. Where it doesn't exist the mic is
// simply not shown.

type Alternative = { transcript: string };
type SpeechResult = { 0: Alternative; isFinal: boolean };
type RecognitionEvent = { results: ArrayLike<SpeechResult> };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type RecognitionClass = new () => Recognition;

function recognitionClass(): RecognitionClass | null {
  const w = window as unknown as {
    SpeechRecognition?: RecognitionClass;
    webkitSpeechRecognition?: RecognitionClass;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const MESSAGES: Record<string, string> = {
  "not-allowed": "Microphone access is blocked. Allow it in your browser settings to talk to Penny.",
  "service-not-allowed": "Microphone access is blocked. Allow it in your browser settings to talk to Penny.",
  "audio-capture": "I couldn't find a microphone.",
  network: "Voice needs an internet connection.",
};

const never = () => () => undefined;

/**
 * Turns the recognizer's results into one line of text. Desktop browsers give each
 * phrase once, but Android Chrome often gives every result as the whole sentence so
 * far ("hello", "hello how", "hello how has"), so a result that continues the one
 * before it replaces it instead of being added after it.
 */
export function transcriptOf(results: ArrayLike<{ 0: { transcript: string } }>): string {
  const parts: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const text = results[i][0].transcript.trim();
    if (!text) continue;
    const last = parts.length - 1;
    if (last >= 0 && text.toLowerCase().startsWith(parts[last].toLowerCase())) parts[last] = text;
    else parts.push(text);
  }
  return parts.join(" ");
}

export function useDictation() {
  const supported = useSyncExternalStore(
    never,
    () => recognitionClass() !== null,
    () => false,
  );
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef<Recognition | null>(null);

  useEffect(() => () => active.current?.abort(), []);

  const stop = useCallback(() => active.current?.stop(), []);

  /** Starts listening. `onText` gets the whole text so far: `base` plus what was said. */
  const start = useCallback((base: string, onText: (text: string) => void) => {
    const Recognition = recognitionClass();
    if (!Recognition || active.current) return;
    const recognition = new Recognition();
    recognition.lang = navigator.language || "en-GH";
    recognition.continuous = true;
    recognition.interimResults = true;
    const lead = base.trim();

    recognition.onresult = (event) => {
      const said = transcriptOf(event.results);
      onText(lead && said ? `${lead} ${said}` : lead || said);
    };
    recognition.onerror = (event) => {
      // Silence and a manual stop are not problems worth a message.
      if (event.error === "no-speech" || event.error === "aborted") return;
      setError(MESSAGES[event.error] ?? "Voice didn't work. Try again or type instead.");
    };
    recognition.onend = () => {
      active.current = null;
      setListening(false);
    };

    setError(null);
    active.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      active.current = null;
      setError("Voice didn't work. Try again or type instead.");
    }
  }, []);

  return { supported, listening, error, start, stop, clearError: () => setError(null) };
}
