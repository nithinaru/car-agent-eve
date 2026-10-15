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

const DISPLAY = "font-[family-name:var(--font-display)]";
const SPEC = "font-[family-name:var(--font-spec)]";

const CHIP_STYLES = [
  "-rotate-2 bg-yellow-400 text-black border-black",
  "rotate-1 bg-zinc-100 text-zinc-900 border-red-600 border-dashed",
  "-rotate-1 bg-red-600 text-white border-white/40",
] as const;

function Odometer({ miles }: { readonly miles: number | null }) {
  const label = formatMiles(miles);
  if (!label || miles === null) return null;
  const digits = String(Math.round(miles)).padStart(6, "0").slice(-7);
  return (
    <span aria-label={label} className={`inline-flex items-center gap-1.5 ${SPEC}`}>
      <span aria-hidden="true" className="inline-flex">
        {digits.split("").map((d, i) => (
          <span
            className={`flex h-6 w-[1.15rem] items-center justify-center border border-black/60 text-sm ${
              i === digits.length - 1 ? "bg-white text-black" : "bg-zinc-900 text-white"
            }`}
            key={`${i}-${d}`}
          >
            {d}
          </span>
        ))}
      </span>
      <span aria-hidden="true" className="text-[10px] text-white/50 uppercase">mi</span>
    </span>
  );
}

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
    <div className="flex min-h-dvh flex-col overflow-x-hidden bg-zinc-950 text-white">
      <header className="relative">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className={`flex items-center gap-2 text-xs uppercase tracking-widest ${SPEC}`}>
            <span aria-hidden="true" className="flex h-4 gap-[3px]">
              <span className="w-[4px] skew-x-[-20deg] bg-red-500" />
              <span className="w-[4px] skew-x-[-20deg] bg-yellow-400" />
            </span>
            CAR/AGENT
          </div>
          {submitted ? (
            <button
              className={`inline-flex -skew-x-6 items-center gap-1.5 border border-yellow-400/60 px-3 py-1.5 text-xs text-yellow-400 uppercase transition-colors hover:bg-yellow-400 hover:text-black ${SPEC}`}
              onClick={onReset}
              type="button"
            >
              <RotateCcwIcon className="size-3.5" />
              New search
            </button>
          ) : null}
        </div>
        <div
          aria-hidden="true"
          className="h-[3px] w-full"
          style={{
            backgroundImage:
              "repeating-linear-gradient(90deg, rgba(250,204,21,0.7) 0 32px, transparent 32px 56px)",
          }}
        />
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6 sm:py-14">
        <div className="relative mb-10 sm:mb-14">
          <p className={`mb-3 text-[11px] text-yellow-400 uppercase tracking-[0.2em] sm:text-xs ${SPEC}`}>
            // AI used-car hunter · powered by eve
          </p>
          <div className="relative inline-block">
            <span
              aria-hidden="true"
              className="-skew-x-12 -z-0 absolute top-[38%] -left-3 h-[34%] w-[110%] bg-red-600"
            />
            <h1
              className={`relative text-[22vw] uppercase leading-[0.8] tracking-tight sm:text-[10rem] lg:text-[12rem] ${DISPLAY}`}
            >
              <span className="block text-white">Car</span>
              <span className="text-stroke block pl-[0.4em]">Agent</span>
            </h1>
          </div>
          <p className="mt-6 max-w-md border-red-500 border-l-4 pl-3 text-base text-white/70 sm:text-lg">
            Tell it your budget, location and vibe. It digs through real listings and brings back the
            keepers.
          </p>
        </div>

        <form className="relative max-w-3xl" onSubmit={handleSubmit}>
          <div className="grid gap-6 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] sm:items-start">
            <label className="flex -rotate-1 flex-col sm:mt-6">
              <span className={`mb-1.5 text-[10px] text-white/50 uppercase tracking-widest ${SPEC}`}>
                Location / plate
              </span>
              <span className="relative rounded-md border-[3px] border-zinc-900 bg-yellow-400 p-1 shadow-[4px_4px_0_0_#dc2626]">
                <span className="flex items-center justify-between px-2 text-[9px] text-black/70 uppercase tracking-[0.3em]">
                  <span className={SPEC}>· where ·</span>
                  <MapPinIcon className="size-3" />
                </span>
                <input
                  className={`h-11 w-full rounded-sm border-2 border-black/80 bg-yellow-300 px-2 text-center text-black text-lg uppercase tracking-[0.15em] outline-none placeholder:text-black/35 focus:bg-white disabled:opacity-70 ${SPEC}`}
                  disabled={submitted}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="SAN FRANCISCO"
                  value={location}
                />
              </span>
            </label>
            <label className="flex flex-col sm:rotate-[0.6deg]">
              <span className={`mb-1.5 flex items-center gap-2 text-[10px] text-white/50 uppercase tracking-widest ${SPEC}`}>
                <GaugeIcon className="size-3 text-red-500" />
                What are you hunting?
              </span>
              <span className="relative block rounded-t-[2rem] rounded-b-md border border-white/15 bg-gradient-to-b from-zinc-800 to-zinc-900 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                <span aria-hidden="true" className="absolute top-2 right-4 flex gap-1">
                  <span className="size-1.5 rounded-full bg-red-500" />
                  <span className="size-1.5 rounded-full bg-yellow-400" />
                  <span className="size-1.5 rounded-full bg-emerald-400" />
                </span>
                <textarea
                  className="min-h-28 w-full resize-y bg-transparent px-1 pt-3 text-base text-white outline-none placeholder:text-white/30 disabled:opacity-60 sm:text-sm"
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
              </span>
            </label>
          </div>

          {!submitted ? (
            <div className="mt-7 flex flex-wrap gap-3 sm:pl-8">
              {EXAMPLES.map((ex, i) => (
                <button
                  className={`max-w-full border-2 px-3 py-1.5 text-left text-[11px] uppercase leading-snug shadow-[2px_2px_0_0_rgba(0,0,0,0.6)] transition-transform hover:rotate-0 hover:scale-105 ${CHIP_STYLES[i % CHIP_STYLES.length]} ${SPEC}`}
                  key={ex.location}
                  onClick={() => {
                    setLocation(ex.location);
                    setRequest(ex.request);
                  }}
                  title={ex.request}
                  type="button"
                >
                  <span className="block font-bold">#{String(i + 1).padStart(2, "0")} · {ex.location}</span>
                  <span className="block normal-case opacity-80">{ex.request}</span>
                </button>
              ))}
            </div>
          ) : null}

          <div className="mt-8 flex justify-end sm:pr-6">
            <button
              className={`inline-flex h-14 -skew-x-12 items-center justify-center gap-3 bg-red-600 px-8 font-bold text-base text-white uppercase tracking-wider shadow-[6px_6px_0_0_#facc15] transition-all hover:-translate-y-0.5 hover:bg-red-500 disabled:opacity-40 disabled:shadow-none disabled:hover:translate-y-0 disabled:hover:bg-red-600 ${SPEC}`}
              disabled={submitted || !location.trim() || !request.trim()}
              type="submit"
            >
              <span className="skew-x-12">
                {submitted ? (isBusy ? "Hunting…" : "Done") : "Find cars →"}
              </span>
            </button>
          </div>
        </form>

        {submitted ? (
          <section className="mt-12 space-y-10">
            {isBusy ? (
              <div
                aria-live="polite"
                className={`flex items-center gap-2 text-xs text-yellow-400 uppercase tracking-[0.2em] ${SPEC}`}
              >
                <span className="animate-blink size-2 rounded-full bg-red-500" />
                {(toolStatus ?? "Revving up…").toUpperCase()}
              </div>
            ) : null}

            {clean ? (
              <div className="max-w-2xl border-white/10 border-l pl-4 text-sm leading-relaxed sm:ml-10 sm:text-base">
                <MessageResponse>{clean}</MessageResponse>
              </div>
            ) : null}

            {result && result.cars.length > 0 ? <CarResults result={result} /> : null}

            {errorMessage ? (
              <div
                className="flex max-w-2xl items-start gap-3 border-2 border-red-500 bg-red-500/10 px-3 py-2.5 text-sm"
                role="alert"
              >
                <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-red-500" />
                <div>
                  <p className={`font-bold text-xs uppercase ${SPEC}`}>Request failed</p>
                  <p className="mt-0.5 text-white/60">{errorMessage}</p>
                </div>
              </div>
            ) : null}

            {!isBusy ? (
              <div>
                <button
                  className={`inline-flex items-center gap-1.5 text-white/60 text-xs uppercase tracking-widest underline-offset-4 hover:text-yellow-400 hover:underline ${SPEC}`}
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

      <footer className={`border-white/10 border-t px-4 py-6 text-[10px] text-white/45 uppercase tracking-[0.2em] sm:px-6 ${SPEC}`}>
        <div className="mx-auto max-w-6xl">Built with eve on Vercel · Listings from Craigslist</div>
      </footer>
    </div>
  );
}

function PriceTag({ price, big }: { readonly price: string; readonly big?: boolean }) {
  if (!price) return null;
  return (
    <span
      className={`inline-block -rotate-2 bg-yellow-400 px-2.5 py-0.5 font-bold text-black shadow-[3px_3px_0_0_#000] ${
        big ? "text-3xl sm:text-4xl" : "text-xl"
      } ${SPEC}`}
    >
      {price}
    </span>
  );
}

function CarImage({ car, className }: { readonly car: CarListing; readonly className: string }) {
  return (
    <div className={`overflow-hidden bg-zinc-800 ${className}`}>
      {car.image ? (
        // biome-ignore lint/performance/noImgElement: remote Craigslist images
        <img
          alt={car.title}
          className="size-full object-cover grayscale-[30%] transition-all duration-300 group-hover:scale-[1.04] group-hover:grayscale-0"
          loading="lazy"
          src={car.image}
        />
      ) : (
        <div className="flex size-full items-center justify-center">
          <Car className="size-12 text-white/20" />
        </div>
      )}
    </div>
  );
}

function CarResults({ result }: { readonly result: CarResult }) {
  const [top, ...rest] = result.cars;
  const offsets = ["sm:mt-0 sm:rotate-[0.8deg]", "sm:mt-12 sm:-rotate-1", "sm:mt-4 sm:rotate-[0.5deg]"];
  return (
    <div className="space-y-12">
      {top ? (
        <a
          className="group relative grid overflow-hidden border-2 border-white/15 bg-zinc-900 transition-colors hover:border-red-500 md:grid-cols-[1.2fr_1fr]"
          href={top.url}
          rel="noreferrer"
          target="_blank"
        >
          <span
            className={`absolute top-3 left-0 z-10 bg-red-600 px-3 py-1 text-xs text-white uppercase tracking-[0.25em] ${SPEC}`}
          >
            ★ Top pick
          </span>
          <CarImage car={top} className="aspect-[4/3] md:aspect-auto md:min-h-80" />
          <div className="flex flex-col gap-4 p-5 sm:p-7">
            <h3 className={`text-3xl uppercase leading-[0.95] sm:text-4xl ${DISPLAY}`}>{top.title}</h3>
            <div>
              <PriceTag big price={top.price} />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Odometer miles={top.miles} />
              {top.location ? (
                <span className={`inline-flex items-center gap-1 text-[11px] text-white/60 uppercase ${SPEC}`}>
                  <MapPinIcon className="size-3 text-red-500" />
                  {top.location}
                </span>
              ) : null}
            </div>
            {top.reason ? <p className="text-sm text-white/70 leading-relaxed sm:text-base">{top.reason}</p> : null}
            <span
              className={`mt-auto inline-flex items-center gap-1 pt-2 text-xs text-yellow-400 uppercase tracking-widest group-hover:underline ${SPEC}`}
            >
              View listing <ExternalLinkIcon className="size-3" />
            </span>
          </div>
        </a>
      ) : null}

      {rest.length > 0 ? (
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {rest.map((car, index) => (
            <a
              className={`group flex flex-col overflow-hidden border border-white/10 bg-zinc-900/70 transition-all hover:rotate-0 hover:border-yellow-400 ${offsets[index % offsets.length]}`}
              href={car.url}
              key={`${index}-${car.url}`}
              rel="noreferrer"
              target="_blank"
            >
              <div className="relative">
                <CarImage car={car} className="aspect-[16/10] w-full" />
                <span className={`absolute right-2 bottom-2 bg-black/80 px-1.5 text-[10px] text-white/70 ${SPEC}`}>
                  #{String(index + 2).padStart(2, "0")}
                </span>
              </div>
              <div className="flex flex-1 flex-col gap-3 p-4">
                <h3 className={`text-xl uppercase leading-none ${DISPLAY}`}>{car.title}</h3>
                <div>
                  <PriceTag price={car.price} />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Odometer miles={car.miles} />
                  {car.location ? (
                    <span className={`inline-flex items-center gap-1 text-[10px] text-white/55 uppercase ${SPEC}`}>
                      <MapPinIcon className="size-3" />
                      {car.location}
                    </span>
                  ) : null}
                </div>
                {car.reason ? <p className="text-sm text-white/60 leading-relaxed">{car.reason}</p> : null}
                <span
                  className={`mt-auto inline-flex items-center gap-1 pt-1 text-[11px] text-white/50 uppercase tracking-widest group-hover:text-yellow-400 ${SPEC}`}
                >
                  View listing <ExternalLinkIcon className="size-3" />
                </span>
              </div>
            </a>
          ))}
        </div>
      ) : null}

      {result.searchUrl ? (
        <a
          className="hazard group block border-2 border-black p-1.5 transition-transform hover:-translate-y-0.5"
          href={result.searchUrl}
          rel="noreferrer"
          target="_blank"
        >
          <span
            className={`flex h-12 items-center justify-center gap-2 bg-zinc-950 text-sm text-yellow-400 uppercase tracking-[0.25em] group-hover:bg-black ${SPEC}`}
          >
            See all listings
            <ArrowRightIcon className="size-4" />
          </span>
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
