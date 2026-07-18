// Cloudflare Worker — ElevenLabs text-to-speech proxy for the Universe globe
// (globe.html). Reads country / state / city overviews aloud and voices the
// guided "Narrated tour". The ElevenLabs API key lives here as an encrypted
// Worker secret, never in the public repo or the browser.
//
// ──────────────────────────────────────────────────────────────────────
// SETUP (one-time, ~10 minutes — same steps as the role-play voice worker):
//
// 1. Go to https://dash.cloudflare.com/ → Workers & Pages → Create → Worker
// 2. Name it (e.g. "universe-narration") → Deploy
// 3. Click "Edit code" → replace the default with this entire file → Save & Deploy
// 4. Back on the Worker page: Settings → Variables and Secrets →
//      Add variable:  name = ELEVENLABS_API_KEY
//                     type = Secret
//                     value = your ElevenLabs API key (elevenlabs.io → Profile → API Keys)
//      Save.
// 5. Copy the Worker URL (looks like https://universe-narration.YOURNAME.workers.dev)
// 6. In globe.html, set VOICE_PROXY_URL near the top of the <script> to that URL.
//    (Leave it '' and the globe falls back to the browser's built-in voice.)
// ──────────────────────────────────────────────────────────────────────

const ALLOWED_ORIGINS = [
  'https://akesha.github.io',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
  'http://localhost:8137',
  'http://127.0.0.1:8137',
  'http://localhost:5173',
  'null' // file:// — lets you test by double-clicking the HTML locally
];

// Only the voices this app offers — a stolen URL can't drive arbitrary
// (e.g. cloned) voices on your account.
const ALLOWED_VOICE_IDS = new Set([
  'DODLEQrClDo8wCz460ld', // Rachel — calm narrator (default)
  'EXAVITQu4vr4xnSDxMaL', // Sarah
  'pNInz6obpgDQGcFmaJgB', // Adam
  'ThT5KcBeYPX3keUQqHPh'  // Dorothy
]);

const DEFAULT_VOICE_ID = 'DODLEQrClDo8wCz460ld';

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const originAllowed = ALLOWED_ORIGINS.includes(origin);
    const corsHeaders = {
      'Access-Control-Allow-Origin': originAllowed ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (!originAllowed) {
      return json({ error: 'Origin not allowed' }, 403, corsHeaders);
    }
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405, corsHeaders);
    }
    if (!env.ELEVENLABS_API_KEY) {
      return json({ error: 'Server is missing ELEVENLABS_API_KEY secret' }, 500, corsHeaders);
    }

    let body;
    try { body = await request.json(); }
    catch { return json({ error: 'Invalid JSON body' }, 400, corsHeaders); }

    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!text) {
      return json({ error: 'Body must include text' }, 400, corsHeaders);
    }
    // Overviews are a paragraph or two; cap so a stolen URL can't synthesize books.
    if (text.length > 2500) {
      return json({ error: 'Text too long' }, 400, corsHeaders);
    }

    const voiceId = ALLOWED_VOICE_IDS.has(body.voiceId) ? body.voiceId : DEFAULT_VOICE_ID;

    const upstream = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': env.ELEVENLABS_API_KEY,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_turbo_v2_5',
          voice_settings: { stability: 0.5, similarity_boost: 0.75 }
        })
      }
    );

    if (!upstream.ok) {
      const detail = await upstream.text();
      return json({ error: 'ElevenLabs error (' + upstream.status + '): ' + detail.slice(0, 300) }, upstream.status, corsHeaders);
    }

    return new Response(upstream.body, {
      status: 200,
      headers: { ...corsHeaders, 'content-type': 'audio/mpeg', 'cache-control': 'no-store' }
    });
  }
};

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...headers, 'content-type': 'application/json' }
  });
}
