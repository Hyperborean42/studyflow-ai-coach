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
import {
  Send, Lightbulb, Loader2, Sparkles,
  MessageSquare, ArrowRight, AlertTriangle, Clock,
  Flame, Target, GraduationCap, ChevronRight
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { useQuery } from "@tanstack/react-query";
import {
  useListCalendarEvents,
  useGetProgress,
  useGetWeakPoints,
  useGetStudyStreak,
  useUpdateCalendarEvent,
  useCreateOpenaiConversation,
  useListOpenaiConversations,
  useListOpenaiMessages,
} from "@workspace/api-client-react";
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

function getEventColor(type: string) {
  switch (type) {
    case "studie": return "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300";
    case "toets":
    case "examen": return "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300";
    case "afspraak": return "bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300";
    default: return "bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-800 dark:text-gray-300";
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
  const updateEvent = useUpdateCalendarEvent();

  const { data: suggestions = [], isLoading: isLoadingSuggestions } = useQuery<AgentSuggestion[]>({
    queryKey: ["agent-suggestions"],
    queryFn: async () => {
      const res = await fetch(import.meta.env.BASE_URL + "api/agent/suggestions");
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  // ─── Chat state ───────────��─────────────────────────────────────────────

  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: conversations = [] } = useListOpenaiConversations();
  const createConversation = useCreateOpenaiConversation();
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);

  const { data: historyMessages = [] } = useListOpenaiMessages(activeConversationId || 0, {
    query: { enabled: !!activeConversationId },
  });

  useEffect(() => {
    if (historyMessages.length > 0) {
      setMessages(historyMessages.map((m) => ({ role: m.role, content: m.content })));
    }
  }, [historyMessages]);

  useEffect(() => {
    if (conversations.length > 0 && !activeConversationId) {
      setActiveConversationId(conversations[0].id);
    } else if (conversations.length === 0 && !activeConversationId) {
      createConversation.mutate(
        { data: { title: "Studiecoach" } },
        { onSuccess: (data) => setActiveConversationId(data.id) },
      );
    }
  }, [conversations, activeConversationId]);

  // Handle incoming ?chat= param
  const [chatParamHandled, setChatParamHandled] = useState(false);
  useEffect(() => {
    if (chatParamHandled || !activeConversationId) return;
    const params = new URLSearchParams(searchString);
    const chatMsg = params.get("chat");
    if (chatMsg) {
      setChatParamHandled(true);
      handleSendMessage(decodeURIComponent(chatMsg));
      navigate("/", { replace: true });
    }
  }, [searchString, activeConversationId, chatParamHandled]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSendMessage = async (text: string = message) => {
    if (!text.trim() || !activeConversationId) return;

    const userMsg = text;
    setMessage("");
    setMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setIsTyping(true);

    let aiResponse = "";
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    try {
      await streamOpenAiResponse(
        `api/openai/conversations/${activeConversationId}/messages`,
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
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Clock className="h-4 w-4 text-primary" />
          Vandaag — {format(now, "EEEE d MMMM", { locale: nl })}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoadingEvents ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-3/4" />
          </div>
        ) : todayEvents.length > 0 ? (
          todayEvents.map((event: { id: number; type: string; completed: boolean; title: string; startTime: string; subject?: string }) => (
            <div
              key={event.id}
              className={`flex items-center gap-3 p-2 rounded-lg border text-sm cursor-pointer transition-opacity ${getEventColor(event.type)} ${event.completed ? "opacity-50 line-through" : ""}`}
              onClick={() => toggleEventComplete(event)}
            >
              <span className="text-xs font-mono opacity-70 w-10 shrink-0">
                {format(new Date(event.startTime), "HH:mm")}
              </span>
              <span className="font-medium flex-1 truncate">{event.title}</span>
              {event.subject && (
                <Badge variant="outline" className="text-[10px] shrink-0">{event.subject}</Badge>
              )}
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground italic">Geen items vandaag. Lekker rustig, of plan iets in!</p>
        )}

        {tomorrowEvents.length > 0 && (
          <div className="pt-2 mt-2 border-t">
            <p className="text-xs font-medium text-muted-foreground mb-1.5">Morgen</p>
            {tomorrowEvents.slice(0, 3).map((event: { id: number; type: string; title: string; startTime: string }) => (
              <div key={event.id} className="flex items-center gap-3 text-xs text-muted-foreground py-0.5">
                <span className="font-mono w-10 shrink-0">{format(new Date(event.startTime), "HH:mm")}</span>
                <span className="truncate">{event.title}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );

  // Upcoming exams — milestone cards
  const examsSection = (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <GraduationCap className="h-4 w-4 text-destructive" />
          Komende Toetsen
        </CardTitle>
      </CardHeader>
      <CardContent>
        {upcomingExams.length > 0 ? (
          <div className="space-y-2">
            {upcomingExams.map((exam: { id: number; title: string; startTime: string; subject?: string }) => {
              const examDate = new Date(exam.startTime);
              const daysUntil = differenceInDays(startOfDay(examDate), startOfDay(now));
              const urgency = daysUntil <= 2 ? "destructive" : daysUntil <= 5 ? "outline" : "secondary";

              return (
                <div key={exam.id} className="flex items-center gap-3 p-2 rounded-lg border bg-card">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{exam.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {format(examDate, "EEE d MMM", { locale: nl })}
                      {exam.subject && ` · ${exam.subject}`}
                    </p>
                  </div>
                  <Badge variant={urgency} className="text-[10px] shrink-0">
                    {countdownLabel(examDate)}
                  </Badge>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground italic">Geen toetsen gepland. Voeg ze toe in Planning!</p>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="w-full mt-2 text-xs"
          onClick={() => navigate("/planning")}
        >
          Ga naar planning <ChevronRight className="ml-1 h-3 w-3" />
        </Button>
      </CardContent>
    </Card>
  );

  // Quick stats bar
  const statsBar = (
    <div className="grid grid-cols-3 gap-3">
      <Card className="text-center p-3">
        <div className="flex items-center justify-center gap-1.5 mb-1">
          <Flame className="h-4 w-4 text-orange-500" />
          <span className="text-xl font-bold">{streak?.currentStreak || 0}</span>
        </div>
        <p className="text-[11px] text-muted-foreground">Dagen streak</p>
      </Card>
      <Card className="text-center p-3">
        <div className="flex items-center justify-center gap-1.5 mb-1">
          <Target className="h-4 w-4 text-primary" />
          <span className="text-xl font-bold">{progress?.completedGoals || 0}/{progress?.totalGoals || 0}</span>
        </div>
        <p className="text-[11px] text-muted-foreground">Doelen</p>
      </Card>
      <Card className="text-center p-3">
        <div className="flex items-center justify-center gap-1.5 mb-1">
          <Clock className="h-4 w-4 text-blue-500" />
          <span className="text-xl font-bold">{progress?.weeklyHours || 0}u</span>
        </div>
        <p className="text-[11px] text-muted-foreground">Deze week</p>
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
    <Card className={`flex flex-col overflow-hidden border-primary/20 ${isMobile ? "flex-1 min-h-[300px]" : "h-full"}`}>
      <CardHeader className="pb-2 bg-primary/5 border-b">
        <CardTitle className="text-base flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-primary" />
          AI Studiecoach
        </CardTitle>
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

  // ─── Layout ───��────────────────────────────���────────────────────────────

  if (isMobile) {
    return (
      <div className="h-full flex flex-col space-y-4">
        <header>
          <h1 className="text-2xl font-bold">Welkom terug!</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {format(now, "EEEE d MMMM", { locale: nl })}
          </p>
        </header>

        {statsBar}
        {todayAgenda}
        {upcomingExams.length > 0 && examsSection}
        {suggestionsPanel}
        {weakPointsSection}
        {miniCoach}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col space-y-5">
      <header>
        <h1 className="text-3xl font-bold">Welkom terug!</h1>
        <p className="text-muted-foreground mt-0.5">
          {format(now, "EEEE d MMMM yyyy", { locale: nl })}
        </p>
      </header>

      {statsBar}
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
