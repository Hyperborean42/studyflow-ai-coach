import React, { useState, useEffect, useRef } from "react";
import { format, startOfWeek, endOfWeek, addDays, isSameDay } from "date-fns";
import { nl } from "date-fns/locale";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChevronLeft, ChevronRight, Mic, Send, Lightbulb, PlayCircle, Loader2, Volume2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
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

export default function Dashboard() {
  const { toast } = useToast();
  const [currentDate, setCurrentDate] = useState(new Date());
  const startDate = startOfWeek(currentDate, { weekStartsOn: 1 });
  const endDate = endOfWeek(currentDate, { weekStartsOn: 1 });

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

  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<{role: string, content: string}[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
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
      
      // If voice is enabled in settings, automatically speak the response
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

  const toggleEventComplete = (event: any) => {
    updateEvent.mutate({ id: event.id, data: { completed: !event.completed } });
  };

  const toggleRecording = () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      toast({ title: "Niet ondersteund", description: "Spraakherkenning wordt niet ondersteund in deze browser.", variant: "destructive" });
      return;
    }
    
    const SpeechRecognition = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.lang = 'nl-NL';
    
    if (isRecording) {
      setIsRecording(false);
      recognition.stop();
      return;
    }
    
    setIsRecording(true);
    recognition.start();
    
    recognition.onresult = (event: any) => {
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
    "Genereer oefeningen", "Maak een quiz", "Geef feedback op mijn antwoord", 
    "Leg eenvoudiger uit", "Maak het moeilijker", "Meer herhaling"
  ];

  return (
    <div className="h-full flex flex-col space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-foreground">Welkom terug!</h1>
        <p className="text-muted-foreground mt-1">Hier is je overzicht voor vandaag.</p>
      </header>

      <div className="flex-1 grid grid-cols-12 gap-6 min-h-0 overflow-hidden">
        {/* Left Column - Calendar (25%) */}
        <Card className="col-span-3 flex flex-col h-full overflow-hidden">
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
                  const dayEvents = calendarEvents.filter(e => isSameDay(new Date(e.startTime), day));
                  const isToday = isSameDay(day, new Date());
                  
                  return (
                    <div key={day.toString()} className="space-y-2">
                      <h4 className={`text-sm font-medium ${isToday ? 'text-primary' : 'text-muted-foreground'}`}>
                        {format(day, 'EEEE d MMM', { locale: nl })}
                      </h4>
                      {dayEvents.length > 0 ? (
                        <div className="space-y-2">
                          {dayEvents.map(event => (
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

        {/* Center Column - Chat (50%) */}
        <Card className="col-span-6 flex flex-col h-full overflow-hidden border-primary/20 shadow-sm">
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
                          <div className="text-sm whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: msg.content }} />
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

        {/* Right Column - Stats (25%) */}
        <div className="col-span-3 flex flex-col gap-6 h-full overflow-hidden">
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
                  <div className="text-xl font-bold">{streak?.currentStreak || 0}🔥</div>
                  <div className="text-xs text-muted-foreground">Dagen streak</div>
                </div>
                <div className="bg-muted/30 p-3 rounded-lg border text-center">
                  <div className="text-xl font-bold">{progress?.completedGoals || 0}/{progress?.totalGoals || 0}</div>
                  <div className="text-xs text-muted-foreground">Doelen behaald</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="flex-1 flex flex-col overflow-hidden">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Aandachtspunten</CardTitle>
              <CardDescription>Onderwerpen om extra te oefenen</CardDescription>
            </CardHeader>
            <ScrollArea className="flex-1">
              <CardContent className="space-y-3 pt-0">
                {weakPoints.length > 0 ? (
                  weakPoints.map(wp => (
                    <div key={wp.id} className="border rounded-md p-3 space-y-2 bg-card">
                      <div className="flex justify-between items-start">
                        <div>
                          <Badge variant="outline" className="mb-1 text-[10px]">{wp.subject}</Badge>
                          <h4 className="font-medium text-sm leading-tight">{wp.topic}</h4>
                        </div>
                        <Badge variant={getSeverityColor(wp.severity) as any} className="text-[10px]">
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
        </div>
      </div>
    </div>
  );
}

function MessageCircleIcon(props: any) {
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
