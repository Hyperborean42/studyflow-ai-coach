/**
 * Shared helper to play a coach message via the /api/coach/speak endpoint.
 * The backend summarizes long responses to 1-2 sentences before TTS so the
 * user hears a brief spoken version rather than every word.
 */

let currentAudio: HTMLAudioElement | null = null;

export function stopCurrentCoachAudio() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }
}

export async function speakCoachMessage(
  text: string,
  options?: { summarize?: boolean; onStart?: () => void; onEnd?: () => void; onError?: (err: unknown) => void },
): Promise<void> {
  stopCurrentCoachAudio();
  try {
    const res = await fetch(import.meta.env.BASE_URL + "api/coach/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, summarize: options?.summarize !== false }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Voorlezen mislukt." }));
      throw new Error(err.error || "Voorlezen mislukt.");
    }
    const data = (await res.json()) as { audioBase64: string; audioMimeType: string };

    // Convert base64 to blob URL
    const binary = atob(data.audioBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: data.audioMimeType || "audio/mpeg" });
    const url = URL.createObjectURL(blob);

    const audio = new Audio(url);
    currentAudio = audio;
    audio.onplay = () => options?.onStart?.();
    audio.onended = () => {
      URL.revokeObjectURL(url);
      if (currentAudio === audio) currentAudio = null;
      options?.onEnd?.();
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      if (currentAudio === audio) currentAudio = null;
      options?.onError?.(new Error("Audio playback failed"));
    };
    await audio.play();
  } catch (err) {
    options?.onError?.(err);
    throw err;
  }
}
