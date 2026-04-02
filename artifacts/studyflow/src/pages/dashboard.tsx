import React, { useState, useEffect, useRef } from "react";
import { useLocation, useSearch } from "wouter";
import { format, startOfWeek, endOfWeek, addDays, isSameDay } from "date-fns";
import { nl } from "date-fns/locale";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  ChevronLeft, ChevronRight, Mic, Send, Lightbulb,
  Loader2, Sparkles, BookOpen, BrainCircuit, CalendarDays,
  MessageSquare, ArrowRight, ChevronDown
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
  useGetSettings,
  useTextToSpeech
} from "@workspace/api-client-react";
import { streamOpenAiResponse } from "@/lib/api-streaming";

interface AgentSuggestion {
  id: string;
  type: "chat" | "quiz" | "material" | "planning";
  title: string;
  message: string;
  priority: "high" | "medium" | "low";
  icon: string;
  actionLabel: string;
  chatMessage?: string;
}

function SuggestionIcon({ type }: { type: string }) {
  switch (type) {
    case "quiz": return <BrainCircuit className="h-5 w-5" />;
    case "material": return <BookOpen className="h-5 w-5" />;
    case "planning": return <CalendarDays className="h-5 w-5" />;
    case "chat":
    default: return <MessageSquare className="h-5 w-5" />;
  }
}

function getPriorityStyles(priority: string) {
  switch (priority) {
    case "high": return "border-destructive/50 bg-destructive/5";
    case "medium": return "border-amber-400/50 bg-amber-50 dark:bg-amber-950/20";
    case "low":
    default: return "border-border";
  }
}

function getPriorityBadgeVariant(priority: string): "destructive" | "outline" | "secondary" {
  switch (priority) {
    case "high": return "destructive";
    case "medium": return "outline";
    case "low":
    default: return "secondary";
  }
}

const SUBJECTS = ["Wiskunde", "Nederlands", "Engels", "Biologie", "Natuurkunde", "Scheikunde", "Geschiedenis", "Aardrijkskunde", "Economie", "M&O"];

