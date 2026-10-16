import { describe, it, expect, vi, afterEach } from 'vitest'
import { getDefaultTextModels } from '../../../src/services/model/defaults'
import { TextAdapterRegistry } from '../../../src/services/llm/adapters/registry'

afterEach(() => vi.unstubAllEnvs())
describe('Cloudflare-only web model setup', () => {
  it('registers a keyless proxy model and disables seeded direct providers', () => {
    vi.stubEnv('VITE_CF_PROXY_ONLY', 'true')
    const registry = new TextAdapterRegistry()
    expect(registry.getAdapter('cloudflare-worker').getProvider().requiresApiKey).toBe(false)
    const defaults = getDefaultTextModels(registry)
    expect(defaults['cloudflare-worker'].enabled).toBe(true)
    expect(defaults.cloudflare.enabled).toBe(false)
    expect(defaults.openai.enabled).toBe(false)
    expect(defaults.custom.enabled).toBe(false)
  })
})
