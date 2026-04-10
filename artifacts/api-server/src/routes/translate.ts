import { Router, type IRouter } from "express";
import multer from "multer";
import { askClaude } from "../lib/claude";
import { speechToText, textToSpeech, type SupportedLang } from "../lib/gcpAudio";

const router: IRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
});

const TRANSLATE_SYSTEM_PROMPT = `You are a precise, context-aware translator for a child-friendly universal translator app.

You will receive:
- A transcribed phrase (may be Dutch, English, or Italian)
- A "mode" that defines the language pair (see modes below)
- A hint from the speech engine about the detected language (may be wrong)

MODES — bidirectional auto-detect (translate FROM detected source TO the other):
- "nl-it": nl ↔ it. Source nl → target it. Source it → target nl.
- "en-it": en ↔ it. Source en → target it. Source it → target en.
- "nl-en": nl ↔ en. Source nl → target en. Source en → target nl.

MODES — fixed direction (sourceLang ALWAYS matches first, targetLang ALWAYS matches second):
- "en-to-it": source MUST be "en", target MUST be "it"
- "it-to-nl": source MUST be "it", target MUST be "nl"
- "it-to-en": source MUST be "it", target MUST be "en"
- "nl-to-it": source MUST be "nl", target MUST be "it"
- "nl-to-en": source MUST be "nl", target MUST be "en"
- "en-to-nl": source MUST be "en", target MUST be "nl"

Your job:
1. For bidirectional modes: detect the actual source language from the text itself (trust the text over the engine hint) and translate to the other language in the pair.
2. For fixed-direction modes: even if the speech engine says the input was another language, translate the transcribed text as if it were the stated source language. Force the direction exactly as specified.
3. Translate naturally — preserve tone, use everyday conversational vocabulary suitable for a child.
4. Do NOT add explanations, greetings, or extra words — only the translation itself.
5. Preserve proper nouns and numbers unchanged.
6. Return ONLY valid JSON in this exact format (no markdown, no code fences):

{"sourceLang":"nl","targetLang":"it","translatedText":"..."}

Where sourceLang and targetLang are one of "nl", "en", "it".`;

interface TranslateResult {
  sourceLang: SupportedLang;
  targetLang: SupportedLang;
  translatedText: string;
}

function parseTranslateResponse(raw: string): TranslateResult {
  let clean = raw.trim();
  if (clean.startsWith("```")) {
    clean = clean.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  }
  const parsed = JSON.parse(clean) as TranslateResult;
  if (!parsed.sourceLang || !parsed.targetLang || !parsed.translatedText) {
    throw new Error("Invalid translate response structure");
  }
  return parsed;
}

type TranslateMode =
  | "nl-it"
  | "en-it"
  | "nl-en"
  | "en-to-it"
  | "it-to-nl"
  | "it-to-en"
  | "nl-to-it"
  | "nl-to-en"
  | "en-to-nl";

const VALID_MODES: TranslateMode[] = [
  "nl-it",
  "en-it",
  "nl-en",
  "en-to-it",
  "it-to-nl",
  "it-to-en",
  "nl-to-it",
  "nl-to-en",
  "en-to-nl",
];

function parseMode(raw: unknown): TranslateMode {
  if (typeof raw === "string" && (VALID_MODES as string[]).includes(raw)) {
    return raw as TranslateMode;
  }
  // Legacy support: primaryLanguage="en" → en-it, otherwise nl-it
  if (raw === "en") return "en-it";
  return "nl-it";
}

router.post("/translate/speech", upload.single("audio"), async (req, res) => {
  const file = (req as unknown as { file?: Express.Multer.File }).file;
  if (!file) {
    res.status(400).json({ error: "Geen audio bestand ontvangen." });
    return;
  }

  // Accept either `mode` (new) or `primaryLanguage` (legacy)
  const mode: TranslateMode = parseMode(req.body?.mode ?? req.body?.primaryLanguage);

  try {
    // Step 1: Speech-to-Text (Google Cloud Speech v2, long model, multi-language)
    console.log(`[translate] STT request — ${file.buffer.length} bytes, mime=${file.mimetype}, mode=${mode}`);
    const { text: sourceText, detectedLanguage } = await speechToText(file.buffer);
    console.log(`[translate] STT result — text="${sourceText}" lang=${detectedLanguage || "unknown"}`);

    if (!sourceText) {
      res.status(422).json({
        error:
          "Ik kon geen woorden herkennen. Spreek iets luider en duidelijker, en probeer opnieuw. Zorg ook dat je meer dan 1 seconde spreekt.",
      });
      return;
    }

    // Step 2: Translate + detect language via Claude (text-based detection is more reliable)
    const claudeRaw = await askClaude(
      TRANSLATE_SYSTEM_PROMPT,
      [
        {
          role: "user",
          content: `Mode: ${mode}\nSpeech engine language hint: ${detectedLanguage || "unknown"}\n\nTranscribed phrase:\n${sourceText}`,
        },
      ],
      { json: true },
    );

    const translated = parseTranslateResponse(claudeRaw);

    // Step 3: Text-to-Speech (Google Cloud TTS Neural2/Wavenet)
    const audioBuffer = await textToSpeech(translated.translatedText, translated.targetLang);
    const audioBase64 = audioBuffer.toString("base64");

    res.json({
      sourceText,
      sourceLang: translated.sourceLang,
      targetText: translated.translatedText,
      targetLang: translated.targetLang,
      audioBase64,
      audioMimeType: "audio/mpeg",
    });
  } catch (err) {
    console.error("Translate error:", err);
    const message = err instanceof Error ? err.message : "Vertaling mislukt.";
    res.status(500).json({ error: message });
  }
});

export default router;
