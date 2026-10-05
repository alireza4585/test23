import Anthropic from "@anthropic-ai/sdk";

/**
 * Vendor-neutral LLM port. The assistant, insight narration and report
 * summaries depend on this interface only, so the model provider (or a
 * self-hosted model on the dedicated backend) can be swapped per deployment.
 */
export interface LlmProvider {
  readonly name: string;
  complete(request: LlmRequest): Promise<LlmResponse>;
}

export interface LlmRequest {
  /** Stable instructions (cached). */
  system: string;
  /** Conversation, oldest first; the last message is the user's question. */
  messages: { role: "user" | "assistant"; content: string }[];
  maxTokens?: number;
}

export interface LlmResponse {
  text: string;
  model: string;
  /** `refused` when the model declined (after server-side fallback). */
  status: "ok" | "refused" | "truncated";
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number };
}

export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic";
  private readonly client: Anthropic;

  constructor(apiKey: string, private readonly model: string) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 60_000 });
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const response = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: request.maxTokens ?? 16000,
      // Opus 5.5 always thinks adaptively; effort keeps chat answers snappy
      // while leaving room for multi-step analysis questions.
      output_config: { effort: "medium" },
      // Re-run safety-classifier declines on Anthropic's recommended
      // fallback model inside the same call.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }],
      messages: request.messages,
    });

    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    return {
      text,
      model: response.model,
      status:
        response.stop_reason === "refusal"
          ? "refused"
          : response.stop_reason === "max_tokens"
            ? "truncated"
            : "ok",
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      },
    };
  }
}
