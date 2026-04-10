import OpenAI, { toFile } from "openai";

/**
 * Lazy-initialized OpenAI client. Only throws if/when an audio endpoint
 * is actually invoked without the API key — doesn't crash server startup.
 */
let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (_client) return _client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set. Audio/translation features are disabled.",
    );
  }
  _client = new OpenAI({ apiKey });
  return _client;
}

export type AudioInputFormat = "wav" | "mp3" | "webm" | "mp4" | "m4a" | "ogg";

/**
 * Speech-to-text using gpt-4o-mini-transcribe.
 * Accepts raw browser-recorded audio (webm from Chrome, mp4 from Safari, etc.)
 */
export async function speechToText(
  audioBuffer: Buffer,
  format: AudioInputFormat = "webm",
): Promise<string> {
  const client = getClient();
  const file = await toFile(audioBuffer, `audio.${format}`);
  const response = await client.audio.transcriptions.create({
    file,
    model: "gpt-4o-mini-transcribe",
  });
  return response.text;
}

export type TtsVoice = "alloy" | "ash" | "ballad" | "coral" | "echo" | "fable" | "nova" | "onyx" | "sage" | "shimmer";

/**
 * Text-to-speech using gpt-4o-mini-tts.
 * Returns an MP3 buffer suitable for browser <audio> playback or sharing.
 */
export async function textToSpeech(
  text: string,
  voice: TtsVoice = "nova",
): Promise<Buffer> {
  const client = getClient();
  const response = await client.audio.speech.create({
    model: "gpt-4o-mini-tts",
    voice,
    input: text,
    response_format: "mp3",
  });
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
