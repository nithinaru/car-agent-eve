"use client";

import type { EveMessage } from "eve/react";
import { useEveAgent } from "eve/react";
import { AlertCircleIcon, ArrowRightIcon, ExternalLinkIcon, RotateCcwIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { MessageResponse } from "@/components/ai-elements/message";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { WEB_CHAT_AGENT } from "@/app/eve-agent";

type ShopProduct = {
  title: string;
  price: string;
  image: string | null;
  productUrl: string;
  reason: string;
  variantId: number;
};

type ShopResult = { products: ShopProduct[]; cartUrl: string };

const EXAMPLES = [
  {
    store: "kyliecosmetics.com",
    request: "a lip kit and a blush for a night out, under $40 each",
  },
  {
    store: "gymshark.com",
    request: "women's running leggings and a sports bra under $60 each",
  },
  {
    store: "www.allbirds.com",
    request: "running shoes for my dad under $150, plus socks",
  },
] as const;

const TOOL_STATUS: Record<string, string> = {
  search_store: "Searching store…",
  build_cart: "Building cart…",
};

const SHOP_BLOCK = /```shop\s*\n([\s\S]*?)```/;
const SHOP_BLOCK_START = /```shop[\s\S]*$/;

function parseShop(text: string): { clean: string; result?: ShopResult } {
  const match = text.match(SHOP_BLOCK);
  if (match) {
    const clean = text.replace(SHOP_BLOCK, "").trim();
    try {
      const data = JSON.parse(match[1]) as ShopResult;
      if (Array.isArray(data.products) && typeof data.cartUrl === "string") {
        return { clean, result: data };
      }
    } catch {
      // fall through
    }
    return { clean };
  }
  // Hide a partially streamed block.
  return { clean: text.replace(SHOP_BLOCK_START, "").trim() };
}

function messageText(message: EveMessage): string {
  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .filter(Boolean)
    .join("\n\n");
}

function activeToolStatus(message: EveMessage | undefined): string | undefined {
  if (!message || message.role !== "assistant") return undefined;
  for (let i = message.parts.length - 1; i >= 0; i -= 1) {
    const part = message.parts[i];
    if (part.type === "dynamic-tool") {
      const done = part.state === "output-available" || part.state === "output-error";
      if (!done) return TOOL_STATUS[part.toolName] ?? "Working…";
      return undefined;
    }
  }
  return undefined;
}

export function ShopAgent() {
  const [resetKey, setResetKey] = useState(0);
  return <ShopAgentSession key={resetKey} onReset={() => setResetKey((k) => k + 1)} />;
}

function ShopAgentSession({ onReset }: { readonly onReset: () => void }) {
  const [storeUrl, setStoreUrl] = useState("");
  const [request, setRequest] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const agent = useEveAgent({
    agent: WEB_CHAT_AGENT,
    prewarm: storeUrl.trim().length > 0 || request.trim().length > 0,
  });

  const isBusy = agent.status === "submitted" || agent.status === "streaming";
  const assistantMessages = agent.data.messages.filter((m) => m.role === "assistant");
  const lastMessage = agent.data.messages.at(-1);
  const fullText = assistantMessages.map(messageText).filter(Boolean).join("\n\n");
  const { clean, result } = parseShop(fullText);
  const toolStatus = isBusy ? activeToolStatus(lastMessage) : undefined;
  const turnFailure = isBusy ? undefined : getLatestTurnFailure(agent.events);
  const errorMessage = agent.error?.message ?? turnFailure;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const store = storeUrl.trim();
    const req = request.trim();
    if (!store || !req || isBusy) return;
    setSubmitted(true);
    await agent.send(`Store: ${store}\nRequest: ${req}`);
  };

  return (
    <div className="flex min-h-dvh flex-col bg-white text-black dark:bg-black dark:text-white">
      <header className="border-black/10 border-b dark:border-white/10">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2 font-semibold tracking-tight">
            <svg aria-hidden="true" className="size-4" fill="currentColor" viewBox="0 0 76 65">
              <path d="M37.5274 0L75.0548 65H0L37.5274 0Z" />
            </svg>
            Shop Agent
          </div>
          {submitted ? (
            <button
              className="inline-flex items-center gap-1.5 rounded-md border border-black/15 px-3 py-1.5 text-sm transition-colors hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
              onClick={onReset}
              type="button"
            >
              <RotateCcwIcon className="size-3.5" />
              New search
            </button>
          ) : null}
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10 sm:px-6 sm:py-16">
        <div className="mb-8 text-center sm:mb-10">
          <h1 className="font-semibold text-4xl tracking-tighter sm:text-5xl">Shop Agent</h1>
          <p className="mt-3 text-black/60 text-base sm:text-lg dark:text-white/60">
            An AI personal shopper for any Shopify store
          </p>
        </div>

        <form
          className="mx-auto flex max-w-2xl flex-col gap-4 rounded-xl border border-black/10 bg-white p-4 shadow-sm sm:p-5 dark:border-white/15 dark:bg-neutral-950"
          onSubmit={handleSubmit}
        >
          <label className="flex flex-col gap-1.5">
            <span className="font-medium text-sm">Store URL</span>
            <input
              className="h-10 rounded-md border border-black/15 bg-transparent px-3 text-base outline-none focus:border-black focus:ring-1 focus:ring-black disabled:opacity-60 sm:text-sm dark:border-white/20 dark:focus:border-white dark:focus:ring-white"
              disabled={submitted}
              inputMode="url"
              onChange={(e) => setStoreUrl(e.target.value)}
              placeholder="kyliecosmetics.com"
              value={storeUrl}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="font-medium text-sm">What are you shopping for?</span>
            <textarea
              className="min-h-24 resize-y rounded-md border border-black/15 bg-transparent px-3 py-2 text-base outline-none focus:border-black focus:ring-1 focus:ring-black disabled:opacity-60 sm:text-sm dark:border-white/20 dark:focus:border-white dark:focus:ring-white"
              disabled={submitted}
              onChange={(e) => setRequest(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="a lip kit and a blush for a night out, under $40 each"
              value={request}
            />
          </label>
          {!submitted ? (
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((ex) => (
                <button
                  className="rounded-full border border-black/15 px-3 py-1 text-black/70 text-xs transition-colors hover:border-black hover:text-black dark:border-white/20 dark:text-white/70 dark:hover:border-white dark:hover:text-white"
                  key={ex.store}
                  onClick={() => {
                    setStoreUrl(ex.store);
                    setRequest(ex.request);
                  }}
                  type="button"
                >
                  {ex.store}
                </button>
              ))}
            </div>
          ) : null}
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-black px-4 font-medium text-sm text-white transition-opacity hover:opacity-85 disabled:opacity-40 dark:bg-white dark:text-black"
            disabled={submitted || !storeUrl.trim() || !request.trim()}
            type="submit"
          >
            {submitted ? (isBusy ? "Shopping…" : "Done") : "Find products"}
            {!submitted ? <ArrowRightIcon className="size-4" /> : null}
          </button>
        </form>

        {submitted ? (
          <section className="mx-auto mt-10 max-w-4xl space-y-8">
            {isBusy ? (
              <div aria-live="polite" className="text-black/60 text-sm dark:text-white/60">
                <Shimmer duration={1}>{toolStatus ?? "Thinking…"}</Shimmer>
              </div>
            ) : null}

            {clean ? (
              <div className="mx-auto max-w-2xl text-sm leading-relaxed sm:text-base">
                <MessageResponse>{clean}</MessageResponse>
              </div>
            ) : null}

            {result && result.products.length > 0 ? (
              <ProductResults result={result} />
            ) : null}

            {errorMessage ? (
              <div
                className="mx-auto flex max-w-2xl items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2.5 text-sm"
                role="alert"
              >
                <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-red-600" />
                <div>
                  <p className="font-medium">Request failed</p>
                  <p className="mt-0.5 text-black/60 dark:text-white/60">{errorMessage}</p>
                </div>
              </div>
            ) : null}

            {!isBusy ? (
              <div className="text-center">
                <button
                  className="inline-flex items-center gap-1.5 text-black/60 text-sm underline-offset-4 hover:text-black hover:underline dark:text-white/60 dark:hover:text-white"
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

      <footer className="border-black/10 border-t py-6 text-center text-black/50 text-xs dark:border-white/10 dark:text-white/50">
        Built with eve on Vercel
      </footer>
    </div>
  );
}

function ProductResults({ result }: { readonly result: ShopResult }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {result.products.map((product) => (
          <a
            className="group flex flex-col overflow-hidden rounded-xl border border-black/10 bg-white transition-colors hover:border-black/40 dark:border-white/15 dark:bg-neutral-950 dark:hover:border-white/40"
            href={product.productUrl}
            key={`${product.variantId}-${product.productUrl}`}
            rel="noreferrer"
            target="_blank"
          >
            <div className="aspect-square w-full overflow-hidden bg-neutral-100 dark:bg-neutral-900">
              {product.image ? (
                // biome-ignore lint/performance/noImgElement: remote Shopify images
                <img
                  alt={product.title}
                  className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                  loading="lazy"
                  src={product.image}
                />
              ) : null}
            </div>
            <div className="flex flex-1 flex-col gap-2 p-4">
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-medium text-sm leading-snug">{product.title}</h3>
                <span className="shrink-0 font-semibold text-sm">{product.price}</span>
              </div>
              <p className="text-black/60 text-sm leading-relaxed dark:text-white/60">
                {product.reason}
              </p>
              <span className="mt-auto inline-flex items-center gap-1 pt-1 text-black/50 text-xs group-hover:text-black dark:text-white/50 dark:group-hover:text-white">
                View product <ExternalLinkIcon className="size-3" />
              </span>
            </div>
          </a>
        ))}
      </div>
      {result.cartUrl ? (
        <a
          className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-black font-medium text-base text-white transition-opacity hover:opacity-85 dark:bg-white dark:text-black"
          href={result.cartUrl}
          rel="noreferrer"
          target="_blank"
        >
          Checkout with these items
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
