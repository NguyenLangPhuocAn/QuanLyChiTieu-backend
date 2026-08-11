import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { LoanDebtsService } from '../src/loan-debts/loan-debts.service';
import { LoanDebtType } from '../src/loan-debts/dto/create-loan-debt.dto';
import { PrismaService } from '../src/prisma/prisma.service';

const email = 'nlpan14112004@gmail.com';
const legacyNames = [
  'Vay đang mở',
  'Cho vay quá hạn',
  'Vay đã trả',
  'Cho vay đã thu hồi',
];
const currentNames = [
  'Vay bạn thân',
  'Cho em họ vay',
  'Vay mua đồ',
  'Cho đồng nghiệp vay',
];
const dateKey = (date: Date) => date.toISOString().slice(0, 10);

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const prisma = app.get(PrismaService);
  const service = app.get(LoanDebtsService);

  try {
    const user = await prisma.users.findUnique({ where: { email } });
    if (!user) {
      throw new Error(`Không tìm thấy ${email}`);
    }

    const wallets = await prisma.wallets.findMany({
      where: { user_id: user.id, deleted_at: null },
      orderBy: { id: 'asc' },
    });
    if (wallets.length === 0) {
      throw new Error('NLPAn chưa có ví');
    }

    const existing = await prisma.loan_debts.findMany({
      where: {
        user_id: user.id,
        deleted_at: null,
        OR: [
          { person_name: { in: legacyNames } },
          { person_name: { in: currentNames } },
          { person_name: { startsWith: 'NLPAn Demo - ' } },
          { note: { contains: 'demo' } },
        ],
      },
    });
    for (const record of existing) {
      await service.remove(user.id, record.id);
    }

    const today = new Date();
    const overdue = new Date(today);
    overdue.setDate(overdue.getDate() - 10);
    const future = new Date(today);
    future.setDate(future.getDate() + 20);
    const wallet = wallets[0];

    const openBorrowed = await service.create(user.id, {
      person_name: currentNames[0],
      type: LoanDebtType.BORROWED,
      principal_amount: '5000000',
      wallet_id: wallet.id,
      due_date: dateKey(future),
      note: 'Khoản vay đang trả dần cho chi tiêu cá nhân',
    });
    await service.addPayment(user.id, openBorrowed.id, {
      wallet_id: wallet.id,
      amount: '1000000',
      note: 'Trả đợt 1',
    });

    const overdueLent = await service.create(user.id, {
      person_name: currentNames[1],
      type: LoanDebtType.LENT,
      principal_amount: '3000000',
      wallet_id: wallet.id,
      due_date: dateKey(overdue),
      note: 'Khoản cho vay gia đình cần theo dõi thu hồi',
    });
    await service.addPayment(user.id, overdueLent.id, {
      wallet_id: wallet.id,
      amount: '500000',
      note: 'Thu hồi đợt 1',
    });

    const paidBorrowed = await service.create(user.id, {
      person_name: currentNames[2],
      type: LoanDebtType.BORROWED,
      principal_amount: '2000000',
      wallet_id: wallet.id,
      note: 'Khoản vay mua đồ đã tất toán',
    });
    await service.addPayment(user.id, paidBorrowed.id, {
      wallet_id: wallet.id,
      amount: '750000',
      note: 'Trả đợt 1',
    });
    await service.addPayment(user.id, paidBorrowed.id, {
      wallet_id: wallet.id,
      amount: '1250000',
      note: 'Trả đợt 2',
    });

    const recoveredLent = await service.create(user.id, {
      person_name: currentNames[3],
      type: LoanDebtType.LENT,
      principal_amount: '1500000',
      wallet_id: wallet.id,
      note: 'Khoản cho vay công việc đã thu đủ',
    });
    await service.addPayment(user.id, recoveredLent.id, {
      wallet_id: wallet.id,
      amount: '500000',
      note: 'Thu hồi đợt 1',
    });
    await service.addPayment(user.id, recoveredLent.id, {
      wallet_id: wallet.id,
      amount: '1000000',
      note: 'Thu hồi đợt 2',
    });

    console.log(`Đã tạo 4 khoản vay/nợ thực tế cho ${email}.`);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
