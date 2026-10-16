import { describe, it, expect, vi, afterEach } from 'vitest'
import { LLMService } from '../../../src/services/llm/service'

afterEach(() => vi.unstubAllEnvs())
describe('Cloudflare-only browser guard', () => {
  it('blocks previously saved direct-provider text configurations before adapter dispatch', async () => {
    vi.stubEnv('VITE_CF_PROXY_ONLY', 'true')
    const modelManager = { getModel: vi.fn().mockResolvedValue({ enabled: true, providerMeta: { id: 'openai' }, modelMeta: { id: 'gpt' } }) }
    const service = new LLMService(modelManager as never)
    await expect(service.sendMessageStructured([{ role: 'user', content: 'hello' }], 'saved-openai')).rejects.toThrow(/Cloudflare-only/)
    await expect(service.testConnection('saved-openai')).rejects.toThrow(/Cloudflare-only/)
  })
})
