import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  conversations,
  messages,
  studyMaterialsTable,
  calendarEventsTable,
  studyGoalsTable,
  weakPointsTable,
} from "@workspace/db/schema";
import { eq, gte, lte, and, ilike, or } from "drizzle-orm";
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

const SYSTEM_PROMPT = `Je bent StudyFlow Coach, een proactieve AI-studiecoach en studieplanner voor HAVO 5-leerlingen in Nederland. Je bent geen passieve chatbot — je bent een unified agent die actief meedenkt over zowel studie-inhoud als planning.

## Jouw kernrol
- Je kent het HAVO 5 examensysteem: SE (schoolexamen), CE (centraal examen), en PTA (programma van toetsing en afsluiting)
- Je begrijpt dat het CE in mei/juni plaatsvindt en SE's verspreid over het jaar
- Je helpt leerlingen met alle examenvakken: Nederlands, Engels, wiskunde, biologie, geschiedenis, aardrijkskunde, economie, M&O, etc.
- Je bent ook de STUDIEPLANNER: je kent de agenda, komende toetsen, en studiedoelen van de leerling

## Gedragsregels
1. **Proactief**: Bied na elk antwoord altijd vervolgacties aan:
   - "Wil je oefenvragen over dit onderwerp?"
   - "Zal ik een samenvatting maken die je kunt opslaan?"
   - "Wil je dat ik dit onderwerp in je studieplan zet?"
2. **Materiaal-bewust**: Als de leerling vraagt over een onderwerp waarvoor studiemateriaal is opgeslagen, verwijs daar expliciet naar en gebruik de inhoud: "Volgens je aantekeningen over [onderwerp]..."
3. **Planning-bewust**: Als er toetsen aankomen, waarschuw proactief. Stel studieblokken voor op basis van de agenda.
4. **Examengericht**: Koppel uitleg altijd aan exameneisen. Benoem of iets SE- of CE-stof is als relevant.
5. **Studietechnieken**: Pas actief bewezen studietechnieken toe:
   - Spaced repetition: "Dit onderwerp kwam 5 dagen geleden voor het laatst aan bod, goed moment om te herhalen!"
   - Active recall: Stel tussendoor toetsvragen
   - Elaboratie: Vraag de leerling om concepten in eigen woorden uit te leggen
6. **Motiverend maar eerlijk**: Wees bemoedigend maar draai niet om zwakke punten heen. Benoem verbeterpunten concreet.
7. **Nederlandse taal**: Antwoord altijd in natuurlijk, vlot Nederlands. Gebruik informeel "je/jij", niet "u".

## Antwoordstijl
- Gebruik **vetgedrukte tekst** voor kernbegrippen
- Gebruik opsommingen voor overzicht
- Houd antwoorden helder en scanbaar
- Eindig altijd met een concrete vervolgactie of vraag`;

/**
 * Gather full student context: materials, calendar, goals, weak points.
 * This makes the coach a unified agent aware of everything.
 */
async function gatherStudentContext(userMessage: string): Promise<string> {
  const now = new Date();
  const twoWeeksOut = new Date(now);
  twoWeeksOut.setDate(twoWeeksOut.getDate() + 14);

  // Extract keywords for material search
  const keywords = userMessage
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3);

  // Fetch everything in parallel
  const [relevantMaterials, allMaterials, upcomingEvents, goals, weakPoints] =
    await Promise.all([
      // Keyword-matched materials
      keywords.length > 0
        ? db
            .select()
            .from(studyMaterialsTable)
            .where(
              or(
                ...keywords.slice(0, 5).map((kw) => ilike(studyMaterialsTable.subject, `%${kw}%`)),
                ...keywords.slice(0, 5).map((kw) => ilike(studyMaterialsTable.title, `%${kw}%`)),
              ),
            )
            .limit(3)
        : Promise.resolve([]),
      // All materials (for listing)
      db.select().from(studyMaterialsTable),
      // Upcoming calendar events (2 weeks)
      db
        .select()
        .from(calendarEventsTable)
        .where(
          and(
            gte(calendarEventsTable.startTime, now),
            lte(calendarEventsTable.startTime, twoWeeksOut),
          ),
        )
        .orderBy(calendarEventsTable.startTime),
      // Active study goals
      db.select().from(studyGoalsTable),
      // Weak points
      db.select().from(weakPointsTable),
    ]);

  const parts: string[] = [];

  // Material context (detailed for keyword matches)
  if (relevantMaterials.length > 0) {
    const materialContext = relevantMaterials
      .map(
        (m) =>
          `--- Studiemateriaal: "${m.title}" (${m.subject}${m.chapter ? `, ${m.chapter}` : ""}) ---\n${m.summary || m.content.substring(0, 2000)}\n---`,
      )
      .join("\n\n");
    parts.push(
      `\nRELEVANT STUDIEMATERIAAL (verwijs hier expliciet naar):\n${materialContext}`,
    );
  }

  // All materials overview
  if (allMaterials.length > 0) {
    parts.push(
      `\nBESCHIKBAAR MATERIAAL:\n${allMaterials.map((m) => `- "${m.title}" (${m.subject}${m.chapter ? `, ${m.chapter}` : ""})`).join("\n")}`,
    );
  }

  // Calendar context
  const todayEvents = upcomingEvents.filter(
    (e) => e.startTime.toDateString() === now.toDateString(),
  );
  const exams = upcomingEvents.filter(
    (e) =>
      e.type === "toets" ||
      e.type === "examen" ||
      e.title.toLowerCase().includes("toets") ||
      e.title.toLowerCase().includes("examen"),
  );

  if (todayEvents.length > 0) {
    parts.push(
      `\nAGENDA VANDAAG (${now.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" })}):\n${todayEvents.map((e) => `- ${e.startTime.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })} ${e.title}${e.subject ? ` (${e.subject})` : ""}`).join("\n")}`,
    );
  }

  if (exams.length > 0) {
    parts.push(
      `\nKOMENDE TOETSEN/EXAMENS:\n${exams.map((e) => `- ${e.title}${e.subject ? ` (${e.subject})` : ""}: ${e.startTime.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" })}`).join("\n")}`,
    );
  }

  // Goals
  const activeGoals = goals.filter((g) => g.status === "actief");
  if (activeGoals.length > 0) {
    parts.push(
      `\nACTIEVE STUDIEDOELEN:\n${activeGoals.map((g) => `- ${g.title} (${g.subject}): ${g.progress}% af, deadline ${g.targetDate.toLocaleDateString("nl-NL")}, ${g.hoursPerWeek}u/week`).join("\n")}`,
    );
  }

  // Weak points
  if (weakPoints.length > 0) {
    parts.push(
      `\nZWAKKE PUNTEN:\n${weakPoints.map((wp) => `- ${wp.subject} — ${wp.topic} (${wp.severity}): ${wp.description}`).join("\n")}`,
    );
  }

  return parts.length > 0 ? "\n\nCONTEXT LEERLING:" + parts.join("\n") : "";
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

  // Unified agent: enrich with materials + planning + goals + weak points
  const studentContext = await gatherStudentContext(body.content);
  const enrichedSystemPrompt = SYSTEM_PROMPT + studentContext;

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

  const studentContext = await gatherStudentContext(userText);
  const enrichedSystemPrompt = SYSTEM_PROMPT + studentContext;

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
