import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { calendarEventsTable, studyGoalsTable } from "@workspace/db/schema";
import { eq, gte, lte, and } from "drizzle-orm";
import { streamClaudeResponse } from "../lib/claude";
import {
  CreateCalendarEventBody,
  UpdateCalendarEventParams,
  UpdateCalendarEventBody,
  DeleteCalendarEventParams,
  RescheduleWeekBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/calendar-events", async (req, res) => {
  const { startDate, endDate } = req.query;
  let events;

  if (startDate && endDate) {
    events = await db.select().from(calendarEventsTable)
      .where(and(
        gte(calendarEventsTable.startTime, new Date(String(startDate))),
        lte(calendarEventsTable.endTime, new Date(String(endDate)))
      ))
      .orderBy(calendarEventsTable.startTime);
  } else {
    events = await db.select().from(calendarEventsTable).orderBy(calendarEventsTable.startTime);
  }

  res.json(events);
});

router.post("/calendar-events", async (req, res) => {
  const body = CreateCalendarEventBody.parse(req.body);
  const [event] = await db.insert(calendarEventsTable).values({
    title: body.title,
    description: body.description,
    startTime: new Date(body.startTime),
    endTime: new Date(body.endTime),
    type: body.type,
    subject: body.subject,
    color: body.color || "#3b82f6",
    completed: false,
  }).returning();
  res.status(201).json(event);
});

router.put("/calendar-events/:id", async (req, res) => {
  const { id } = UpdateCalendarEventParams.parse({ id: Number(req.params.id) });
  const body = UpdateCalendarEventBody.parse(req.body);

  const updateData: Record<string, unknown> = {};
  if (body.title !== undefined) updateData.title = body.title;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.startTime !== undefined) updateData.startTime = new Date(body.startTime);
  if (body.endTime !== undefined) updateData.endTime = new Date(body.endTime);
  if (body.completed !== undefined) updateData.completed = body.completed;

  const [event] = await db.update(calendarEventsTable).set(updateData).where(eq(calendarEventsTable.id, id)).returning();
  res.json(event);
});

router.delete("/calendar-events/:id", async (req, res) => {
  const { id } = DeleteCalendarEventParams.parse({ id: Number(req.params.id) });
  await db.delete(calendarEventsTable).where(eq(calendarEventsTable.id, id));
  res.status(204).send();
});

router.post("/calendar-events/reschedule-week", async (req, res) => {
  const body = RescheduleWeekBody.parse(req.body);

  const goals = await db.select().from(studyGoalsTable).where(eq(studyGoalsTable.status, "actief"));
  const weekStart = new Date(body.weekStartDate);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const existingEvents = await db.select().from(calendarEventsTable)
    .where(and(
      gte(calendarEventsTable.startTime, weekStart),
      lte(calendarEventsTable.endTime, weekEnd)
    ));

  await streamClaudeResponse(
    res,
    `Je bent StudyFlow Coach, een proactieve AI-studiecoach voor HAVO 5-leerlingen. Je maakt realistische studieplanning rekening houdend met SE- en CE-periodes. Antwoord altijd in Nederlands.`,
    [
      {
        role: "user" as const,
        content: `Analyseer de volgende studiedoelen en plan een optimale studieweek. Geef concrete aanbevelingen voor studieblokken. Houd rekening met:
- Spaced repetition: wissel vakken af, herhaal moeilijke stof vaker
- Actief leren: stel voor wanneer de leerling moet oefenen vs. samenvatten
- Energie-management: zwaardere vakken eerder op de dag

Studiedoelen:
${goals.map(g => `- ${g.title} (${g.subject}): ${g.hoursPerWeek} uur/week, voortgang: ${g.progress}%`).join("\n")}

Bestaande afspraken deze week:
${existingEvents.map(e => `- ${e.title}: ${e.startTime.toLocaleString("nl-NL")} - ${e.endTime.toLocaleString("nl-NL")}`).join("\n") || "Geen bestaande afspraken"}

Week van: ${weekStart.toLocaleDateString("nl-NL")}

Geef per dag (ma-zo) concrete studieblokken van 1-2 uur met het vak. Wees motiverend en realistisch.`,
      },
    ]
  );
});

export default router;
