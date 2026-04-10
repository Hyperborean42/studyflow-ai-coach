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
 * Transcribe audio using Google Cloud Speech-to-Text v2 with chirp_2 model.
 * Supports auto-language-detection across Dutch, English, and Italian.
 *
 * Uses the europe-west4 regional endpoint because chirp_2 is only available
 * at regional endpoints (not at global). Accepts any browser-recorded audio
 * format (webm/opus from Chrome, mp4/aac from Safari) — v2 auto-decodes.
 */
export async function speechToText(audioBuffer: Buffer): Promise<{
  text: string;
  detectedLanguage?: string;
}> {
  const token = await getAccessToken();
  const projectId = getProjectId();
  const location = "europe-west4";

  const url = `https://${location}-speech.googleapis.com/v2/projects/${projectId}/locations/${location}/recognizers/_:recognize`;

  const body = {
    config: {
      autoDecodingConfig: {},
      languageCodes: ["nl-NL", "en-US", "it-IT"],
      model: "chirp_2",
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

const TTS_VOICES: Record<SupportedLang, { languageCode: string; name: string }> = {
  nl: { languageCode: "nl-NL", name: "nl-NL-Wavenet-E" },
  en: { languageCode: "en-US", name: "en-US-Neural2-F" },
  it: { languageCode: "it-IT", name: "it-IT-Wavenet-A" },
};

/**
 * Synthesize speech using Google Cloud Text-to-Speech.
 * Returns an MP3 buffer suitable for browser playback or file sharing.
 */
export async function textToSpeech(
  text: string,
  language: SupportedLang,
): Promise<Buffer> {
  const token = await getAccessToken();
  const voice = TTS_VOICES[language];

  const url = "https://texttospeech.googleapis.com/v1/text:synthesize";
  const body = {
    input: { text },
    voice: {
      languageCode: voice.languageCode,
      name: voice.name,
    },
    audioConfig: {
      audioEncoding: "MP3",
      speakingRate: 1.0,
      pitch: 0.0,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "x-goog-user-project": getProjectId(),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Text-to-Speech failed: ${res.status} ${errorText.replace(/\s+/g, " ")}`);
  }

  const data = (await res.json()) as { audioContent: string };
  return Buffer.from(data.audioContent, "base64");
}

// Re-export for convenience
export { STT_LANG_CODES };
