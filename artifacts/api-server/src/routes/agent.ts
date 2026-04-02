import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  calendarEventsTable,
  studyGoalsTable,
  studyMaterialsTable,
  weakPointsTable,
} from "@workspace/db/schema";
import { eq, gte, lte, and } from "drizzle-orm";
import { askClaude } from "../lib/claude";

const router: IRouter = Router();

const AGENT_SYSTEM_PROMPT = `Je bent StudyFlow Agent, het proactieve brein achter de StudyFlow Coach app voor HAVO 5-leerlingen. Je genereert gepersonaliseerde suggesties en studieplanning op basis van de data van de leerling.

Je kent het Nederlandse onderwijssysteem:
- HAVO 5 is het eindexamenjaar
- SE (schoolexamen): toetsen verspreid over het jaar, tellen mee voor het einddiploma
- CE (centraal examen): landelijke examens in mei/juni
- PTA (programma van toetsing en afsluiting): overzicht van alle SE-toetsen per vak

Je past bewezen studietechnieken toe:
- Spaced repetition: herhaal stof op optimale intervallen
- Active recall: test jezelf in plaats van alleen herlezen
- Interleaving: wissel vakken af voor beter begrip
- Elaboratie: leg concepten in eigen woorden uit

Antwoord ALTIJD in het Nederlands.`;

