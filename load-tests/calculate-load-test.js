/**
 * Load test: POST /api/deals/calculate — 300 RPS
 *
 * Prerequisites:
 *   1. Install k6: https://k6.io/docs/get-started/installation/
 *   2. Stack must be running (docker compose up -d)
 *   3. A Keycloak user must exist in realm "sber-realm":
 *        Keycloak Admin → http://localhost:8080 (admin/admin)
 *        → sber-realm → Users → Add user
 *        → Set email, firstName, lastName, phone
 *        → Credentials tab → Set password (turn off "Temporary")
 *
 * Run (minimum):
 *   k6 run -e KC_USER=<email> -e KC_PASS=<password> load-tests/calculate-load-test.js
 *
 * Run with custom parameters:
 *   k6 run -e KC_USER=test@test.com -e KC_PASS=secret \
 *           -e TARGET_RPS=300 -e DURATION=120s \
 *           -e SESSION_POOL_SIZE=30 \
 *           load-tests/calculate-load-test.js
 */

import http from 'k6/http';
import { check, fail } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const BASE_URL          = __ENV.BASE_URL          || 'http://localhost:8085';
const KEYCLOAK_URL      = __ENV.KEYCLOAK_URL      || 'http://localhost:8080';
const KC_USER           = __ENV.KC_USER;
const KC_PASS           = __ENV.KC_PASS;
const TARGET_RPS        = parseInt(__ENV.TARGET_RPS        || '300', 10);
const DURATION          = __ENV.DURATION          || '60s';
// How many sessions to pre-create in setup().
// Larger = better VU coverage, slower setup start (~1 s per session).
// Rule of thumb: set to expected active VU count (TARGET_RPS × avg_latency_s).
const SESSION_POOL_SIZE = parseInt(__ENV.SESSION_POOL_SIZE || '20',  10);
// Latency threshold used by err_latency metric
const LATENCY_MS        = parseInt(__ENV.LATENCY_MS        || '5000', 10);

// Seed data from V2__insert_mock_data.sql
const DEAL_IDS  = ['CRD-2025-00123', 'CRD-2025-00124', 'CRD-2025-00125', 'CRD-2025-00126'];
const CURRENCIES = ['RUB', 'USD', 'EUR'];

// ---------------------------------------------------------------------------
// Metrics
//
// Three separate error rates instead of one combined:
//   err_status  — HTTP status != 200 (server/gateway errors)
//   err_body    — empty or missing response body
//   err_latency — response time exceeded LATENCY_MS
//
// session_redirects — counts 302 "session expired" events separately.
//   NOT included in any error Rate so it does not inflate the error %.
//   It is purely informational: high values mean sessions expire under load.
// ---------------------------------------------------------------------------
const errStatus       = new Rate('err_status');
const errBody         = new Rate('err_body');
const errLatency      = new Rate('err_latency');
const sessionRedirects = new Counter('session_redirects');
const calcLatency     = new Trend('calc_latency_ms', true);

// ---------------------------------------------------------------------------
// Scenario
// ---------------------------------------------------------------------------
export const options = {
  scenarios: {
    constant_rps: {
      executor:        'constant-arrival-rate',
      rate:            TARGET_RPS,
      timeUnit:        '1s',
      duration:        DURATION,
      preAllocatedVUs: 150,
      maxVUs:          600,
    },
  },
  thresholds: {
    'http_req_duration{name:calculate}': [`p(95)<2000`, `p(99)<5000`],
    'err_status':                        ['rate<0.01'],
    'err_body':                          ['rate<0.01'],
    'err_latency':                       [`rate<0.05`],
    'http_req_failed':                   ['rate<0.05'],
    // If many 302s fire, sessions are expiring under load — treat as test anomaly.
    'session_redirects':                 [`count<${SESSION_POOL_SIZE * 5}`],
  },
};

// ---------------------------------------------------------------------------
// OAuth2 helpers
// ---------------------------------------------------------------------------
function get0(jar, url, tag) {
  return http.get(url, { jar, redirects: 0, tags: { name: tag } });
}

function resolveUrl(base, loc) {
  if (!loc) return base;
  if (loc.startsWith('http')) return loc;
  // strip trailing slash from base, ensure leading slash on path
  const b = base.replace(/\/$/, '');
  const l = loc.startsWith('/') ? loc : '/' + loc;
  return b + l;
}

