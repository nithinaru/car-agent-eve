import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { defineAgent } from "eve";

// Free path: with GROQ_API_KEY set, call Groq's free tier directly instead of AI Gateway.
const groq = process.env.GROQ_API_KEY
  ? createOpenAICompatible({
      name: "groq",
      baseURL: "https://api.groq.com/openai/v1",
      apiKey: process.env.GROQ_API_KEY,
      includeUsage: true,
    })
  : null;

export default defineAgent(
  groq
    ? { model: groq("openai/gpt-oss-120b"), modelContextWindowTokens: 131_072 }
    : { model: "anthropic/claude-sonnet-5.5" },
);
