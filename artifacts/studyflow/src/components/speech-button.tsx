import React from "react";
import { Button } from "@/components/ui/button";
import { Mic } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSpeechInput } from "@/hooks/use-speech-input";
import { useToast } from "@/hooks/use-toast";

interface SpeechButtonProps {
  /** Called with transcript text when speech is recognized */
  onTranscript: (text: string) => void;
  /** Append to existing text or replace */
  disabled?: boolean;
  /** Size variant */
  size?: "icon" | "sm" | "default";
  /** Additional className */
  className?: string;
}

/**
 * Reusable speech-to-text button. Drop it next to any text input.
 * Uses the browser's SpeechRecognition API (Dutch by default).
 */
export function SpeechButton({ onTranscript, disabled, size = "icon", className }: SpeechButtonProps) {
  const { toast } = useToast();

  const { isRecording, isSupported, toggle } = useSpeechInput({
    onResult: (transcript) => {
      onTranscript(transcript);
    },
    onError: (error) => {
      toast({ title: "Spraak", description: error, variant: "destructive" });
    },
  });

  if (!isSupported) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size={size}
          variant={isRecording ? "destructive" : "outline"}
          onClick={toggle}
          disabled={disabled}
          className={`${isRecording ? "animate-pulse" : ""} ${className || ""}`}
        >
          <Mic className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {isRecording ? "Stoppen met luisteren" : "Spreek in"}
      </TooltipContent>
    </Tooltip>
  );
}
