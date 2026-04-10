import React, { useState, useEffect, useRef } from "react";
import { useLocation, useSearch } from "wouter";
import {
  format,
  startOfWeek,
  endOfWeek,
  differenceInDays,
  isToday,
  isTomorrow,
  startOfDay,
  addWeeks,
} from "date-fns";
import { nl } from "date-fns/locale";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Send, Lightbulb, Loader2, Sparkles, Maximize2,
  MessageSquare, ArrowRight, AlertTriangle, Clock,
  Flame, Target, GraduationCap, ChevronRight, Circle, CheckCircle2,
} from "lucide-react";
import { Markdown } from "@/components/markdown";
import { CoachSpeakerButton } from "@/components/coach-speaker-button";
import { useToast } from "@/hooks/use-toast";
import { SpeechButton } from "@/components/speech-button";
import { useIsMobile } from "@/hooks/use-mobile";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useListCalendarEvents,
  useGetProgress,
  useGetWeakPoints,
  useGetStudyStreak,
  useUpdateCalendarEvent,
  useCreateOpenaiConversation,
  useListOpenaiConversations,
  useGetSettings,
} from "@workspace/api-client-react";
import { getEventColor } from "@/lib/event-utils";
import { streamOpenAiResponse } from "@/lib/api-streaming";

// ─── Types ──────────────────────────────────────────────────────────────────

interface AgentSuggestion {
  id: string;
  type: "chat" | "quiz" | "material" | "planning";
  title: string;
  message: string;
  priority: "high" | "medium" | "low";
  actionLabel: string;
  chatMessage?: string;
}

// ─── Helpers ────────────────────────────────────��───────────────────────────

function getPriorityStyles(priority: string) {
  switch (priority) {
    case "high": return "border-destructive/50 bg-destructive/5";
    case "medium": return "border-amber-400/50 bg-amber-50 dark:bg-amber-950/20";
    default: return "border-border";
  }
}

function getPriorityBadgeVariant(priority: string): "destructive" | "outline" | "secondary" {
  switch (priority) {
    case "high": return "destructive";
    case "medium": return "outline";
    default: return "secondary";
  }
}

function countdownLabel(date: Date): string {
  const days = differenceInDays(startOfDay(date), startOfDay(new Date()));
  if (days === 0) return "Vandaag!";
  if (days === 1) return "Morgen";
  return `Over ${days} dagen`;
}

// ─── Component ────────────���────────────────────────���────────────────────────

