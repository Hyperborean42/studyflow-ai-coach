import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Mic, Send, Loader2, Sparkles, HeartHandshake } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { streamOpenAiResponse } from "@/lib/api-streaming";

export default function Coaching() {
  const { toast } = useToast();
  const [reviewText, setReviewText] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [coachResponse, setCoachResponse] = useState("");

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
      setReviewText(prev => prev + (prev ? " " : "") + transcript);
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

  const handleSubmit = async () => {
    if (!reviewText.trim()) return;
    
    setIsSubmitting(true);
    setCoachResponse("");
    
    try {
      await streamOpenAiResponse(
        `api/coaching/weekly-review`,
        { feedback: reviewText },
        (chunk) => {
          setCoachResponse(prev => prev + chunk);
        }
      );
      toast({ title: "Review verwerkt", description: "Je coach heeft gereageerd." });
    } catch (error) {
      toast({ title: "Fout", description: "Kon review niet verwerken.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="h-full flex flex-col space-y-6 max-w-4xl mx-auto w-full">
      <header className="text-center mb-4">
        <h1 className="text-3xl font-bold text-foreground">Wekelijkse Reflectie</h1>
        <p className="text-muted-foreground mt-2">Neem even de tijd om terug te kijken op je studieweek. Jouw AI coach helpt je te verbeteren.</p>
      </header>

      <Card className="border-primary/20 shadow-sm">
        <CardHeader className="bg-primary/5 pb-4 border-b">
          <CardTitle className="text-xl flex items-center gap-2">
            <HeartHandshake className="h-5 w-5 text-primary" />
            Hoe ging het deze week?
          </CardTitle>
          <CardDescription>
            Deel wat goed ging, waar je tegenaan liep en hoe je je voelde. Je kunt typen of inspreken.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="relative">
            <Textarea 
              value={reviewText}
              onChange={e => setReviewText(e.target.value)}
              placeholder="Deze week vond ik wiskunde lastig omdat... maar geschiedenis ging super goed. Ik was wel vaak moe in de avond..."
              className="min-h-[150px] resize-y pb-12 text-base"
              disabled={isSubmitting}
            />
            <div className="absolute bottom-3 right-3 flex gap-2">
              <Button 
                type="button" 
                size="icon" 
                variant={isRecording ? "destructive" : "secondary"} 
                onClick={toggleRecording}
                className={`rounded-full h-8 w-8 ${isRecording ? "animate-pulse" : ""}`}
                disabled={isSubmitting}
              >
                <Mic className="h-4 w-4" />
              </Button>
            </div>
          </div>
          
          <div className="mt-4 flex justify-end">
            <Button 
              onClick={handleSubmit} 
              disabled={isSubmitting || !reviewText.trim()}
              className="gap-2"
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Vraag om Feedback
            </Button>
          </div>
        </CardContent>
      </Card>

      {coachResponse && (
        <Card className="bg-muted/30 border-primary/30">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Jouw AI Studiecoach
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div 
              className="prose prose-sm md:prose-base dark:prose-invert max-w-none prose-p:leading-relaxed"
              dangerouslySetInnerHTML={{ __html: coachResponse }} 
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
