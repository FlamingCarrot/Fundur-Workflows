import Anthropic from "@anthropic-ai/sdk";
import {
  OPENAI_STYLE_URLS,
  ProviderError,
  ProviderKeyError,
  ProviderRefusalError,
  type Completion,
  type ProviderId,
} from "./providers";

/**
 * A conversation with a model that can call tools, streamed as it is written
 * (P4-10). One shape for every provider: the orchestrator does not care which
 * one answers. Runs on the server only.
 */

export interface ToolSpec {
  name: string;
  description: string;
  /** A JSON schema for the tool's input object. */
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  /** Anything the provider needs echoed back with the call (Gemini's thought signature). */
  meta?: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  name: string;
  content: string;
  isError?: boolean;
}

export type ChatMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; results: ToolResult[] };

export interface ChatRequest {
  model: string;
  system: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  maxTokens?: number;
}

export interface ChatResult extends Completion {
  toolCalls: ToolCall[];
  /** The answer stopped at the length limit. */
  cutOff?: boolean;
}

export type ChatFn = (
  provider: ProviderId,
  key: string,
  req: ChatRequest,
  onText?: (delta: string) => void,
  fetchImpl?: typeof fetch
) => Promise<ChatResult>;

const TIMEOUT_MS = 110_000;

async function postStream(fetchImpl: typeof fetch, url: string, headers: Record<string, string>, body: unknown): Promise<Response> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new ProviderError(`Could not reach the provider: ${(err as Error).message}`);
  }
  if (res.status === 401 || res.status === 403) throw new ProviderKeyError("The provider did not accept the saved key");
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    if (res.status === 400 && /API_KEY_INVALID/.test(detail)) throw new ProviderKeyError("The provider did not accept the saved key");
    throw new ProviderError(`The provider answered ${res.status}: ${detail.slice(0, 300)}`);
  }
  return res;
}

/** The JSON payload of each server-sent event, in order. */
async function* sseData(res: Response): AsyncGenerator<unknown> {
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffer += value;
    let cut: number;
    while ((cut = buffer.search(/\r?\n\r?\n/)) >= 0) {
      const block = buffer.slice(0, cut);
      buffer = buffer.slice(cut).replace(/^\r?\n\r?\n/, "");
      const data = block
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (!data || data === "[DONE]") continue;
      try {
        yield JSON.parse(data);
      } catch {
        // Keep-alive comments and partial junk are skipped.
      }
    }
    if (done) break;
  }
}

const parseArgs = (raw: string): Record<string, unknown> => {
  if (!raw.trim()) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
};

function anthropicMessages(messages: ChatMessage[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  const push = (role: "user" | "assistant", blocks: Anthropic.ContentBlockParam[]) => {
    if (!blocks.length) return;
    const last = out[out.length - 1];
    // Turns must alternate, so tool results and the next words share one turn.
    if (last?.role === role && Array.isArray(last.content)) last.content.push(...blocks);
    else out.push({ role, content: blocks });
  };
  for (const m of messages) {
    if (m.role === "user") push("user", m.content ? [{ type: "text", text: m.content }] : []);
    else if (m.role === "assistant") {
      push("assistant", [
        ...(m.content ? [{ type: "text" as const, text: m.content }] : []),
        ...(m.toolCalls ?? []).map((c) => ({ type: "tool_use" as const, id: c.id, name: c.name, input: c.input })),
      ]);
    } else {
      push(
        "user",
        m.results.map((r) => ({ type: "tool_result" as const, tool_use_id: r.id, content: r.content, is_error: r.isError || undefined }))
      );
    }
  }
  return out;
}

function openAiMessages(system: string, messages: ChatMessage[]): unknown[] {
  const out: unknown[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "user") out.push({ role: "user", content: m.content });
    else if (m.role === "assistant") {
      out.push({
        role: "assistant",
        content: m.content || null,
        ...(m.toolCalls?.length
          ? {
              tool_calls: m.toolCalls.map((c) => ({
                id: c.id,
                type: "function",
                function: { name: c.name, arguments: JSON.stringify(c.input) },
              })),
            }
          : {}),
      });
    } else for (const r of m.results) out.push({ role: "tool", tool_call_id: r.id, content: r.content });
  }
  return out;
}

