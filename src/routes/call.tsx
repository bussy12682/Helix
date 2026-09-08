import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Mic, MicOff, PhoneOff, Send, Volume2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { HelixMark } from "@/components/helix/logo";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ApiRequestError, analyzeProject, getStoredSessionToken, sendVoiceTurn, transcribeVoiceNote } from "@/lib/api";

export const Route = createFileRoute("/call")({
  head: () => ({
    meta: [
      { title: "Voice Call with HELIX AI" },
      { name: "description", content: "Brief your AI engineering team by voice and watch requirements form in real time." },
      { property: "og:title", content: "Voice Call with HELIX AI" },
      { property: "og:description", content: "Talk through your project with HELIX." },
    ],
  }),
  component: VoiceCall,
});

function format(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

type SpeechRecognitionResultEvent = Event & {
  resultIndex: number;
  results: SpeechRecognitionResultList;
};

type SpeechRecognitionInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onerror: ((event: Event & { error?: string }) => void) | null;
  onend: (() => void) | null;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;
type ConversationMessage = { role: "user" | "assistant"; content: string };

function getSpeechRecognition() {
  if (typeof window === "undefined") return null;
  const browserWindow = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition ?? null;
}

function VoiceCall() {
  const [elapsed, setElapsed] = useState(0);
  const [muted, setMuted] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [isWaiting, setIsWaiting] = useState(false);
  const [hasStartedListening, setHasStartedListening] = useState(false);
  const [recognitionSupported, setRecognitionSupported] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [isReplying, setIsReplying] = useState(false);
  const [isTranscribingCall, setIsTranscribingCall] = useState(false);
  const [assistantReply, setAssistantReply] = useState("");
  const conversationRef = useRef<ConversationMessage[]>([]);
  const lastSentTranscriptRef = useRef("");
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const callRecorderRef = useRef<MediaRecorder | null>(null);
  const callStreamRef = useRef<MediaStream | null>(null);
  const callAudioSegmentsRef = useRef<Blob[]>([]);
  const callAudioChunksRef = useRef<Blob[]>([]);
  const callAudioStopResolverRef = useRef<(() => void) | null>(null);
  const liveTranscriptProducedRef = useRef(false);
  const isEndingCallRef = useRef(false);
  const keepListeningRef = useRef(true);
  const continuationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallbackSegmentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallbackCaptureRef = useRef(false);
  const navigate = useNavigate();

  const draft = (() => {
    try {
      const raw = sessionStorage.getItem("helix_project_draft");
      return raw ? JSON.parse(raw) as { name?: string } : {};
    } catch {
      return {};
    }
  })();

  async function sendUserTurn(content: string) {
    const trimmedContent = content.trim();
    if (!trimmedContent || !draft.name || isReplying || trimmedContent === lastSentTranscriptRef.current) return;

    lastSentTranscriptRef.current = trimmedContent;
    const nextMessages = [...conversationRef.current, { role: "user" as const, content: trimmedContent }];
    conversationRef.current = nextMessages;
    setMessages(nextMessages);
    setAssistantReply("");
    setIsReplying(true);

    try {
      const token = getStoredSessionToken();
      if (!token) {
        navigate({ to: "/login" });
        return;
      }
      const response = await sendVoiceTurn({ name: draft.name, messages: nextMessages }, token);
      const assistantMessage = { role: "assistant" as const, content: response.reply };
      const conversation = [...nextMessages, assistantMessage];
      conversationRef.current = conversation;
      setMessages(conversation);
      setAssistantReply(response.reply);
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(response.reply));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "HELIX could not respond.");
    } finally {
      setIsReplying(false);
    }
  }

  function sendTypedTurn() {
    if (!transcript.trim()) {
      toast.info("Type a message about your project first.");
      return;
    }
    void sendUserTurn(transcript);
  }

  useEffect(() => {
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const SpeechRecognition = getSpeechRecognition();
    if (!SpeechRecognition) {
      setRecognitionSupported(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      let finalText = "";
      let interimText = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) finalText += `${result[0].transcript} `;
        else interimText += `${result[0].transcript} `;
      }
      if (finalText) {
        liveTranscriptProducedRef.current = true;
        setTranscript((current) => `${current} ${finalText}`.trim());
        void sendUserTurn(finalText);
      }
      setInterimTranscript(interimText.trim());
      setIsWaiting(false);
      if (continuationTimerRef.current) clearTimeout(continuationTimerRef.current);
    };
    recognition.onerror = (event) => {
      if (event.error === "aborted") return;
      setIsListening(false);
      setIsWaiting(false);
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        toast.error("Microphone access failed. Check your browser permission and try again.");
      } else if (event.error === "audio-capture") {
        keepListeningRef.current = false;
        toast.error("No microphone was found. Connect a microphone and try again.");
      } else if (event.error === "network") {
        keepListeningRef.current = true;
        fallbackCaptureRef.current = true;
        setRecognitionSupported(false);
        recognitionRef.current = null;
        scheduleFallbackSegment();
      }
    };
    recognition.onend = () => {
      if (!keepListeningRef.current) {
        setIsListening(false);
        return;
      }
      if (recognitionRef.current !== recognition) return;

      setIsWaiting(true);
      if (continuationTimerRef.current) clearTimeout(continuationTimerRef.current);
      continuationTimerRef.current = setTimeout(() => {
        setIsWaiting(false);
        try {
          recognition.start();
          setIsListening(true);
        } catch {
          setIsWaiting(false);
        }
      }, 350);
    };
    recognitionRef.current = recognition;

    return () => {
      keepListeningRef.current = false;
      if (continuationTimerRef.current) clearTimeout(continuationTimerRef.current);
      recognition.stop();
      void stopAudioCapture();
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      recognitionRef.current = null;
    };
  }, []);

  function scheduleFallbackSegment() {
    if (fallbackSegmentTimerRef.current) clearTimeout(fallbackSegmentTimerRef.current);
    fallbackSegmentTimerRef.current = setTimeout(() => {
      const recorder = callRecorderRef.current;
      if (fallbackCaptureRef.current && recorder?.state === "recording") recorder.stop();
    }, 4500);
  }

  async function startAudioCapture() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return false;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      callAudioChunksRef.current = [];
      liveTranscriptProducedRef.current = false;
      fallbackCaptureRef.current = !recognitionRef.current || !recognitionSupported;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) callAudioChunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        const blob = new Blob(callAudioChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        callStreamRef.current?.getTracks().forEach((track) => track.stop());
        callStreamRef.current = null;
        if (blob.size > 0) {
          callAudioSegmentsRef.current.push(blob);
          if (isEndingCallRef.current || liveTranscriptProducedRef.current || !fallbackCaptureRef.current) {
            callAudioStopResolverRef.current?.();
            callAudioStopResolverRef.current = null;
            return;
          }

          const token = getStoredSessionToken();
          if (token) {
            setIsTranscribingCall(true);
            try {
              const result = await transcribeVoiceNote(blob, token);
              await sendUserTurn(result.transcript);
            } catch (error) {
              if (error instanceof ApiRequestError && error.code === "AI_RATE_LIMITED") {
                fallbackCaptureRef.current = false;
                keepListeningRef.current = false;
                setIsListening(false);
                toast.error("Voice transcription is temporarily rate-limited. Try again in a moment or use browser speech recognition.");
              } else {
                toast.error(error instanceof Error ? error.message : "Could not transcribe that voice turn.");
              }
            } finally {
              setIsTranscribingCall(false);
            }
          }
        }
        if (fallbackCaptureRef.current && keepListeningRef.current && !isEndingCallRef.current) {
          void startAudioCapture();
        }
        callAudioStopResolverRef.current?.();
        callAudioStopResolverRef.current = null;
      };
      callStreamRef.current = stream;
      callRecorderRef.current = recorder;
      recorder.start();
      if (fallbackCaptureRef.current) scheduleFallbackSegment();
      return true;
    } catch (error) {
      toast.error(error instanceof DOMException && error.name === "NotAllowedError"
        ? "Microphone access is required for the voice call."
        : "Could not start microphone capture.");
      return false;
    }
  }

  function stopAudioCapture() {
    if (fallbackSegmentTimerRef.current) {
      clearTimeout(fallbackSegmentTimerRef.current);
      fallbackSegmentTimerRef.current = null;
    }
    const recorder = callRecorderRef.current;
    if (!recorder || recorder.state === "inactive") return Promise.resolve();

    return new Promise<void>((resolve) => {
      callAudioStopResolverRef.current = resolve;
      recorder.requestData();
      recorder.stop();
      callRecorderRef.current = null;
    });
  }

  async function toggleListening() {
    if (!recognitionRef.current || !recognitionSupported) {
      if (isListening) {
        await stopAudioCapture();
        setIsListening(false);
        setMuted(true);
      } else {
        setHasStartedListening(true);
        const started = await startAudioCapture();
        if (!started) return;
        setIsListening(true);
        setMuted(false);
        toast.info("Your voice is being recorded. End the call when you are finished.");
      }
      return;
    }
    if (isListening) {
      keepListeningRef.current = false;
      recognitionRef.current.stop();
      await stopAudioCapture();
      setIsListening(false);
      setIsWaiting(false);
    } else {
      keepListeningRef.current = true;
      setHasStartedListening(true);
      const started = await startAudioCapture();
      if (!started) return;
      try {
        recognitionRef.current.start();
        setIsListening(true);
        setIsWaiting(false);
      } catch {
        fallbackCaptureRef.current = true;
        setRecognitionSupported(false);
        recognitionRef.current = null;
        setIsListening(true);
        scheduleFallbackSegment();
      }
    }
  }

  async function endCall() {
    if (isReplying) {
      toast.info("Let HELIX finish responding before ending the call.");
      return;
    }
    keepListeningRef.current = false;
    isEndingCallRef.current = true;
    if (continuationTimerRef.current) clearTimeout(continuationTimerRef.current);
    if (fallbackSegmentTimerRef.current) clearTimeout(fallbackSegmentTimerRef.current);
    recognitionRef.current?.stop();
    await stopAudioCapture();
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    const token = getStoredSessionToken();
    let description = `${transcript} ${interimTranscript}`.trim();
    if (!description && callAudioSegmentsRef.current.length > 0 && token) {
      setIsAnalyzing(true);
      try {
        const audio = new Blob(callAudioSegmentsRef.current, {
          type: callAudioSegmentsRef.current[0].type || "audio/webm",
        });
        const result = await transcribeVoiceNote(audio, token);
        description = result.transcript.trim();
        setTranscript(description);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not transcribe the voice recording.");
      }
    }
    const conversation = conversationRef.current.length > 0
      ? conversationRef.current
      : description
        ? [{ role: "user" as const, content: description }]
        : [];
    if (!token) {
      navigate({ to: "/login" });
      return;
    }
    if (!draft.name || !description) {
      toast.error("Say a little about your project before ending the call.");
      return;
    }

    setIsAnalyzing(true);
    try {
      const analysis = await analyzeProject({ name: draft.name, description, conversation }, token);
      sessionStorage.setItem(
        "helix_project_analysis",
        JSON.stringify({ ...analysis, name: draft.name, description }),
      );
      sessionStorage.removeItem("helix_project_draft");
      navigate({ to: "/projects/summary" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not analyze the voice brief.");
    } finally {
      setIsAnalyzing(false);
    }
  }

  return (
    <div className="surface-night grid-glow flex min-h-screen flex-col items-center px-6 py-8">
      <div className="flex w-full max-w-lg items-center justify-between">
        <span className="text-sm font-semibold">Voice Call with HELIX AI</span>
        <Button asChild variant="ghost" size="icon" className="text-night-muted hover:bg-white/5">
          <Link to="/projects/new" aria-label="Close call">
            <X className="h-4 w-4" />
          </Link>
        </Button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center">
        <div className="relative flex h-56 w-56 items-center justify-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-primary/15" />
          <span className="absolute inset-6 rounded-full bg-primary/20" />
          <span className="absolute inset-12 rounded-full bg-primary/30" />
          <span className="relative flex h-24 w-24 items-center justify-center rounded-full bg-primary shadow-glow">
            <HelixMark className="h-10 w-10 text-primary-foreground" />
          </span>
        </div>
        <p className="mt-8 font-display text-2xl font-bold tabular-nums">{format(elapsed)}</p>
        <p className="mt-2 min-h-12 max-w-sm text-center text-sm text-night-muted" aria-live="polite">
          {muted
            ? "Microphone muted"
              : isTranscribingCall
                ? "Transcribing your voice..."
              : isReplying
              ? "HELIX is responding..."
              : assistantReply
                ? assistantReply
              : !hasStartedListening
                ? "Click the microphone to start speaking about your project."
                : isWaiting
              ? "Pause detected. Continue speaking within five seconds..."
              : isListening
                ? transcript || interimTranscript || "Listening for your project brief..."
                : recognitionSupported
                  ? "Microphone is paused"
                  : "Voice recording is active. End the call when you are finished."}
        </p>

        <div className="mt-8 w-full max-w-lg">
          <label htmlFor="voice-transcript" className="mb-2 block text-xs font-medium text-night-muted">
            Transcript
          </label>
          <Textarea
            id="voice-transcript"
            value={interimTranscript ? `${transcript} ${interimTranscript}` : transcript}
            onChange={(event) => {
              setTranscript(event.target.value);
              setInterimTranscript("");
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                sendTypedTurn();
              }
            }}
            placeholder="Your transcript will appear here. You can edit it before ending the call."
            className="min-h-28 border-night-border bg-white/5 text-night-foreground placeholder:text-night-muted"
          />
          <div className="mt-2 flex justify-end">
            <Button type="button" size="sm" onClick={sendTypedTurn} disabled={isReplying || !transcript.trim()}>
              <Send className="mr-1.5 h-4 w-4" /> Send to HELIX
            </Button>
          </div>
          <div className="mt-3 max-h-32 space-y-2 overflow-y-auto text-xs text-night-muted" aria-live="polite">
            {messages.map((message, index) => (
              <p key={`${message.role}-${index}`}>
                <span className="font-semibold text-night-foreground">{message.role === "user" ? "You" : "HELIX"}:</span>{" "}
                {message.content}
              </p>
            ))}
          </div>
        </div>

        <div className="mt-10 flex items-center gap-4">
          <button
            type="button"
            onClick={() => {
              setMuted(isListening);
              void toggleListening();
            }}
            className="flex h-12 w-12 items-center justify-center rounded-full border border-night-border text-night-foreground transition-colors hover:bg-white/5"
            aria-label={isListening ? "Pause microphone" : "Start microphone"}
          >
            {muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </button>
          <Button
            size="lg"
            variant="destructive"
            className="rounded-full px-7"
            onClick={endCall}
            disabled={isAnalyzing || isReplying}
          >
            <PhoneOff className="mr-2 h-4 w-4" /> {isAnalyzing ? "Analyzing..." : "End Call"}
          </Button>
          <button
            type="button"
            className="flex h-12 w-12 items-center justify-center rounded-full border border-night-border text-night-foreground transition-colors hover:bg-white/5"
            aria-label="Speaker"
          >
            <Volume2 className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-6 flex gap-10 text-xs text-night-muted">
          <span>Mute</span>
          <span>End</span>
          <span>Speaker</span>
        </div>
      </div>

      <p className="max-w-sm text-center text-xs text-night-muted">
        You can end the call at any time. HELIX will analyse the conversation and
        produce a project summary for your approval.
      </p>
    </div>
  );
}
