import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { FileUp, Keyboard, Mic, Phone, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { AppShell, Panel } from "@/components/helix/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { analyzeProject, extractProjectDocument, getStoredSessionToken, transcribeVoiceNote } from "@/lib/api";

export const Route = createFileRoute("/projects/new")({
  head: () => ({
    meta: [
      { title: "New Project — HELIX" },
      { name: "description", content: "Describe your product by typing, voice call, voice note or document upload." },
      { property: "og:title", content: "New Project — HELIX" },
      { property: "og:description", content: "Choose how you brief your AI engineering team." },
    ],
  }),
  component: NewProject,
});

const methods = [
  { id: "type", icon: Keyboard, title: "Type", copy: "Describe your project in writing." },
  { id: "call", icon: Phone, title: "Voice Call", copy: "Talk it through with HELIX AI." },
  { id: "note", icon: Mic, title: "Voice Note", copy: "Record a brief and send it over." },
  { id: "upload", icon: FileUp, title: "Upload Document", copy: "PDF, DOCX or Markdown spec." },
] as const;

type NoteSpeechResultEvent = Event & { resultIndex: number; results: SpeechRecognitionResultList };
type NoteSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onerror: ((event: Event & { error?: string }) => void) | null;
  onend: (() => void) | null;
  onresult: ((event: NoteSpeechResultEvent) => void) | null;
  start: () => void;
  stop: () => void;
};
type NoteSpeechConstructor = new () => NoteSpeechRecognition;

function getNoteSpeechRecognition() {
  if (typeof window === "undefined") return null;
  const browserWindow = window as Window & {
    SpeechRecognition?: NoteSpeechConstructor;
    webkitSpeechRecognition?: NoteSpeechConstructor;
  };
  return browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition ?? null;
}