export default function Dashboard() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const searchString = useSearch();
  const isMobile = useIsMobile();
  const [currentDate, setCurrentDate] = useState(new Date());
  const startDate = startOfWeek(currentDate, { weekStartsOn: 1 });
  const endDate = endOfWeek(currentDate, { weekStartsOn: 1 });
  const [statsOpen, setStatsOpen] = useState(false);

  const { data: calendarEvents = [], isLoading: isLoadingEvents } = useListCalendarEvents({
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString()
  });

  const { data: progress } = useGetProgress();
  const { data: weakPoints = [] } = useGetWeakPoints();
  const { data: streak } = useGetStudyStreak();
  const { data: settings } = useGetSettings();
  const updateEvent = useUpdateCalendarEvent();
  const textToSpeech = useTextToSpeech();

  // Agent suggestions
  const { data: suggestions = [], isLoading: isLoadingSuggestions } = useQuery<AgentSuggestion[]>({
    queryKey: ["agent-suggestions"],
    queryFn: async () => {
      const res = await fetch(import.meta.env.BASE_URL + "api/agent/suggestions");
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<{role: string, content: string}[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [selectedSubject, setSelectedSubject] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: conversations = [] } = useListOpenaiConversations();
  const createConversation = useCreateOpenaiConversation();
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);

  const { data: historyMessages = [] } = useListOpenaiMessages(activeConversationId || 0, {
    query: { enabled: !!activeConversationId }
  });

  useEffect(() => {
    if (historyMessages.length > 0) {
      setMessages(historyMessages.map(m => ({ role: m.role, content: m.content })));
    }
  }, [historyMessages]);

  useEffect(() => {
    if (conversations.length > 0 && !activeConversationId) {
      setActiveConversationId(conversations[0].id);
    } else if (conversations.length === 0 && !activeConversationId) {
      createConversation.mutate({ data: { title: "Studiecoach" } }, {
        onSuccess: (data) => setActiveConversationId(data.id)
      });
    }
  }, [conversations, activeConversationId]);

  // Handle incoming ?chat= param from other pages
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

  const playAudio = (base64Audio: string) => {
    try {
      const audio = new Audio(`data:audio/mp3;base64,${base64Audio}`);
      audio.play();
    } catch (e) {
      console.error("Audio afspelen mislukt", e);
    }
  };

  const handleSpeak = (text: string) => {
    textToSpeech.mutate({ data: { text, voice: "alloy" } }, {
      onSuccess: (data) => {
        if (data.audio) {
          playAudio(data.audio);
        }
      },
      onError: () => {
        toast({ title: "Fout", description: "Kon tekst niet voorlezen.", variant: "destructive" });
      }
    });
  };

  const handleSendMessage = async (text: string = message) => {
    if (!text.trim() || !activeConversationId) return;

    const userMsg = text;
    setMessage("");
    setMessages(prev => [...prev, { role: "user", content: userMsg }]);
    setIsTyping(true);

    let aiResponse = "";
    setMessages(prev => [...prev, { role: "assistant", content: "" }]);

    try {
      await streamOpenAiResponse(
        `api/openai/conversations/${activeConversationId}/messages`,
        { content: userMsg },
        (chunk) => {
          aiResponse += chunk;
          setMessages(prev => {
            const newMessages = [...prev];
            newMessages[newMessages.length - 1].content = aiResponse;
            return newMessages;
          });
        }
      );

      if (settings?.voiceEnabled && aiResponse.trim()) {
        handleSpeak(aiResponse);
      }

    } catch (error) {
      toast({
        title: "Fout",
        description: "Kon bericht niet verzenden",
        variant: "destructive"
      });
    } finally {
      setIsTyping(false);
    }
  };

  const handleSuggestionAction = (suggestion: AgentSuggestion) => {
    switch (suggestion.type) {
      case "chat":
        handleSendMessage(suggestion.chatMessage || suggestion.message);
        break;
      case "quiz":
        navigate("/materialen?tab=quiz");
        break;
      case "material":
        navigate("/materialen");
        break;
      case "planning":
        navigate("/planning");
        break;
    }
  };

  const toggleEventComplete = (event: unknown) => {
    const e = event as { id: number; completed: boolean };
    updateEvent.mutate({ id: e.id, data: { completed: !e.completed } });
  };

  const toggleRecording = () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      toast({ title: "Niet ondersteund", description: "Spraakherkenning wordt niet ondersteund in deze browser.", variant: "destructive" });
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || (window as unknown as { webkitSpeechRecognition: typeof window.SpeechRecognition }).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.lang = 'nl-NL';

    if (isRecording) {
      setIsRecording(false);
      recognition.stop();
      return;
    }

    setIsRecording(true);
    recognition.start();

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = event.results[0][0].transcript;
      setMessage(prev => prev + " " + transcript);
      setIsRecording(false);
    };

    recognition.onerror = () => {
      setIsRecording(false);
      toast({ title: "Fout", description: "Spraakherkenning mislukt.", variant: "destructive" });
    };

    recognition.onend = () => {
      setIsRecording(false);
    };
  };

  const getEventColor = (type: string) => {
    switch(type) {
      case 'studie': return 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800';
      case 'afspraak': return 'bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-800';
      case 'vrij': return 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800';
      default: return 'bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700';
    }
  };

  const getSeverityColor = (severity: string) => {
    switch(severity) {
      case 'hoog': return 'destructive';
      case 'gemiddeld': return 'warning';
      case 'laag': return 'secondary';
      default: return 'default';
    }
  };

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(startDate, i));

  const quickActions = [
    "Overhoor mij",
    "Wat moet ik vandaag doen?",
    "Genereer oefeningen",
    "Maak een quiz",
    "Geef feedback op mijn antwoord",
    "Leg eenvoudiger uit",
  ];

  // --- Agent Suggestions Panel ---
  const suggestionsPanel = (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold">Suggesties van je coach</h2>
      </div>
      {isLoadingSuggestions ? (
        <div className="flex gap-4 overflow-x-auto pb-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="min-w-[280px] flex-shrink-0">
              <Card className="h-full">
                <CardContent className="p-4 space-y-3">
                  <Skeleton className="h-5 w-3/4" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-8 w-24 mt-2" />
                </CardContent>
              </Card>
            </div>
          ))}
        </div>
      ) : suggestions.length > 0 ? (
        <div className="flex gap-4 overflow-x-auto pb-2 -mx-1 px-1 snap-x snap-mandatory">
          {suggestions.map((suggestion) => (
            <div key={suggestion.id} className="min-w-[280px] max-w-[320px] flex-shrink-0 snap-start">
              <Card className={`h-full border-2 ${getPriorityStyles(suggestion.priority)}`}>
                <CardContent className="p-4 flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 text-primary">
                      <SuggestionIcon type={suggestion.type} />
                      <h3 className="font-semibold text-sm leading-tight">{suggestion.title}</h3>
                    </div>
                    <Badge variant={getPriorityBadgeVariant(suggestion.priority)} className="text-[10px] flex-shrink-0">
                      {suggestion.priority === "high" ? "Urgent" : suggestion.priority === "medium" ? "Belangrijk" : "Tip"}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground leading-snug">{suggestion.message}</p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="self-start mt-auto text-xs"
                    onClick={() => handleSuggestionAction(suggestion)}
                  >
                    {suggestion.actionLabel}
                    <ArrowRight className="ml-1 h-3 w-3" />
                  </Button>
                </CardContent>
              </Card>
            </div>
          ))}
        </div>
      ) : (
        <Card className="border-dashed">
          <CardContent className="p-6 text-center text-muted-foreground text-sm">
            Je agent heeft nog geen suggesties. Voeg toetsen en materiaal toe!
          </CardContent>
        </Card>
      )}
    </div>
  );

  // --- Calendar Column ---
  const calendarColumn = (
    <Card className={`flex flex-col overflow-hidden ${isMobile ? "" : "col-span-3 h-full"}`}>
      <CardHeader className="pb-3 border-b">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Weekkalender</CardTitle>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCurrentDate(addDays(currentDate, -7))} data-testid="btn-prev-week">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCurrentDate(addDays(currentDate, 7))} data-testid="btn-next-week">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <CardDescription className="text-xs">
          {format(startDate, 'd MMM', { locale: nl })} - {format(endDate, 'd MMM', { locale: nl })}
        </CardDescription>
      </CardHeader>
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {isLoadingEvents ? (
            <div className="flex justify-center p-4"><Loader2 className="animate-spin h-6 w-6 text-muted-foreground" /></div>
          ) : (
            weekDays.map(day => {
              const dayEvents = calendarEvents.filter((e: { startTime: string }) => isSameDay(new Date(e.startTime), day));
              const isToday = isSameDay(day, new Date());

              return (
                <div key={day.toString()} className="space-y-2">
                  <h4 className={`text-sm font-medium ${isToday ? 'text-primary' : 'text-muted-foreground'}`}>
                    {format(day, 'EEEE d MMM', { locale: nl })}
                  </h4>
                  {dayEvents.length > 0 ? (
                    <div className="space-y-2">
                      {dayEvents.map((event: { id: number; type: string; completed: boolean; title: string; startTime: string; subject?: string }) => (
                        <div
                          key={event.id}
                          className={`p-2 rounded-md border text-sm flex flex-col gap-1 cursor-pointer transition-opacity ${getEventColor(event.type)} ${event.completed ? 'opacity-50' : ''}`}
                          onClick={() => toggleEventComplete(event)}
                          data-testid={`event-${event.id}`}
                        >
                          <div className="flex justify-between items-start">
                            <span className={`font-semibold ${event.completed ? 'line-through' : ''}`}>{event.title}</span>
                            <span className="text-xs opacity-70">
                              {format(new Date(event.startTime), 'HH:mm')}
                            </span>
                          </div>
                          {event.subject && <span className="text-xs opacity-80">{event.subject}</span>}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground italic pl-2 border-l-2 border-muted">Geen items</div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>
    </Card>
  );

  // --- Chat Column ---
  const chatColumn = (
    <Card className={`flex flex-col overflow-hidden border-primary/20 shadow-sm ${isMobile ? "" : "col-span-6 h-full"}`}>
      <CardHeader className="pb-3 border-b bg-primary/5">
        <CardTitle className="text-lg flex items-center gap-2">
          <Lightbulb className="h-5 w-5 text-primary" />
          AI Studiecoach
        </CardTitle>
        <CardDescription>Stel vragen, vraag om uitleg of oefen je stof.</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col p-0 overflow-hidden">
        <ScrollArea className="flex-1 p-4">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground p-8">
              <MessageCircleIcon className="h-12 w-12 text-muted-foreground/30 mb-4" />
              <p>Start een gesprek met je coach. Waar wil je het over hebben?</p>
            </div>
          ) : (
            <div className="space-y-4 pb-4">
              {messages.map((msg, idx) => (
                <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] p-3 rounded-lg ${
                    msg.role === 'user'
                      ? 'bg-primary text-primary-foreground rounded-tr-none'
                      : 'bg-muted/50 border rounded-tl-none'
                  }`}>
                    {msg.role === 'assistant' && !msg.content ? (
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

        <div className="p-4 border-t bg-background">
          <div className="flex flex-wrap gap-2 mb-3">
            {quickActions.map(action => (
              <Button
                key={action}
                variant="outline"
                size="sm"
                className="text-xs h-7 rounded-full"
                onClick={() => handleSendMessage(action)}
                disabled={isTyping}
                data-testid={`quick-action-${action}`}
              >
                {action}
              </Button>
            ))}
            {/* Subject dropdown quick action */}
            <div className="flex items-center gap-1">
              <Select value={selectedSubject} onValueChange={(val) => {
                setSelectedSubject(val);
                handleSendMessage(`Leg ${val} uit`);
              }}>
                <SelectTrigger className="h-7 text-xs rounded-full w-auto min-w-[130px] border-input">
                  <SelectValue placeholder="Leg [vak] uit..." />
                </SelectTrigger>
                <SelectContent>
                  {SUBJECTS.map(s => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex gap-2 items-end">
            <Textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="Typ je bericht hier..."
              className="min-h-[60px] resize-none"
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              data-testid="input-chat"
            />
            <div className="flex flex-col gap-2">
              <Button
                size="icon"
                variant={isRecording ? "destructive" : "outline"}
                onClick={toggleRecording}
                className={isRecording ? "animate-pulse" : ""}
                data-testid="btn-record"
              >
                <Mic className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                onClick={() => handleSendMessage()}
                disabled={isTyping || !message.trim()}
                data-testid="btn-send"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  // --- Stats Column ---
  const statsContent = (
    <>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Voortgang</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="flex justify-between items-baseline mb-1">
              <span className="text-2xl font-bold text-primary">{progress?.weeklyHours || 0}u</span>
              <span className="text-xs text-muted-foreground">van {progress?.totalStudyHours || 0}u doel</span>
            </div>
            <Progress value={Math.min(100, ((progress?.weeklyHours || 0) / (progress?.totalStudyHours || 1)) * 100)} className="h-2" />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="bg-muted/30 p-3 rounded-lg border text-center">
              <div className="text-xl font-bold">{streak?.currentStreak || 0}</div>
              <div className="text-xs text-muted-foreground">Dagen streak</div>
            </div>
            <div className="bg-muted/30 p-3 rounded-lg border text-center">
              <div className="text-xl font-bold">{progress?.completedGoals || 0}/{progress?.totalGoals || 0}</div>
              <div className="text-xs text-muted-foreground">Doelen behaald</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className={`flex flex-col overflow-hidden ${isMobile ? "" : "flex-1"}`}>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Aandachtspunten</CardTitle>
          <CardDescription>Onderwerpen om extra te oefenen</CardDescription>
        </CardHeader>
        <ScrollArea className="flex-1">
          <CardContent className="space-y-3 pt-0">
            {weakPoints.length > 0 ? (
              weakPoints.map((wp: { id: number; subject: string; topic: string; severity: string; suggestedAction: string }) => (
                <div key={wp.id} className="border rounded-md p-3 space-y-2 bg-card">
                  <div className="flex justify-between items-start">
                    <div>
                      <Badge variant="outline" className="mb-1 text-[10px]">{wp.subject}</Badge>
                      <h4 className="font-medium text-sm leading-tight">{wp.topic}</h4>
                    </div>
                    <Badge variant={getSeverityColor(wp.severity) as "destructive" | "secondary" | "outline"} className="text-[10px]">
                      {wp.severity}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{wp.suggestedAction}</p>
                  <Button variant="ghost" size="sm" className="w-full text-xs h-7 mt-1" onClick={() => handleSendMessage(`Help mij met ${wp.topic} voor ${wp.subject}`)}>
                    Oefen dit
                  </Button>
                </div>
              ))
            ) : (
              <div className="text-sm text-center text-muted-foreground p-4">
                Je bent goed op weg! Geen specifieke zwakke punten geregistreerd.
              </div>
            )}
          </CardContent>
        </ScrollArea>
      </Card>
    </>
  );

  // --- Mobile Layout ---
  if (isMobile) {
    return (
      <div className="h-full flex flex-col space-y-4">
        <header>
          <h1 className="text-2xl font-bold text-foreground">Welkom terug!</h1>
          <p className="text-muted-foreground text-sm mt-1">Hier is je overzicht voor vandaag.</p>
        </header>

        {suggestionsPanel}

        <div className="flex-1 min-h-[400px]">
          {chatColumn}
        </div>

        <Collapsible open={statsOpen} onOpenChange={setStatsOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full flex items-center justify-between text-sm text-muted-foreground">
              <span>Statistieken &amp; Kalender</span>
              <ChevronDown className={`h-4 w-4 transition-transform ${statsOpen ? "rotate-180" : ""}`} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-4 pt-2">
            {calendarColumn}
            {statsContent}
          </CollapsibleContent>
        </Collapsible>
      </div>
    );
  }

  // --- Desktop Layout ---
  return (
    <div className="h-full flex flex-col space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-foreground">Welkom terug!</h1>
        <p className="text-muted-foreground mt-1">Hier is je overzicht voor vandaag.</p>
      </header>

      {suggestionsPanel}

      <div className="flex-1 grid grid-cols-12 gap-6 min-h-0 overflow-hidden">
        {calendarColumn}
        {chatColumn}
        <div className="col-span-3 flex flex-col gap-6 h-full overflow-hidden">
          {statsContent}
        </div>
      </div>
    </div>
  );
}

function MessageCircleIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z" />
    </svg>
  );
}
