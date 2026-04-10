import React, { useState, useRef, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Mic, Square, Play, Share2, Trash2, Languages, Loader2, AlertCircle, Download, Copy,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useGetSettings } from "@workspace/api-client-react";

// ─── Types ──────────────────────────────────────────────────────────────────

type Lang = "nl" | "en" | "it";

interface TranslationEntry {
  id: string;
  timestamp: number;
  sourceText: string;
  sourceLang: Lang;
  targetText: string;
  targetLang: Lang;
  audioBase64: string;
  audioMimeType: string;
}

const LANG_FLAGS: Record<Lang, string> = {
  nl: "🇳🇱",
  en: "🇬🇧",
  it: "🇮🇹",
};

const LANG_LABELS: Record<Lang, string> = {
  nl: "Nederlands",
  en: "English",
  it: "Italiano",
};

type TranslateMode =
  | "nl-it"
  | "en-it"
  | "nl-en"
  | "en-to-it"
  | "it-to-nl"
  | "it-to-en"
  | "nl-to-it"
  | "nl-to-en"
  | "en-to-nl";

const MODE_LABELS: Record<TranslateMode, string> = {
  "nl-it": "🇳🇱 NL ↔ 🇮🇹 IT",
  "en-it": "🇬🇧 EN ↔ 🇮🇹 IT",
  "nl-en": "🇳🇱 NL ↔ 🇬🇧 EN",
  "en-to-it": "🇬🇧 EN → 🇮🇹 IT",
  "it-to-nl": "🇮🇹 IT → 🇳🇱 NL",
  "it-to-en": "🇮🇹 IT → 🇬🇧 EN",
  "nl-to-it": "🇳🇱 NL → 🇮🇹 IT",
  "nl-to-en": "🇳🇱 NL → 🇬🇧 EN",
  "en-to-nl": "🇬🇧 EN → 🇳🇱 NL",
};

const STORAGE_KEY = "studyflow.vertalen.history";
const MODE_KEY = "studyflow.vertalen.mode";
const PRIMARY_LANG_KEY = "studyflow.vertalen.primaryLang"; // legacy migration

// ─── Helpers ────────────────────────────────────────────────────────────────

function loadHistory(): TranslationEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as TranslationEntry[]) : [];
  } catch {
    return [];
  }
}

