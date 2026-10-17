import type { TextModel, TextModelConfig, TextProvider, Message, LLMResponse, StreamHandlers, ToolDefinition, ParameterDefinition } from '../types'
import { APIError, RequestConfigError } from '../errors'
import { AbstractTextProviderAdapter } from './abstract-adapter'

/** Web-only same-origin text adapter; no credentials, external URL, or model choice crosses the boundary. */
export class CloudflareWorkerAdapter extends AbstractTextProviderAdapter {
  getProvider(): TextProvider {
    return {
      id: 'cloudflare-worker', name: 'Cloudflare Workers AI (private)',
      description: 'Text only. Runs via same-origin Cloudflare Worker.',
      requiresApiKey: false, defaultBaseURL: '/api/model', supportsDynamicModels: false,
      connectionSchema: { required: [], optional: [], fieldTypes: {} },
    }
  }

  getModels(): TextModel[] {
    const base = this.buildDefaultModel('@cf/qwen/qwen3-30b-a3b-fp8')
    return [{ ...base,
      name: 'Qwen3 30B A3B (Workers AI)',
      capabilities: { ...base.capabilities, supportsTools: false },
    }]
  }

  protected getParameterDefinitions(_modelId: string): readonly ParameterDefinition[] { return [] }
  protected getDefaultParameterValues(_modelId: string): Record<string, unknown> { return {} }

  protected async doSendMessage(messages: Message[], _config: TextModelConfig): Promise<LLMResponse> {
    // Credentials and session cookies are handled by Cloudflare Access on this same-origin request.
    const response = await fetch('/api/model', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    })
    if (!response.ok) throw new APIError(`Cloudflare Worker request failed (${response.status})`)
    let data: unknown
    try { data = await response.json() } catch { throw new APIError('Invalid Cloudflare Worker response') }
    if (!data || typeof data !== 'object' || typeof (data as { content?: unknown }).content !== 'string') {
      throw new APIError('Invalid Cloudflare Worker response')
    }
    return { content: (data as { content: string }).content }
  }

  protected async doSendMessageStream(messages: Message[], config: TextModelConfig, callbacks: StreamHandlers): Promise<void> {
    // Explicit non-streaming fallback: existing UI callbacks still complete, but no fake token stream.
    const result = await this.doSendMessage(messages, config)
    callbacks.onToken(result.content)
    callbacks.onComplete(result)
  }

  public async sendMessageStreamWithTools(
    _messages: Message[], _config: TextModelConfig, _tools: ToolDefinition[], _callbacks: StreamHandlers,
  ): Promise<void> {
    throw new RequestConfigError('Tool calling is not supported by the Cloudflare Worker adapter')
  }
}
