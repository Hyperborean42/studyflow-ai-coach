import { Router, type IRouter } from "express";
import { askClaude } from "../lib/claude";
import { textToSpeech } from "../lib/gcpAudio";

const router: IRouter = Router();

const SUMMARIZE_PROMPT = `Je krijgt een bericht van een AI-studiecoach. Vat het kort samen in MAXIMAAL 2 zinnen,
natuurlijk Nederlands, informeel (je/jij). Geen opsomming, geen markdown, geen uitleg — alleen de
kern, zoals je het tegen een 16-jarige zou zeggen. Antwoord ALLEEN met de samenvatting zelf.`;

const MAX_INPUT_CHARS = 4000;
const MAX_TTS_CHARS = 400;

router.post("/coach/speak", async (req, res) => {
  const rawText = typeof req.body?.text === "string" ? req.body.text : "";
  const summarize = req.body?.summarize !== false; // default true

  const text = rawText.trim().slice(0, MAX_INPUT_CHARS);
  if (!text) {
    res.status(400).json({ error: "Geen tekst om voor te lezen." });
    return;
  }

  try {
    let spoken = text;

    // Summarize if requested and text is longer than a short sentence
    if (summarize && text.length > 200) {
      try {
        spoken = (await askClaude(SUMMARIZE_PROMPT, [{ role: "user", content: text }])).trim();
      } catch (err) {
        console.error("Coach speak: summarize failed, falling back to raw text", err);
      }
    }

    // Guardrail: cap TTS input length to keep audio short and costs bounded
    if (spoken.length > MAX_TTS_CHARS) {
      spoken = spoken.slice(0, MAX_TTS_CHARS).replace(/[^.!?]*$/, "") || spoken.slice(0, MAX_TTS_CHARS);
    }

    const audioBuffer = await textToSpeech(spoken, "nl");
    const audioBase64 = audioBuffer.toString("base64");

    res.json({
      spokenText: spoken,
      audioBase64,
      audioMimeType: "audio/mpeg",
    });
  } catch (err) {
    console.error("Coach speak error:", err);
    const message = err instanceof Error ? err.message : "Voorlezen mislukt.";
    res.status(500).json({ error: message });
  }
});

export default router;
