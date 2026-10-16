import { API_BASE_URL } from '../config.js';

async function getJson(path, fetchImpl) {
  if (!API_BASE_URL) throw new Error('The API base URL is not configured');
  const response = await fetchImpl(`${API_BASE_URL}${path}`);
  if (!response.ok) {
    throw new Error(`Request to ${path} failed with status ${response.status}`);
  }
  const body = await response.json();
  if (!body || body.success !== true) {
    throw new Error(`Request to ${path} returned an unsuccessful response`);
  }
  return body.data;
}

async function postJson(path, body, fetchImpl) {
  if (!API_BASE_URL) throw new Error('The API base URL is not configured');
  const response = await fetchImpl(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  if (!json || json.success !== true) {
    const err = new Error(json?.error?.message ?? `Request to ${path} failed`);
    err.status = response.status;
    err.code = json?.error?.code;
    throw err;
  }
  return json.data;
}

export const getHealth = (fetchImpl = fetch) => getJson('/api/health', fetchImpl).then((data) => ({ success: true, data }));

export const getCatalog = (fetchImpl = fetch) => getJson('/api/catalog', fetchImpl);

/** Returns { design, revision } for the predefined basic wardrobe. */
export const getDefaultDesign = (fetchImpl = fetch) => getJson('/api/designs/default', fetchImpl);

/** POST /api/chat — returns { reply, proposal? } */
export const postChat = ({ messages, design, revision }, fetchImpl = fetch) =>
  postJson('/api/chat', { messages, design, revision }, fetchImpl);

/** POST /api/proposals/apply — returns { design, revision } or throws (409 = stale) */
export const applyProposal = ({ design, revision, proposal }, fetchImpl = fetch) =>
  postJson('/api/proposals/apply', { design, revision, proposal }, fetchImpl);

/** POST /api/transcribe — multipart audio → { text } */
export async function transcribeAudio(audioBlob, fetchImpl = fetch) {
  if (!API_BASE_URL) throw new Error('The API base URL is not configured');
  const form = new FormData();
  form.append('audio', audioBlob, 'recording.webm');
  const response = await fetchImpl(`${API_BASE_URL}/api/transcribe`, {
    method: 'POST',
    body: form,
  });
  const json = await response.json();
  if (!json || json.success !== true) {
    throw new Error(json?.error?.message ?? 'Transcription failed');
  }
  return json.data; // { text }
}

/** POST /api/tts — { text, voice? } → audio Blob (audio/mpeg) */
export async function fetchTTS(text, voice = 'alloy', fetchImpl = fetch) {
  if (!API_BASE_URL) throw new Error('The API base URL is not configured');
  const response = await fetchImpl(`${API_BASE_URL}/api/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice }),
  });
  if (!response.ok) throw new Error('TTS request failed');
  return response.blob();
}
