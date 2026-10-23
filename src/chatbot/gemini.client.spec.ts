import { ServiceUnavailableException } from '@nestjs/common';
import { GeminiClient } from './gemini.client';

describe('GeminiClient', () => {
  const originalKey = process.env.GEMINI_API_KEY;
  const originalModel = process.env.GEMINI_MODEL;
  const originalBaseUrl = process.env.GEMINI_BASE_URL;

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = originalModel;
    if (originalBaseUrl === undefined) delete process.env.GEMINI_BASE_URL;
    else process.env.GEMINI_BASE_URL = originalBaseUrl;
  });

  it('requires the API key to stay on the backend', async () => {
    delete process.env.GEMINI_API_KEY;
    const client = new GeminiClient();

    await expect(
      client.respond({
        instructions: 'test',
        messages: [{ role: 'user', content: 'Xin chào' }],
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('calls Gemini generateContent with system and conversation context', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.GEMINI_MODEL = 'test-model';
    process.env.GEMINI_BASE_URL = 'https://example.test/v1beta/';
    let capturedUrl = '';
    let capturedRequest: RequestInit | undefined;
    jest.spyOn(global, 'fetch').mockImplementation((input, init) => {
      capturedUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      capturedRequest = init;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            responseId: 'resp_123',
            modelVersion: 'test-model-001',
            candidates: [
              {
                content: {
                  parts: [{ text: 'Chi tiêu ổn định.' }],
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    });
    const client = new GeminiClient();

    const result = await client.respond({
      instructions: 'Phân tích tài chính',
      messages: [
        { role: 'user', content: 'Tháng trước thế nào?' },
        { role: 'assistant', content: 'Bạn đã chi 4 triệu.' },
        { role: 'user', content: 'Còn tháng này?' },
      ],
    });

    expect(result).toEqual({
      message: 'Chi tiêu ổn định.',
      response_id: 'resp_123',
      model: 'test-model-001',
    });
    expect(capturedUrl).toBe(
      'https://example.test/v1beta/models/test-model:generateContent',
    );
    expect(capturedRequest?.method).toBe('POST');
    expect(capturedRequest?.headers).toEqual(
      expect.objectContaining({ 'x-goog-api-key': 'test-key' }),
    );
    if (typeof capturedRequest?.body !== 'string') {
      throw new Error('Expected a JSON request body');
    }
    const parsedBody = JSON.parse(capturedRequest.body) as {
      system_instruction: { parts: Array<{ text: string }> };
      contents: Array<{ role: string; parts: Array<{ text: string }> }>;
    };
    expect(parsedBody.system_instruction.parts[0].text).toBe(
      'Phân tích tài chính',
    );
    expect(parsedBody.contents).toEqual([
      { role: 'user', parts: [{ text: 'Tháng trước thế nào?' }] },
      { role: 'model', parts: [{ text: 'Bạn đã chi 4 triệu.' }] },
      { role: 'user', parts: [{ text: 'Còn tháng này?' }] },
    ]);
  });
  it('sends the extraction JSON schema and short limits without changing the default model', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.GEMINI_MODEL = 'existing-model';
    const request = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: '{}' }] } }],
        }),
        { status: 200 },
      ),
    );
    await new GeminiClient().respond({
      instructions: 'Extract fields',
      messages: [{ role: 'user', content: 'Synthetic notification' }],
      responseMimeType: 'application/json',
      responseJsonSchema: { type: 'object', required: ['type'] },
      maxOutputTokens: 600,
      temperature: 0,
      timeoutMs: 12000,
    });
    const options = request.mock.calls[0][1];
    if (typeof options?.body !== 'string')
      throw new Error('Expected a JSON body');
    const body = JSON.parse(options.body) as {
      generationConfig: Record<string, unknown>;
    };
    expect(body.generationConfig).toMatchObject({
      responseJsonSchema: { type: 'object', required: ['type'] },
      responseMimeType: 'application/json',
      maxOutputTokens: 600,
      temperature: 0,
    });
    const target = request.mock.calls[0][0];
    expect(
      typeof target === 'string'
        ? target
        : target instanceof URL
          ? target.href
          : target.url,
    ).toContain('/models/existing-model:');
  });
  it('aborts an extraction at its explicit timeout', async () => {
    jest.useFakeTimers();
    process.env.GEMINI_API_KEY = 'test-key';
    jest.spyOn(global, 'fetch').mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    try {
      const pending = new GeminiClient().respond({
        instructions: 'Extract',
        messages: [],
        timeoutMs: 12000,
      });
      const assertion = expect(pending).rejects.toThrow('phản hồi quá lâu');
      await jest.advanceTimersByTimeAsync(12000);
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });
});
