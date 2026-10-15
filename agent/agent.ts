import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { defineAgent } from "eve";

// Groq's free tier caps each model at 8k tokens/minute, so rotate across models on 429.
const GROQ_MODELS = ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"];

async function groqFetch(url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (typeof init?.body !== "string") return fetch(url, init);
  const body = JSON.parse(init.body);
  // Groq rejects `reasoning_content` on prior assistant messages; strip it.
  for (const m of body.messages ?? []) delete m.reasoning_content;
  for (let attempt = 0; attempt < 3; attempt++) {
    let waitMs = 0;
    for (const model of GROQ_MODELS) {
      const req = { ...body, model };
      if (model.startsWith("openai/")) req.reasoning_effort = "low";
      else delete req.reasoning_effort;
      const res = await fetch(url, { ...init, body: JSON.stringify(req) });
      if (res.status !== 429) return res;
      const retryAfter = Number(res.headers.get("retry-after") ?? "5");
      waitMs = Math.max(waitMs, Math.min(retryAfter, 30) * 1000);
    }
    await new Promise((r) => setTimeout(r, waitMs));
  }
  return fetch(url, init);
}

const groq = process.env.GROQ_API_KEY
  ? createOpenAICompatible({
      name: "groq",
      baseURL: "https://api.groq.com/openai/v1",
      apiKey: process.env.GROQ_API_KEY,
      includeUsage: true,
      fetch: groqFetch,
    })
  : null;

export default defineAgent(
  groq
    ? { model: groq(GROQ_MODELS[0]), modelContextWindowTokens: 131_072 }
    : { model: "anthropic/claude-sonnet-5.5" },
);
