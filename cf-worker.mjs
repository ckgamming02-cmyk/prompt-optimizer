// Cloudflare-only backend. Never accept a provider, model URL, or API key from the browser.
const MODEL = '@cf/qwen/qwen3-30b-a3b-fp8';
const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });

function decodeBase64Url(part) {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) throw new Error('Invalid JWT encoding');
  return Uint8Array.from(atob(part.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}

async function verifyAccess(request, env) {
  const domain = env.ACCESS_TEAM_DOMAIN;
  const audience = env.ACCESS_AUD;
  if (!domain || !audience || !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(domain)) return false;
  const jwt = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!jwt || jwt.length > 8192) return false;
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return false;
    const header = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0])));
    const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[1])));
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') return false;
    const now = Math.floor(Date.now() / 1000);
    if (payload.iss !== `https://${domain}` || !Array.isArray(payload.aud) || !payload.aud.includes(audience)
      || typeof payload.exp !== 'number' || payload.exp <= now
      || typeof payload.nbf !== 'number' || payload.nbf > now
      || typeof payload.sub !== 'string' || !payload.sub) return false;
    const certs = await fetch(`https://${domain}/cdn-cgi/access/certs`);
    if (!certs.ok) return false;
    const { keys } = await certs.json();
    const key = Array.isArray(keys) ? keys.find(k => k.kid === header.kid && k.kty === 'RSA') : null;
    if (!key) return false;
    const imported = await crypto.subtle.importKey('jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', imported, decodeBase64Url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  } catch {
    return false;
  }
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path !== '/api/model') {
      if (path === '/api' || path.startsWith('/api/')) return json({ error: 'Not found' }, 404);
      const asset = await env.ASSETS.fetch(request);
      const headers = new Headers(asset.headers);
      headers.set('Content-Security-Policy', "connect-src 'self'");
      return new Response(asset.body, { status: asset.status, statusText: asset.statusText, headers });
    }
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    if (!await verifyAccess(request, env)) return json({ error: 'Unauthorized' }, 401);
    if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) return json({ error: 'Invalid content type' }, 415);
    if (Number(request.headers.get('Content-Length') || 0) > 65536) return json({ error: 'Request too large' }, 413);
    let body;
    try {
      const text = await request.text();
      if (text.length > 65536) return json({ error: 'Request too large' }, 413);
      body = JSON.parse(text);
    } catch {
      return json({ error: 'Invalid JSON' }, 400);
    }
    if (!body || Object.keys(body).some(k => k !== 'messages') || !Array.isArray(body.messages)
      || body.messages.length < 1 || body.messages.length > 32
      || body.messages.some(m => !m || !['system', 'user', 'assistant'].includes(m.role)
        || typeof m.content !== 'string' || !m.content.trim() || m.content.length > 16000
        || Object.keys(m).some(k => !['role', 'content'].includes(k)))) {
      return json({ error: 'Invalid messages' }, 400);
    }
    try {
      const result = await env.AI.run(MODEL, { messages: body.messages });
      if (typeof result?.response !== 'string') return json({ error: 'Invalid AI response' }, 502);
      return json({ content: result.response });
    } catch {
      return json({ error: 'AI service unavailable' }, 502);
    }
  }
};
