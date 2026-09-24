import {
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

type GeminiPart = { text?: string };
type GeminiRequestPart =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } };
type GeminiResponse = {
  responseId?: string;
  modelVersion?: string;
  candidates?: Array<{
    content?: { parts?: GeminiPart[] };
  }>;
};

@Injectable()
export class GeminiClient {
  private readonly logger = new Logger(GeminiClient.name);

  private extractText(payload: GeminiResponse) {
    return (payload.candidates ?? [])
      .flatMap((candidate) => candidate.content?.parts ?? [])
      .map((part) => part.text?.trim() ?? '')
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  private async generate(input: {
    instructions: string;
    contents: Array<{
      role: 'user' | 'model';
      parts: GeminiRequestPart[];
    }>;
    maxOutputTokens: number;
    temperature: number;
    responseMimeType?: string;
    unavailableMessage: string;
  }) {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'Gemini chưa được cấu hình GEMINI_API_KEY trên backend',
      );
    }

    const model = process.env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash-lite';
    const baseUrl = (
      process.env.GEMINI_BASE_URL?.trim() ||
      'https://generativelanguage.googleapis.com/v1beta'
    ).replace(/\/$/, '');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const encodedModel = encodeURIComponent(model);
      const response = await fetch(
        `${baseUrl}/models/${encodedModel}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify({
            system_instruction: {
              parts: [{ text: input.instructions }],
            },
            contents: input.contents,
            generationConfig: {
              maxOutputTokens: input.maxOutputTokens,
              temperature: input.temperature,
              ...(input.responseMimeType
                ? { responseMimeType: input.responseMimeType }
                : {}),
            },
          }),
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        this.logger.warn(`Gemini API returned ${response.status}`);
        throw new HttpException(
          response.status === 429
            ? 'Gemini đang quá tải hoặc đã hết hạn mức miễn phí, vui lòng thử lại sau'
            : input.unavailableMessage,
          response.status === 429 ? 429 : 502,
        );
      }

      const payload = (await response.json()) as GeminiResponse;
      const message = this.extractText(payload);
      if (!message) {
        throw new HttpException('Chatbot không trả về nội dung', 502);
      }

      return {
        message,
        response_id: payload.responseId ?? null,
        model: payload.modelVersion ?? model,
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const timedOut = error instanceof Error && error.name === 'AbortError';
      this.logger.warn(
        timedOut ? 'Gemini request timed out' : 'Gemini request failed',
      );
      throw new ServiceUnavailableException(
        timedOut
          ? 'Gemini phản hồi quá lâu, vui lòng thử lại'
          : input.unavailableMessage,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async respond(input: {
    instructions: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  }) {
    return this.generate({
      instructions: input.instructions,
      contents: input.messages.map((message) => ({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: message.content }],
      })),
      maxOutputTokens: 900,
      temperature: 0.3,
      unavailableMessage: 'Chatbot chưa thể trả lời lúc này',
    });
  }

  async suggestQuestions(input: { instructions: string; prompt: string }) {
    return this.generate({
      instructions: input.instructions,
      contents: [
        {
          role: 'user',
          parts: [{ text: input.prompt }],
        },
      ],
      maxOutputTokens: 500,
      temperature: 0.85,
      responseMimeType: 'application/json',
      unavailableMessage: 'Chưa thể tạo câu hỏi gợi ý lúc này',
    });
  }

  async analyzeImage(input: {
    instructions: string;
    prompt: string;
    mimeType: string;
    imageBase64: string;
  }) {
    return this.generate({
      instructions: input.instructions,
      contents: [
        {
          role: 'user',
          parts: [
            { text: input.prompt },
            {
              inline_data: {
                mime_type: input.mimeType,
                data: input.imageBase64,
              },
            },
          ],
        },
      ],
      maxOutputTokens: 1800,
      temperature: 0.1,
      responseMimeType: 'application/json',
      unavailableMessage: 'Chưa thể đọc hóa đơn lúc này',
    });
  }
}