function NewProject() {
  const [method, setMethod] = useState<(typeof methods)[number]["id"]>("type");
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isReadingFile, setIsReadingFile] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRecordingNote, setIsRecordingNote] = useState(false);
  const [isTranscribingNote, setIsTranscribingNote] = useState(false);
  const [recordedAudioUrl, setRecordedAudioUrl] = useState<string | null>(null);
  const noteRecorderRef = useRef<MediaRecorder | null>(null);
  const noteStreamRef = useRef<MediaStream | null>(null);
  const noteSpeechRef = useRef<NoteSpeechRecognition | null>(null);
  const noteAudioChunksRef = useRef<Blob[]>([]);
  const noteTranscriptRef = useRef('');
  const isRecordingNoteRef = useRef(false);
  const navigate = useNavigate();

  useEffect(() => () => {
    isRecordingNoteRef.current = false;
    noteSpeechRef.current?.stop();
    noteRecorderRef.current?.stop();
    noteStreamRef.current?.getTracks().forEach((track) => track.stop());
    if (recordedAudioUrl) URL.revokeObjectURL(recordedAudioUrl);
  }, [recordedAudioUrl]);

  function startVoiceCall() {
    if (!name.trim()) {
      toast.error('Add a project name before starting the voice call.');
      return;
    }

    sessionStorage.setItem('helix_project_draft', JSON.stringify({ name: name.trim() }));
    navigate({ to: '/call' });
  }

  async function toggleVoiceNote() {
    if (isRecordingNote) {
      isRecordingNoteRef.current = false;
      noteSpeechRef.current?.stop();
      noteRecorderRef.current?.stop();
      noteStreamRef.current?.getTracks().forEach((track) => track.stop());
      setIsRecordingNote(false);
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      toast.error('Voice notes are not supported in this browser. Use Chrome or Edge.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      noteAudioChunksRef.current = [];
      noteTranscriptRef.current = '';
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) noteAudioChunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        const blob = new Blob(noteAudioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        if (blob.size > 0) {
          if (recordedAudioUrl) URL.revokeObjectURL(recordedAudioUrl);
          setRecordedAudioUrl(URL.createObjectURL(blob));
          const token = getStoredSessionToken();
          if (token && !noteTranscriptRef.current.trim()) {
            setIsTranscribingNote(true);
            try {
              const result = await transcribeVoiceNote(blob, token);
              setDescription((current) => `${current} ${result.transcript}`.trim());
              toast.success('Voice note transcribed. You can edit it before continuing.');
            } catch (error) {
              toast.error(error instanceof Error ? error.message : 'Could not transcribe the voice note.');
            } finally {
              setIsTranscribingNote(false);
            }
          }
        }
      };
      noteStreamRef.current = stream;
      noteRecorderRef.current = recorder;
      recorder.start();
      isRecordingNoteRef.current = true;

      const SpeechRecognition = getNoteSpeechRecognition();
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';
        recognition.onresult = (event) => {
          let finalText = '';
          let interimText = '';
          for (let index = event.resultIndex; index < event.results.length; index += 1) {
            const result = event.results[index];
            if (result.isFinal) finalText += `${result[0].transcript} `;
            else interimText += `${result[0].transcript} `;
          }
          if (finalText.trim()) {
            noteTranscriptRef.current += `${finalText} `;
            setDescription((current) => `${current} ${finalText}`.trim());
          }
          void interimText;
        };
        recognition.onerror = (event) => {
          const recoverableError = event.error === 'no-speech' || event.error === 'aborted';
          if (recoverableError) return;

          isRecordingNoteRef.current = false;
          if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
            toast.error('Microphone permission was denied. Allow microphone access and start again.');
          } else if (event.error === 'audio-capture') {
            toast.error('No microphone was found. Connect a microphone and start again.');
          }
        };
        recognition.onend = () => {
          if (!isRecordingNoteRef.current) return;
          try {
            recognition.start();
          } catch {
            // The browser may still be closing the recognition session.
          }
        };
        noteSpeechRef.current = recognition;
        recognition.start();
      } else {
        toast.info('Recording started. Add the note text after recording in this browser.');
      }

      setIsRecordingNote(true);
    } catch (error) {
      isRecordingNoteRef.current = false;
      setIsRecordingNote(false);
      noteRecorderRef.current = null;
      noteStreamRef.current?.getTracks().forEach((track) => track.stop());
      noteStreamRef.current = null;
      toast.error(error instanceof DOMException && error.name === 'NotAllowedError'
        ? 'Microphone permission is required for voice notes.'
        : 'Could not start the voice note.');
    }
  }

  async function handleCreate() {
    if (isRecordingNote) {
      toast.info('Stop the voice note before continuing so the final words are captured.');
      return;
    }
    const token = getStoredSessionToken();
    if (!token) {
      navigate({ to: '/login' });
      return;
    }
    if (!name.trim() || (!description.trim() && !selectedFile)) {
      toast.error('Project name and description are required.');
      return;
    }

    setIsSubmitting(true);
    try {
      let projectDescription = description.trim();
      if (selectedFile) {
        setIsReadingFile(true);
        const document = await extractProjectDocument(selectedFile, token);
        projectDescription = document.description;
        if (document.truncated) toast.info('The document was trimmed to the first 30,000 characters.');
      }
      const analysis = await analyzeProject({ name: name.trim(), description: projectDescription }, token);
      sessionStorage.setItem(
        'helix_project_analysis',
        JSON.stringify({ ...analysis, name: name.trim(), description: projectDescription }),
      );
      toast.success('Brief analyzed. Review your project summary.');
      navigate({ to: '/projects/summary' });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create project.');
    } finally {
      setIsReadingFile(false);
      setIsSubmitting(false);
    }
  }

  return (
    <AppShell title="Create New Project" subtitle="How would you like to describe your project?">
      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <Panel title="Choose a method">
          <div className="grid gap-3 sm:grid-cols-2">
            {methods.map((m) => {
              const selected = method === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    if (method === "note" && isRecordingNote) void toggleVoiceNote();
                    setMethod(m.id);
                  }}
                  className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-colors ${
                    selected
                      ? "border-primary bg-accent"
                      : "border-border hover:bg-muted"
                  }`}
                >
                  <m.icon className={`mt-0.5 h-5 w-5 ${selected ? "text-primary" : "text-muted-foreground"}`} />
                  <span>
                    <span className="block text-sm font-semibold">{m.title}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{m.copy}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-5 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="project-name">Project name</Label>
              <Input id="project-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="E-commerce platform" />
            </div>
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={7}
              placeholder={method === "type"
                ? "Describe the product, users, and outcome you want to build..."
                : method === "call"
                  ? "Add a short brief before starting the voice workflow..."
                  : method === "note"
                    ? "Paste the transcript or brief from your voice note..."
                    : "Paste the key requirements from your document..."}
            />
            {method === "note" && (
              <div className="space-y-3 rounded-xl border border-dashed border-border p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">Record your voice note</p>
                    <p className="text-xs text-muted-foreground">
                      Speak naturally. HELIX will transcribe the note into the brief.
                    </p>
                  </div>
                  <Button type="button" variant={isRecordingNote ? "destructive" : "outline"} onClick={toggleVoiceNote}>
                    {isRecordingNote ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                    {isRecordingNote ? 'Stop recording' : isTranscribingNote ? 'Transcribing...' : 'Start recording'}
                  </Button>
                </div>
                {recordedAudioUrl && (
                  <audio controls src={recordedAudioUrl} className="w-full" aria-label="Recorded voice note" />
                )}
              </div>
            )}
                  {method === "upload" && (
                    <div className="space-y-2 rounded-xl border border-dashed border-border p-4">
                      <Label htmlFor="project-document">Project document</Label>
                      <Input
                        id="project-document"
                        type="file"
                        accept=".pdf,.docx,.md,.markdown,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown,text/plain"
                        onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
                      />
                      <p className="text-xs text-muted-foreground">PDF, DOCX, Markdown or text, up to 10 MB.</p>
                      {selectedFile && <p className="text-sm text-foreground">Selected: {selectedFile.name}</p>}
                    </div>
                  )}
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" asChild>
              <Link to="/dashboard">Cancel</Link>
            </Button>
            <Button
              onClick={method === 'call' ? startVoiceCall : handleCreate}
              disabled={isSubmitting}
            >
              {isReadingFile ? 'Reading document...' : isSubmitting ? 'Analyzing brief...' : method === 'call' ? 'Start voice call' : 'Continue'}
            </Button>
          </div>
        </Panel>

        <Panel title="What happens next" description="HELIX turns your brief into a plan">
          <ol className="space-y-4 text-sm">
            {[
              "Project Manager AI structures your requirements",
              "You approve the project summary",
              "Architecture, database and backend agents start work",
              "QA and Security agents review each build",
              "DevOps deploys to staging automatically",
            ].map((step, i) => (
              <li key={step} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
        </Panel>
      </div>
    </AppShell>
  );
}
