import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { studyGoalsTable, calendarEventsTable, weakPointsTable, studySessionsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { streamClaudeResponse } from "../lib/claude";
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
  const weakPoints = await db.select().from(weakPointsTable);

  const weakPointsSummary = weakPoints.length > 0
    ? `\nZwakke punten: ${weakPoints.map(wp => `${wp.subject} - ${wp.topic} (${wp.severity})`).join(", ")}`
    : "";

  await streamClaudeResponse(
    res,
    `Je bent StudyFlow Coach, een proactieve AI-studiecoach voor HAVO 5-leerlingen. Je geeft eerlijke, motiverende wekelijkse reviews. Je kent het verschil tussen SE- en CE-voorbereiding en past je advies daarop aan. Antwoord in Nederlands.`,
    [
      {
        role: "user" as const,
        content: `Geef een motiverende wekelijkse coaching review op basis van het volgende:

Eigen reflectie van de student:
"${body.feedback}"

Statistieken:
- Actieve studiedoelen: ${goals.filter(g => g.status === "actief").length}
- Afgeronde taken: ${completedEvents} van de ${events.length}
- Doelen: ${goals.map(g => `${g.title} (${g.progress}%)`).join(", ")}${weakPointsSummary}

Geef:
1. Een persoonlijke, motiverende terugkoppeling op de reflectie
2. Concrete tips voor verbetering — koppel aan specifieke zwakke punten als die er zijn
3. Specifieke aanpassingen voor de komende week
4. Een bemoedigend slotwoord

Eindig met concrete vervolgacties: "Wil je dat ik een oefentoets maak voor [zwak punt]?" of "Zal ik je studieplan aanpassen?"`,
      },
    ]
  );
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
  const checkDate = new Date(today);
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
