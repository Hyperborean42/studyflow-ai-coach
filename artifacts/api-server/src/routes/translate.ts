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
- A transcribed phrase (language unknown, may be Dutch, English, or Italian)
- A "mode" that defines the language pair: "nl-it", "en-it", or "nl-en"
- A hint from the speech engine about the detected language (may be wrong)

Your job:
1. Detect the actual source language from the text itself (trust the text over the engine hint). Must be "nl", "en", or "it".
2. The target language is the OTHER language in the pair:
   - mode "nl-it": nl ↔ it. Source nl → target it. Source it → target nl.
   - mode "en-it": en ↔ it. Source en → target it. Source it → target en.
   - mode "nl-en": nl ↔ en. Source nl → target en. Source en → target nl.
3. If the detected source language doesn't match either language in the pair, pick the closer match and translate to the other.
4. Translate naturally — preserve tone, use everyday conversational vocabulary suitable for a child.
5. Do NOT add explanations, greetings, or extra words — only the translation itself.
6. Preserve proper nouns and numbers unchanged.
7. Return ONLY valid JSON in this exact format (no markdown, no code fences):

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

type TranslateMode = "nl-it" | "en-it" | "nl-en";

function parseMode(raw: unknown): TranslateMode {
  if (raw === "en-it" || raw === "nl-en") return raw;
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
