import { describe, it, expect, vi, afterEach } from 'vitest'
import { CloudflareWorkerAdapter } from '../../../src/services/llm/adapters/cloudflare-worker-adapter'

const adapter = new CloudflareWorkerAdapter()
const config = {} as Parameters<typeof adapter.sendMessage>[1]
afterEach(() => vi.unstubAllGlobals())

describe('Cloudflare Worker same-origin adapter', () => {
  it('requires no browser key and calls only the same-origin endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ content: 'done' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    expect(adapter.getProvider().requiresApiKey).toBe(false)
    expect(await adapter.sendMessage([{ role: 'user', content: 'hello' }], config)).toEqual({ content: 'done' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/model')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ messages: [{ role: 'user', content: 'hello' }] })
  })
  it('fails closed for tools and malformed API responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ unexpected: true }), { status: 200 })))
    await expect(adapter.sendMessage([{ role: 'user', content: 'hi' }], config)).rejects.toThrow()
    await expect(adapter.sendMessageStreamWithTools([{ role: 'user', content: 'hi' }], config, [{ type: 'function', function: { name: 'test' } }], { onToken: () => {}, onComplete: () => {}, onError: () => {} })).rejects.toThrow(/not supported/)
  })
})
