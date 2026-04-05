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
import multer from "multer";
import AdmZip from "adm-zip";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

/**
 * Extract text content from uploaded file buffer.
 * Supports: .pptx, .docx, .txt, .md
 */
function extractTextFromFile(buffer: Buffer, filename: string): string {
  const ext = filename.toLowerCase().split(".").pop() || "";

  if (ext === "pptx") {
    return extractPptxText(buffer);
  }
  if (ext === "docx") {
    return extractDocxText(buffer);
  }
  // Plain text / markdown
  return buffer.toString("utf-8");
}

function extractPptxText(buffer: Buffer): string {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();
  const slideTexts: string[] = [];

  // Sort slide entries by slide number
  const slideEntries = entries
    .filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName))
    .sort((a, b) => {
      const numA = parseInt(a.entryName.match(/slide(\d+)/)?.[1] || "0");
      const numB = parseInt(b.entryName.match(/slide(\d+)/)?.[1] || "0");
      return numA - numB;
    });

  for (const entry of slideEntries) {
    const xml = entry.getData().toString("utf-8");
    // Extract text from <a:t> tags (PowerPoint text runs)
    const texts = [...xml.matchAll(/<a:t[^>]*>([^<]+)<\/a:t>/g)].map((m) => m[1]);
    if (texts.length > 0) {
      const slideNum = entry.entryName.match(/slide(\d+)/)?.[1] || "?";
      slideTexts.push(`[Slide ${slideNum}]\n${texts.join(" ")}`);
    }
  }

  return slideTexts.join("\n\n");
}

function extractDocxText(buffer: Buffer): string {
  const zip = new AdmZip(buffer);
  const docEntry = zip.getEntry("word/document.xml");
  if (!docEntry) return "";
  const xml = docEntry.getData().toString("utf-8");
  // Extract text from <w:t> tags
  const texts = [...xml.matchAll(/<w:t[^>]*>([^<]+)<\/w:t>/g)].map((m) => m[1]);
  return texts.join(" ");
}

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

// ─── File Upload ────────────────────────────────────────────────────────────
router.post("/study-materials/upload", upload.single("file"), async (req, res) => {
  const file = (req as any).file;
  if (!file) {
    res.status(400).json({ error: "Geen bestand geüpload" });
    return;
  }

  const title = req.body.title || file.originalname.replace(/\.[^.]+$/, "");
  const subject = req.body.subject || "Onbekend";
  const chapter = req.body.chapter || null;
  const examType = req.body.examType || null;
  const tags = req.body.tags || null;

  let content: string;
  try {
    content = extractTextFromFile(file.buffer, file.originalname);
  } catch (err) {
    res.status(422).json({ error: "Kon tekst niet uit bestand halen. Probeer een .pptx, .docx of .txt bestand." });
    return;
  }

  if (!content.trim()) {
    res.status(422).json({ error: "Geen tekst gevonden in het bestand." });
    return;
  }

  const [material] = await db
    .insert(studyMaterialsTable)
    .values({
      title,
      subject,
      content,
      fileType: file.originalname.split(".").pop() || "bestand",
      chapter,
      examType,
      tags,
      updatedAt: new Date(),
    })
    .returning();

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
