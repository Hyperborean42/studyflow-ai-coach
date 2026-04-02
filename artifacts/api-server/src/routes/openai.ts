import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { conversations, messages, studyMaterialsTable } from "@workspace/db/schema";
import { eq, ilike, or } from "drizzle-orm";
import { streamClaudeResponse } from "../lib/claude";
import {
  CreateOpenaiConversationBody,
  SendOpenaiMessageBody,
  GetOpenaiConversationParams,
  DeleteOpenaiConversationParams,
  ListOpenaiMessagesParams,
  SendOpenaiMessageParams,
  SendOpenaiVoiceMessageParams,
  SendOpenaiVoiceMessageBody,
  TranscribeAudioBody,
  TextToSpeechBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

const SYSTEM_PROMPT = `Je bent StudyFlow Coach, een proactieve AI-studiecoach voor HAVO 5-leerlingen in Nederland. Je bent geen passieve chatbot — je bent een agent die actief meedenkt, voorstelt en begeleidt.

## Jouw kernrol
- Je kent het HAVO 5 examensysteem: SE (schoolexamen), CE (centraal examen), en PTA (programma van toetsing en afsluiting)
- Je begrijpt dat het CE in mei/juni plaatsvindt en SE's verspreid over het jaar
- Je helpt leerlingen met alle examenvakken: Nederlands, Engels, wiskunde, biologie, geschiedenis, aardrijkskunde, economie, M&O, etc.

## Gedragsregels
1. **Proactief**: Bied na elk antwoord altijd vervolgacties aan:
   - "Wil je oefenvragen over dit onderwerp?"
   - "Zal ik een samenvatting maken die je kunt opslaan?"
   - "Wil je dat ik dit onderwerp in je studieplan zet?"
2. **Materiaal-bewust**: Als de leerling vraagt over een onderwerp waarvoor studiemateriaal is opgeslagen, verwijs daar expliciet naar: "Volgens je aantekeningen over [onderwerp]..."
3. **Examengericht**: Koppel uitleg altijd aan exameneisen. Benoem of iets SE- of CE-stof is als relevant.
4. **Studietechnieken**: Pas actief bewezen studietechnieken toe:
   - Spaced repetition: "Dit onderwerp kwam 5 dagen geleden voor het laatst aan bod, goed moment om te herhalen!"
   - Active recall: Stel tussendoor toetsvragen
   - Elaboratie: Vraag de leerling om concepten in eigen woorden uit te leggen
5. **Motiverend maar eerlijk**: Wees bemoedigend maar draai niet om zwakke punten heen. Benoem verbeterpunten concreet.
6. **Nederlandse taal**: Antwoord altijd in natuurlijk, vlot Nederlands. Gebruik informeel "je/jij", niet "u".

## Antwoordstijl
- Gebruik **vetgedrukte tekst** voor kernbegrippen
- Gebruik opsommingen voor overzicht
- Houd antwoorden helder en scanbaar
- Eindig altijd met een concrete vervolgactie of vraag`;

/**
 * Search study materials matching a user message (by subject or content keywords).
 * Returns the top 3 most relevant materials.
 */
async function findRelevantMaterials(userMessage: string): Promise<string> {
  // Extract potential subject/topic keywords from the message
  const keywords = userMessage
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3);

  if (keywords.length === 0) return "";

  // Search materials by subject or content match
  const materials = await db
    .select()
    .from(studyMaterialsTable)
    .where(
      or(
        ...keywords.slice(0, 5).map((kw) => ilike(studyMaterialsTable.subject, `%${kw}%`)),
        ...keywords.slice(0, 5).map((kw) => ilike(studyMaterialsTable.title, `%${kw}%`))
      )
    )
    .limit(3);

  if (materials.length === 0) return "";

  const materialContext = materials
    .map(
      (m) =>
        `--- Studiemateriaal: "${m.title}" (${m.subject}) ---\n${m.summary || m.content.substring(0, 1500)}\n---`
    )
    .join("\n\n");

  return `\n\nDe leerling heeft de volgende relevante studiematerialen opgeslagen. Verwijs hier expliciet naar in je antwoord als het relevant is (bijv. "Volgens je aantekeningen over..."):\n\n${materialContext}`;
}

