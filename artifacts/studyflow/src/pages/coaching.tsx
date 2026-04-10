import React, { useState, useEffect, useRef } from "react";
import { useSearch, useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Mic, Send, Loader2, Sparkles, Lightbulb, MessageSquare,
  BookOpen, CalendarDays, BrainCircuit, RotateCcw, Volume2, VolumeX,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Markdown } from "@/components/markdown";
import { CoachSpeakerButton } from "@/components/coach-speaker-button";
import { CoachAudioBar } from "@/components/coach-audio-bar";
import { speakCoachMessage } from "@/lib/speak-coach";

const AUTOPLAY_KEY = "studyflow.coach.autoplay";

// Progressive disclosure threshold — responses longer than this get truncated
// with a "Lees meer" affordance so the user can skim and listen.
const LONG_RESPONSE_WORDS = 120;

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function truncateToSentences(text: string, maxSentences = 3): string {
  // Split on sentence terminators while keeping them
  const parts = text.match(/[^.!?]+[.!?]+(\s|$)/g) || [text];
  return parts.slice(0, maxSentences).join("").trim();
}
import {
  useCreateOpenaiConversation,
  useListOpenaiConversations,
  useListOpenaiMessages,
  useDeleteOpenaiConversation,
} from "@workspace/api-client-react";
import { streamOpenAiResponse } from "@/lib/api-streaming";
import { useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";

export default function Coaching() {
  const { toast } = useToast();
  const searchString = useSearch();
  const [, navigate] = useLocation();
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [activeMaterialId, setActiveMaterialId] = useState<number | null>(null);
  const [expandedMessages, setExpandedMessages] = useState<Set<number>>(new Set());
  const [autoPlay, setAutoPlay] = useState<boolean>(() => {
    // Default OFF — user must explicitly enable to save tokens and respect
    // their environment (class, quiet spaces).
    return localStorage.getItem(AUTOPLAY_KEY) === "true";
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem(AUTOPLAY_KEY, String(autoPlay));
  }, [autoPlay]);

  const toggleExpanded = (idx: number) => {
    setExpandedMessages((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const queryClient = useQueryClient();
  const { data: conversations = [], refetch: refetchConversations } = useListOpenaiConversations();
  const createConversation = useCreateOpenaiConversation();
  const deleteConversation = useDeleteOpenaiConversation();
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);

  // Only load history when user explicitly switches to an older conversation
  const [loadHistory, setLoadHistory] = useState(false);
  const { data: historyMessages = [] } = useListOpenaiMessages(activeConversationId || 0, {
    query: { enabled: loadHistory && !!activeConversationId },
  });

  useEffect(() => {
    if (loadHistory && historyMessages.length > 0) {
      setMessages(historyMessages.map((m) => ({ role: m.role, content: m.content })));
      setLoadHistory(false);
    }
  }, [historyMessages, loadHistory]);

  const ensureConversation = async (): Promise<number> => {
    if (activeConversationId) return activeConversationId;
    // Create a new conversation for this session
    return new Promise((resolve) => {
      createConversation.mutate(
        { data: { title: `Coach ${new Date().toLocaleDateString("nl-NL")}` } },
        {
          onSuccess: (data) => {
            setActiveConversationId(data.id);
            refetchConversations();
            resolve(data.id);
          },
        },
      );
    });
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSendMessage = async (text: string = message) => {
    if (!text.trim()) return;

    const convId = await ensureConversation();
    const userMsg = text;
    setMessage("");
    setMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setIsTyping(true);

    let aiResponse = "";
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    try {
      await streamOpenAiResponse(
        `api/openai/conversations/${convId}/messages`,
        activeMaterialId
          ? { content: userMsg, materialId: activeMaterialId }
          : { content: userMsg },
        (chunk) => {
          aiResponse += chunk;
          setMessages((prev) => {
            const newMessages = [...prev];
            newMessages[newMessages.length - 1].content = aiResponse;
            return newMessages;
          });
        },
      );

      // Auto-play the finished response if enabled
      if (autoPlay && aiResponse.trim().length > 20) {
        // Use a stable key for auto-play so the speaker button state stays in sync
        const msgKey = `coaching-autoplay-${Date.now()}`;
        try {
          await speakCoachMessage(aiResponse, { key: msgKey });
        } catch {
          /* silent — speaker button is still available as fallback */
        }
      }
    } catch {
      toast({ title: "Fout", description: "Kon bericht niet verzenden", variant: "destructive" });
    } finally {
      setIsTyping(false);
    }
  };

  // Handle incoming ?material= and ?chat= params — pin the material and auto-send
  const [navParamsHandled, setNavParamsHandled] = useState(false);
  useEffect(() => {
    if (navParamsHandled) return;
    const params = new URLSearchParams(searchString);
    const materialParam = params.get("material");
    const chatParam = params.get("chat");

    if (materialParam && /^\d+$/.test(materialParam)) {
      setActiveMaterialId(Number(materialParam));
    }

    if (chatParam) {
      setNavParamsHandled(true);
      // Defer the send by one tick so state (activeMaterialId) is committed
      setTimeout(() => {
        handleSendMessage(decodeURIComponent(chatParam));
        navigate("/coaching", { replace: true });
      }, 50);
    } else if (materialParam) {
      setNavParamsHandled(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchString, navParamsHandled]);

  const handleDeleteCurrentConversation = () => {
    if (!activeConversationId) return;
    if (!confirm("Dit gesprek verwijderen?")) return;
    deleteConversation.mutate(
      { id: activeConversationId },
      {
        onSuccess: async () => {
          setActiveConversationId(null);
          setMessages([]);
          // Invalidate conversation list so the dropdown updates
          await queryClient.invalidateQueries({
            predicate: (q) => {
              const key = q.queryKey[0];
              return typeof key === "string" && key.toLowerCase().includes("openai");
            },
          });
          refetchConversations();
          toast({ title: "Gesprek verwijderd" });
        },
        onError: () => toast({ title: "Kon gesprek niet verwijderen", variant: "destructive" }),
      },
    );
  };

  const handleNewConversation = () => {
    createConversation.mutate(
      { data: { title: `Coach ${new Date().toLocaleDateString("nl-NL")}` } },
      {
        onSuccess: (data) => {
          setActiveConversationId(data.id);
          setMessages([]);
          refetchConversations();
        },
      },
    );
  };

  const toggleRecording = () => {
    if (!("webkitSpeechRecognition" in window) && !("SpeechRecognition" in window)) {
      toast({ title: "Niet ondersteund", description: "Spraakherkenning wordt niet ondersteund.", variant: "destructive" });
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || (window as unknown as { webkitSpeechRecognition: typeof window.SpeechRecognition }).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.lang = "nl-NL";

    if (isRecording) {
      setIsRecording(false);
      recognition.stop();
      return;
    }

    setIsRecording(true);
    recognition.start();

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = event.results[0][0].transcript;
      setMessage((prev) => prev + " " + transcript);
      setIsRecording(false);
    };

    recognition.onerror = () => {
      setIsRecording(false);
      toast({ title: "Fout", description: "Spraakherkenning mislukt.", variant: "destructive" });
    };

    recognition.onend = () => setIsRecording(false);
  };

  const quickActions = [
    { label: "Overhoor mij", icon: BrainCircuit, msg: "Overhoor mij over de stof die ik heb geüpload" },
    { label: "Plan mijn week", icon: CalendarDays, msg: "Help me mijn studieweek te plannen op basis van mijn toetsen en doelen" },
    { label: "Leg uit", icon: BookOpen, msg: "Leg mij het laatste onderwerp uit dat ik heb bestudeerd" },
    { label: "Reflectie", icon: Sparkles, msg: "Ik wil een wekelijkse reflectie doen. Hoe ging mijn studieweek?" },
    { label: "Genereer quiz", icon: BrainCircuit, msg: "Maak een quiz van 5 vragen over mijn studiemateriaal" },
    { label: "Studietips", icon: Lightbulb, msg: "Geef me gepersonaliseerde studietips op basis van mijn zwakke punten" },
  ];

  return (
    <div className="h-full flex flex-col -mx-3 md:mx-0">
      {/* Header — compact on mobile */}
      <header className="flex items-center justify-between mb-2 md:mb-4 px-3 md:px-0">
        <div className="min-w-0 flex items-center gap-2">
          <Lightbulb className="h-5 w-5 md:h-7 md:w-7 text-primary shrink-0" />
          <h1 className="text-base md:text-3xl font-bold truncate">Je studiecoach</h1>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {/* Auto-play toggle */}
          <Button
            variant={autoPlay ? "secondary" : "outline"}
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => setAutoPlay((v) => !v)}
            title={autoPlay ? "Auto-voorlezen aan" : "Auto-voorlezen uit"}
            aria-label={autoPlay ? "Zet auto-voorlezen uit" : "Zet auto-voorlezen aan"}
          >
            {autoPlay ? (
              <Volume2 className="h-4 w-4" />
            ) : (
              <VolumeX className="h-4 w-4 text-muted-foreground" />
            )}
          </Button>
          {conversations.length > 1 && (
            <>
              <select
                className="text-xs md:text-sm border rounded-md px-2 py-1 bg-background max-w-[100px] md:max-w-none h-8"
                value={activeConversationId || ""}
                onChange={(e) => {
                  setActiveConversationId(Number(e.target.value));
                  setMessages([]);
                  setLoadHistory(true);
                }}
              >
                {conversations.map((c) => (
                  <option key={c.id} value={c.id}>{c.title}</option>
                ))}
              </select>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 text-destructive/60 hover:text-destructive"
                onClick={handleDeleteCurrentConversation}
                disabled={!activeConversationId || deleteConversation.isPending}
                title="Verwijder huidig gesprek"
                aria-label="Verwijder huidig gesprek"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" className="text-xs h-8 w-8 p-0 md:w-auto md:px-3" onClick={handleNewConversation} title="Nieuw gesprek">
            <RotateCcw className="h-3.5 w-3.5 md:mr-1" />
            <span className="hidden md:inline">Nieuw</span>
          </Button>
        </div>
      </header>

      {/* Active material indicator */}
      {activeMaterialId && (
        <div className="mb-2 flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-primary/10 border border-primary/20 text-xs">
          <span className="flex items-center gap-2 min-w-0">
            <BookOpen className="h-3.5 w-3.5 text-primary shrink-0" />
            <span className="truncate">Coach kan je studiemateriaal lezen</span>
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[11px] shrink-0"
            onClick={() => setActiveMaterialId(null)}
          >
            Losmaken
          </Button>
        </div>
      )}

      {/* Chat area */}
      <Card className="flex-1 flex flex-col overflow-hidden border-primary/20 rounded-none md:rounded-xl border-x-0 md:border-x">
        <CardContent className="flex-1 flex flex-col p-0 overflow-hidden relative">
          {/* Sticky audio bar — always visible while coach audio is playing */}
          <div className="px-3 pt-2">
            <CoachAudioBar />
          </div>
          <ScrollArea className="flex-1 p-4">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-4 md:p-8 max-w-xl mx-auto">
                <MessageSquare className="h-8 w-8 md:h-12 md:w-12 text-muted-foreground/20 mb-3" />
                <h3 className="text-base md:text-lg font-medium mb-1">Hoi! Ik ben je studiecoach.</h3>
                <p className="text-xs md:text-sm text-muted-foreground mb-4">
                  Ik denk actief mee over je planning en studiestof. Waar wil je mee beginnen?
                </p>

                {/* Prominent "Plan mijn week" CTA */}
                <button
                  type="button"
                  onClick={() => handleSendMessage("Help me mijn week plannen op basis van mijn toetsen, doelen en materiaal. Maak een concreet voorstel.")}
                  className="group w-full rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-background p-3 md:p-4 text-left transition-all hover:border-primary/60 hover:shadow-md active:scale-[0.99] mb-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex-shrink-0 w-10 h-10 md:w-12 md:h-12 rounded-full bg-primary/20 flex items-center justify-center group-hover:bg-primary/30 transition-colors">
                      <CalendarDays className="h-5 w-5 md:h-6 md:w-6 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm md:text-base font-semibold">Plan mijn week</p>
                      <p className="text-[11px] md:text-xs text-muted-foreground">
                        Ik maak een concreet studieplan op basis van je toetsen en doelen
                      </p>
                    </div>
                  </div>
                </button>

                {/* Secondary quick actions */}
                <div className="grid grid-cols-3 gap-1.5 md:gap-2 w-full">
                  {quickActions
                    .filter((a) => a.label !== "Plan mijn week")
                    .map((action) => (
                      <Button
                        key={action.label}
                        variant="outline"
                        size="sm"
                        className="text-[11px] md:text-xs h-auto py-1.5 px-2 md:py-2 md:px-3 flex flex-col items-center gap-0.5"
                        onClick={() => handleSendMessage(action.msg)}
                      >
                        <action.icon className="h-3.5 w-3.5 text-primary" />
                        {action.label}
                      </Button>
                    ))}
                </div>
              </div>
            ) : (
              <div className="space-y-5 pb-4 px-3 md:px-0">
                {messages.map((msg, idx) => {
                  if (msg.role === "user") {
                    return (
                      <div key={idx} className="flex justify-end">
                        <div className="max-w-[85%] p-3 rounded-2xl bg-primary text-primary-foreground rounded-tr-sm">
                          <div className="text-base md:text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</div>
                        </div>
                      </div>
                    );
                  }
                  if (!msg.content) {
                    return (
                      <div key={idx} className="flex justify-start">
                        <div className="p-3 rounded-2xl bg-muted/50 border rounded-tl-sm">
                          <Loader2 className="h-4 w-4 animate-spin" />
                        </div>
                      </div>
                    );
                  }

                  // Assistant message with progressive disclosure
                  const words = countWords(msg.content);
                  const isLong = words > LONG_RESPONSE_WORDS;
                  const isExpanded = expandedMessages.has(idx);
                  const displayText = isLong && !isExpanded
                    ? truncateToSentences(msg.content, 3)
                    : msg.content;

                  return (
                    <div key={idx} className="flex justify-start">
                      <div className="max-w-[92%] md:max-w-[85%] p-4 rounded-2xl bg-muted/50 border rounded-tl-sm">
                        <Markdown compact className="text-base md:text-sm leading-relaxed">
                          {displayText}
                        </Markdown>
                        {isLong && (
                          <Button
                            variant="link"
                            size="sm"
                            className="h-6 text-xs p-0 mt-1 text-primary"
                            onClick={() => toggleExpanded(idx)}
                          >
                            {isExpanded ? "Minder tonen" : `Lees meer (${words} woorden)`}
                          </Button>
                        )}
                        {msg.content.length > 20 && (
                          <div className="mt-2 pt-2 border-t border-border/50 flex items-center justify-end">
                            <CoachSpeakerButton
                              messageKey={`coaching-${idx}`}
                              text={msg.content}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>
            )}
          </ScrollArea>

          {/* Input area */}
          <div className="p-3 md:p-4 border-t bg-background">
            {messages.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {quickActions.slice(0, 4).map((action) => (
                  <Button
                    key={action.label}
                    variant="outline"
                    size="sm"
                    className="text-[11px] h-6 rounded-full"
                    onClick={() => handleSendMessage(action.msg)}
                    disabled={isTyping}
                  >
                    {action.label}
                  </Button>
                ))}
              </div>
            )}
            <div className="flex gap-2 items-end">
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Typ je bericht..."
                className="min-h-[44px] max-h-[88px] resize-none text-sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
              />
              <Button
                size="icon"
                variant={isRecording ? "destructive" : "outline"}
                onClick={toggleRecording}
                className={`h-[44px] w-[44px] shrink-0 ${isRecording ? "animate-pulse" : ""}`}
              >
                <Mic className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                className="h-[44px] w-[44px] shrink-0"
                onClick={() => handleSendMessage()}
                disabled={isTyping || !message.trim()}
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
