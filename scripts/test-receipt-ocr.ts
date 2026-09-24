import { readFile } from 'fs/promises';
import { extname, resolve } from 'path';
import { GeminiClient } from '../src/chatbot/gemini.client';
import { loadEnvFile } from '../src/env';
import { PrismaService } from '../src/prisma/prisma.service';
import { ReceiptOcrService } from '../src/transactions/receipt-ocr.service';

const mimeByExtension: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

const main = async () => {
  loadEnvFile();
  const inputPath = process.argv[2];
  if (!inputPath) throw new Error('Vui lòng truyền đường dẫn ảnh hóa đơn');
  const absolutePath = resolve(inputPath);
  const mimetype = mimeByExtension[extname(absolutePath).toLowerCase()];
  if (!mimetype) throw new Error('Chỉ hỗ trợ JPG, PNG hoặc WEBP');

  const prisma = new PrismaService();
  await prisma.$connect();
  try {
    const user = await prisma.users.findFirst({
      where: { deleted_at: null },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    if (!user) throw new Error('Database chưa có người dùng để test');
    const service = new ReceiptOcrService(prisma, new GeminiClient());
    const result = await service.analyze(user.id, {
      mimetype,
      buffer: await readFile(absolutePath),
    } as Express.Multer.File);
    console.log(`OCR_RESULT=${JSON.stringify(result)}`);
  } finally {
    await prisma.$disconnect();
  }
};

main().catch((error: unknown) => {
  console.error(
    `OCR_TEST_FAILED=${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
