import { BadGatewayException } from '@nestjs/common';
import { GeminiClient } from '../chatbot/gemini.client';
import { PrismaService } from '../prisma/prisma.service';
import { ReceiptOcrService } from './receipt-ocr.service';

describe('ReceiptOcrService', () => {
  const file = {
    mimetype: 'image/jpeg',
    buffer: Buffer.from('fake-image'),
  } as Express.Multer.File;

  it('returns a safe draft and only accepts an accessible category', async () => {
    const prisma = {
      users: { findUnique: jest.fn().mockResolvedValue({ role: 'BASIC' }) },
      categories: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 3, name: 'Ăn uống', icon: 'food.png' }]),
      },
    };
    const gemini = {
      analyzeImage: jest.fn().mockResolvedValue({
        message: JSON.stringify({
          merchant: 'WinMart',
          note: 'Mua hàng WinMart',
          amount: 88000,
          currency: 'VND',
          transaction_date: '2026-09-01',
          suggested_category_id: 3,
          receipt_items: [
            { name: 'Cua 0,5 kg', amount: 50000 },
            { name: 'Rau', amount: 30000 },
            { name: 'Thuế/phí', amount: 8000 },
            { name: 'Tổng cộng', amount: 88000 },
          ],
          warnings: [],
        }),
        model: 'test-model',
      }),
    };
    const service = new ReceiptOcrService(
      prisma as unknown as PrismaService,
      gemini as unknown as GeminiClient,
    );

    const result = await service.analyze(7, file);

    expect(result).toMatchObject({
      merchant: 'WinMart',
      amount: 88000,
      currency: 'VND',
      suggested_category: { id: 3, name: 'Ăn uống' },
      receipt_items: [],
    });
    expect(result.warnings).not.toContain('Không đọc được danh sách món hàng.');
    expect(gemini.analyzeImage).toHaveBeenCalledWith(
      expect.objectContaining({
        mimeType: 'image/jpeg',
        imageBase64: file.buffer.toString('base64'),
      }),
    );
  });

  it('rejects a non-JSON AI response instead of creating guessed data', async () => {
    const prisma = {
      users: { findUnique: jest.fn().mockResolvedValue({ role: 'BASIC' }) },
      categories: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const gemini = {
      analyzeImage: jest.fn().mockResolvedValue({
        message: 'Không đọc được',
        model: 'test-model',
      }),
    };
    const service = new ReceiptOcrService(
      prisma as unknown as PrismaService,
      gemini as unknown as GeminiClient,
    );

    await expect(service.analyze(7, file)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it.each(['12,50', '1,234.56', '1.234.567', '', -10, 1e15, null])(
    'leaves unsafe total %s blank instead of changing its value',
    async (amount) => {
      const prisma = {
        users: { findUnique: jest.fn().mockResolvedValue({ role: 'BASIC' }) },
        categories: { findMany: jest.fn().mockResolvedValue([]) },
      };
      const gemini = {
        analyzeImage: jest.fn().mockResolvedValue({
          message: JSON.stringify({ amount, receipt_items: [] }),
          model: 'test-model',
        }),
      };
      const result = await new ReceiptOcrService(
        prisma as unknown as PrismaService,
        gemini as unknown as GeminiClient,
      ).analyze(7, file);
      expect(result.amount).toBeNull();
      expect(result.warnings).toContain('Không đọc được tổng thanh toán hợp lệ.');
    },
  );
});
