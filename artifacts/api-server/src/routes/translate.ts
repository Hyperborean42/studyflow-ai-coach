import { Router, type IRouter } from "express";
import multer from "multer";
import { askClaude } from "../lib/claude";
import { speechToText, textToSpeech, type AudioInputFormat } from "../lib/openaiAudio";

const router: IRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
});

type SupportedLang = "nl" | "en" | "it";

const TRANSLATE_SYSTEM_PROMPT = `You are a precise, context-aware translator for a bilingual child-friendly universal translator app.

You will receive a transcribed phrase in Dutch, English, or Italian, plus the user's "primary language" (either "nl" or "en").

Your job:
1. Detect the source language (must be "nl", "en", or "it")
2. If source is "it" (Italian), the target is the user's primary language ("nl" or "en")
3. Otherwise (source is "nl" or "en"), the target is "it" (Italian)
4. Translate naturally — preserve tone, use everyday conversational vocabulary suitable for a child
5. Do NOT add explanations, greetings, or extra words — only the translation itself
6. Preserve proper nouns and numbers unchanged
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

function inferAudioFormat(mimeType: string | undefined): AudioInputFormat {
  const mime = (mimeType || "").toLowerCase();
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac")) return "mp4";
  if (mime.includes("ogg")) return "ogg";
  return "webm"; // Chrome/Firefox default for MediaRecorder
}

router.post("/translate/speech", upload.single("audio"), async (req, res) => {
  const file = (req as unknown as { file?: Express.Multer.File }).file;
  if (!file) {
    res.status(400).json({ error: "Geen audio bestand ontvangen." });
    return;
  }

  const primaryLanguage = (req.body?.primaryLanguage === "en" ? "en" : "nl") as "nl" | "en";

  try {
    const format = inferAudioFormat(file.mimetype);
    const sourceText = (await speechToText(file.buffer, format)).trim();
    if (!sourceText) {
      res.status(422).json({ error: "Kon geen spraak herkennen in de opname." });
      return;
    }

    // Translate + detect language via Claude (one call)
    const claudeRaw = await askClaude(
      TRANSLATE_SYSTEM_PROMPT,
      [
        {
          role: "user",
          content: `User primary language: ${primaryLanguage}\n\nTranscribed phrase:\n${sourceText}`,
        },
      ],
      { json: true },
    );

    const translated = parseTranslateResponse(claudeRaw);

    // Generate speech — 'nova' works well across NL/EN/IT
    const audioBuffer = await textToSpeech(translated.translatedText, "nova");
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
