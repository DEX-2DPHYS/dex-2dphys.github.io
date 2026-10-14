// AI providers for the assistant, called straight from the page with the user's own API key
// (Settings → AI assistant). Nothing goes through a server of ours: the key is sent only to the
// provider it belongs to. All three accept calls from a web page (checked 2026-10-14: Claude with
// its browser-access header; OpenAI and Mistral by CORS).
//
// callModel({ provider, model, key, system, messages, maxTokens, effort, signal })
//   → { text, model, usage: { input, output }, cost (USD, from the price table) }
// messages: [{ role: 'user' | 'assistant', content: string }]

export const PROVIDERS = {
  anthropic: {
    name: 'Claude (Anthropic)', keyHint: 'sk-ant-…', keyUrl: 'https://console.anthropic.com/settings/keys',
    models: [
      { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', note: 'best results (default)', price: [4, 20], fallback: true },
      { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', note: 'faster, half the price', price: [2, 10], fallback: true },
      { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', note: 'fastest and cheapest; simple requests', price: [0.1, 0.5] },
      { id: 'claude-fable-5-1', name: 'Claude Fable 5.1', note: 'most capable, most expensive, slower', price: [10, 50], fallback: true },
    ],
  },
  openai: {
    name: 'OpenAI (ChatGPT models)', keyHint: 'sk-…', keyUrl: 'https://platform.openai.com/api-keys',
    models: [
      { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', note: 'default', price: [2, 10] },
      { id: 'gpt-6-luna', name: 'GPT-6 Luna', note: 'fast and cheap', price: [0.1, 0.5] },
      { id: 'gpt-6-astra', name: 'GPT-6 Astra', note: 'most capable, expensive', price: [10, 50] },
    ],
  },
  mistral: {
    name: 'Mistral', keyHint: 'API key', keyUrl: 'https://console.mistral.ai/api-keys',
    models: [
      { id: 'mistral-medium-3-5', name: 'Mistral Medium 3.5', note: 'default', price: [1.5, 7.5] },
      { id: 'mistral-large-latest', name: 'Mistral Large', note: '', price: [0.5, 1.5] },
      { id: 'mistral-small-latest', name: 'Mistral Small', note: 'fast and cheap', price: [0.15, 0.6] },
    ],
  },
};

export const modelInfo = (provider, id) => PROVIDERS[provider]?.models.find((m) => m.id === id) || { id, name: id, note: 'model id typed in', price: null };
export const costOf = (provider, id, u) => { const p = modelInfo(provider, id).price; return p ? (u.input * p[0] + u.output * p[1]) / 1e6 : null; };

export class AIError extends Error { constructor(msg, kind = 'error') { super(msg); this.kind = kind; } }

const TIMEOUT_MS = 240000;
async function post(url, headers, body, signal, who) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new Error('timeout')), TIMEOUT_MS);
  const stop = () => ctl.abort(new Error('stopped'));
  signal?.addEventListener('abort', stop);
  let r;
  try {
    r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctl.signal });
  } catch (e) {
    if (signal?.aborted) throw new AIError('Stopped.', 'stopped');
    if (ctl.signal.aborted) throw new AIError(`${who} did not answer within ${TIMEOUT_MS / 60000} minutes. Try again, or pick a faster model in Settings.`, 'timeout');
    // OpenAI's error replies carry no CORS header, so a wrong key reaches the page as a network error
    throw new AIError(who === 'OpenAI'
      ? 'OpenAI did not answer this page. Most often the API key is wrong or has no credit (OpenAI\'s error reply cannot be read by a web page, so it looks like a network failure). Check the key in Settings → AI assistant, and the network.'
      : `Could not reach ${who}: is the computer online? (${e.message})`, 'network');
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', stop); }
  const res = await r.json().catch(() => ({}));
  if (!r.ok) {
    const detail = res.error?.message || res.message || res.detail || r.statusText;
    const msg = r.status === 401 || r.status === 403 ? `${who} rejected the API key. Check it in Settings → AI assistant.`
      : r.status === 429 ? `${who}: too many requests or no credit left (${typeof detail === 'string' ? detail : JSON.stringify(detail)}).`
      : r.status === 404 || (r.status === 400 && /model/i.test(String(detail))) ? `${who} does not know the model you picked (${typeof detail === 'string' ? detail : JSON.stringify(detail)}). Pick another one in Settings.`
      : `${who} error ${r.status}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;
    throw new AIError(msg, r.status === 401 || r.status === 403 ? 'key' : 'api');
  }
  return res;
}

async function callAnthropic({ model, key, system, messages, maxTokens, effort, signal }) {
  const info = modelInfo('anthropic', model);
  const body = { model, max_tokens: maxTokens, system, messages, output_config: { effort } };
  const headers = { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' };
  if (info.fallback) { body.fallbacks = 'default'; headers['anthropic-beta'] = 'server-side-fallback-2026-07-01'; }   // a safety decline is re-run on a fallback model
  const res = await post('https://api.anthropic.com/v1/messages', headers, body, signal, 'Claude');
  if (res.stop_reason === 'refusal') throw new AIError(`The model declined this request${res.stop_details?.category ? ` (${res.stop_details.category})` : ''}. Rephrase it.`, 'refusal');
  if (res.stop_reason === 'max_tokens') throw new AIError('The answer was cut off (too long). Ask for less at a time.', 'length');
  const text = (res.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  const u = res.usage || {};
  return { text, model: res.model || model, usage: { input: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0), output: u.output_tokens || 0 } };
}

async function callOpenAI({ model, key, system, messages, maxTokens, effort, signal }) {
  const body = {
    model, instructions: system, store: false, max_output_tokens: maxTokens,
    input: messages.map((m) => ({ role: m.role, content: m.content })),
    reasoning: { effort: effort === 'low' ? 'low' : 'medium' },
    text: { format: { type: 'json_object' } },
  };
  const res = await post('https://api.openai.com/v1/responses', { authorization: `Bearer ${key}` }, body, signal, 'OpenAI');
  if (res.status === 'incomplete') throw new AIError(res.incomplete_details?.reason === 'max_output_tokens' ? 'The answer was cut off (too long). Ask for less at a time.' : 'OpenAI stopped early.', 'length');
  const parts = (res.output || []).filter((o) => o.type === 'message').flatMap((o) => o.content || []);
  const refusal = parts.find((p) => p.type === 'refusal');
  if (refusal) throw new AIError(`OpenAI declined: ${refusal.refusal}`, 'refusal');
  return { text: parts.filter((p) => p.type === 'output_text').map((p) => p.text).join(''), model: res.model || model, usage: { input: res.usage?.input_tokens || 0, output: res.usage?.output_tokens || 0 } };
}

async function callMistral({ model, key, system, messages, maxTokens, signal }) {
  const body = { model, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, ...messages], response_format: { type: 'json_object' } };
  const res = await post('https://api.mistral.ai/v1/chat/completions', { authorization: `Bearer ${key}` }, body, signal, 'Mistral');
  const ch = res.choices?.[0] || {};
  if (ch.finish_reason === 'length') throw new AIError('The answer was cut off (too long). Ask for less at a time.', 'length');
  const c = ch.message?.content;
  const text = typeof c === 'string' ? c : (c || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  return { text, model: res.model || model, usage: { input: res.usage?.prompt_tokens || 0, output: res.usage?.completion_tokens || 0 } };
}

// A hook for the gates: window.__ebwAiMock(request) → { text, usage } replaces the network.
export async function callModel(req) {
  const { provider, key } = req;
  if (!PROVIDERS[provider]) throw new AIError(`Unknown provider ${provider}`);
  if (!key && !window.__ebwAiMock) throw new AIError('No API key yet: add one in Settings → AI assistant.', 'key');
  const r = { maxTokens: 16000, effort: 'medium', ...req };
  const t0 = performance.now();
  const out = window.__ebwAiMock ? await window.__ebwAiMock(r)
    : provider === 'anthropic' ? await callAnthropic(r) : provider === 'openai' ? await callOpenAI(r) : await callMistral(r);
  out.usage ??= { input: 0, output: 0 };
  out.model ??= r.model;
  out.ms = Math.round(performance.now() - t0);
  out.cost = costOf(provider, r.model, out.usage);
  return out;
}
