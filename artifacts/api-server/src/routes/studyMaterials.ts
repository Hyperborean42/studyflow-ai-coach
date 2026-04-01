import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { studyMaterialsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";
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

const SYSTEM_PROMPT = `Je bent StudyFlow Coach, een empathische maar strenge Nederlandse studiecoach. Gebruik altijd de agenda, studiematerialen en voortgang van de gebruiker. Pas uitleg aan op het gevraagde niveau en de stijl. Geef concrete tips en stel meer herhaling voor over zwakke onderwerpen. Antwoord altijd in natuurlijk, vriendelijk en motiverend Nederlands.`;

router.get("/study-materials", async (_req, res) => {
  const materials = await db.select().from(studyMaterialsTable).orderBy(studyMaterialsTable.createdAt);
  res.json(materials);
});

router.post("/study-materials", async (req, res) => {
  const body = CreateStudyMaterialBody.parse(req.body);
  const [material] = await db.insert(studyMaterialsTable).values({
    title: body.title,
    subject: body.subject,
    content: body.content,
    fileType: body.fileType,
    updatedAt: new Date(),
  }).returning();
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

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const stream = await openai.chat.completions.create({
    model: "gpt-5",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Maak een heldere, gestructureerde samenvatting van het volgende studiemateriaal over ${material.subject}. Gebruik **vetgedrukte** tekst voor sleutelbegrippen, opsommingstekens voor hoofdpunten, en markeer de belangrijkste concepten duidelijk. Maak de samenvatting overzichtelijk en studievriendelijk.

Materiaal titel: ${material.title}
Inhoud:
${material.content}`,
      },
    ],
    stream: true,
  });

  let summary = "";
  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content || "";
    if (content) {
      summary += content;
      res.write(`data: ${JSON.stringify({ content })}\n\n`);
    }
  }

  await db.update(studyMaterialsTable).set({ summary, updatedAt: new Date() }).where(eq(studyMaterialsTable.id, id));

  res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  res.end();
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
  const response = await openai.chat.completions.create({
    model: "gpt-5",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Genereer ${numQ} meerkeuze quizvragen (${body.difficulty} niveau) over het volgende studiemateriaal. Geef het antwoord als JSON in het volgende formaat:
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

Materiaal: ${material.title} - ${material.content.substring(0, 3000)}`,
      },
    ],
    response_format: { type: "json_object" },
  });

  const parsed = JSON.parse(response.choices[0]?.message?.content || "{}");
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

  const response = await openai.chat.completions.create({
    model: "gpt-5",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Genereer 4 praktische oefeningen voor het studiemateriaal. Varieer de moeilijkheidsgraad. Geef het antwoord als JSON:
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

Materiaal: ${material.title} - ${material.content.substring(0, 2000)}`,
      },
    ],
    response_format: { type: "json_object" },
  });

  const parsed = JSON.parse(response.choices[0]?.message?.content || "{}");
  const exercises = (parsed.exercises || []).map((e: Record<string, string>, i: number) => ({
    id: i + 1,
    materialId: id,
    ...e,
  }));

  res.json(exercises);
});

export default router;
