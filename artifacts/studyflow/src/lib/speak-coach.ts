/**
 * Shared helper to play a coach message via the /api/coach/speak endpoint.
 * The backend summarizes long responses to 1-2 sentences before TTS so the
 * user hears a brief spoken version rather than every word.
 *
 * Guarantees only one coach audio plays at a time — starting a new one
 * cancels any in-flight fetch and stops any currently-playing audio.
 */

let currentAudio: HTMLAudioElement | null = null;
let currentAbort: AbortController | null = null;
let currentKey: string | null = null;
let currentRevokeUrl: string | null = null;

// Global listeners — components can subscribe to know which message is
// currently speaking, so they can show spinners / disable buttons.
type Listener = (key: string | null) => void;
const listeners = new Set<Listener>();

function notify() {
  for (const l of listeners) l(currentKey);
}

export function subscribeCoachAudio(listener: Listener): () => void {
  listeners.add(listener);
  // Fire once immediately so new subscribers know current state
  listener(currentKey);
  return () => {
    listeners.delete(listener);
  };
}

export function stopCurrentCoachAudio() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
  }
  if (currentAbort) {
    currentAbort.abort();
  }
  if (currentRevokeUrl) {
    URL.revokeObjectURL(currentRevokeUrl);
    currentRevokeUrl = null;
  }
  currentAudio = null;
  currentAbort = null;
  currentKey = null;
  notify();
}

export async function speakCoachMessage(
  text: string,
  options?: { key?: string; summarize?: boolean },
): Promise<void> {
  // Identify this message for state tracking
  const key = options?.key ?? `${Date.now()}-${Math.random()}`;

  // If this exact message is already speaking, stop it (toggle off)
  if (currentKey === key) {
    stopCurrentCoachAudio();
    return;
  }

  // Cancel any in-flight or playing previous audio
  stopCurrentCoachAudio();

  // Mark this key as active immediately so UI can show a loading spinner
  currentKey = key;
  notify();

  const abort = new AbortController();
  currentAbort = abort;

  try {
    const res = await fetch(import.meta.env.BASE_URL + "api/coach/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, summarize: options?.summarize !== false }),
      signal: abort.signal,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Voorlezen mislukt." }));
      throw new Error(err.error || "Voorlezen mislukt.");
    }
    const data = (await res.json()) as { audioBase64: string; audioMimeType: string };

    // If we were cancelled while fetching, bail out
    if (currentKey !== key) return;

    // Convert base64 to blob URL
    const binary = atob(data.audioBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: data.audioMimeType || "audio/mpeg" });
    const url = URL.createObjectURL(blob);

    const audio = new Audio(url);
    currentAudio = audio;
    currentRevokeUrl = url;

    audio.onended = () => {
      URL.revokeObjectURL(url);
      if (currentAudio === audio) {
        currentAudio = null;
        currentAbort = null;
        currentKey = null;
        currentRevokeUrl = null;
        notify();
      }
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      if (currentAudio === audio) {
        currentAudio = null;
        currentAbort = null;
        currentKey = null;
        currentRevokeUrl = null;
        notify();
      }
    };
    await audio.play();
  } catch (err) {
    // AbortError is expected when user clicks another button
    if ((err as { name?: string })?.name === "AbortError") return;
    // Clear state on error
    if (currentKey === key) {
      currentKey = null;
      currentAudio = null;
      currentAbort = null;
      notify();
    }
    throw err;
  }
}
