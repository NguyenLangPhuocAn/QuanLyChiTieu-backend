import { AdminService } from './admin.service';

type DashboardCategoryMeta = {
  name: string;
  icon?: string | null;
  cash_flow_group?: string | null;
  isSystem: boolean;
  userId: number | null;
};

type DashboardTransaction = {
  id: number;
  amount: number;
  transaction_date: Date;
  category_id?: number | null;
  wallet_id?: number | null;
};

type DashboardTransactionSummary = {
  income: number;
  expense: number;
  net: number;
  transactionCount: number;
  incomeCount: number;
  expenseCount: number;
  categoryTotals: Array<{ categoryId: number }>;
  walletTotals: Array<{ walletId: number; total: number }>;
};

type AdminServiceTestAccess = {
  summarizeTransactions(
    transactions: DashboardTransaction[],
    categoryMeta?: Map<number, DashboardCategoryMeta>,
  ): DashboardTransactionSummary;
};

describe('AdminService logs', () => {
  const makeService = (logs: Array<{ id: number; action: string }>) => {
    const prisma = {
      admin_logs: {
        findMany: jest.fn().mockResolvedValue(
          logs.map((log) => ({
            ...log,
            admin_id: 1,
            created_at: new Date('2026-05-26T10:00:00.000Z'),
          })),
        ),
      },
    };

    return new AdminService(prisma as never, {} as never);
  };

  it('includes notification sends in admin logs and notification target filters', async () => {
    const service = makeService([
      { id: 1, action: 'Admin gửi thông báo hệ thống (id: 9)' },
      { id: 2, action: 'xem dashboard' },
    ]);

    await expect(service.getLogs()).resolves.toEqual([
      expect.objectContaining({
        id: 1,
        action: 'Admin gửi thông báo hệ thống (id: 9)',
      }),
    ]);

    await expect(service.getLogs({ target: 'NOTIFICATION' })).resolves.toEqual([
      expect.objectContaining({
        id: 1,
        action: 'Admin gửi thông báo hệ thống (id: 9)',
      }),
    ]);
  });

  it('excludes personal finance actions from admin logs', async () => {
    const service = makeService([
      { id: 1, action: 'Tạo giao dịch (id: 946)' },
      { id: 2, action: 'Upload ảnh hóa đơn giao dịch (id: 946)' },
      { id: 3, action: 'Admin tạo người dùng (Nguyễn Văn A)' },
    ]);

    await expect(service.getLogs()).resolves.toEqual([
      expect.objectContaining({
        id: 3,
        action: 'Admin tạo người dùng (Nguyễn Văn A)',
      }),
    ]);
  });
});

describe('AdminService categories', () => {
  it('deduplicates active system categories with the same name and type', async () => {
    const prisma = {
      categories: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 3,
            name: 'Ăn uống',
            type: 'EXPENSE',
            icon: 'categories/icons/expense_food.png',
            is_system: true,
            is_active: true,
            user_id: null,
          },
          {
            id: 81,
            name: 'Ăn uống',
            type: 'EXPENSE',
            icon: 'categories/icons/expense_food.png',
            is_system: true,
            is_active: true,
            user_id: null,
          },
        ]),
      },
      users: {
        findMany: jest.fn(),
      },
    };
    const service = new AdminService(prisma as never, {} as never);

    await expect(service.getCategories()).resolves.toEqual([
      expect.objectContaining({ id: 3, name: 'Ăn uống' }),
    ]);
  });
});

describe('AdminService statistics', () => {
  it('excludes loan/debt categories from dashboard transaction summaries', () => {
    const service = new AdminService(
      {} as never,
      {} as never,
    ) as unknown as AdminServiceTestAccess;
    const summary = service.summarizeTransactions(
      [
        {
          id: 1,
          amount: 5000000,
          transaction_date: new Date('2026-06-01T00:00:00.000Z'),
          category_id: 10,
          wallet_id: 1,
        },
        {
          id: 2,
          amount: -1000000,
          transaction_date: new Date('2026-06-02T00:00:00.000Z'),
          category_id: 11,
          wallet_id: 1,
        },
        {
          id: 3,
          amount: 3000000,
          transaction_date: new Date('2026-06-03T00:00:00.000Z'),
          category_id: 12,
          wallet_id: 1,
        },
        {
          id: 4,
          amount: -500000,
          transaction_date: new Date('2026-06-04T00:00:00.000Z'),
          category_id: 13,
          wallet_id: 1,
        },
      ],
      new Map([
        [
          10,
          {
            name: 'Salary',
            cash_flow_group: 'NORMAL',
            isSystem: true,
            userId: null,
          },
        ],
        [
          11,
          {
            name: 'Food',
            cash_flow_group: 'NORMAL',
            isSystem: true,
            userId: null,
          },
        ],
        [
          12,
          {
            name: 'Borrowed cash',
            cash_flow_group: 'LOAN_DEBT',
            isSystem: true,
            userId: null,
          },
        ],
        [
          13,
          {
            name: 'Debt repayment',
            cash_flow_group: 'LOAN_DEBT',
            isSystem: true,
            userId: null,
          },
        ],
      ]),
    );

    expect(summary).toEqual(
      expect.objectContaining({
        income: 5000000,
        expense: 1000000,
        net: 4000000,
        transactionCount: 2,
        incomeCount: 1,
        expenseCount: 1,
      }),
    );
    expect(summary.categoryTotals.map((item) => item.categoryId)).toEqual([
      10, 11,
    ]);
    expect(summary.walletTotals).toEqual([{ walletId: 1, total: 6000000 }]);
  });
});