/**
 * Performs a full OAuth2 Authorization Code flow and returns a
 * "Cookie: JSESSIONID=..." string for BASE_URL.
 *
 * All redirects are followed manually (redirects:0) because k6's
 * auto-redirect strips cookies that belong to the originating domain when
 * hopping across hosts (e.g. the STATE cookie on localhost:8085 disappears
 * when following a Keycloak redirect back to the gateway, causing Spring
 * Security to reject the callback with 500).
 *
 * We start from /oauth2/authorization/keycloak — NOT /api/deals/calculate —
 * because the latter is POST-only; Spring Security would save the GET and try
 * to replay it after login, resulting in a 500 Method Not Allowed.
 */
function oauthLogin() {
  // new http.CookieJar() — creates an isolated empty jar for this login attempt.
  // http.cookieJar() (without 'new') returns the VU's shared default jar, which
  // accumulates Keycloak session cookies across calls. On the 2nd+ call Keycloak
  // sees the existing session, skips the login page, and redirects straight to the
  // Spring Security callback — the Step 2 loop then follows it into the gateway
  // and lands on localhost:8085/ which returns 404.
  const jar = new http.CookieJar();

  // Step 1: Spring Security OAuth2 authorization endpoint
  //   → 302 http://localhost:8080/realms/sber-realm/.../auth?...&state=...
  //   STATE cookie is written to localhost:8085 here.
  let res = get0(jar, `${BASE_URL}/oauth2/authorization/keycloak`, 'login_1');
  if (res.status !== 302) {
    fail(`[login] Step 1: expected 302, got ${res.status}. Is api-gateway running on ${BASE_URL}?`);
  }

  // Step 2: Follow Keycloak redirects to the login page
  // The Location from Step 1 is generated by Spring Security and points to Keycloak.
  // Log it so any URL misconfiguration (wrong realm, wrong host) is immediately visible.
  let loc = res.headers['Location'];
  console.log(`[login] Keycloak auth URL: ${loc}`);
  let hops = 5;
  do {
    res = get0(jar, loc, 'login_2');
    if (res.status === 302) {
      const next = res.headers['Location'];
      const resolved = resolveUrl(loc, next);
      console.log(`[login] Keycloak redirect → ${resolved}`);
      // If Keycloak redirected to the gateway callback it means SSO kicked in
      // (user already has a Keycloak session in this jar — shouldn't happen with
      // a fresh jar, but guard anyway). Stop here; Step 4 will process the callback.
      if (resolved.startsWith(BASE_URL + '/login/oauth2/code/')) {
        loc = resolved;
        break;
      }
      loc = resolved;
    }
  } while (res.status === 302 && --hops > 0);

  // If we ended up at the callback URL (SSO skip), jump straight to Step 4
  if (loc.startsWith(BASE_URL + '/login/oauth2/code/')) {
    // res is the last 302; pretend Step 3 already happened
    res = { status: 302, headers: { Location: loc } };
  } else if (res.status !== 200) {
    fail(`[login] Step 2: expected login page (200), got ${res.status} at: ${loc}`);
  }

  // Step 3: POST credentials (skipped in SSO case — res is already the callback redirect)
  if (!loc.startsWith(BASE_URL + '/login/oauth2/code/')) {
    // Custom sberinfo theme: <form class="auth-form"> (no id on the element)
    // Decode &amp; — Freemarker HTML-escapes & in the action URL
    const formAction = (res.html().find('form.auth-form').attr('action') || '').replace(/&amp;/g, '&');
    if (!formAction) fail('[login] Step 2: login form not found. Check the sberinfo theme is applied to sber-realm.');

    //   Success → 302 .../login/oauth2/code/keycloak?code=...&state=...
    //   Bad creds → 200 (login page with error)
    res = http.post(
      formAction,
      { username: KC_USER, password: KC_PASS, credentialId: '' },
      { jar, redirects: 0, tags: { name: 'login_3' } }
    );
    if (res.status !== 302) {
      const hint = res.html().find('.auth-error, .alert-error').text().trim() || res.body.substring(0, 200);
      fail(`[login] Step 3: expected 302, got ${res.status}. ${hint}`);
    }
  }

  // Step 4: Follow Keycloak → Spring Security callback chain
  //   Spring Security validates STATE (reads cookie from localhost:8085),
  //   exchanges the code, creates a session → Set-Cookie: JSESSIONID=...
  //   Stop as soon as the session cookie appears in the jar.
  hops = 10;
  do {
    loc = res.headers['Location'];
    if (!loc) break;
    loc = loc.startsWith('http') ? loc : BASE_URL + loc;
    res = get0(jar, loc, 'login_4');
    if (Object.keys(jar.cookiesForURL(BASE_URL)).length > 0) break;
  } while (res.status === 302 && --hops > 0);

  const rawCookies = jar.cookiesForURL(BASE_URL);
  const cookieHeader = Object.entries(rawCookies)
    // k6 < 0.42 returns string[], k6 >= 0.42 returns HTTPCookieJarCookie[].
    .map(([name, vals]) => {
      const v = vals[0];
      return `${name}=${typeof v === 'object' && v !== null ? v.value : v}`;
    })
    .join('; ');

  if (!cookieHeader || cookieHeader.includes('=undefined')) {
    fail('[login] No valid session cookie. If value shows "undefined", upgrade k6 to >= 0.42.');
  }
  return cookieHeader;
}

