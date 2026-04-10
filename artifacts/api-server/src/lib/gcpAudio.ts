/**
 * Google Cloud Speech-to-Text + Text-to-Speech via REST API.
 *
 * Uses Application Default Credentials on Cloud Run — fetches a bearer
 * token from the metadata server. No SDK, no API keys, no bundling issues.
 */

import { Buffer } from "node:buffer";

// ─── Auth ──────────────────────────────────────────────────────────────────

interface CachedToken {
  token: string;
  expiresAt: number;
}

let tokenCache: CachedToken | null = null;

/**
 * Fetch a GCP access token from the Cloud Run metadata server.
 * Caches the token in memory until ~1 minute before expiry.
 */
async function getAccessToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.token;
  }

  const res = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    { headers: { "Metadata-Flavor": "Google" } },
  );

  if (!res.ok) {
    throw new Error(
      `Failed to fetch GCP access token from metadata server: ${res.status} ${res.statusText}`,
    );
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return data.access_token;
}

function getProjectId(): string {
  const id =
    process.env.GCP_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    "western-beanbag-445419-q5";
  return id;
}

// ─── Speech-to-Text (v2, chirp_2 multi-language) ───────────────────────────

export type SupportedLang = "nl" | "en" | "it";

const STT_LANG_CODES: Record<SupportedLang, string> = {
  nl: "nl-NL",
  en: "en-US",
  it: "it-IT",
};

/**
 * Transcribe audio using Google Cloud Speech-to-Text v2.
 *
 * Uses the 'global' location with the 'long' model — the documented combo
 * that supports multi-language recognition (nl-NL + en-US + it-IT in one
 * request). Chirp/chirp_2 are restricted to specific regional endpoints
 * that don't support multi-language mode.
 *
 * Accepts any browser-recorded audio format (webm/opus from Chrome,
 * mp4/aac from Safari) — v2 auto-decodes.
 */
export async function speechToText(audioBuffer: Buffer): Promise<{
  text: string;
  detectedLanguage?: string;
}> {
  const token = await getAccessToken();
  const projectId = getProjectId();

  const url = `https://speech.googleapis.com/v2/projects/${projectId}/locations/global/recognizers/_:recognize`;

  const body = {
    config: {
      autoDecodingConfig: {},
      languageCodes: ["nl-NL", "en-US", "it-IT"],
      model: "long",
      features: {
        enableAutomaticPunctuation: true,
      },
    },
    content: audioBuffer.toString("base64"),
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "x-goog-user-project": projectId,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text();
    // Log single-line for easier log viewing
    throw new Error(`Speech-to-Text failed: ${res.status} ${errorText.replace(/\s+/g, " ")}`);
  }

  const data = (await res.json()) as {
    results?: Array<{
      alternatives?: Array<{ transcript?: string }>;
      languageCode?: string;
    }>;
  };

  const firstResult = data.results?.[0];
  const transcript = firstResult?.alternatives?.[0]?.transcript || "";
  const detectedLanguage = firstResult?.languageCode;

  return {
    text: transcript.trim(),
    detectedLanguage,
  };
}

// ─── Text-to-Speech (Neural2 voices per language) ─────────────────────────

// Chirp3 HD voices — Google's newest and most natural-sounding text-to-speech.
// These are available at the global endpoint via the v1 synthesis API.
// Fallback voices are older Wavenet/Neural2 if Chirp3 HD rejects the request.
const TTS_VOICES: Record<SupportedLang, { languageCode: string; primary: string; fallback: string }> = {
  nl: {
    languageCode: "nl-NL",
    primary: "nl-NL-Chirp3-HD-Achernar",
    fallback: "nl-NL-Wavenet-E",
  },
  en: {
    languageCode: "en-US",
    primary: "en-US-Chirp3-HD-Achernar",
    fallback: "en-US-Neural2-F",
  },
  it: {
    languageCode: "it-IT",
    primary: "it-IT-Chirp3-HD-Achernar",
    fallback: "it-IT-Wavenet-A",
  },
};

async function synthesize(
  text: string,
  languageCode: string,
  voiceName: string,
): Promise<Response> {
  const token = await getAccessToken();
  const url = "https://texttospeech.googleapis.com/v1/text:synthesize";
  const body = {
    input: { text },
    voice: { languageCode, name: voiceName },
    audioConfig: {
      audioEncoding: "MP3",
      speakingRate: 1.0,
      pitch: 0.0,
    },
  };

  return fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "x-goog-user-project": getProjectId(),
    },
    body: JSON.stringify(body),
  });
}

/**
 * Synthesize speech using Google Cloud Text-to-Speech.
 * Tries Chirp3 HD first (newest, most natural), falls back to Wavenet/Neural2.
 * Returns an MP3 buffer suitable for browser playback or file sharing.
 */
export async function textToSpeech(
  text: string,
  language: SupportedLang,
): Promise<Buffer> {
  const voice = TTS_VOICES[language];

  // Try Chirp3 HD
  let res = await synthesize(text, voice.languageCode, voice.primary);

  // Fall back to older voice if Chirp3 HD isn't available for this language/region
  if (!res.ok) {
    const errorText = await res.text();
    console.warn(
      `TTS Chirp3 HD failed for ${voice.primary}, falling back to ${voice.fallback}: ${res.status} ${errorText.replace(/\s+/g, " ").slice(0, 200)}`,
    );
    res = await synthesize(text, voice.languageCode, voice.fallback);
  }

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Text-to-Speech failed: ${res.status} ${errorText.replace(/\s+/g, " ")}`);
  }

  const data = (await res.json()) as { audioContent: string };
  return Buffer.from(data.audioContent, "base64");
}

// Re-export for convenience
export { STT_LANG_CODES };
