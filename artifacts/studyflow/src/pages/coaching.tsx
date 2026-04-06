import React, { useState, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Mic, Send, Loader2, Sparkles, Lightbulb, MessageSquare,
  BookOpen, CalendarDays, BrainCircuit, RotateCcw,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  useCreateOpenaiConversation,
  useListOpenaiConversations,
  useListOpenaiMessages,
} from "@workspace/api-client-react";
import { streamOpenAiResponse } from "@/lib/api-streaming";

export default function Coaching() {
  const { toast } = useToast();
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: conversations = [], refetch: refetchConversations } = useListOpenaiConversations();
  const createConversation = useCreateOpenaiConversation();
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
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between mb-2 md:mb-4">
        <div className="min-w-0">
          <h1 className="text-xl md:text-3xl font-bold flex items-center gap-2">
            <Lightbulb className="h-5 w-5 md:h-7 md:w-7 text-primary" />
            AI Studiecoach
          </h1>
          <p className="text-muted-foreground text-xs md:text-sm mt-0.5 hidden md:block">
            Je persoonlijke coach die je materiaal kent, je planning begrijpt, en je helpt studeren.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {conversations.length > 1 && (
            <select
              className="text-xs md:text-sm border rounded-md px-2 py-1 bg-background max-w-[120px] md:max-w-none"
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
          )}
          <Button variant="outline" size="sm" className="text-xs h-8" onClick={handleNewConversation}>
            <RotateCcw className="h-3.5 w-3.5 md:mr-1" />
            <span className="hidden md:inline">Nieuw gesprek</span>
          </Button>
        </div>
      </header>

      {/* Chat area */}
      <Card className="flex-1 flex flex-col overflow-hidden border-primary/20">
        <CardContent className="flex-1 flex flex-col p-0 overflow-hidden">
          <ScrollArea className="flex-1 p-4">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-4 md:p-8">
                <MessageSquare className="h-8 w-8 md:h-12 md:w-12 text-muted-foreground/20 mb-3" />
                <h3 className="text-base md:text-lg font-medium mb-1">Hoi! Ik ben je studiecoach.</h3>
                <p className="text-xs md:text-sm text-muted-foreground mb-4 max-w-md">
                  Vraag me om hulp met studeren, planning of een quiz!
                </p>
                <div className="grid grid-cols-3 gap-1.5 md:gap-2 max-w-lg">
                  {quickActions.map((action) => (
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
              <div className="space-y-4 pb-4">
                {messages.map((msg, idx) => (
                  <div key={idx} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] p-3 rounded-lg ${
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