// ─── GET /agent/suggestions ──────────────────────────────────────────────────
// Returns proactive agent suggestions based on the student's current data.
router.get("/agent/suggestions", async (_req, res) => {
  const now = new Date();
  const nextWeek = new Date(now);
  nextWeek.setDate(nextWeek.getDate() + 7);

  // Gather all student data in parallel
  const [upcomingEvents, goals, materials, weakPoints, allEvents] = await Promise.all([
    db
      .select()
      .from(calendarEventsTable)
      .where(
        and(
          gte(calendarEventsTable.startTime, now),
          lte(calendarEventsTable.startTime, nextWeek)
        )
      )
      .orderBy(calendarEventsTable.startTime),
    db.select().from(studyGoalsTable),
    db.select().from(studyMaterialsTable),
    db.select().from(weakPointsTable),
    db
      .select()
      .from(calendarEventsTable)
      .where(eq(calendarEventsTable.completed, true)),
  ]);

  // Calculate streak
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const studiedDates = new Set(
    allEvents.map((e) => {
      const d = new Date(e.startTime);
      d.setHours(0, 0, 0, 0);
      return d.toISOString().split("T")[0];
    })
  );
  let currentStreak = 0;
  const checkDate = new Date(today);
  while (studiedDates.has(checkDate.toISOString().split("T")[0])) {
    currentStreak++;
    checkDate.setDate(checkDate.getDate() - 1);
  }
  const studiedToday = studiedDates.has(today.toISOString().split("T")[0]);

  // Find materials not reviewed recently (no summary or old)
  const unreviewedMaterials = materials.filter((m) => {
    const daysSinceUpdate = (now.getTime() - m.updatedAt.getTime()) / (1000 * 60 * 60 * 24);
    return daysSinceUpdate > 3;
  });

  // Build context for Claude
  const upcomingExams = upcomingEvents.filter(
    (e) => e.type === "toets" || e.type === "examen" || e.title.toLowerCase().includes("toets") || e.title.toLowerCase().includes("examen")
  );
  const upcomingStudy = upcomingEvents.filter((e) => e.type === "studie");
  const activeGoals = goals.filter((g) => g.status === "actief");

  const prompt = `Genereer 3-5 proactieve suggesties voor de leerling op basis van de volgende data. Wees specifiek en persoonlijk.

HUIDIGE SITUATIE:
- Datum: ${now.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
- Studiestreak: ${currentStreak} dagen${studiedToday ? " (vandaag al gestudeerd)" : " (vandaag nog niet gestudeerd)"}

KOMENDE TOETSEN/EXAMENS (7 dagen):
${upcomingExams.length > 0 ? upcomingExams.map((e) => `- ${e.title} (${e.subject || "onbekend vak"}): ${e.startTime.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" })}`).join("\n") : "Geen toetsen gepland"}

GEPLANDE STUDIEBLOKKEN (7 dagen):
${upcomingStudy.length > 0 ? upcomingStudy.map((e) => `- ${e.title}: ${e.startTime.toLocaleDateString("nl-NL")} ${e.startTime.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}`).join("\n") : "Geen studieblokken gepland"}

ACTIEVE STUDIEDOELEN:
${activeGoals.length > 0 ? activeGoals.map((g) => `- ${g.title} (${g.subject}): ${g.progress}% af, deadline ${g.targetDate.toLocaleDateString("nl-NL")}`).join("\n") : "Geen actieve doelen"}

ZWAKKE PUNTEN:
${weakPoints.length > 0 ? weakPoints.map((wp) => `- ${wp.subject} - ${wp.topic}: ${wp.description} (${wp.severity})`).join("\n") : "Geen zwakke punten geregistreerd"}

ONGEBRUIKT STUDIEMATERIAAL (>3 dagen niet bekeken):
${unreviewedMaterials.length > 0 ? unreviewedMaterials.map((m) => `- "${m.title}" (${m.subject})`).join("\n") : "Alle materialen recent bekeken"}

BESCHIKBAAR STUDIEMATERIAAL:
${materials.length > 0 ? materials.map((m) => `- "${m.title}" (${m.subject})`).join("\n") : "Nog geen materialen opgeslagen"}

Geef het antwoord als JSON array:
[
  {
    "type": "exam_prep" | "weak_point" | "material_review" | "streak" | "daily_tip",
    "priority": "high" | "medium" | "low",
    "title": "korte titel",
    "message": "persoonlijk, motiverend bericht in 2-3 zinnen",
    "action": {
      "type": "chat" | "quiz" | "material" | "planning",
      "payload": { "subject": "vaknaam", "topic": "onderwerp", "materialId": 123 }
    }
  }
]

Regels:
- "exam_prep" met priority "high" als er een toets binnen 3 dagen is
- "weak_point" als er zwakke punten zijn die aansluiten bij komende toetsen
- "material_review" als studiemateriaal lang niet is bekeken
- "streak" als de leerling vandaag nog niet heeft gestudeerd of een mooie streak heeft
- "daily_tip" voor algemene studietips specifiek voor HAVO 5
- Gebruik altijd bestaande materialIds uit de data als je naar materiaal verwijst
- Schrijf in informeel Nederlands (je/jij)`;

  try {
    const response = await askClaude(AGENT_SYSTEM_PROMPT, [{ role: "user", content: prompt }], {
      json: true,
    });

    // Parse and validate the response
    let suggestions;
    try {
      suggestions = JSON.parse(response);
      // Handle if Claude wraps it in an object
      if (!Array.isArray(suggestions) && suggestions.suggestions) {
        suggestions = suggestions.suggestions;
      }
    } catch {
      suggestions = [];
    }

    res.json(suggestions);
  } catch (error) {
    console.error("Agent suggestions error:", error);
    res.status(500).json({ error: "Kon geen suggesties genereren" });
  }
});

// ─── POST /agent/auto-plan ───────────────────────────────────────────────────
// Auto-generates study blocks based on exams and goals, creates them in the DB.
router.post("/agent/auto-plan", async (req, res) => {
  const { weekStartDate } = req.body;

  if (!weekStartDate) {
    res.status(400).json({ error: "weekStartDate is verplicht (ISO 8601 formaat)" });
    return;
  }

  const weekStart = new Date(weekStartDate);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  // Gather context
  const [goals, existingEvents, materials, weakPoints] = await Promise.all([
    db.select().from(studyGoalsTable).where(eq(studyGoalsTable.status, "actief")),
    db
      .select()
      .from(calendarEventsTable)
      .where(
        and(
          gte(calendarEventsTable.startTime, weekStart),
          lte(calendarEventsTable.endTime, weekEnd)
        )
      ),
    db.select().from(studyMaterialsTable),
    db.select().from(weakPointsTable),
  ]);

  const exams = existingEvents.filter(
    (e) =>
      e.type === "toets" ||
      e.type === "examen" ||
      e.title.toLowerCase().includes("toets") ||
      e.title.toLowerCase().includes("examen")
  );
  const fixedEvents = existingEvents.filter(
    (e) => e.type !== "studie"
  );

  const prompt = `Maak een optimaal studieplan voor de komende week. Genereer concrete studieblokken als JSON.

WEEK: ${weekStart.toLocaleDateString("nl-NL")} t/m ${weekEnd.toLocaleDateString("nl-NL")}

ACTIEVE STUDIEDOELEN:
${goals.length > 0 ? goals.map((g) => `- ${g.title} (${g.subject}): ${g.hoursPerWeek} uur/week nodig, voortgang: ${g.progress}%`).join("\n") : "Geen doelen"}

TOETSEN DEZE WEEK:
${exams.length > 0 ? exams.map((e) => `- ${e.title} (${e.subject || "?"}): ${e.startTime.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" })} om ${e.startTime.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}`).join("\n") : "Geen toetsen gepland"}

VASTE AFSPRAKEN (niet verplaatsbaar):
${fixedEvents.length > 0 ? fixedEvents.map((e) => `- ${e.title}: ${e.startTime.toLocaleDateString("nl-NL")} ${e.startTime.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })} - ${e.endTime.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}`).join("\n") : "Geen vaste afspraken"}

ZWAKKE PUNTEN:
${weakPoints.length > 0 ? weakPoints.map((wp) => `- ${wp.subject} - ${wp.topic} (${wp.severity})`).join("\n") : "Geen"}

BESCHIKBAAR MATERIAAL:
${materials.length > 0 ? materials.map((m) => `- ${m.subject}: "${m.title}"`).join("\n") : "Geen"}

REGELS:
- Studieblokken van 60-90 minuten
- Maximaal 3 blokken per dag (HAVO 5 leerlingen hebben ook school)
- Plan na school: 15:30-21:00 op weekdagen, flexibeler in het weekend
- Meer studietijd voor vakken met komende toetsen
- Wissel vakken af (interleaving)
- Zwakke punten vaker plannen
- Geef elke blok een beschrijvende titel in het Nederlands

Geef het antwoord als JSON:
{
  "studyBlocks": [
    {
      "title": "Wiskunde: oefenen met integralen",
      "description": "Focus op opgaven hoofdstuk 7. Maak minstens 10 oefenopgaven.",
      "startTime": "2026-03-31T15:30:00.000Z",
      "endTime": "2026-03-31T17:00:00.000Z",
      "subject": "Wiskunde",
      "color": "#3b82f6"
    }
  ],
  "reasoning": "Korte uitleg waarom je deze planning hebt gemaakt"
}

Gebruik de juiste data van de week ${weekStart.toISOString().split("T")[0]}. Gebruik diverse kleuren per vak.`;

  try {
    const response = await askClaude(AGENT_SYSTEM_PROMPT, [{ role: "user", content: prompt }], {
      json: true,
    });

    const parsed = JSON.parse(response);
    const studyBlocks = parsed.studyBlocks || parsed.study_blocks || [];

    // Create all study blocks in the database
    const createdEvents = [];
    for (const block of studyBlocks) {
      const [event] = await db
        .insert(calendarEventsTable)
        .values({
          title: block.title,
          description: block.description || null,
          startTime: new Date(block.startTime),
          endTime: new Date(block.endTime),
          type: "studie",
          subject: block.subject || null,
          color: block.color || "#3b82f6",
          completed: false,
        })
        .returning();
      createdEvents.push(event);
    }

    res.status(201).json({
      created: createdEvents.length,
      events: createdEvents,
      reasoning: parsed.reasoning || null,
    });
  } catch (error) {
    console.error("Auto-plan error:", error);
    res.status(500).json({ error: "Kon geen studieplan genereren" });
  }
});

export default router;