router.get("/openai/conversations", async (req, res) => {
  const convs = await db.select().from(conversations).orderBy(conversations.createdAt);
  res.json(convs);
});

router.post("/openai/conversations", async (req, res) => {
  const body = CreateOpenaiConversationBody.parse(req.body);
  const [conv] = await db.insert(conversations).values({ title: body.title }).returning();
  res.status(201).json(conv);
});

router.get("/openai/conversations/:id", async (req, res) => {
  const { id } = GetOpenaiConversationParams.parse({ id: Number(req.params.id) });
  const conv = await db.select().from(conversations).where(eq(conversations.id, id));
  if (!conv.length) {
    res.status(404).json({ error: "Gesprek niet gevonden" });
    return;
  }
  const msgs = await db.select().from(messages).where(eq(messages.conversationId, id)).orderBy(messages.createdAt);
  res.json({ ...conv[0], messages: msgs });
});

router.delete("/openai/conversations/:id", async (req, res) => {
  const { id } = DeleteOpenaiConversationParams.parse({ id: Number(req.params.id) });
  await db.delete(messages).where(eq(messages.conversationId, id));
  await db.delete(conversations).where(eq(conversations.id, id));
  res.status(204).send();
});

router.get("/openai/conversations/:id/messages", async (req, res) => {
  const { id } = ListOpenaiMessagesParams.parse({ id: Number(req.params.id) });
  const msgs = await db.select().from(messages).where(eq(messages.conversationId, id)).orderBy(messages.createdAt);
  res.json(msgs);
});

router.post("/openai/conversations/:id/messages", async (req, res) => {
  const { id } = SendOpenaiMessageParams.parse({ id: Number(req.params.id) });
  const body = SendOpenaiMessageBody.parse(req.body);

  await db.insert(messages).values({
    conversationId: id,
    role: "user",
    content: body.content,
  });

  const allMessages = await db.select().from(messages).where(eq(messages.conversationId, id)).orderBy(messages.createdAt);

  // Material-aware: search for relevant study materials based on user's message
  const materialContext = await findRelevantMaterials(body.content);
  const enrichedSystemPrompt = SYSTEM_PROMPT + materialContext;

  const assistantContent = await streamClaudeResponse(
    res,
    enrichedSystemPrompt,
    allMessages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))
  );

  await db.insert(messages).values({
    conversationId: id,
    role: "assistant",
    content: assistantContent,
  });
});

router.post("/openai/conversations/:id/voice-messages", async (req, res) => {
  const { id } = SendOpenaiVoiceMessageParams.parse({ id: Number(req.params.id) });
  const body = SendOpenaiVoiceMessageBody.parse(req.body);

  // Voice transcription still requires OpenAI Whisper — keep as TODO
  // For now, expect the frontend to send pre-transcribed text in the audio field
  // or handle transcription client-side
  const userText = body.audio; // Fallback: treat as text if no transcription service

  await db.insert(messages).values({ conversationId: id, role: "user", content: userText });

  const allMessages = await db.select().from(messages).where(eq(messages.conversationId, id)).orderBy(messages.createdAt);

  const materialContext = await findRelevantMaterials(userText);
  const enrichedSystemPrompt = SYSTEM_PROMPT + materialContext;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  res.write(`data: ${JSON.stringify({ type: "transcript", data: userText })}\n\n`);

  const assistantContent = await streamClaudeResponse(
    res,
    enrichedSystemPrompt,
    allMessages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
  );

  await db.insert(messages).values({ conversationId: id, role: "assistant", content: assistantContent });
});

router.post("/openai/transcribe", async (_req, res) => {
  // Voice transcription requires a dedicated service (e.g. OpenAI Whisper).
  // This endpoint is preserved for API compatibility but returns an error
  // until a transcription provider is configured.
  res.status(501).json({
    error: "Spraakherkenning is tijdelijk niet beschikbaar. Typ je vraag in het tekstveld.",
  });
});

router.post("/openai/tts", async (_req, res) => {
  // Text-to-speech requires a dedicated service.
  // Preserved for API compatibility.
  res.status(501).json({
    error: "Tekst-naar-spraak is tijdelijk niet beschikbaar.",
  });
});

export default router;
