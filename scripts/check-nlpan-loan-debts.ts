import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { LoanDebtsService } from '../src/loan-debts/loan-debts.service';
import { PrismaService } from '../src/prisma/prisma.service';

const normalizeText = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });

  try {
    const prisma = app.get(PrismaService);
    const service = app.get(LoanDebtsService);
    const user = await prisma.users.findUnique({
      where: { email: 'nlpan14112004@gmail.com' },
    });

    if (!user) {
      throw new Error('Không tìm thấy tài khoản NLPAn');
    }

    const expectedNames = new Set(
      [
        'Vay bạn thân',
        'Cho em họ vay',
        'Vay mua đồ',
        'Cho đồng nghiệp vay',
      ].map(normalizeText),
    );

    const records = (await service.findAll(user.id)).filter((record) =>
      expectedNames.has(normalizeText(record.person_name)),
    );
    const statuses = new Set<string>(records.map((record) => record.status));

    if (
      records.length !== 4 ||
      !statuses.has('OPEN') ||
      !statuses.has('OVERDUE') ||
      !statuses.has('PAID') ||
      records.some((record) => record.payments.length === 0) ||
      records.some((record) => /demo|nlpan/i.test(record.note ?? ''))
    ) {
      throw new Error('Dữ liệu vay/nợ thực tế chưa sạch hoặc chưa đầy đủ');
    }

    console.log(
      records
        .map(
          (record) =>
            `${record.person_name}: ${record.status}, còn ${record.remaining_amount}`,
        )
        .join('\n'),
    );
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
