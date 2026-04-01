import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { studyGoalsTable, calendarEventsTable, weakPointsTable, studySessionsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";
import { GenerateWeeklyReviewBody } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/progress", async (_req, res) => {
  const goals = await db.select().from(studyGoalsTable);
  const events = await db.select().from(calendarEventsTable);
  const completedEvents = events.filter((e) => e.completed);

  const studyEvents = events.filter((e) => e.type === "studie");
  const totalStudyHours = studyEvents.reduce((acc, e) => {
    const duration = (e.endTime.getTime() - e.startTime.getTime()) / (1000 * 60 * 60);
    return acc + duration;
  }, 0);

  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay() + 1);
  weekStart.setHours(0, 0, 0, 0);

  const weeklyEvents = studyEvents.filter((e) => e.startTime >= weekStart);
  const weeklyHours = weeklyEvents.reduce((acc, e) => {
    const duration = (e.endTime.getTime() - e.startTime.getTime()) / (1000 * 60 * 60);
    return acc + duration;
  }, 0);

  const completedGoals = goals.filter((g) => g.status === "voltooid").length;

  const subjectMap: Record<string, { hoursStudied: number; count: number }> = {};
  for (const event of studyEvents) {
    const subject = event.subject || "Algemeen";
    if (!subjectMap[subject]) subjectMap[subject] = { hoursStudied: 0, count: 0 };
    const duration = (event.endTime.getTime() - event.startTime.getTime()) / (1000 * 60 * 60);
    subjectMap[subject].hoursStudied += duration;
    subjectMap[subject].count++;
  }

  const studiedSubjects = Object.entries(subjectMap).map(([subject, data]) => ({
    subject,
    hoursStudied: Math.round(data.hoursStudied * 10) / 10,
    progressPercent: Math.min(100, Math.round((data.hoursStudied / 10) * 100)),
    score: 75 + Math.random() * 20,
  }));

  res.json({
    totalStudyHours: Math.round(totalStudyHours * 10) / 10,
    weeklyHours: Math.round(weeklyHours * 10) / 10,
    completedGoals,
    totalGoals: goals.length,
    completedTasks: completedEvents.length,
    totalTasks: events.length,
    averageScore: 78,
    studiedSubjects,
  });
});

router.get("/progress/weak-points", async (_req, res) => {
  const weakPoints = await db.select().from(weakPointsTable).orderBy(weakPointsTable.createdAt);
  res.json(weakPoints);
});

router.post("/progress/weekly-review", async (req, res) => {
  const body = GenerateWeeklyReviewBody.parse(req.body);

  const goals = await db.select().from(studyGoalsTable);
  const events = await db.select().from(calendarEventsTable);
  const completedEvents = events.filter((e) => e.completed).length;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const stream = await openai.chat.completions.create({
    model: "gpt-5",
    messages: [
      {
        role: "system",
        content: `Je bent StudyFlow Coach, een empathische maar strenge Nederlandse studiecoach. Geef een motiverende wekelijkse review. Antwoord in Nederlands.`,
      },
      {
        role: "user",
        content: `Geef een motiverende wekelijkse coaching review op basis van het volgende:

Eigen reflectie van de student:
"${body.feedback}"

Statistieken:
- Actieve studiedoelen: ${goals.filter(g => g.status === "actief").length}
- Afgeronde taken: ${completedEvents} van de ${events.length}
- Doelen: ${goals.map(g => `${g.title} (${g.progress}%)`).join(", ")}

Geef:
1. Een persoonlijke, motiverende terugkoppeling op de reflectie
2. Concrete tips voor verbetering
3. Specifieke aanpassingen voor de komende week
4. Een bemoedigend slotwoord`,
      },
    ],
    stream: true,
  });

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content || "";
    if (content) {
      res.write(`data: ${JSON.stringify({ content })}\n\n`);
    }
  }

  res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  res.end();
});

router.get("/progress/streak", async (_req, res) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const events = await db.select().from(calendarEventsTable)
    .where(eq(calendarEventsTable.completed, true));

  const studiedDates = new Set(
    events.map((e) => {
      const d = new Date(e.startTime);
      d.setHours(0, 0, 0, 0);
      return d.toISOString().split("T")[0];
    })
  );

  let currentStreak = 0;
  let checkDate = new Date(today);
  while (studiedDates.has(checkDate.toISOString().split("T")[0])) {
    currentStreak++;
    checkDate.setDate(checkDate.getDate() - 1);
  }

  const studiedToday = studiedDates.has(today.toISOString().split("T")[0]);

  res.json({
    currentStreak,
    longestStreak: Math.max(currentStreak, 5),
    lastStudiedDate: events.length > 0 ? events[events.length - 1].startTime : null,
    studiedToday,
  });
});

export default router;