// ---------------------------------------------------------------------------
// setup() — runs once before VUs start.
//
// Pre-creates SESSION_POOL_SIZE sessions sequentially.
// This is the key fix for "Grafana shows half the target RPS":
//   With per-VU lazy login, 150 VUs all log in concurrently on their first
//   iteration — during that time no calculate requests reach deal-service,
//   so Grafana sees ~half the target RPS.  Pre-created sessions mean every VU
//   starts with a ready session and calls calculate from the first iteration.
// ---------------------------------------------------------------------------
export function setup() {
  if (!KC_USER || !KC_PASS) {
    fail('Missing credentials. Run: k6 run -e KC_USER=<email> -e KC_PASS=<password> ...');
  }

  console.log(`[setup] Pre-creating ${SESSION_POOL_SIZE} sessions (≈${SESSION_POOL_SIZE}s)...`);
  const sessions = [];
  for (let i = 0; i < SESSION_POOL_SIZE; i++) {
    sessions.push(oauthLogin());
    if ((i + 1) % 5 === 0) console.log(`[setup] ${i + 1}/${SESSION_POOL_SIZE} sessions ready`);
  }
  console.log(`[setup] Session pool ready (${sessions.length} sessions)`);
  return { sessions };
}

// ---------------------------------------------------------------------------
// Per-VU fallback session.
// Lazily populated when the assigned pool session is rejected (302).
// Cached so subsequent iterations of the same VU skip the re-login overhead.
// ---------------------------------------------------------------------------
let vuFallbackSession = null;

// ---------------------------------------------------------------------------
// default — runs per VU iteration
//
// Session selection:
//   1. Use the pool session assigned to this VU (sessions[(__VU-1) % pool.length])
//      This covers all pre-allocated VUs without any per-VU login overhead.
//   2. If the pool session is ever rejected (302), fall back to a per-VU
//      session obtained by logging in fresh.  The fallback is cached in
//      vuFallbackSession so subsequent iterations of the same VU reuse it.
// ---------------------------------------------------------------------------
export default function ({ sessions }) {
  const poolCookie = sessions[(__VU - 1) % sessions.length];
  const cookie     = vuFallbackSession || poolCookie;

  const dealId   = DEAL_IDS[Math.floor(Math.random() * DEAL_IDS.length)];
  const currency = CURRENCIES[Math.floor(Math.random() * CURRENCIES.length)];

  const res = http.post(
    `${BASE_URL}/api/deals/calculate`,
    JSON.stringify({
      deal_id:          dealId,
      calculation_date: '2025-06-01',
      target_currency:  currency,
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'X-API-Version': '1',
        Cookie:          cookie,
      },
      // redirects:0 — explicitly detect session rejection (302) instead of
      // silently following it to a 200 login page that passes status checks.
      redirects: 0,
      tags: { name: 'calculate' },
    }
  );

  calcLatency.add(res.timings.duration);

  // 302 = session expired/rejected. Track separately — NOT an error Rate entry.
  if (res.status === 302) {
    sessionRedirects.add(1);
    vuFallbackSession = oauthLogin(); // re-login immediately; next iteration uses the fresh session
    return;
  }

  const statusOk  = res.status === 200;
  const bodyOk    = res.body !== null && res.body.length > 0;
  const latencyOk = res.timings.duration < LATENCY_MS;

  check(res, {
    'status 200':                    () => statusOk,
    'body present':                  () => bodyOk,
    [`latency <${LATENCY_MS}ms`]:    () => latencyOk,
  });

  errStatus.add(!statusOk);
  errBody.add(!bodyOk);
  errLatency.add(!latencyOk);

  if (!statusOk || !bodyOk) {
    console.error(`[${dealId}/${currency}] HTTP ${res.status}: ${(res.body || '').substring(0, 300)}`);
  }
}

export function teardown() {
  console.log('[teardown] Done. Grafana → Prometheus: deal_calculate_seconds for p95/p99.');
}
