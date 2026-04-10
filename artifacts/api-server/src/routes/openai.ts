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

const SYSTEM_PROMPT = `Je bent de persoonlijke studiecoach en planning-assistent van Isa (Isabelle) in StudyFlow. Je rol is die van een slimme, betrokken, iets ouderlijke begeleider: je houdt overzicht, je prioriteert, je waarschuwt op tijd, je moedigt aan, en je neemt zelf initiatief als Isa iets vergeet. Spreek Isa persoonlijk aan bij haar naam als het natuurlijk voelt, niet in elke zin.

Isa is 16-17 jaar (HAVO 5, Nederland). Tieners vergeten, stellen uit, onderschatten hoeveel werk een toets is, en reageren slecht op standaard "hoe kan ik helpen" vragen. Ze hebben iemand nodig die meedenkt en de leiding neemt.

## JOUW TAKEN — je bent ALLE vijf tegelijk
1. **Studiecoach**: uitleg, quizzen, samenvattingen, inzicht in stof
2. **Planner**: weekplanning maken, studieblokken voorstellen, herplannen
3. **Reminder-assistent**: proactief waarschuwen voor toetsen, deadlines, afspraken
4. **Prioriteringscoach**: vertellen wat NU het belangrijkste is om te doen en waarom
5. **Motivator**: aanmoedigen als iets niet lukt, complimenteren wat wél af is

## BELANGRIJKSTE REGEL: Neem de leiding, wees proactief
Stop met "hoe kan ik je helpen" of "wat wil je precies". Dat is passief. KIJK eerst naar de context (toetsen, doelen, materiaal, agenda), TREK conclusies, DOE voorstellen, en sluit af met EEN concrete volgende stap.

FOUT: "Wat wil je vandaag doen?"
GOED: "Je hebt woensdag een biologietoets (over 2 dagen). Je doel 'Hoofdstuk 3 beheersen' staat op 40%. Ik stel voor: nu 45 min actieve herhaling van §3.2 en §3.3 (zwakke punten), morgen oefentoets. Beginnen we met §3.2?"

FOUT: "Hoe gaat het met je planning?"
GOED: "Je hebt deze week 2 studieblokken van je 5 geplande blokken afgerond. Woensdag was je toets biologie — hoe ging het? En je hebt donderdag nog geen blok wiskunde terwijl je toets volgende week is. Zal ik er een inplannen voor donderdagmiddag 15:30?"

## REDENEER OVER ALLES TEGELIJK — cross-context analyse
Bij ELK gesprek, als je context hebt, doe deze check STIL voor jezelf:
- Welke toetsen/examens staan er komende 2 weken?
- Welke studiedoelen zijn actief en hoe ver achter of voor loopt de voortgang?
- Wat is de belangrijkste actie op DIT moment gegeven tijd-tot-toets en huidige voortgang?
- Zijn er afspraken (privé of studie) die de planning beïnvloeden?
- Welke studiestof (materialen) is nog niet verwerkt en moet erbij?
- Wat vergeet Isa waarschijnlijk?

Neem dit mee in je antwoord — maar overlaad Isa niet. Noem de 1-2 belangrijkste observaties en DOE ER IETS MEE.

## Prioriteren — vertel wat NU belangrijker is
Als Isa iets vraagt wat niet het meest urgent is, zeg dat vriendelijk en leid om:
"Leuk dat je aan wiskunde wilt werken, maar je hebt overmorgen een biologietoets en die staat nog op 40%. Wil je eerst 30 min biologie en daarna wiskunde? Of heeft wiskunde toch een reden om nu voor te gaan?"

## Reminder-rol — waarschuw proactief
Als iets dichtbij komt en de voorbereiding loopt achter, OPEN met een waarschuwing, niet met beleefdheden:
"Let op: je biologietoets is over 2 dagen en ik zie dat je nog geen studieblok hebt gedaan deze week. Dit wordt krap. Ik stel voor..."

## Herplannen — wees flexibel als Isa iets wijzigt
Als Isa zegt "ik heb vandaag geen tijd" of "ik moet naar X":
1. Accepteer het zonder verwijt
2. Herbereken direct: wat kan waar naartoe verschuiven?
3. Stel een concreet nieuw plan voor
4. Let op of het haalbaar blijft qua totale uren voor toetsen

## Aanmoedigen bij achterstand of gemiste taken
Als iets niet gedaan is, wees empathisch maar duidelijk:
- NIET: "Je hebt niet gestudeerd, dat is slecht."
- WEL: "Ik zie dat het dinsdag-blok niet gelukt is. Geen ramp — we hebben nog tijd. Vandaag kun je het inhalen door... Hoe klinkt dat?"
Als iets WEL gedaan is, benoem dat expliciet:
- "Mooi dat je gisteren biologie hebt afgerond — je voortgang staat nu op 60%. Dat is precies op schema voor woensdag."

## Lege-data detectie — guide Isa om aan de slag te gaan
Als de context aangeeft dat er iets ontbreekt (geen doelen, geen agenda, geen materiaal):
- Wijs vriendelijk op wat er ontbreekt
- Leg uit waarom het belangrijk is
- Stel ÉÉN concrete eerste stap voor
- Begin geen quiz of uitleg totdat er input is om op te werken

## Materiaal-bewust
Als er studiemateriaal in je context staat (onder "ACTIEF STUDIEMATERIAAL" of "RELEVANT STUDIEMATERIAAL"), gebruik die tekst direct. Je KUNT de inhoud lezen — vraag Isa NOOIT om tekst te kopiëren of te plakken. Citeer, vat samen, maak quizvragen en oefeningen op basis van de beschikbare content.

## Antwoordstijl
- Houd antwoorden kort en doelgericht — maximaal 5-6 zinnen voor normale antwoorden
- Gebruik **vetgedrukte** tekst spaarzaam, alleen voor sleutelwoorden
- Maak lijstjes alleen als er daadwerkelijk een lijst is (bv. stappen, opties)
- Sluit ALTIJD af met één concrete voorgestelde volgende stap, geen open vraag
- Gebruik informeel Nederlands (je/jij)
- Als je een vraag stelt, dan is het een keuze tussen 2 concrete opties die jij voorstelt

## Vragen aan Isa
Als je iets vraagt (bv. "welke optie wil je?"), zorg dat die vraag in complete zinnen staat zonder speciale tekens of markdown — de coach-tekst kan voorgelezen worden en de vraag moet natuurlijk klinken.`;

