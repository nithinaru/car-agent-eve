"use client";

import type { EveMessage } from "eve/react";
import { useEveAgent } from "eve/react";
import {
  AlertCircleIcon,
  ArrowRightIcon,
  Car,
  ExternalLinkIcon,
  GaugeIcon,
  MapPinIcon,
  RotateCcwIcon,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { MessageResponse } from "@/components/ai-elements/message";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { WEB_CHAT_AGENT } from "@/app/eve-agent";

type CarListing = {
  title: string;
  price: string;
  miles: number | null;
  location: string | null;
  url: string;
  image: string | null;
  reason: string;
};

type CarResult = { cars: CarListing[]; searchUrl: string };

const EXAMPLES = [
  {
    location: "San Francisco",
    request: "a reliable commuter under $15k with less than 100k miles",
  },
  {
    location: "Los Angeles",
    request: "a Toyota Tacoma or 4Runner under $25k",
  },
  {
    location: "Seattle",
    request: "a fun weekend car under $20k, manual if possible",
  },
] as const;

const TOOL_STATUS: Record<string, string> = {
  search_cars: "Searching listings…",
};

const CARS_BLOCK = /```cars\s*\n([\s\S]*?)```/;
const CARS_BLOCK_START = /```cars[\s\S]*$/;

function parseCars(text: string): { clean: string; result?: CarResult } {
  const match = text.match(CARS_BLOCK);
  if (match) {
    const clean = text.replace(CARS_BLOCK, "").trim();
    try {
      const data = JSON.parse(match[1]) as CarResult;
      if (Array.isArray(data.cars) && typeof data.searchUrl === "string") {
        return { clean, result: data };
      }
    } catch {
      // fall through
    }
    return { clean };
  }
  // Hide a partially streamed block.
  return { clean: text.replace(CARS_BLOCK_START, "").trim() };
}

function messageText(message: EveMessage): string {
  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .filter(Boolean)
    .join("\n\n");
}

type ToolCar = Omit<CarListing, "price" | "reason"> & { price: number | null };

// Fallback when the model skips the ```cars block: use the search_cars tool output
// and show the listings the reply mentions (or the top 3).
function carsFromTools(messages: EveMessage[], replyText: string): CarResult | undefined {
  const output: { cars: ToolCar[]; searchUrl?: string } = { cars: [] };
  for (const m of messages) {
    for (const part of m.parts) {
      if (part.type === "dynamic-tool" && part.toolName === "search_cars" && part.state === "output-available") {
        const out = part.output as { cars?: ToolCar[]; searchUrl?: string } | undefined;
        if (out?.cars?.length) {
          output.cars.push(...out.cars);
          output.searchUrl ??= out.searchUrl;
        }
      }
    }
  }
  if (!output.cars.length || !output.searchUrl) return undefined;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const picks: { car: ToolCar; line: string }[] = [];
  for (const line of replyText.split("\n")) {
    if (picks.length === 3) break;
    const l = norm(line);
    const titleHit = output.cars.find((c) => !picks.some((p) => p.car === c) && l.includes(norm(c.title).slice(0, 20)));
    const priceHit = output.cars.find(
      (c) => !picks.some((p) => p.car === c) && c.price && line.replace(/,/g, "").includes(`$${c.price}`) &&
        norm(c.title).split(/\d+/).some((w) => w.length > 3 && l.includes(w)),
    );
    const car = titleHit ?? priceHit;
    if (car) picks.push({ car, line });
  }
  if (!picks.length) for (const car of output.cars.slice(0, 3)) picks.push({ car, line: "" });
  return {
    searchUrl: output.searchUrl,
    cars: picks.map(({ car: c, line }) => {
      const reason = line.split(/\s[–—-]\s/).slice(2).join(" – ").trim();
      return { ...c, price: c.price ? `$${c.price.toLocaleString("en-US")}` : "", reason };
    }),
  };
}

function activeToolStatus(message: EveMessage | undefined): string | undefined {
  if (!message || message.role !== "assistant") return undefined;
  for (let i = message.parts.length - 1; i >= 0; i -= 1) {
    const part = message.parts[i];
    if (part.type === "dynamic-tool") {
      const done = part.state === "output-available" || part.state === "output-error";
      if (!done) return TOOL_STATUS[part.toolName] ?? "Revving up…";
      return undefined;
    }
  }
  return undefined;
}

function formatMiles(miles: number | null): string | null {
  if (typeof miles !== "number" || !Number.isFinite(miles)) return null;
  return `${Math.round(miles).toLocaleString("en-US")} mi`;
}

const inputClass =
  "rounded-md border border-white/15 bg-zinc-900/60 px-3 text-base text-white outline-none placeholder:text-white/30 focus:border-red-500 focus:ring-1 focus:ring-red-500 disabled:opacity-60 sm:text-sm";

export function CarAgent() {
  const [resetKey, setResetKey] = useState(0);
  return <CarAgentSession key={resetKey} onReset={() => setResetKey((k) => k + 1)} />;
}

function CarAgentSession({ onReset }: { readonly onReset: () => void }) {
  const [location, setLocation] = useState("");
  const [request, setRequest] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const agent = useEveAgent({
    agent: WEB_CHAT_AGENT,
    prewarm: location.trim().length > 0 || request.trim().length > 0,
  });

  const isBusy = agent.status === "submitted" || agent.status === "streaming";
  const assistantMessages = agent.data.messages.filter((m) => m.role === "assistant");
  const lastMessage = agent.data.messages.at(-1);
  const fullText = assistantMessages.map(messageText).filter(Boolean).join("\n\n");
  const parsed = parseCars(fullText);
  const clean = parsed.clean;
  const result = parsed.result ?? (isBusy ? undefined : carsFromTools(assistantMessages, clean));
  const toolStatus = isBusy ? activeToolStatus(lastMessage) : undefined;
  const turnFailure = isBusy ? undefined : getLatestTurnFailure(agent.events);
  const errorMessage = agent.error?.message ?? turnFailure;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const loc = location.trim();
    const req = request.trim();
    if (!loc || !req || isBusy) return;
    setSubmitted(true);
    await agent.send(`Location: ${loc}\nRequest: ${req}`);
  };

  return (
    <div className="flex min-h-dvh flex-col bg-zinc-950 text-white">
      <header className="relative border-white/10 border-b">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3 font-semibold tracking-tight">
            <span aria-hidden="true" className="flex h-5 gap-[3px]">
              <span className="w-[3px] skew-x-[-20deg] bg-red-500" />
              <span className="w-[3px] skew-x-[-20deg] bg-red-500" />
            </span>
            <Car className="size-5 text-red-500" />
            Car Agent
          </div>
          {submitted ? (
            <button
              className="inline-flex items-center gap-1.5 rounded-md border border-white/20 px-3 py-1.5 text-sm transition-colors hover:bg-white/10"
              onClick={onReset}
              type="button"
            >
              <RotateCcwIcon className="size-3.5" />
              New search
            </button>
          ) : null}
        </div>
        {/* Road lane divider */}
        <div
          aria-hidden="true"
          className="h-px w-full"
          style={{
            backgroundImage:
              "repeating-linear-gradient(90deg, rgba(250,204,21,0.45) 0 24px, transparent 24px 44px)",
          }}
        />
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6 sm:py-16">
        <div className="mb-8 text-center sm:mb-10">
          <h1 className="inline-flex items-center gap-3 font-semibold text-4xl tracking-tighter sm:text-5xl">
            <Car className="size-9 text-red-500 sm:size-11" />
            Car Agent
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-base text-white/60 sm:text-lg">
            Tell it your budget, location and vibe — it searches real listings.
          </p>
        </div>

        <form
          className="mx-auto flex max-w-2xl flex-col gap-4 rounded-xl border border-white/10 bg-zinc-900/50 p-4 shadow-lg shadow-black/40 sm:p-5"
          onSubmit={handleSubmit}
        >
          <label className="flex flex-col gap-1.5">
            <span className="font-medium text-sm">Location</span>
            <input
              className={`h-10 ${inputClass}`}
              disabled={submitted}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="San Francisco"
              value={location}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="font-medium text-sm">What car are you looking for?</span>
            <textarea
              className={`min-h-24 resize-y py-2 ${inputClass}`}
              disabled={submitted}
              onChange={(e) => setRequest(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="a reliable commuter under $15k with less than 100k miles"
              value={request}
            />
          </label>
          {!submitted ? (
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((ex) => (
                <button
                  className="rounded-full border border-white/15 px-3 py-1 text-left text-white/70 text-xs transition-colors hover:border-red-500 hover:text-white"
                  key={ex.location}
                  onClick={() => {
                    setLocation(ex.location);
                    setRequest(ex.request);
                  }}
                  title={ex.request}
                  type="button"
                >
                  {ex.location} · {ex.request}
                </button>
              ))}
            </div>
          ) : null}
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-red-600 px-4 font-medium text-sm text-white transition-colors hover:bg-red-500 disabled:opacity-40 disabled:hover:bg-red-600"
            disabled={submitted || !location.trim() || !request.trim()}
            type="submit"
          >
            {submitted ? (isBusy ? "Hunting…" : "Done") : "Find cars"}
            {!submitted ? <ArrowRightIcon className="size-4" /> : null}
          </button>
        </form>

        {submitted ? (
          <section className="mx-auto mt-10 max-w-5xl space-y-8">
            {isBusy ? (
              <div aria-live="polite" className="text-center text-sm text-white/60">
                <Shimmer duration={1}>{toolStatus ?? "Revving up…"}</Shimmer>
              </div>
            ) : null}

            {clean ? (
              <div className="mx-auto max-w-2xl text-sm leading-relaxed sm:text-base">
                <MessageResponse>{clean}</MessageResponse>
              </div>
            ) : null}

            {result && result.cars.length > 0 ? <CarResults result={result} /> : null}

            {errorMessage ? (
              <div
                className="mx-auto flex max-w-2xl items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm"
                role="alert"
              >
                <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-red-500" />
                <div>
                  <p className="font-medium">Request failed</p>
                  <p className="mt-0.5 text-white/60">{errorMessage}</p>
                </div>
              </div>
            ) : null}

            {!isBusy ? (
              <div className="text-center">
                <button
                  className="inline-flex items-center gap-1.5 text-sm text-white/60 underline-offset-4 hover:text-white hover:underline"
                  onClick={onReset}
                  type="button"
                >
                  <RotateCcwIcon className="size-3.5" />
                  Start a new search
                </button>
              </div>
            ) : null}
          </section>
        ) : null}
      </main>

      <footer className="border-white/10 border-t py-6 text-center text-white/50 text-xs">
        Built with eve on Vercel · Listings from Craigslist
      </footer>
    </div>
  );
}

function CarResults({ result }: { readonly result: CarResult }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {result.cars.map((car, index) => {
          const miles = formatMiles(car.miles);
          return (
            <a
              className="group flex flex-col overflow-hidden rounded-xl border border-white/10 bg-zinc-900/60 transition-colors hover:border-red-500/60"
              href={car.url}
              key={`${index}-${car.url}`}
              rel="noreferrer"
              target="_blank"
            >
              <div className="aspect-[4/3] w-full overflow-hidden bg-zinc-800">
                {car.image ? (
                  // biome-ignore lint/performance/noImgElement: remote Craigslist images
                  <img
                    alt={car.title}
                    className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                    loading="lazy"
                    src={car.image}
                  />
                ) : (
                  <div className="flex size-full items-center justify-center">
                    <Car className="size-12 text-white/20" />
                  </div>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-2.5 p-4">
                <h3 className="font-medium text-sm leading-snug">{car.title}</h3>
                <span className="font-bold text-2xl text-red-500 tracking-tight">
                  {car.price}
                </span>
                {miles || car.location ? (
                  <div className="flex flex-wrap gap-1.5">
                    {miles ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-white/80 text-xs">
                        <GaugeIcon className="size-3" />
                        {miles}
                      </span>
                    ) : null}
                    {car.location ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-white/80 text-xs">
                        <MapPinIcon className="size-3" />
                        {car.location}
                      </span>
                    ) : null}
                  </div>
                ) : null}
                <p className="text-sm text-white/60 leading-relaxed">{car.reason}</p>
                <span className="mt-auto inline-flex items-center gap-1 pt-1 text-white/50 text-xs group-hover:text-white">
                  View listing <ExternalLinkIcon className="size-3" />
                </span>
              </div>
            </a>
          );
        })}
      </div>
      {result.searchUrl ? (
        <a
          className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-red-600 font-medium text-base text-white transition-colors hover:bg-red-500"
          href={result.searchUrl}
          rel="noreferrer"
          target="_blank"
        >
          See all listings
          <ArrowRightIcon className="size-4" />
        </a>
      ) : null}
    </div>
  );
}

function getLatestTurnFailure(
  events: ReturnType<typeof useEveAgent>["events"],
): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === "turn.failed") {
      return event.data.code === "MODEL_CALL_FAILED"
        ? "The model is temporarily unavailable. Please try again."
        : event.data.message;
    }
    if (
      event.type === "turn.completed" ||
      event.type === "turn.cancelled" ||
      event.type === "message.received"
    ) {
      return undefined;
    }
  }
  return undefined;
}
