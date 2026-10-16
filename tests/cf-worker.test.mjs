import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import worker from '../cf-worker.mjs';

const encoder = new TextEncoder();
const b64 = input => Buffer.from(input).toString('base64url');
const keyPair = await webcrypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...await webcrypto.subtle.exportKey('jwk', keyPair.publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' };
const team = 'example.cloudflareaccess.com';
const audience = 'test-audience';
async function token(overrides = {}) {
  const payload = { iss: `https://${team}`, aud: [audience], exp: Math.floor(Date.now()/1000)+60, nbf: Math.floor(Date.now()/1000)-60, sub: 'user', ...overrides };
  const unsigned = `${b64(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'test-key' }))}.${b64(JSON.stringify(payload))}`;
  const signature = await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5', keyPair.privateKey, encoder.encode(unsigned));
  return `${unsigned}.${b64(Buffer.from(signature))}`;
}
function request(jwt, body = { messages: [{ role: 'user', content: 'hello' }] }) {
  return new Request('https://example.com/api/model', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(jwt ? { 'Cf-Access-Jwt-Assertion': jwt } : {}) }, body: JSON.stringify(body) });
}
const calls = [];
const env = { ACCESS_TEAM_DOMAIN: team, ACCESS_AUD: audience, AI: { run: async (...args) => { calls.push(args); return { response: 'ok' }; } }, ASSETS: { fetch: async () => new Response('asset') } };
const originalFetch = globalThis.fetch;
globalThis.fetch = async url => {
  assert.equal(url, `https://${team}/cdn-cgi/access/certs`);
  return Response.json({ keys: [jwk] });
};
test.after(() => { globalThis.fetch = originalFetch; });
test('rejects missing and bad Access JWT without calling AI', async () => {
  calls.length = 0;
  assert.equal((await worker.fetch(request(), env)).status, 401);
  assert.equal((await worker.fetch(request(await token({ aud: ['wrong'] })), env)).status, 401);
  assert.equal((await worker.fetch(request(`${await token()}tampered`), env)).status, 401);
  for (const overrides of [
    { exp: Math.floor(Date.now()/1000)-1 },
    { nbf: Math.floor(Date.now()/1000)+3600 },
    { iss: 'https://wrong.cloudflareaccess.com' },
  ]) assert.equal((await worker.fetch(request(await token(overrides)), env)).status, 401);
  assert.equal((await worker.fetch(request('x'.repeat(8193)), env)).status, 401);
  const unknownKey = await token();
  const [header, payload, signature] = unknownKey.split('.');
  assert.equal((await worker.fetch(request(`${b64(JSON.stringify({alg:'none',kid:'test-key'}))}.${payload}.${signature}`), env)).status, 401);
  assert.equal((await worker.fetch(request(`${b64(JSON.stringify({alg:'RS256',kid:'unknown'}))}.${payload}.${signature}`), env)).status, 401);
  assert.equal(calls.length, 0);
});
test('rejects invalid input and ignores client model selection', async () => {
  calls.length = 0;
  const jwt = await token();
  assert.equal((await worker.fetch(request(jwt, { messages: [{ role: 'user', content: '' }] }), env)).status, 400);
  assert.equal((await worker.fetch(request(jwt, { messages: [{ role: 'user', content: 'ok' }], model: 'arbitrary' }), env)).status, 400);
  assert.equal(calls.length, 0);
});
test('serves text via fixed server-side AI binding and other paths as assets', async () => {
  calls.length = 0;
  const response = await worker.fetch(request(await token()), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { content: 'ok' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '@cf/qwen/qwen3-30b-a3b-fp8');
  const asset = await worker.fetch(new Request('https://example.com/'), env);
  assert.equal(asset.status, 200);
  assert.equal(asset.headers.get('Content-Security-Policy'), "connect-src 'self'");
  assert.equal((await worker.fetch(new Request('https://example.com/api/nope'), env)).status, 404);
  assert.equal((await worker.fetch(new Request('https://example.com/api'), env)).status, 404);
});