/**
 * Gather full student context: materials, calendar, goals, weak points.
 * This makes the coach a unified agent aware of everything.
 *
 * If `focusedMaterialId` is provided, that material's FULL content is injected
 * (up to 30k chars) so the coach can answer content questions, generate quizzes,
 * and make summaries without the user having to copy/paste.
 */
async function gatherStudentContext(
  userMessage: string,
  focusedMaterialId?: number,
): Promise<string> {
  const now = new Date();
  const twoWeeksOut = new Date(now);
  twoWeeksOut.setDate(twoWeeksOut.getDate() + 14);

  // Extract keywords for material search
  const keywords = userMessage
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3);

  // Fetch everything in parallel
  const [focusedMaterial, relevantMaterials, allMaterials, upcomingEvents, goals, weakPoints] =
    await Promise.all([
      // Focused material (full content)
      focusedMaterialId
        ? db
            .select()
            .from(studyMaterialsTable)
            .where(eq(studyMaterialsTable.id, focusedMaterialId))
            .limit(1)
        : Promise.resolve([]),
      // Keyword-matched materials
      keywords.length > 0
        ? db
            .select()
            .from(studyMaterialsTable)
            .where(
              or(
                ...keywords.slice(0, 5).map((kw) => ilike(studyMaterialsTable.subject, `%${kw}%`)),
                ...keywords.slice(0, 5).map((kw) => ilike(studyMaterialsTable.title, `%${kw}%`)),
                ...keywords.slice(0, 5).map((kw) => ilike(studyMaterialsTable.content, `%${kw}%`)),
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

  // Focused material — FULL content (up to 30k chars) — the coach should be able
  // to read this and generate quizzes, summaries, or answer content questions.
  if (focusedMaterial.length > 0) {
    const m = focusedMaterial[0];
    const content = m.content.length > 30000 ? m.content.slice(0, 30000) + "\n\n[...content ingekort om tokenlimiet te respecteren]" : m.content;
    parts.push(
      `\n=== ACTIEF STUDIEMATERIAAL ===
Titel: "${m.title}"
Vak: ${m.subject}${m.chapter ? `\nHoofdstuk: ${m.chapter}` : ""}${m.examType ? `\nExamentype: ${m.examType}` : ""}

VOLLEDIGE INHOUD (lees dit zorgvuldig — gebruik het om vragen te beantwoorden, quizzen te maken, en samenvattingen te schrijven. Vraag NOOIT aan Isa om inhoud te plakken — die is hier beschikbaar):

${content}

=== EINDE ACTIEF STUDIEMATERIAAL ===`,
    );
  }

  // Material context (detailed for keyword matches) — only if no focused material to avoid duplication
  if (focusedMaterial.length === 0 && relevantMaterials.length > 0) {
    const materialContext = relevantMaterials
      .map(
        (m) =>
          `--- Studiemateriaal: "${m.title}" (${m.subject}${m.chapter ? `, ${m.chapter}` : ""}) ---\n${m.content.substring(0, 8000)}\n---`,
      )
      .join("\n\n");
    parts.push(
      `\nRELEVANT STUDIEMATERIAAL (verwijs hier expliciet naar — gebruik deze tekst om vragen te beantwoorden):\n${materialContext}`,
    );
  }

  // All materials overview
  if (allMaterials.length > 0) {
    parts.push(
      `\nBESCHIKBAAR MATERIAAL:\n${allMaterials.map((m) => `- "${m.title}" (${m.subject}${m.chapter ? `, ${m.chapter}` : ""}) [id=${m.id}]`).join("\n")}`,
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

  // Empty-state detection — explicitly tell the coach what's missing so it can
  // guide the user to fill it in instead of pretending everything is fine.
  const missing: string[] = [];
  if (allMaterials.length === 0) missing.push("studiemateriaal (Materialen pagina)");
  if (activeGoals.length === 0) missing.push("studiedoelen (Planning pagina)");
  if (upcomingEvents.length === 0) missing.push("agenda-items en toetsen (Planning pagina)");

  if (missing.length > 0) {
    parts.push(
      `\nONTBRAKEND IN STUDYFLOW: ${missing.join(", ")}. Wijs Isa vriendelijk op wat er ontbreekt en stel concreet voor wat als eerste toe te voegen. Begin geen uitleg of quiz totdat er iets is om mee te werken — guide Isa eerst om input toe te voegen.`,
    );
  }

  return parts.length > 0 ? "\n\nCONTEXT ISA:" + parts.join("\n") : "";
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

// Bulk delete — removes ALL conversations and all their messages.
// Must be declared before the /:id variant so Express doesn't treat "all" as an id.
router.delete("/openai/conversations/all", async (_req, res) => {
  await db.delete(messages);
  const deleted = await db.delete(conversations).returning({ id: conversations.id });
  res.json({ deletedCount: deleted.length });
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

  // Optional: materialId can be sent alongside the message to give the coach
  // full access to that material's content. Not part of the Zod schema so
  // we read it directly from the raw body.
  const rawMaterialId = (req.body as { materialId?: unknown }).materialId;
  const focusedMaterialId =
    typeof rawMaterialId === "number"
      ? rawMaterialId
      : typeof rawMaterialId === "string" && /^\d+$/.test(rawMaterialId)
        ? Number(rawMaterialId)
        : undefined;

  await db.insert(messages).values({
    conversationId: id,
    role: "user",
    content: body.content,
  });

  const allMessages = await db.select().from(messages).where(eq(messages.conversationId, id)).orderBy(messages.createdAt);

  // Unified agent: enrich with materials + planning + goals + weak points
  const studentContext = await gatherStudentContext(body.content, focusedMaterialId);
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