function saveHistory(entries: TranslationEntry[]) {
  try {
    // Keep only last 30 entries to avoid localStorage bloat
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-30)));
  } catch {
    /* quota exceeded — ignore */
  }
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function Vertalen() {
  const { toast } = useToast();
  const { data: settings } = useGetSettings();
  const autoPlayEnabled = settings?.voiceEnabled !== false; // default true if undefined

  const [mode, setMode] = useState<TranslateMode>(() => {
    const stored = localStorage.getItem(MODE_KEY);
    if (stored && stored in MODE_LABELS) return stored as TranslateMode;
    // Migrate from legacy primaryLang key
    const legacy = localStorage.getItem(PRIMARY_LANG_KEY);
    return legacy === "en" ? "en-it" : "nl-it";
  });

  const [entries, setEntries] = useState<TranslationEntry[]>(() => loadHistory());
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    saveHistory(entries);
  }, [entries]);

  useEffect(() => {
    localStorage.setItem(MODE_KEY, mode);
  }, [mode]);

  // Scroll to newest entry
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      // Walk up to find the ScrollArea viewport (Radix puts overflow on a parent)
      const viewport = el.closest<HTMLDivElement>("[data-radix-scroll-area-viewport]");
      (viewport || el).scrollTo({ top: (viewport || el).scrollHeight, behavior: "smooth" });
    }
  }, [entries.length]);

  // Clean up mic stream on unmount
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // ─── Recording ─────────────────────────────────────────────────────────

  const startRecording = async () => {
    setPermissionError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Pick a mime type the browser supports
      const mimeType =
        MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" :
        MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" :
        MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" :
        "";

      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        await sendAudio(blob);
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    } catch (err) {
      console.error("Mic error:", err);
      setPermissionError(
        err instanceof Error && err.name === "NotAllowedError"
          ? "Microfoon toegang geweigerd. Sta microfoon toe in je browser instellingen."
          : "Kon microfoon niet starten.",
      );
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  };

  const toggleRecording = () => {
    if (isRecording) stopRecording();
    else if (!isProcessing) startRecording();
  };

  // ─── Send to backend ────────────────────────────────────────────────────

  const sendAudio = async (blob: Blob) => {
    setIsProcessing(true);
    try {
      const formData = new FormData();
      const ext = blob.type.includes("mp4") ? "mp4" : "webm";
      formData.append("audio", blob, `recording.${ext}`);
      formData.append("mode", mode);

      const res = await fetch(import.meta.env.BASE_URL + "api/translate/speech", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Vertaling mislukt." }));
        throw new Error(err.error || "Vertaling mislukt.");
      }

      const data = await res.json();
      const entry: TranslationEntry = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        sourceText: data.sourceText,
        sourceLang: data.sourceLang,
        targetText: data.targetText,
        targetLang: data.targetLang,
        audioBase64: data.audioBase64,
        audioMimeType: data.audioMimeType || "audio/mpeg",
      };
      setEntries((prev) => [...prev, entry]);

      // Auto-play the translated audio if voice output is enabled in settings
      if (autoPlayEnabled) {
        playAudio(entry);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Vertaling mislukt.";
      toast({ title: "Fout", description: message, variant: "destructive" });
    } finally {
      setIsProcessing(false);
    }
  };

  // ─── Playback ──────────────────────────────────────────────────────────

  const playAudio = (entry: TranslationEntry) => {
    try {
      const blob = base64ToBlob(entry.audioBase64, entry.audioMimeType);
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      audio.play().catch((e) => {
        console.error("Playback failed:", e);
        URL.revokeObjectURL(url);
      });
    } catch (e) {
      console.error("Playback error:", e);
    }
  };

  // ─── Sharing ────────────────────────────────────────────────────────────

  /**
   * Share the translated audio + text to any external app (WhatsApp, iMessage,
   * email, etc.) via the native share sheet. Falls back to download on platforms
   * that don't support Web Share with files (most desktop browsers).
   */
  const shareAudio = async (entry: TranslationEntry) => {
    try {
      const blob = base64ToBlob(entry.audioBase64, entry.audioMimeType);
      const file = new File(
        [blob],
        `vertaling-${entry.sourceLang}-${entry.targetLang}.mp3`,
        { type: entry.audioMimeType },
      );

      // Prefer Web Share API with files (opens native share sheet on iOS/Android)
      const nav = navigator as Navigator & {
        canShare?: (data: ShareData) => boolean;
        share?: (data: ShareData) => Promise<void>;
      };

      if (nav.share && nav.canShare && nav.canShare({ files: [file] })) {
        await nav.share({
          files: [file],
          title: "Vertaling",
          text: entry.targetText,
        });
        return;
      }

      // Fallback 1: Web Share with just text (iOS Safari on older versions)
      if (nav.share) {
        try {
          await nav.share({
            title: "Vertaling",
            text: entry.targetText,
          });
          // Still download the audio so they can attach it manually
          downloadAudio(entry);
          toast({
            title: "Audio gedownload",
            description: "De tekst is gedeeld en het audiobestand is gedownload.",
          });
          return;
        } catch {
          /* fall through to download */
        }
      }

      // Fallback 2: pure download (desktop)
      downloadAudio(entry);
      toast({
        title: "Audio gedownload",
        description: "Open WhatsApp/e-mail en voeg het bestand toe als bijlage.",
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      console.error("Share error:", err);
      toast({
        title: "Delen mislukt",
        description: "Probeer de download-knop.",
        variant: "destructive",
      });
    }
  };

  const downloadAudio = (entry: TranslationEntry) => {
    const blob = base64ToBlob(entry.audioBase64, entry.audioMimeType);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vertaling-${entry.sourceLang}-${entry.targetLang}.mp3`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyText = async (entry: TranslationEntry) => {
    try {
      await navigator.clipboard.writeText(entry.targetText);
      toast({ title: "Gekopieerd", description: "Vertaling staat op het klembord." });
    } catch {
      toast({ title: "Kopiëren mislukt", variant: "destructive" });
    }
  };

  // ─── Entry management ─────────────────────────────────────────────────

  const clearHistory = () => {
    if (!confirm("Weet je zeker dat je het gesprek wilt wissen?")) return;
    setEntries([]);
    localStorage.removeItem(STORAGE_KEY);
  };

  // ─── Render ────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between mb-2 md:mb-4 gap-2">
        <div className="min-w-0">
          <h1 className="text-xl md:text-3xl font-bold flex items-center gap-2">
            <Languages className="h-5 w-5 md:h-7 md:w-7 text-primary" />
            Vertaler
          </h1>
          <p className="text-muted-foreground text-xs md:text-sm mt-0.5 hidden md:block">
            Universele spraak-vertaler.
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <select
            className="text-xs md:text-sm border rounded-md px-2 py-1 bg-background h-8"
            value={mode}
            onChange={(e) => setMode(e.target.value as TranslateMode)}
            aria-label="Talenpaar"
          >
            <optgroup label="Auto-detecteer">
              <option value="nl-it">{MODE_LABELS["nl-it"]}</option>
              <option value="en-it">{MODE_LABELS["en-it"]}</option>
              <option value="nl-en">{MODE_LABELS["nl-en"]}</option>
            </optgroup>
            <optgroup label="Vaste richting">
              <option value="nl-to-it">{MODE_LABELS["nl-to-it"]}</option>
              <option value="en-to-it">{MODE_LABELS["en-to-it"]}</option>
              <option value="it-to-nl">{MODE_LABELS["it-to-nl"]}</option>
              <option value="it-to-en">{MODE_LABELS["it-to-en"]}</option>
              <option value="nl-to-en">{MODE_LABELS["nl-to-en"]}</option>
              <option value="en-to-nl">{MODE_LABELS["en-to-nl"]}</option>
            </optgroup>
          </select>
          {entries.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={clearHistory}
              aria-label="Wis gesprek"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </header>

      {/* Conversation log */}
      <Card className="flex-1 flex flex-col overflow-hidden border-primary/20">
        <CardContent className="flex-1 flex flex-col p-0 overflow-hidden">
          <ScrollArea className="flex-1">
            <div ref={scrollRef} className="p-3 md:p-4 space-y-3">
              {entries.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 md:p-10 text-muted-foreground">
                  <Languages className="h-10 w-10 md:h-14 md:w-14 opacity-20 mb-3" />
                  <h3 className="text-base md:text-lg font-medium text-foreground mb-1">
                    Spreek iets in om te vertalen
                  </h3>
                  <p className="text-xs md:text-sm max-w-md">
                    Druk op de knop en zeg iets in het Nederlands, Engels of Italiaans.
                    Ik detecteer automatisch de taal en vertaal.
                  </p>
                </div>
              ) : (
                entries.map((entry) => (
                  <div key={entry.id} className="rounded-xl border bg-card p-3 space-y-2">
                    {/* Source */}
                    <div className="flex items-start gap-2">
                      <span className="text-lg leading-none shrink-0 mt-0.5">{LANG_FLAGS[entry.sourceLang]}</span>
                      <div className="flex-1 min-w-0">
                        <Badge variant="outline" className="text-[10px] mb-1">
                          {LANG_LABELS[entry.sourceLang]}
                        </Badge>
                        <p className="text-sm text-muted-foreground">{entry.sourceText}</p>
                      </div>
                    </div>

                    {/* Target (translation) */}
                    <div className="flex items-start gap-2 pt-1 border-t">
                      <span className="text-lg leading-none shrink-0 mt-0.5">{LANG_FLAGS[entry.targetLang]}</span>
                      <div className="flex-1 min-w-0">
                        <Badge className="text-[10px] mb-1">
                          {LANG_LABELS[entry.targetLang]}
                        </Badge>
                        <p className="text-sm font-medium">{entry.targetText}</p>
                      </div>
                    </div>

                    {/* Actions — Delen is primary, always visible */}
                    <div className="flex items-center gap-1.5 pt-1 flex-wrap">
                      <Button
                        variant="default"
                        size="sm"
                        className="h-8 text-xs flex-1 min-w-[110px]"
                        onClick={() => shareAudio(entry)}
                      >
                        <Share2 className="h-3.5 w-3.5 mr-1.5" /> Stuur audio
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-8 text-xs"
                        onClick={() => playAudio(entry)}
                        aria-label="Afspelen"
                      >
                        <Play className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs"
                        onClick={() => copyText(entry)}
                        aria-label="Kopieer tekst"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-xs"
                        onClick={() => downloadAudio(entry)}
                        aria-label="Download"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>

          {/* Error */}
          {permissionError && (
            <div className="px-4 py-2 bg-destructive/10 border-t border-destructive/20 text-destructive text-xs flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {permissionError}
            </div>
          )}

          {/* Record button */}
          <div className="p-4 border-t bg-background flex flex-col items-center gap-2">
            <Button
              onClick={toggleRecording}
              disabled={isProcessing}
              size="lg"
              className={`h-16 w-16 rounded-full shadow-lg transition-all ${
                isRecording
                  ? "bg-destructive hover:bg-destructive/90 animate-pulse"
                  : "bg-primary hover:bg-primary/90"
              }`}
              aria-label={isRecording ? "Stop opname" : "Start opname"}
            >
              {isProcessing ? (
                <Loader2 className="h-7 w-7 animate-spin" />
              ) : isRecording ? (
                <Square className="h-6 w-6 fill-current" />
              ) : (
                <Mic className="h-7 w-7" />
              )}
            </Button>
            <p className="text-[11px] text-muted-foreground text-center">
              {isProcessing
                ? "Bezig met vertalen..."
                : isRecording
                  ? "Tik om te stoppen"
                  : "Tik om op te nemen"}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
