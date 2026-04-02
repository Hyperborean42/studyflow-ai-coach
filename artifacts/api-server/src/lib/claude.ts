import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export { anthropic };

const DEFAULT_MODEL = "claude-sonnet-4-6";

/**
 * Stream a Claude response as SSE events.
 * Writes `data: {"content": "..."}` chunks and a final `data: {"done": true}`.
 * Returns the full assembled assistant text.
 */
export async function streamClaudeResponse(
  res: {
    write: (chunk: string) => void;
    end: () => void;
    setHeader: (key: string, value: string) => void;
    headersSent?: boolean;
  },
  systemPrompt: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  options?: { model?: string; skipHeaders?: boolean }
): Promise<string> {
  // Only set headers if they haven't been sent yet (e.g. voice endpoint sets them early)
  if (!options?.skipHeaders && !res.headersSent) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
  }

  const stream = anthropic.messages.stream({
    model: options?.model ?? DEFAULT_MODEL,
    max_tokens: 4096,
    system: systemPrompt,
    messages,
  });

  let assistantContent = "";

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      const content = event.delta.text;
      if (content) {
        assistantContent += content;
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }
  }

  res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  res.end();

  return assistantContent;
}

/**
 * Non-streaming call to Claude. Use for JSON responses (quizzes, exercises, agent planning).
 * When `options.json` is true, the prompt instructs Claude to return valid JSON and
 * the response is returned as-is (caller should JSON.parse).
 */
export async function askClaude(
  systemPrompt: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  options?: { model?: string; json?: boolean }
): Promise<string> {
  const system = options?.json
    ? `${systemPrompt}\n\nBELANGRIJK: Antwoord ALLEEN met valid JSON. Geen extra tekst voor of na het JSON-object.`
    : systemPrompt;

  const response = await anthropic.messages.create({
    model: options?.model ?? DEFAULT_MODEL,
    max_tokens: 4096,
    system,
    messages,
  });

  const textBlock = response.content.find((block) => block.type === "text");
  return textBlock?.text ?? "";
}
