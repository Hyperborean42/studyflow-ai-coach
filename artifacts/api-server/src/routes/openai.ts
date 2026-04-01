import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { conversations, messages } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";
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

const SYSTEM_PROMPT = `Je bent StudyFlow Coach, een empathische maar strenge Nederlandse studiecoach. Gebruik altijd de agenda, studiematerialen en voortgang van de gebruiker. Pas uitleg aan op het gevraagde niveau en de stijl. Geef concrete tips en stel meer herhaling voor over zwakke onderwerpen. Antwoord altijd in natuurlijk, vriendelijk en motiverend Nederlands.`;

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

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const stream = await openai.chat.completions.create({
    model: "gpt-5",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      ...allMessages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    ],
    stream: true,
  });

  let assistantContent = "";
  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content || "";
    if (content) {
      assistantContent += content;
      res.write(`data: ${JSON.stringify({ content })}\n\n`);
    }
  }

  await db.insert(messages).values({
    conversationId: id,
    role: "assistant",
    content: assistantContent,
  });

  res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  res.end();
});

router.post("/openai/conversations/:id/voice-messages", async (req, res) => {
  const { id } = SendOpenaiVoiceMessageParams.parse({ id: Number(req.params.id) });
  const body = SendOpenaiVoiceMessageBody.parse(req.body);

  const audioBuffer = Buffer.from(body.audio, "base64");
  const audioFile = new File([audioBuffer], "audio.webm", { type: "audio/webm" });

  const transcription = await openai.audio.transcriptions.create({
    file: audioFile,
    model: "gpt-4o-mini-transcribe",
    response_format: "json",
  });

  const userText = transcription.text;
  await db.insert(messages).values({ conversationId: id, role: "user", content: userText });

  const allMessages = await db.select().from(messages).where(eq(messages.conversationId, id)).orderBy(messages.createdAt);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  res.write(`data: ${JSON.stringify({ type: "transcript", data: userText })}\n\n`);

  const stream = await openai.chat.completions.create({
    model: "gpt-5",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      ...allMessages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    ],
    stream: true,
  });

  let assistantContent = "";
  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content || "";
    if (content) {
      assistantContent += content;
      res.write(`data: ${JSON.stringify({ type: "text", data: content })}\n\n`);
    }
  }

  await db.insert(messages).values({ conversationId: id, role: "assistant", content: assistantContent });
  res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  res.end();
});

router.post("/openai/transcribe", async (req, res) => {
  const body = TranscribeAudioBody.parse(req.body);
  const audioBuffer = Buffer.from(body.audio, "base64");
  const audioFile = new File([audioBuffer], "audio.webm", { type: "audio/webm" });

  const transcription = await openai.audio.transcriptions.create({
    file: audioFile,
    model: "gpt-4o-mini-transcribe",
    response_format: "json",
  });

  res.json({ text: transcription.text });
});

router.post("/openai/tts", async (req, res) => {
  const body = TextToSpeechBody.parse(req.body);

  const response = await openai.chat.completions.create({
    model: "gpt-5",
    messages: [{ role: "user", content: "Zeg het volgende voor in het Nederlands: " + body.text }],
  });

  const text = response.choices[0]?.message?.content || body.text;
  const encoder = new TextEncoder();
  const audioData = encoder.encode(text);
  const base64Audio = Buffer.from(audioData).toString("base64");

  res.json({ audio: base64Audio, text });
});

export default router;
