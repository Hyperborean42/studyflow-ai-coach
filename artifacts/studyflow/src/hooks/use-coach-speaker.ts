import { useEffect, useState } from "react";
import { subscribeCoachAudio, speakCoachMessage } from "@/lib/speak-coach";

/**
 * Hook to power a coach-message speaker button with correct loading / speaking
 * / idle states. Single global audio — only one message plays at a time.
 *
 * Usage:
 *   const { isSpeaking, isAnySpeaking, speak } = useCoachSpeaker("msg-12", text);
 */
export function useCoachSpeaker(key: string, text: string) {
  const [activeKey, setActiveKey] = useState<string | null>(null);

  useEffect(() => {
    return subscribeCoachAudio((k) => setActiveKey(k));
  }, []);

  const isSpeaking = activeKey === key;
  const isAnySpeaking = activeKey !== null;

  const speak = async () => {
    await speakCoachMessage(text, { key });
  };

  return { isSpeaking, isAnySpeaking, speak };
}