export default function Dashboard() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const searchString = useSearch();
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();

  const now = new Date();
  const todayStart = startOfWeek(now, { weekStartsOn: 1 });
  const nextWeekEnd = addWeeks(endOfWeek(now, { weekStartsOn: 1 }), 1);

  // ─── Data fetching ──────────────────────────────────────────────────────

  const { data: calendarEvents = [], isLoading: isLoadingEvents } = useListCalendarEvents({
    startDate: todayStart.toISOString(),
    endDate: nextWeekEnd.toISOString(),
  });

  const { data: progress } = useGetProgress();
  const { data: weakPoints = [] } = useGetWeakPoints();
  const { data: streak } = useGetStudyStreak();
  const { data: settings } = useGetSettings();
  const userName = settings?.userName || "";
  const greeting = userName ? `Welkom terug, ${userName}!` : "Welkom terug!";
  const updateEvent = useUpdateCalendarEvent({
    mutation: {
      onMutate: async () => {
        await queryClient.cancelQueries({ queryKey: ["listCalendarEvents"] });
      },
    },
  });

  const { data: suggestions = [], isLoading: isLoadingSuggestions } = useQuery<AgentSuggestion[]>({
    queryKey: ["agent-suggestions"],
    queryFn: async () => {
      const res = await fetch(import.meta.env.BASE_URL + "api/agent/suggestions");
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  // ─── Chat state (lazy — only fetches when user interacts) ────────────────

  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [coachExpanded, setCoachExpanded] = useState(false);
  const [coachActivated, setCoachActivated] = useState(false);

  const createConversation = useCreateOpenaiConversation();
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);

  // Only fetch conversations when user activates the coach
  const { data: conversations = [] } = useListOpenaiConversations({
    query: { enabled: coachActivated },
  });

  useEffect(() => {
    if (!coachActivated || !conversations.length || activeConversationId) return;
    setActiveConversationId(conversations[0].id);
  }, [conversations, activeConversationId, coachActivated]);

  // Handle incoming ?chat= param — activate coach if needed
  const [chatParamHandled, setChatParamHandled] = useState(false);
  useEffect(() => {
    if (chatParamHandled) return;
    const params = new URLSearchParams(searchString);
    const chatMsg = params.get("chat");
    if (chatMsg) {
      setCoachActivated(true);
      setChatParamHandled(true);
    }
  }, [searchString, chatParamHandled]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const ensureConversation = async (): Promise<number> => {
    if (activeConversationId) return activeConversationId;
    return new Promise((resolve) => {
      createConversation.mutate(
        { data: { title: "Studiecoach" } },
        { onSuccess: (data) => { setActiveConversationId(data.id); resolve(data.id); } },
      );
    });
  };

  const handleSendMessage = async (text: string = message) => {
    if (!text.trim()) return;
    setCoachActivated(true);

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
        { content: userMsg },
        (chunk) => {
          aiResponse += chunk;
          setMessages((prev) => {
            const newMessages = [...prev];
            newMessages[newMessages.length - 1].content = aiResponse;
            return newMessages;
          });
        },
      );
    } catch {
      toast({ title: "Fout", description: "Kon bericht niet verzenden", variant: "destructive" });
    } finally {
      setIsTyping(false);
    }
  };

  const handleSuggestionAction = (suggestion: AgentSuggestion) => {
    switch (suggestion.type) {
      case "chat": handleSendMessage(suggestion.chatMessage || suggestion.message); break;
      case "quiz": navigate("/materialen?tab=quiz"); break;
      case "material": navigate("/materialen"); break;
      case "planning": navigate("/planning"); break;
    }
  };

  const toggleEventComplete = (event: { id: number; completed: boolean }) => {
    updateEvent.mutate({ id: event.id, data: { completed: !event.completed } });
  };

  // ─── Derived data ──────────────────────────────────────────────────────

  const todayEvents = calendarEvents.filter((e: { startTime: string }) =>
    isToday(new Date(e.startTime)),
  );
  const tomorrowEvents = calendarEvents.filter((e: { startTime: string }) =>
    isTomorrow(new Date(e.startTime)),
  );

  const upcomingExams = calendarEvents
    .filter((e: { type: string; title: string; startTime: string }) => {
      const t = e.type?.toLowerCase() || "";
      const title = e.title?.toLowerCase() || "";
      return (
        t === "toets" || t === "examen" ||
        title.includes("toets") || title.includes("examen") || title.includes("tentamen")
      );
    })
    .filter((e: { startTime: string }) => new Date(e.startTime) >= now)
    .sort((a: { startTime: string }, b: { startTime: string }) =>
      new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
    )
    .slice(0, 5);

  const quickActions = [
    "Wat moet ik vandaag doen?",
    "Overhoor mij",
    "Maak een quiz",
    "Help me plannen",
  ];

  // ─── Sections ───��───────────────────────────────────────────────────────

  // Today's agenda — compact timeline
  const todayAgenda = (
    <Card className="flex flex-col">
      <CardHeader className="py-2.5 px-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Clock className="h-3.5 w-3.5 text-primary" />
          Vandaag — {format(now, "EEE d MMM", { locale: nl })}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3 pt-0 space-y-1.5">
        {isLoadingEvents ? (
          <div className="space-y-1.5">
            <Skeleton className="h-7 w-full" />
            <Skeleton className="h-7 w-3/4" />
          </div>
        ) : todayEvents.length > 0 ? (
          todayEvents.map((event: { id: number; type: string; completed: boolean; title: string; startTime: string; subject?: string }) => (
            <button
              type="button"
              key={event.id}
              className={`w-full flex items-center gap-2 py-1.5 px-2 rounded-md border text-xs cursor-pointer transition-all duration-100 active:scale-[0.98] text-left ${getEventColor(event.type)} ${event.completed ? "opacity-50 line-through" : ""}`}
              onClick={() => toggleEventComplete(event)}
              aria-label={event.completed ? `Markeer ${event.title} als niet voltooid` : `Markeer ${event.title} als voltooid`}
            >
              {event.completed ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />
              ) : (
                <Circle className="h-3.5 w-3.5 shrink-0" />
              )}
              <span className="font-mono opacity-70 w-9 shrink-0">
                {format(new Date(event.startTime), "HH:mm")}
              </span>
              <span className="font-medium flex-1 truncate">{event.title}</span>
              {event.subject && (
                <Badge variant="outline" className="text-[9px] shrink-0">{event.subject}</Badge>
              )}
            </button>
          ))
        ) : (
          <p className="text-xs text-muted-foreground italic">Vrije dag! Tijd om voor te lopen.</p>
        )}

        {tomorrowEvents.length > 0 && (
          <div className="pt-1.5 mt-1 border-t">
            <p className="text-[10px] font-medium text-muted-foreground mb-1">Morgen</p>
            {tomorrowEvents.slice(0, 2).map((event: { id: number; type: string; title: string; startTime: string }) => (
              <div key={event.id} className="flex items-center gap-2 text-[11px] text-muted-foreground py-0.5">
                <span className="font-mono w-9 shrink-0">{format(new Date(event.startTime), "HH:mm")}</span>
                <span className="truncate">{event.title}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );

  // Upcoming exams — compact milestone cards
  const examsSection = (
    <Card className="flex flex-col">
      <CardHeader className="py-2.5 px-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <GraduationCap className="h-3.5 w-3.5 text-destructive" />
          Komende Toetsen
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3 pt-0">
        {upcomingExams.length > 0 ? (
          <div className="space-y-1.5">
            {upcomingExams.slice(0, 3).map((exam: { id: number; title: string; startTime: string; subject?: string }) => {
              const examDate = new Date(exam.startTime);
              const daysUntil = differenceInDays(startOfDay(examDate), startOfDay(now));
              const urgency = daysUntil <= 2 ? "destructive" : daysUntil <= 5 ? "outline" : "secondary";

              return (
                <div key={exam.id} className="flex items-center gap-2 py-1.5 px-2 rounded-md border bg-card text-xs">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{exam.title}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {format(examDate, "EEE d MMM", { locale: nl })}
                      {exam.subject && ` · ${exam.subject}`}
                    </p>
                  </div>
                  <Badge variant={urgency} className="text-[9px] shrink-0">
                    {countdownLabel(examDate)}
                  </Badge>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground italic">Geen toetsen gepland.</p>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="w-full mt-1.5 text-[11px] h-7"
          onClick={() => navigate("/planning")}
        >
          Planning <ChevronRight className="ml-1 h-3 w-3" />
        </Button>
      </CardContent>
    </Card>
  );

  // "Help me plannen" CTA — the app's core USP. Prominent, always visible,
  // opens the coach in expanded mode and auto-sends the planning request.
  const planCta = (
    <button
      type="button"
      onClick={() => {
        setCoachExpanded(true);
        handleSendMessage("Help me mijn week plannen op basis van mijn toetsen, doelen en materiaal. Maak een concreet voorstel.");
      }}
      disabled={isTyping}
      className="group w-full rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-background p-3 md:p-4 text-left transition-all duration-150 hover:border-primary/60 hover:shadow-md active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed"
    >
      <div className="flex items-center gap-3">
        <div className="flex-shrink-0 w-10 h-10 md:w-12 md:h-12 rounded-full bg-primary/20 flex items-center justify-center group-hover:bg-primary/30 transition-colors">
          <Sparkles className="h-5 w-5 md:h-6 md:w-6 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm md:text-base font-semibold">Help me plannen</p>
          <p className="text-[11px] md:text-xs text-muted-foreground">
            Laat de coach een studieplan voor deze week maken
          </p>
        </div>
        <ChevronRight className="h-4 w-4 md:h-5 md:w-5 text-muted-foreground group-hover:text-primary shrink-0" />
      </div>
    </button>
  );

  // Quick stats bar — compact
  const statsBar = (
    <div className="grid grid-cols-3 gap-2">
      <Card className="text-center p-2">
        <div className="flex items-center justify-center gap-1 mb-0.5">
          <Flame className="h-3.5 w-3.5 text-orange-500" />
          <span className="text-lg font-bold">{streak?.currentStreak || 0}</span>
        </div>
        <p className="text-[10px] text-muted-foreground">Streak</p>
      </Card>
      <button
        type="button"
        onClick={() => navigate("/planning")}
        className="text-left"
      >
        <Card className="text-center p-2 hover:bg-muted/40 transition-colors">
          <div className="flex items-center justify-center gap-1 mb-0.5">
            <Target className="h-3.5 w-3.5 text-primary" />
            <span className="text-lg font-bold">
              {progress?.totalGoals
                ? `${progress.completedGoals || 0}/${progress.totalGoals}`
                : "—"}
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground">Doelen</p>
        </Card>
      </button>
      <Card className="text-center p-2">
        <div className="flex items-center justify-center gap-1 mb-0.5">
          <Clock className="h-3.5 w-3.5 text-blue-500" />
          <span className="text-lg font-bold">{progress?.weeklyHours || 0}u</span>
        </div>
        <p className="text-[10px] text-muted-foreground">Deze week</p>
      </Card>
    </div>
  );

  // Coach suggestions (horizontal scroll)
  const suggestionsPanel = suggestions.length > 0 || isLoadingSuggestions ? (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Tips van je coach</h2>
      </div>
      {isLoadingSuggestions ? (
        <div className="flex gap-3 overflow-x-auto pb-1">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="min-w-[240px] shrink-0">
              <CardContent className="p-3 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-7 w-20 mt-1" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1 snap-x snap-mandatory">
          {suggestions.map((s) => (
            <Card key={s.id} className={`min-w-[240px] max-w-[280px] shrink-0 snap-start border ${getPriorityStyles(s.priority)}`}>
              <CardContent className="p-3 flex flex-col gap-2">
                <div className="flex items-center gap-1.5">
                  <Badge variant={getPriorityBadgeVariant(s.priority)} className="text-[9px]">
                    {s.priority === "high" ? "Urgent" : s.priority === "medium" ? "Belangrijk" : "Tip"}
                  </Badge>
                </div>
                <p className="text-xs font-medium leading-snug">{s.title}</p>
                <p className="text-[11px] text-muted-foreground leading-snug line-clamp-2">{s.message}</p>
                <Button size="sm" variant="outline" className="self-start text-[11px] h-6 mt-auto" onClick={() => handleSuggestionAction(s)}>
                  {s.actionLabel} <ArrowRight className="ml-1 h-3 w-3" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  ) : null;

  // Mini coach chat
  const miniCoach = (
    <Card className={`flex flex-col overflow-hidden border-primary/20 ${isMobile ? "flex-1 min-h-[200px]" : "h-full"}`}>
      <CardHeader className="pb-2 bg-primary/5 border-b">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-primary" />
            Je studiecoach
          </CardTitle>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCoachExpanded(true)}>
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
        </div>
        <CardDescription className="text-xs">Stel vragen, vraag om uitleg of oefen je stof.</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col p-0 overflow-hidden">
        <ScrollArea className="flex-1 p-3">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground p-6">
              <MessageSquare className="h-8 w-8 text-muted-foreground/30 mb-3" />
              <p className="text-sm">Start een gesprek met je coach.</p>
            </div>
          ) : (
            <div className="space-y-3 pb-2">
              {messages.map((msg, idx) => (
                <div key={idx} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] p-2.5 rounded-lg text-sm ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground rounded-tr-none"
                      : "bg-muted/50 border rounded-tl-none"
                  }`}>
                    {msg.role === "assistant" && !msg.content ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : msg.role === "assistant" ? (
                      <>
                        <Markdown compact className="text-sm">{msg.content}</Markdown>
                        {msg.content.length > 20 && (
                          <div className="mt-1.5 pt-1.5 border-t border-border/50 flex items-center justify-end">
                            <CoachSpeakerButton
                              messageKey={`dashboard-mini-${idx}`}
                              text={msg.content}
                              compact
                            />
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="text-sm whitespace-pre-wrap">{msg.content}</div>
                    )}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </ScrollArea>

        <div className="p-3 border-t bg-background space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {quickActions.map((action) => (
              <Button
                key={action}
                variant="outline"
                size="sm"
                className="text-[11px] h-6 rounded-full"
                onClick={() => handleSendMessage(action)}
                disabled={isTyping}
              >
                {action}
              </Button>
            ))}
          </div>
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
            <SpeechButton
              onTranscript={(t) => setMessage((prev) => prev ? prev + " " + t : t)}
              disabled={isTyping}
              className="h-[44px] w-[44px] shrink-0"
            />
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
  );

  // Weak points compact
  const weakPointsSection = weakPoints.length > 0 ? (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          Aandachtspunten
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {weakPoints.slice(0, 3).map((wp: { id: number; subject: string; topic: string; severity: string }) => (
          <div key={wp.id} className="flex items-center justify-between gap-2 text-sm">
            <div className="flex items-center gap-2 min-w-0">
              <Badge variant="outline" className="text-[10px] shrink-0">{wp.subject}</Badge>
              <span className="truncate">{wp.topic}</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-[11px] h-6 shrink-0"
              onClick={() => handleSendMessage(`Help mij met ${wp.topic} voor ${wp.subject}`)}
            >
              Oefen
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  ) : null;

  // Expanded coach Sheet (fullscreen chat)
  const expandedCoach = (
    <Sheet open={coachExpanded} onOpenChange={setCoachExpanded}>
      <SheetContent side="bottom" className="h-[95dvh] flex flex-col p-0">
        <SheetHeader className="px-4 pt-4 pb-2 border-b bg-primary/5">
          <SheetTitle className="flex items-center gap-2">
            <Lightbulb className="h-5 w-5 text-primary" />
            Je studiecoach
          </SheetTitle>
        </SheetHeader>
        <ScrollArea className="flex-1 p-4">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground p-8">
              <MessageSquare className="h-12 w-12 text-muted-foreground/20 mb-4" />
              <p>Start een gesprek met je coach.</p>
            </div>
          ) : (
            <div className="space-y-4 pb-4">
              {messages.map((msg, idx) => (
                <div key={idx} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] p-3 rounded-lg ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground rounded-tr-none"
                      : "bg-muted/50 border rounded-tl-none"
                  }`}>
                    {msg.role === "assistant" && !msg.content ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : msg.role === "assistant" ? (
                      <>
                        <Markdown compact className="text-sm">{msg.content}</Markdown>
                        {msg.content.length > 20 && (
                          <div className="mt-2 pt-2 border-t border-border/50 flex items-center justify-end">
                            <CoachSpeakerButton
                              messageKey={`dashboard-expanded-${idx}`}
                              text={msg.content}
                            />
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="text-sm whitespace-pre-wrap">{msg.content}</div>
                    )}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </ScrollArea>
        <div className="p-4 border-t bg-background space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {quickActions.map((action) => (
              <Button
                key={action}
                variant="outline"
                size="sm"
                className="text-xs h-7 rounded-full"
                onClick={() => handleSendMessage(action)}
                disabled={isTyping}
              >
                {action}
              </Button>
            ))}
          </div>
          <div className="flex gap-2 items-end">
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Typ je bericht..."
              className="min-h-[60px] resize-none"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
            />
            <div className="flex flex-col gap-2">
              <SpeechButton
                onTranscript={(t) => setMessage((prev) => prev ? prev + " " + t : t)}
                disabled={isTyping}
              />
              <Button
                size="icon"
                onClick={() => handleSendMessage()}
                disabled={isTyping || !message.trim()}
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );

  // ─── Layout ─────────────────────────────────────────────────────────

  if (isMobile) {
    return (
      <div className="h-full flex flex-col space-y-3">
        {expandedCoach}
        <header>
          <h1 className="text-lg font-bold">{greeting}</h1>
          <p className="text-muted-foreground text-xs">
            {format(now, "EEE d MMMM", { locale: nl })}
          </p>
        </header>

        {statsBar}

        {planCta}

        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-1">{todayAgenda}</div>
          <div className="col-span-1">{examsSection}</div>
        </div>

        {suggestionsPanel}
        {weakPointsSection}
        {miniCoach}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col space-y-5">
      {expandedCoach}
      <header>
        <h1 className="text-3xl font-bold">{greeting}</h1>
        <p className="text-muted-foreground mt-0.5">
          {format(now, "EEEE d MMMM yyyy", { locale: nl })}
        </p>
      </header>

      {statsBar}
      {planCta}
      {suggestionsPanel}

      <div className="flex-1 grid grid-cols-12 gap-5 min-h-0 overflow-hidden">
        {/* Left: today + exams */}
        <div className="col-span-4 flex flex-col gap-5 h-full overflow-y-auto">
          {todayAgenda}
          {examsSection}
          {weakPointsSection}
        </div>

        {/* Right: coach chat */}
        <div className="col-span-8 h-full">
          {miniCoach}
        </div>
      </div>
    </div>
  );
}
