import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { studyGoalsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import {
  CreateStudyGoalBody,
  UpdateStudyGoalParams,
  UpdateStudyGoalBody,
  DeleteStudyGoalParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/study-goals", async (_req, res) => {
  const goals = await db.select().from(studyGoalsTable).orderBy(studyGoalsTable.createdAt);
  res.json(goals);
});

router.post("/study-goals", async (req, res) => {
  const body = CreateStudyGoalBody.parse(req.body);
  const [goal] = await db.insert(studyGoalsTable).values({
    title: body.title,
    subject: body.subject,
    targetDate: new Date(body.targetDate),
    hoursPerWeek: body.hoursPerWeek,
    progress: 0,
    status: "actief",
  }).returning();
  res.status(201).json(goal);
});

router.put("/study-goals/:id", async (req, res) => {
  const { id } = UpdateStudyGoalParams.parse({ id: Number(req.params.id) });
  const body = UpdateStudyGoalBody.parse(req.body);

  const updateData: Record<string, unknown> = {};
  if (body.title !== undefined) updateData.title = body.title;
  if (body.subject !== undefined) updateData.subject = body.subject;
  if (body.targetDate !== undefined) updateData.targetDate = new Date(body.targetDate);
  if (body.hoursPerWeek !== undefined) updateData.hoursPerWeek = body.hoursPerWeek;
  if (body.progress !== undefined) updateData.progress = body.progress;
  if (body.status !== undefined) updateData.status = body.status;

  const [goal] = await db.update(studyGoalsTable).set(updateData).where(eq(studyGoalsTable.id, id)).returning();
  res.json(goal);
});

router.delete("/study-goals/:id", async (req, res) => {
  const { id } = DeleteStudyGoalParams.parse({ id: Number(req.params.id) });
  await db.delete(studyGoalsTable).where(eq(studyGoalsTable.id, id));
  res.status(204).send();
});

export default router;
