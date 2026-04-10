import React from "react";
import { Button } from "@/components/ui/button";
import { Volume2, Loader2, Square } from "lucide-react";
import { useCoachSpeaker } from "@/hooks/use-coach-speaker";
import { useToast } from "@/hooks/use-toast";

interface CoachSpeakerButtonProps {
  messageKey: string;
  text: string;
  className?: string;
  compact?: boolean;
}

/**
 * Reusable speaker button for coach messages. Handles:
 * - Instant loading feedback (spinner while fetching + speaking)
 * - Only one audio plays at a time globally
 * - Click-again-to-stop toggle
 * - Other speaker buttons disabled while one is active
 */
export function CoachSpeakerButton({
  messageKey,
  text,
  className,
  compact = false,
}: CoachSpeakerButtonProps) {
  const { toast } = useToast();
  const { isSpeaking, isAnySpeaking, speak } = useCoachSpeaker(messageKey, text);

  const handleClick = async () => {
    try {
      await speak();
    } catch (err) {
      toast({
        title: "Voorlezen mislukt",
        description: err instanceof Error ? err.message : "Probeer opnieuw.",
        variant: "destructive",
      });
    }
  };

  const label = isSpeaking ? "Stop" : "Luister";

  return (
    <Button
      variant="ghost"
      size="sm"
      className={
        className ||
        (compact
          ? "h-5 text-[10px] text-muted-foreground hover:text-primary"
          : "h-6 text-[11px] text-muted-foreground hover:text-primary")
      }
      onClick={handleClick}
      disabled={isAnySpeaking && !isSpeaking}
      aria-label={label}
    >
      {isSpeaking ? (
        <Square className="h-3 w-3 mr-1 fill-current" />
      ) : isAnySpeaking ? (
        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
      ) : (
        <Volume2 className="h-3 w-3 mr-1" />
      )}
      {label}
    </Button>
  );
}
