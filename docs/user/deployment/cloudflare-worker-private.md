# Private Cloudflare Workers AI variant (draft)

This fork's `wrangler.jsonc` builds **one Worker + static assets**, not a Pages Functions project. Do not use the older Cloudflare Pages guide as a deployment recipe for this variant.

## Scope

- Text only: browser sends `POST /api/model` to the same origin. Worker selects the fixed Workers AI model `@cf/qwen/qwen3-30b-a3b-fp8` via `env.AI` binding. No provider token or account ID is sent to the browser. Streaming is emulated by one final text callback; tools, image understanding and image generation are **not implemented** for this private proxy. They must not be treated as supported.
- The `VITE_CF_PROXY_ONLY=true` build enables the keyless proxy default and blocks saved direct text providers in `LLMService`. Worker static-asset responses attach `Content-Security-Policy: connect-src 'self'` to block browser connections to third-party model endpoints; the `/api/model` JSON response does not need that browser policy. This is defense-in-depth, not a substitute for server authorization; it also blocks external integrations that require browser fetches. Browser storage may still contain keys that a user previously entered: clear those locally if appropriate.
- Do not put any token in `VITE_*`, `public/config.js`, repository files, browser settings, or messages. Workers AI binding needs **no API key**. If a future provider needs one, use a Worker Secret only.

## Before public use

1. In Cloudflare Zero Trust, create an Access **self-hosted application for this Worker** and a policy restricted to your identity. Enforce MFA at your identity provider / Access policy. Protect **All traffic**, including any `workers.dev`, preview/version URLs and custom domains; disable alternative public hostnames that cannot be protected. Do not assume Access applies to every URL without testing each one.
2. Set Worker *non-secret* environment variables `ACCESS_TEAM_DOMAIN` (e.g. `example.cloudflareaccess.com`, without scheme) and `ACCESS_AUD` (the Access application audience tag). The Worker fails closed without these. Access itself must also inject the `Cf-Access-Jwt-Assertion` header; the Worker validates the signature, issuer, audience and expiry using the team's public certificates. Never accept a browser-supplied audience or domain.
3. Apply Cloudflare WAF / rate limiting to `/api/model` and set Workers AI budget alerts/limits. An authenticated user can otherwise exhaust usage; `Access` is authentication, **not** spending control.
4. After staging deploy, test **every** hostname unauthenticated (must be denied by Access, including static assets), authenticated normal text request, missing/forged/expired JWT (401; zero AI calls), unknown `/api/*` (404 rather than SPA HTML), and SPA route fallback. Check browser Network requests are same-origin only. Confirm the Worker is using the AI binding, not an API token. Do not promote until these pass.

Local verification performed on this draft: Node test for JWT + AI invocation, core unit tests and typechecks, web build, and `wrangler deploy --dry-run`. These do not verify live Access configuration, real Workers AI responses, MFA, spending limits, or production routing. The worker and asset deployment must be reviewed and configured in your Cloudflare account before any claim of production safety. The app-level smoke test does not model Worker asset responses; verify the response CSP header on the live static asset after deploying a staging environment.

Rollback: redeploy the previous Worker revision and remove the private proxy only after confirming no previous build accidentally exposed `VITE_*` credentials. Rotate any previously exposed key.
