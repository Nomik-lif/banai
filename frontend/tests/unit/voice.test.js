import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/config.js', () => ({ API_BASE_URL: 'http://localhost:8000' }));

const { transcribeAudio, fetchTTS } = await import('../../src/api/client.js');

describe('transcribeAudio', () => {
  it('posts FormData to /api/transcribe and returns text', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ success: true, data: { text: 'Make it wider' } }),
    });
    const blob = new Blob(['audio'], { type: 'audio/webm' });
    const result = await transcribeAudio(blob, mockFetch);

    expect(result.text).toBe('Make it wider');
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('http://localhost:8000/api/transcribe');
    expect(opts.method).toBe('POST');
    expect(opts.body).toBeInstanceOf(FormData);
  });

  it('throws when success is false', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      json: () =>
        Promise.resolve({ success: false, error: { message: 'Transcription failed' } }),
    });
    const blob = new Blob(['audio'], { type: 'audio/webm' });
    await expect(transcribeAudio(blob, mockFetch)).rejects.toThrow('Transcription failed');
  });

  it('throws when API_BASE_URL is missing', async () => {
    vi.resetModules();
    vi.doMock('../../src/config.js', () => ({ API_BASE_URL: '' }));
    const { transcribeAudio: t } = await import('../../src/api/client.js');
    const blob = new Blob(['audio'], { type: 'audio/webm' });
    await expect(t(blob)).rejects.toThrow('API base URL');
    vi.doMock('../../src/config.js', () => ({ API_BASE_URL: 'http://localhost:8000' }));
  });
});

describe('fetchTTS', () => {
  it('posts text and voice to /api/tts and returns a Blob', async () => {
    const fakeBlob = new Blob(['mp3data'], { type: 'audio/mpeg' });
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(fakeBlob),
    });
    const result = await fetchTTS('Hello there', 'nova', mockFetch);

    expect(result).toBeInstanceOf(Blob);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('http://localhost:8000/api/tts');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toMatchObject({ text: 'Hello there', voice: 'nova' });
  });

  it('defaults voice to alloy', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob()),
    });
    await fetchTTS('Hello', undefined, mockFetch);
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).voice).toBe('alloy');
  });

  it('throws on non-ok response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false });
    await expect(fetchTTS('hi', 'alloy', mockFetch)).rejects.toThrow('TTS request failed');
  });
});
