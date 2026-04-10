import React, { useEffect, useState } from "react";
import { Square, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { subscribeCoachAudio, stopCurrentCoachAudio } from "@/lib/speak-coach";

/**
 * Persistent floating audio bar. Sticks to the top of the chat area and is
 * visible whenever coach audio is playing — no scrolling required to access
 * the stop control. Hidden when no audio is active.
 */
export function CoachAudioBar() {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => subscribeCoachAudio((k) => setActive(k)), []);

  if (!active) return null;

  return (
    <div
      role="region"
      aria-live="polite"
      className="sticky top-0 z-30 flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-primary-foreground shadow-lg mb-2"
    >
      <div className="flex-shrink-0 h-7 w-7 rounded-full bg-primary-foreground/20 flex items-center justify-center">
        <Volume2 className="h-3.5 w-3.5 animate-pulse" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate">Coach spreekt...</p>
      </div>
      <Button
        variant="secondary"
        size="sm"
        className="h-7 text-[11px] shrink-0"
        onClick={stopCurrentCoachAudio}
        aria-label="Stop afspelen"
      >
        <Square className="h-3 w-3 mr-1 fill-current" /> Stop
      </Button>
    </div>
  );
}
