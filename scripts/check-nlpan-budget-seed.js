const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

for (const line of fs
  .readFileSync(path.join(__dirname, '..', '.env'), 'utf8')
  .split(/\r?\n/)) {
  const match = /^([^#=]+)=(.*)$/.exec(line.trim());
  if (!match) continue;
  process.env[match[1].trim()] = match[2].trim().replace(/^['"]|['"]$/g, '');
}

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.users.findUnique({
    where: { email: 'nlpan14112004@gmail.com' },
  });
  if (!user) throw new Error('Không tìm thấy tài khoản NLPAn');
  const now = new Date();
  const budgets = await prisma.budgets.findMany({
    where: {
      user_id: user.id,
      is_active: true,
      deleted_at: null,
      period: { in: ['DAY', 'WEEK', 'MONTH'] },
    },
  });

  for (const period of ['DAY', 'WEEK', 'MONTH']) {
    const matching = budgets.filter((item) => item.period === period);
    const current = matching.filter(
      (item) => item.start_date <= now && item.end_date >= now,
    );
    if (matching.length < 3 || current.length < 1) {
      throw new Error(
        `${period}: cần ít nhất 3 ngân sách và 1 ngân sách đang áp dụng`,
      );
    }
    console.log(
      `${period}: ${matching.length} ngân sách, ${current.length} đang áp dụng`,
    );
  }
}

main().finally(() => prisma.$disconnect());
