import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { defineAgent } from "eve";

// Free path: with GROQ_API_KEY set, call Groq's free tier directly instead of AI Gateway.
const groq = process.env.GROQ_API_KEY
  ? createOpenAICompatible({
      name: "groq",
      baseURL: "https://api.groq.com/openai/v1",
      apiKey: process.env.GROQ_API_KEY,
      includeUsage: true,
      // Groq rejects `reasoning_content` on prior assistant messages; strip it.
      fetch: async (url, init) => {
        if (typeof init?.body === "string") {
          const body = JSON.parse(init.body);
          for (const m of body.messages ?? []) delete m.reasoning_content;
          init = { ...init, body: JSON.stringify(body) };
        }
        return fetch(url, init);
      },
    })
  : null;

export default defineAgent(
  groq
    ? { model: groq("openai/gpt-oss-120b"), modelContextWindowTokens: 131_072 }
    : { model: "anthropic/claude-sonnet-5.5" },
);
