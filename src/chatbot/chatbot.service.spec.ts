import { BudgetsService } from '../budgets/budgets.service';
import { FinancialPlansService } from '../financial-plans/financial-plans.service';
import { LoanDebtsService } from '../loan-debts/loan-debts.service';
import { PrismaService } from '../prisma/prisma.service';
import { SavingsService } from '../savings/savings.service';
import { ChatbotService } from './chatbot.service';
import { GeminiClient } from './gemini.client';

describe('ChatbotService', () => {
  it('paginates older conversation messages with a stable id cursor', async () => {
    const rows = Array.from({ length: 11 }, (_, index) => ({
      id: 50 - index,
      user_id: 7,
      conversation_id: 11,
      role: index % 2 ? 'ASSISTANT' : 'USER',
      content: `Tin nhắn ${50 - index}`,
      category_spending: null,
      context_window_days: null,
      created_at: new Date(
        `2026-09-02T00:${String(50 - index).padStart(2, '0')}:00.000Z`,
      ),
    }));
    const findMany = jest.fn().mockResolvedValue(rows);
    const prisma = {
      chatbot_conversations: {
        findFirst: jest.fn().mockResolvedValue({
          id: 11,
          title: 'Kiểm tra phân trang',
          created_at: new Date('2026-09-02T00:00:00.000Z'),
          updated_at: new Date('2026-09-02T01:00:00.000Z'),
        }),
      },
      chatbot_messages: { findMany },
    } as unknown as PrismaService;
    const service = new ChatbotService(
      prisma,
      {} as BudgetsService,
      {} as LoanDebtsService,
      {} as SavingsService,
      {} as FinancialPlansService,
      {} as GeminiClient,
    );

    const result = await service.getConversationHistory(7, 11, 10, 51);

    expect(findMany).toHaveBeenCalledWith({
      where: {
        user_id: 7,
        conversation_id: 11,
        id: { lt: 51 },
      },
      orderBy: { id: 'desc' },
      take: 11,
    });
    expect(result.messages.map((message) => message.id)).toEqual([
      41, 42, 43, 44, 45, 46, 47, 48, 49, 50,
    ]);
    expect(result.has_more).toBe(true);
    expect(result.next_cursor).toBe(41);
  });

  it('sends aggregated context without private profile or debt-person fields', async () => {
    let messageId = 0;
    const createMessage = jest.fn(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: ++messageId,
          category_spending: null,
          context_window_days: null,
          created_at: new Date('2026-09-02T00:00:00.000Z'),
          ...data,
        }),
    );
    const prisma = {
      users: {
        findFirst: jest.fn().mockResolvedValue({
          id: 7,
          role: 'BASIC',
          currency_default: 'VND',
        }),
      },
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          { month: '2026-08', currency: 'VND', income: 10, expense: 4 },
        ])
        .mockResolvedValueOnce([
          {
            category_id: 3,
            category: 'Ăn uống',
            icon: 'categories/icons/food.png',
            currency: 'VND',
            amount: 4,
          },
        ])
        .mockResolvedValueOnce([
          {
            wallet_type: 'BANK',
            currency: 'VND',
            wallet_count: 1,
            balance: 6,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: 91,
            note: 'Tiền thuê nhà tháng 9',
            transaction_date: new Date('2026-09-01T00:00:00.000Z'),
            category_id: 8,
            category: 'Nhà ở',
            category_icon: 'categories/icons/home.png',
            wallet: 'Ngân hàng chính',
            currency: 'VND',
            amount: 4_800_000,
            type: 'EXPENSE',
            cash_flow_group: 'NORMAL',
          },
        ]),
      chatbot_conversations: {
        findFirst: jest.fn(),
        create: jest.fn().mockResolvedValue({
          id: 11,
          user_id: 7,
          title: 'Tôi chi vào danh mục nào?',
          created_at: new Date('2026-09-02T00:00:00.000Z'),
          updated_at: new Date('2026-09-02T00:00:00.000Z'),
        }),
        update: jest.fn(),
      },
      chatbot_messages: { create: createMessage },
      $transaction: jest.fn(
        (operation: (client: Record<string, unknown>) => Promise<unknown>) =>
          operation(prisma as unknown as Record<string, unknown>),
      ),
    } as unknown as PrismaService;
    const budgets = {
      findAll: jest.fn().mockResolvedValue({ data: [], meta: {} }),
    } as unknown as BudgetsService;
    const debts = {
      findAll: jest.fn().mockResolvedValue([
        {
          type: 'BORROWED',
          currency: 'VND',
          remaining_amount: 3,
          due_date: null,
          status: 'OPEN',
          person_name: 'PRIVATE PERSON',
          note: 'PRIVATE NOTE',
        },
      ]),
    } as unknown as LoanDebtsService;
    const savings = {
      getAssistantContext: jest.fn().mockResolvedValue({
        active_goal_count: 0,
        completed_goal_count: 0,
        currency_summaries: [],
        goals: [],
      }),
    } as unknown as SavingsService;
    const financialPlans = {
      getOverview: jest.fn().mockResolvedValue({
        methodology: { history_months: 4, forecast_months: 4 },
        cashflow_plans: [],
        savings_plans: [],
      }),
    } as unknown as FinancialPlansService;
    let capturedInstructions = '';
    const respond = jest.fn((input: { instructions: string }) => {
      capturedInstructions = input.instructions;
      return Promise.resolve({
        message: 'Bạn đang chi ít hơn thu.',
        response_id: 'resp_1',
        model: 'test-model',
      });
    });
    const gemini = {
      respond,
    } as unknown as GeminiClient;
    const service = new ChatbotService(
      prisma,
      budgets,
      debts,
      savings,
      financialPlans,
      gemini,
    );

    const result = await service.send(7, {
      message: 'Tôi chi vào danh mục nào?',
    });

    expect(capturedInstructions).toContain('"monthly_cash_flow"');
    expect(capturedInstructions).toContain('"top_expense_categories"');
    expect(capturedInstructions).toContain('"recent_transactions"');
    expect(capturedInstructions).toContain('Tiền thuê nhà tháng 9');
    expect(capturedInstructions).toContain(
      'không yêu cầu người dùng tự mở lịch sử',
    );
    expect(capturedInstructions).toContain('"financial_plan"');
    expect(capturedInstructions).not.toContain('PRIVATE PERSON');
    expect(capturedInstructions).not.toContain('PRIVATE NOTE');
    expect(result.category_spending).toEqual([
      {
        category_id: 3,
        category: 'Ăn uống',
        icon: 'categories/icons/food.png',
        currency: 'VND',
        amount: 4,
      },
    ]);
    expect(createMessage).toHaveBeenCalledTimes(2);
    expect(result.user_message.role).toBe('user');
    expect(result.assistant_message.role).toBe('assistant');
    jest.spyOn(prisma, '$queryRaw').mockResolvedValue([]);
    const planned = await service.send(7, {
      message: 'Gợi ý 3 kế hoạch tài chính',
    });
    expect(respond).toHaveBeenCalledTimes(1);
    expect(planned.message).toContain('Chưa có dữ liệu thu chi');
    expect(planned.assistant_message.content).toBe(planned.message);
  });
});
