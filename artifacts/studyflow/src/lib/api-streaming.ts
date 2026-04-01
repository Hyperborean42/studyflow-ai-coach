export async function streamOpenAiResponse(url: string, body: any, onChunk: (content: string) => void) {
  const response = await fetch(import.meta.env.BASE_URL + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  
  if (!response.body) throw new Error("No response body");
  
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    const lines = decoder.decode(value).split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6));
          if (data.done) break;
          if (data.content) {
            onChunk(data.content);
          }
        } catch(e) {
          // ignore parse errors for incomplete chunks
        }
      }
    }
  }
}
