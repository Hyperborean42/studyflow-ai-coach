import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { studyMaterialsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { streamClaudeResponse, askClaude } from "../lib/claude";
import {
  CreateStudyMaterialBody,
  GetStudyMaterialParams,
  DeleteStudyMaterialParams,
  SummarizeStudyMaterialParams,
  GenerateQuizParams,
  GenerateQuizBody,
  GenerateExercisesParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

const SYSTEM_PROMPT = `Je bent StudyFlow Coach, een proactieve AI-studiecoach voor HAVO 5-leerlingen. Je helpt met studiemateriaal door heldere samenvattingen te maken, quizvragen te genereren en oefeningen te ontwerpen die aansluiten bij het SE/CE-niveau.

Belangrijke richtlijnen:
- Maak samenvattingen examengericht: markeer welke concepten vaak terugkomen in CE-examens
- Gebruik **vetgedrukte** tekst voor sleutelbegrippen
- Varieer quizvragen tussen kennisvragen, inzichtvragen en toepassingsvragen
- Geef bij oefeningen altijd een studietip mee
- Antwoord altijd in natuurlijk Nederlands`;

router.get("/study-materials", async (_req, res) => {
  const materials = await db.select().from(studyMaterialsTable).orderBy(studyMaterialsTable.createdAt);
  res.json(materials);
});

router.post("/study-materials", async (req, res) => {
  const body = CreateStudyMaterialBody.parse(req.body);
  const values: Record<string, unknown> = {
    title: body.title,
    subject: body.subject,
    content: body.content,
    fileType: body.fileType,
    updatedAt: new Date(),
  };
  // Support optional new fields if provided
  if ("chapter" in body && body.chapter) values.chapter = body.chapter;
  if ("examType" in body && body.examType) values.examType = body.examType;
  if ("tags" in body && body.tags) values.tags = body.tags;

  const [material] = await db.insert(studyMaterialsTable).values(values as typeof studyMaterialsTable.$inferInsert).returning();
  res.status(201).json(material);
});

router.get("/study-materials/:id", async (req, res) => {
  const { id } = GetStudyMaterialParams.parse({ id: Number(req.params.id) });
  const [material] = await db.select().from(studyMaterialsTable).where(eq(studyMaterialsTable.id, id));
  if (!material) {
    res.status(404).json({ error: "Studiemateriaal niet gevonden" });
    return;
  }
  res.json(material);
});

router.delete("/study-materials/:id", async (req, res) => {
  const { id } = DeleteStudyMaterialParams.parse({ id: Number(req.params.id) });
  await db.delete(studyMaterialsTable).where(eq(studyMaterialsTable.id, id));
  res.status(204).send();
});

router.post("/study-materials/:id/summarize", async (req, res) => {
  const { id } = SummarizeStudyMaterialParams.parse({ id: Number(req.params.id) });
  const [material] = await db.select().from(studyMaterialsTable).where(eq(studyMaterialsTable.id, id));
  if (!material) {
    res.status(404).json({ error: "Materiaal niet gevonden" });
    return;
  }

  const chapterInfo = material.chapter ? ` (${material.chapter})` : "";
  const examInfo = material.examType ? ` [${material.examType}-stof]` : "";

  const assistantContent = await streamClaudeResponse(
    res,
    SYSTEM_PROMPT,
    [
      {
        role: "user" as const,
        content: `Maak een heldere, gestructureerde samenvatting van het volgende studiemateriaal over ${material.subject}${chapterInfo}${examInfo}. Gebruik **vetgedrukte** tekst voor sleutelbegrippen, opsommingstekens voor hoofdpunten, en markeer de belangrijkste concepten duidelijk. Geef aan welke onderdelen waarschijnlijk terugkomen op het examen. Maak de samenvatting overzichtelijk en studievriendelijk.

Materiaal titel: ${material.title}
Inhoud:
${material.content}`,
      },
    ]
  );

  await db.update(studyMaterialsTable).set({ summary: assistantContent, updatedAt: new Date() }).where(eq(studyMaterialsTable.id, id));
});

router.post("/study-materials/:id/quiz", async (req, res) => {
  const { id } = GenerateQuizParams.parse({ id: Number(req.params.id) });
  const body = GenerateQuizBody.parse(req.body);
  const [material] = await db.select().from(studyMaterialsTable).where(eq(studyMaterialsTable.id, id));
  if (!material) {
    res.status(404).json({ error: "Materiaal niet gevonden" });
    return;
  }

  const numQ = body.numQuestions || 5;
  const chapterInfo = material.chapter ? ` (${material.chapter})` : "";
  const examInfo = material.examType ? ` Dit is ${material.examType}-stof.` : "";

  const response = await askClaude(
    SYSTEM_PROMPT,
    [
      {
        role: "user" as const,
        content: `Genereer ${numQ} meerkeuze quizvragen (${body.difficulty} niveau) over het volgende studiemateriaal.${examInfo} Mix kennisvragen, inzichtvragen en toepassingsvragen zoals op het HAVO-examen. Geef het antwoord als JSON in het volgende formaat:
{
  "questions": [
    {
      "question": "vraag",
      "options": ["optie A", "optie B", "optie C", "optie D"],
      "correctAnswer": "optie A",
      "explanation": "uitleg waarom dit het juiste antwoord is"
    }
  ]
}

Materiaal: ${material.title}${chapterInfo} - ${material.content.substring(0, 3000)}`,
      },
    ],
    { json: true }
  );

  const parsed = JSON.parse(response);
  res.json({
    id: Date.now(),
    materialId: id,
    questions: parsed.questions || [],
    createdAt: new Date().toISOString(),
  });
});

router.post("/study-materials/:id/exercises", async (req, res) => {
  const { id } = GenerateExercisesParams.parse({ id: Number(req.params.id) });
  const [material] = await db.select().from(studyMaterialsTable).where(eq(studyMaterialsTable.id, id));
  if (!material) {
    res.status(404).json({ error: "Materiaal niet gevonden" });
    return;
  }

  const chapterInfo = material.chapter ? ` (${material.chapter})` : "";
  const examInfo = material.examType ? ` Dit is ${material.examType}-stof.` : "";

  const response = await askClaude(
    SYSTEM_PROMPT,
    [
      {
        role: "user" as const,
        content: `Genereer 4 praktische oefeningen voor het studiemateriaal.${examInfo} Varieer de moeilijkheidsgraad. Maak oefeningen die lijken op echte HAVO-examenvragen. Geef het antwoord als JSON:
{
  "exercises": [
    {
      "question": "oefenvraag",
      "answer": "volledig antwoord",
      "difficulty": "makkelijk|gemiddeld|moeilijk",
      "tip": "een nuttige studietip"
    }
  ]
}

Materiaal: ${material.title}${chapterInfo} - ${material.content.substring(0, 2000)}`,
      },
    ],
    { json: true }
  );

  const parsed = JSON.parse(response);
  const exercises = (parsed.exercises || []).map((e: Record<string, string>, i: number) => ({
    id: i + 1,
    materialId: id,
    ...e,
  }));

  res.json(exercises);
});

export default router;
