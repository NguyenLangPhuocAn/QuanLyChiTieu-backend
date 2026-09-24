/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { Prisma } from '@prisma/client';
import { NotificationsService } from './notifications.service';

const createPrismaMock = () => ({
  notification_settings: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  notifications: {
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn(),
  },
  notification_broadcasts: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
  users: {
    findMany: jest.fn(),
  },
  budgets: {
    findMany: jest.fn(),
  },
  admin_logs: {
    create: jest.fn(),
  },
  $queryRaw: jest.fn(),
  $executeRaw: jest.fn(),
  $transaction: jest.fn(),
});

const createDuplicateError = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });

describe('NotificationsService', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('creates default settings when missing', async () => {
    const prisma = createPrismaMock();
    prisma.notification_settings.findUnique.mockResolvedValue(null);
    prisma.notification_settings.create.mockResolvedValue({
      id: 1,
      user_id: 7,
      budget_alerts_enabled: true,
      budget_expiring_enabled: true,
      cashflow_forecast_enabled: true,
      savings_plan_alerts_enabled: true,
      system_notifications_enabled: true,
    });
    const service = new NotificationsService(prisma as never);

    await expect(service.getSettings(7)).resolves.toMatchObject({
      user_id: 7,
      budget_alerts_enabled: true,
      budget_expiring_enabled: true,
      cashflow_forecast_enabled: true,
      savings_plan_alerts_enabled: true,
      system_notifications_enabled: true,
    });
    expect(prisma.notification_settings.create).toHaveBeenCalledWith({
      data: {
        user_id: 7,
        budget_alerts_enabled: true,
        budget_expiring_enabled: true,
        cashflow_forecast_enabled: true,
        savings_plan_alerts_enabled: true,
        system_notifications_enabled: true,
      },
    });
  });

  it('returns existing settings without creating defaults', async () => {
    const prisma = createPrismaMock();
    const existingSettings = {
      id: 12,
      user_id: 7,
      budget_alerts_enabled: false,
      budget_expiring_enabled: true,
      system_notifications_enabled: false,
    };
    prisma.notification_settings.findUnique.mockResolvedValue(existingSettings);
    const service = new NotificationsService(prisma as never);

    await expect(service.getSettings(7)).resolves.toEqual(existingSettings);
    expect(prisma.notification_settings.create).not.toHaveBeenCalled();
  });

  it('returns settings created by a concurrent request when default creation races', async () => {
    const prisma = createPrismaMock();
    const existingSettings = {
      id: 12,
      user_id: 7,
      budget_alerts_enabled: true,
      budget_expiring_enabled: true,
      system_notifications_enabled: true,
    };
    prisma.notification_settings.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existingSettings);
    prisma.notification_settings.create.mockRejectedValue(
      createDuplicateError(),
    );
    const service = new NotificationsService(prisma as never);

    await expect(service.getSettings(7)).resolves.toEqual(existingSettings);
    expect(prisma.notification_settings.findUnique).toHaveBeenCalledTimes(2);
  });

  it('soft deletes only notifications owned by the user', async () => {
    const prisma = createPrismaMock();
    prisma.notifications.updateMany.mockResolvedValue({ count: 1 });
    const service = new NotificationsService(prisma as never);

    await expect(service.deleteOne(5, 10)).resolves.toEqual({
      message: 'Đã xóa thông báo',
    });
    expect(prisma.notifications.updateMany).toHaveBeenCalledWith({
      where: { id: 10, user_id: 5, deleted_at: null },
      data: { deleted_at: expect.any(Date) },
    });
  });

  it('creates broadcast recipients only for active users with system notifications enabled', async () => {
    const prisma = createPrismaMock();
    prisma.$transaction.mockImplementation(async (callback) =>
      callback({
        notification_broadcasts: prisma.notification_broadcasts,
        notifications: prisma.notifications,
        admin_logs: prisma.admin_logs,
        $queryRaw: prisma.$queryRaw,
      }),
    );
    prisma.notification_broadcasts.create.mockResolvedValue({
      id: 99,
      title: 'Bảo trì',
      message: 'Hệ thống bảo trì tối nay',
      severity: 'INFO',
      admin_id: 1,
      created_at: new Date('2026-05-22T08:00:00.000Z'),
    });
    prisma.$queryRaw.mockResolvedValue([{ id: 2 }, { id: 3 }]);
    prisma.notifications.create.mockResolvedValue({});
    const service = new NotificationsService(prisma as never);

    await expect(
      service.createBroadcast(1, {
        title: 'Bảo trì',
        message: 'Hệ thống bảo trì tối nay',
        severity: 'INFO',
      }),
    ).resolves.toMatchObject({ id: 99, recipientCount: 2 });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(prisma.notifications.create).toHaveBeenCalledTimes(2);
    expect(prisma.notifications.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        user_id: 2,
        broadcast_id: 99,
        type: 'SYSTEM',
        dedupe_key: 'broadcast:99',
      }),
    });
    expect(prisma.notifications.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        user_id: 3,
        broadcast_id: 99,
        type: 'SYSTEM',
        dedupe_key: 'broadcast:99',
      }),
    });
  });

  it('uses the transaction client for broadcast fan-out and admin log writes', async () => {
    const prisma = createPrismaMock();
    const tx = createPrismaMock();
    prisma.$transaction.mockImplementation(async (callback) => callback(tx));
    tx.notification_broadcasts.create.mockResolvedValue({
      id: 100,
      title: 'System',
      message: 'Maintenance',
      severity: 'WARNING',
      admin_id: 1,
      created_at: new Date('2026-05-22T08:00:00.000Z'),
    });
    tx.$queryRaw.mockResolvedValue([{ id: 4 }]);
    tx.notifications.create.mockResolvedValue({});
    const service = new NotificationsService(prisma as never);

    await expect(
      service.createBroadcast(1, {
        title: 'System',
        message: 'Maintenance',
        severity: 'WARNING',
      }),
    ).resolves.toMatchObject({ id: 100, recipientCount: 1 });

    expect(prisma.notification_broadcasts.create).not.toHaveBeenCalled();
    expect(prisma.notifications.create).not.toHaveBeenCalled();
    expect(prisma.admin_logs.create).not.toHaveBeenCalled();
    expect(tx.notification_broadcasts.create).toHaveBeenCalledTimes(1);
    expect(tx.notifications.create).toHaveBeenCalledTimes(1);
    expect(tx.admin_logs.create).toHaveBeenCalledTimes(1);
  });

  it('rejects a broadcast whose title and message already exist', async () => {
    const prisma = createPrismaMock();
    prisma.notification_broadcasts.findFirst.mockResolvedValue({ id: 88 });
    const service = new NotificationsService(prisma as never);

    await expect(
      service.createBroadcast(1, {
        title: 'Thông báo kiểm tra',
        message: 'asdas',
      }),
    ).rejects.toThrow('Thông báo có cùng tiêu đề và nội dung đã tồn tại');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('allows test content when it does not duplicate an existing broadcast', async () => {
    const prisma = createPrismaMock();
    prisma.notification_broadcasts.findFirst.mockResolvedValue(null);
    prisma.$transaction.mockImplementation(async (callback) =>
      callback({
        notification_broadcasts: prisma.notification_broadcasts,
        notifications: prisma.notifications,
        admin_logs: prisma.admin_logs,
        $queryRaw: prisma.$queryRaw,
      }),
    );
    prisma.notification_broadcasts.create.mockResolvedValue({
      id: 89,
      title: 'Thông báo kiểm tra',
      message: 'asdas',
    });
    prisma.$queryRaw.mockResolvedValue([]);
    const service = new NotificationsService(prisma as never);

    await expect(
      service.createBroadcast(1, {
        title: 'Thông báo kiểm tra',
        message: 'asdas',
      }),
    ).resolves.toMatchObject({ id: 89 });
  });

  it('normalizes invalid notification list pagination values', async () => {
    const prisma = createPrismaMock();
    prisma.notifications.findMany.mockResolvedValue([]);
    prisma.notifications.count.mockResolvedValue(0);
    const service = new NotificationsService(prisma as never);

    await expect(
      service.list(5, {
        page: Number.NaN,
        limit: Number.POSITIVE_INFINITY,
      }),
    ).resolves.toMatchObject({
      meta: { page: 1, limit: 20, total: 0, totalPages: 1 },
    });
    expect(prisma.notifications.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 20 }),
    );
  });

  it('normalizes invalid broadcast list pagination values', async () => {
    const prisma = createPrismaMock();
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.notification_broadcasts.count.mockResolvedValue(0);
    const service = new NotificationsService(prisma as never);

    await expect(
      service.listBroadcasts({
        page: Number.NEGATIVE_INFINITY,
        limit: 0,
      }),
    ).resolves.toMatchObject({
      meta: { page: 1, limit: 10, total: 0, totalPages: 1 },
    });
    expect(prisma.$queryRaw).toHaveBeenCalled();
  });

  it('recalls broadcast notifications and writes an admin log', async () => {
    const prisma = createPrismaMock();
    const tx = createPrismaMock();
    prisma.$transaction.mockImplementation(async (callback) => callback(tx));
    tx.$queryRaw.mockResolvedValue([{ id: 99, revoked_at: null }]);
    tx.$executeRaw.mockResolvedValue(1);
    tx.notifications.updateMany.mockResolvedValue({ count: 3 });
    const service = new NotificationsService(prisma as never);

    await expect(service.recallBroadcast(1, 99)).resolves.toEqual({
      message: 'Đã thu hồi thông báo.',
      revokedCount: 3,
    });

    expect(tx.notifications.updateMany).toHaveBeenCalledWith({
      where: { broadcast_id: 99, deleted_at: null },
      data: { deleted_at: expect.any(Date) },
    });
    expect(tx.admin_logs.create).toHaveBeenCalledWith({
      data: {
        admin_id: 1,
        action: 'Admin thu hồi thông báo hệ thống (id: 99)',
      },
    });
  });

  it('ignores duplicate notification writes', async () => {
    const prisma = createPrismaMock();
    prisma.notifications.create.mockRejectedValue(createDuplicateError());
    const service = new NotificationsService(prisma as never);

    await expect(
      service.createForUser({
        userId: 1,
        type: 'BUDGET_EXCEEDED',
        severity: 'CRITICAL',
        title: 'Vượt ngân sách',
        message: 'Ví chính đã vượt ngân sách.',
        sourceType: 'budget',
        sourceId: 4,
        dedupeKey: 'budget-exceeded:4:2026-05-31',
      }),
    ).resolves.toEqual(null);
  });

  it('creates budget warning and exceeded notifications from current budget spend', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-17T08:00:00.000Z'));
    const prisma = createPrismaMock();
    const budgetsService = {
      findAll: jest.fn().mockResolvedValue([
        {
          id: 10,
          name: 'Groceries',
          wallet_name: 'Main wallet',
          limit_amount: 1000,
          available_limit_amount: 1000,
          spent: 850,
          status: 'WARNING',
          start_date: new Date('2026-06-01T00:00:00.000Z'),
          end_date: new Date('2026-06-30T12:00:00'),
        },
        {
          id: 11,
          name: 'Travel',
          wallet_name: 'Main wallet',
          limit_amount: 1000,
          available_limit_amount: 800,
          spent: 900,
          status: 'EXCEEDED',
          start_date: new Date('2026-06-01T00:00:00.000Z'),
          end_date: new Date('2026-06-30T12:00:00'),
        },
        {
          id: 12,
          name: 'Ignored',
          wallet_name: 'Main wallet',
          limit_amount: 1000,
          available_limit_amount: 1000,
          spent: 200,
          status: 'NORMAL',
          start_date: new Date('2026-06-01T00:00:00.000Z'),
          end_date: new Date('2026-06-30T12:00:00'),
        },
        {
          id: 13,
          name: 'Exact limit',
          wallet_name: 'Main wallet',
          limit_amount: 1500,
          available_limit_amount: 1500,
          spent: 1500,
          status: 'WARNING',
          start_date: new Date('2026-06-01T00:00:00.000Z'),
          end_date: new Date('2026-06-30T12:00:00'),
        },
      ]),
    };
    prisma.notification_settings.findUnique.mockResolvedValue({
      user_id: 7,
      budget_alerts_enabled: true,
      budget_expiring_enabled: true,
      system_notifications_enabled: true,
    });
    prisma.notifications.create.mockResolvedValue({});
    const service = new NotificationsService(
      prisma as never,
      budgetsService as never,
    );

    await service.createBudgetAlertsForWallet(7, 3);

    expect(budgetsService.findAll).toHaveBeenCalledWith(7, 3);
    expect(prisma.notifications.create).toHaveBeenCalledTimes(3);
    expect(prisma.notifications.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        user_id: 7,
        type: 'BUDGET_WARNING',
        severity: 'WARNING',
        title: 'Cảnh báo ngân sách',
        message: 'Groceries trong Main wallet đã đạt 80% ngân sách.',
        source_type: 'budget',
        source_id: 10,
        dedupe_key: 'budget-warning:10:2026-06-30:80',
      }),
    });
    expect(prisma.notifications.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        user_id: 7,
        type: 'BUDGET_EXCEEDED',
        severity: 'CRITICAL',
        title: 'Vượt ngân sách',
        message: 'Travel trong Main wallet đã vượt ngân sách.',
        source_type: 'budget',
        source_id: 11,
        dedupe_key: 'budget-exceeded:11:2026-06-30',
      }),
    });
    expect(prisma.notifications.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        user_id: 7,
        type: 'BUDGET_WARNING',
        severity: 'WARNING',
        source_id: 13,
        dedupe_key: 'budget-warning:13:2026-06-30:80',
      }),
    });
  });

  it('returns expiring budget scan and created counts while ignoring duplicates', async () => {
    const prisma = createPrismaMock();
    prisma.$queryRaw.mockResolvedValue([
      {
        id: 21,
        user_id: 7,
        name: 'Weekly food',
        wallet_name: 'Main wallet',
        end_date: new Date('2026-05-23T00:00:00.000Z'),
      },
      {
        id: 22,
        user_id: 8,
        name: 'Monthly travel',
        wallet_name: 'Trip wallet',
        end_date: new Date('2026-05-25T00:00:00.000Z'),
      },
    ]);
    prisma.notifications.create
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(createDuplicateError());
    const service = new NotificationsService(prisma as never);

    await expect(service.createExpiringBudgetNotifications()).resolves.toEqual({
      scannedCount: 2,
      createdCount: 1,
    });

    expect(String(prisma.$queryRaw.mock.calls[0][0])).toContain(
      'AND w.user_id = b.user_id',
    );
    expect(String(prisma.$queryRaw.mock.calls[0][0])).toContain(
      "b.period = 'QUARTER'",
    );
    expect(prisma.notifications.create).toHaveBeenCalledTimes(2);
    expect(prisma.notifications.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        user_id: 7,
        type: 'BUDGET_EXPIRING',
        severity: 'WARNING',
        title: 'Ngân sách sắp hết hạn',
        message: 'Weekly food trong Main wallet sẽ hết hạn vào 2026-05-23.',
        source_type: 'budget',
        source_id: 21,
        dedupe_key: 'budget-expiring:21:2026-05-23',
      }),
    });
  });

  it('creates separate cashflow and savings plan alerts', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-20T08:00:00.000Z'));
    const prisma = createPrismaMock();
    prisma.$queryRaw.mockResolvedValue([
      {
        id: 7,
        cashflow_forecast_enabled: 1,
        savings_plan_alerts_enabled: 1,
      },
    ]);
    prisma.notifications.create.mockResolvedValue({});
    const financialPlansService = {
      getOverview: jest.fn().mockResolvedValue({
        cashflow_plans: [
          {
            currency: 'VND',
            summary: {
              status: 'RISK',
              forecast_average_income: 5_000_000,
              forecast_average_expense: 7_000_000,
            },
          },
        ],
        savings_plans: [
          {
            id: 4,
            name: 'Mua laptop',
            currency: 'VND',
            status: 'BEHIND',
            monthly_gap: 500_000,
            remaining_amount: 5_000_000,
          },
        ],
      }),
    };
    const service = new NotificationsService(
      prisma as never,
      undefined,
      financialPlansService as never,
    );

    await expect(service.createFinancialPlanNotifications()).resolves.toEqual({
      scannedCount: 1,
      createdCount: 2,
    });
    expect(prisma.notifications.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        source_type: 'cashflow_forecast',
        dedupe_key: 'cashflow-forecast:2026-09:VND:RISK',
      }),
    });
    expect(prisma.notifications.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        source_type: 'savings_goal',
        source_id: 4,
        dedupe_key: 'savings-plan:4:2026-09:BEHIND',
      }),
    });
  });

  it('skips budget alert scans when settings disable them', async () => {
    const prisma = createPrismaMock();
    prisma.notification_settings.findUnique.mockResolvedValue({
      user_id: 7,
      budget_alerts_enabled: false,
      budget_expiring_enabled: true,
      system_notifications_enabled: true,
    });
    const service = new NotificationsService(prisma as never);

    await service.createBudgetAlertsForWallet(7, 3);

    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.notifications.create).not.toHaveBeenCalled();
  });
});