function geminiContents(messages: ChatMessage[]): unknown[] {
  const out: { role: string; parts: unknown[] }[] = [];
  const push = (role: string, parts: unknown[]) => {
    if (!parts.length) return;
    const last = out[out.length - 1];
    if (last?.role === role) last.parts.push(...parts);
    else out.push({ role, parts });
  };
  for (const m of messages) {
    if (m.role === "user") push("user", m.content ? [{ text: m.content }] : []);
    else if (m.role === "assistant") {
      push("model", [
        ...(m.content ? [{ text: m.content }] : []),
        ...(m.toolCalls ?? []).map((c) => ({ functionCall: { name: c.name, args: c.input }, ...(c.meta ?? {}) })),
      ]);
    } else push("user", m.results.map((r) => ({ functionResponse: { name: r.name, response: { content: r.content } } })));
  }
  return out;
}

/** One streamed turn: the words as they come, then any tools the model wants run. */
export const chat: ChatFn = async (provider, key, req, onText, fetchImpl = fetch) => {
  const maxTokens = req.maxTokens ?? 8_000;
  const tools = req.tools ?? [];
  switch (provider) {
    case "anthropic": {
      const client = new Anthropic({ apiKey: key, fetch: fetchImpl, maxRetries: 1, timeout: TIMEOUT_MS });
      let message: Anthropic.Message;
      try {
        const stream = client.messages.stream({
          model: req.model,
          max_tokens: maxTokens,
          system: req.system,
          messages: anthropicMessages(req.messages),
          ...(tools.length
            ? { tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema as Anthropic.Tool.InputSchema })) }
            : {}),
        });
        stream.on("text", (delta) => onText?.(delta));
        message = await stream.finalMessage();
      } catch (err) {
        if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
          throw new ProviderKeyError("Anthropic did not accept the saved key");
        }
        if (err instanceof Anthropic.APIError) throw new ProviderError(`Anthropic answered ${err.status ?? "with an error"}: ${err.message}`);
        throw new ProviderError(`Could not reach Anthropic: ${(err as Error).message}`);
      }
      const usage = { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens };
      if (message.stop_reason === "refusal") throw Object.assign(new ProviderRefusalError("The model declined to answer"), usage);
      return {
        text: message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(""),
        toolCalls: message.content.flatMap((b) =>
          b.type === "tool_use" ? [{ id: b.id, name: b.name, input: (b.input ?? {}) as Record<string, unknown> }] : []
        ),
        cutOff: message.stop_reason === "max_tokens",
        ...usage,
      };
    }
    case "openai":
    case "openrouter":
    case "xai": {
      const res = await postStream(
        fetchImpl,
        OPENAI_STYLE_URLS[provider],
        { Authorization: `Bearer ${key}` },
        {
          model: req.model,
          ...(provider === "xai" ? { max_tokens: maxTokens } : { max_completion_tokens: maxTokens }),
          messages: openAiMessages(req.system, req.messages),
          ...(tools.length
            ? { tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } })) }
            : {}),
          stream: true,
          stream_options: { include_usage: true },
          ...(provider === "openrouter" ? { usage: { include: true } } : {}),
        }
      );
      let text = "";
      let finish: string | undefined;
      let refusal = "";
      const usage = { inputTokens: 0, outputTokens: 0, reportedCostUsd: undefined as number | undefined };
      const calls: { id: string; name: string; args: string }[] = [];
      for await (const raw of sseData(res)) {
        const chunk = raw as {
          error?: { message?: string };
          choices?: {
            delta?: {
              content?: string | null;
              refusal?: string | null;
              tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[];
            };
            finish_reason?: string | null;
          }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
        };
        if (chunk.error) throw new ProviderError(`The provider stopped: ${chunk.error.message ?? "unknown error"}`);
        for (const choice of chunk.choices ?? []) {
          const d = choice.delta;
          if (d?.content) {
            text += d.content;
            onText?.(d.content);
          }
          if (d?.refusal) refusal += d.refusal;
          for (const tc of d?.tool_calls ?? []) {
            const i = tc.index ?? calls.length;
            calls[i] ??= { id: "", name: "", args: "" };
            if (tc.id) calls[i].id = tc.id;
            if (tc.function?.name) calls[i].name += tc.function.name;
            if (tc.function?.arguments) calls[i].args += tc.function.arguments;
          }
          if (choice.finish_reason) finish = choice.finish_reason;
        }
        if (chunk.usage) {
          usage.inputTokens = chunk.usage.prompt_tokens ?? usage.inputTokens;
          usage.outputTokens = chunk.usage.completion_tokens ?? usage.outputTokens;
          if (typeof chunk.usage.cost === "number") usage.reportedCostUsd = chunk.usage.cost;
        }
      }
      if (refusal && !text) throw Object.assign(new ProviderRefusalError("The model declined to answer"), usage);
      return {
        text,
        toolCalls: calls
          .filter((c) => c?.name)
          .map((c, i) => ({ id: c.id || `call_${i}`, name: c.name, input: parseArgs(c.args) })),
        cutOff: finish === "length",
        ...usage,
      };
    }
    case "gemini": {
      const res = await postStream(
        fetchImpl,
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(req.model)}:streamGenerateContent?alt=sse`,
        { "x-goog-api-key": key },
        {
          systemInstruction: { parts: [{ text: req.system }] },
          contents: geminiContents(req.messages),
          ...(tools.length
            ? {
                tools: [
                  {
                    functionDeclarations: tools.map((t) => ({
                      name: t.name,
                      description: t.description,
                      parametersJsonSchema: t.inputSchema,
                    })),
                  },
                ],
              }
            : {}),
          generationConfig: { maxOutputTokens: maxTokens },
        }
      );
      let text = "";
      let finish: string | undefined;
      let blocked = false;
      const usage = { inputTokens: 0, outputTokens: 0 };
      const toolCalls: ToolCall[] = [];
      for await (const raw of sseData(res)) {
        const chunk = raw as {
          candidates?: {
            content?: {
              parts?: {
                text?: string;
                thought?: boolean;
                thoughtSignature?: string;
                functionCall?: { name: string; args?: Record<string, unknown> };
              }[];
            };
            finishReason?: string;
          }[];
          usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
          promptFeedback?: { blockReason?: string };
        };
        if (chunk.promptFeedback?.blockReason) blocked = true;
        const candidate = chunk.candidates?.[0];
        for (const part of candidate?.content?.parts ?? []) {
          if (part.functionCall) {
            toolCalls.push({
              id: `call_${toolCalls.length}_${part.functionCall.name}`,
              name: part.functionCall.name,
              input: part.functionCall.args ?? {},
              ...(part.thoughtSignature ? { meta: { thoughtSignature: part.thoughtSignature } } : {}),
            });
          } else if (part.text && !part.thought) {
            text += part.text;
            onText?.(part.text);
          }
        }
        if (candidate?.finishReason) finish = candidate.finishReason;
        if (chunk.usageMetadata) {
          usage.inputTokens = chunk.usageMetadata.promptTokenCount ?? usage.inputTokens;
          // Thinking tokens are billed as output.
          usage.outputTokens = (chunk.usageMetadata.candidatesTokenCount ?? 0) + (chunk.usageMetadata.thoughtsTokenCount ?? 0);
        }
      }
      if (blocked || (finish === "SAFETY" && !text)) throw Object.assign(new ProviderRefusalError("The model declined to answer"), usage);
      return { text, toolCalls, cutOff: finish === "MAX_TOKENS", ...usage };
    }
  }
};
