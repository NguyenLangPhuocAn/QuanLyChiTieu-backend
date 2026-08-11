import { Test, TestingModule } from '@nestjs/testing';
import { CategoriesService } from './categories.service';
import { PrismaService } from '../prisma/prisma.service';

describe('CategoriesService', () => {
  let service: CategoriesService;
  const prisma = {
    users: {
      findUnique: jest.fn(),
    },
    categories: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoriesService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    service = module.get<CategoriesService>(CategoriesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('lists system and own categories for admin in the mobile API', async () => {
    prisma.users.findUnique.mockResolvedValue({ id: 7, role: 'ADMIN' });
    prisma.categories.findMany.mockResolvedValue([]);

    await service.findAll(7);

    expect(prisma.categories.findMany).toHaveBeenCalledWith({
      where: {
        AND: [
          { OR: [{ is_active: true }, { is_active: null }] },
          { OR: [{ is_system: true }, { user_id: 7 }] },
        ],
      },
      orderBy: { id: 'desc' },
    });
  });

  it('deduplicates active system categories with the same name and type', async () => {
    prisma.users.findUnique.mockResolvedValue({ id: 7, role: 'ADMIN' });
    prisma.categories.findMany.mockResolvedValue([
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
    ]);

    await expect(service.findAll(7)).resolves.toEqual([
      expect.objectContaining({ id: 3, name: 'Ăn uống' }),
    ]);
  });

  it('blocks a premium user from creating a personal category that duplicates a visible system category', async () => {
    prisma.users.findUnique.mockResolvedValue({ id: 7, role: 'PREMIUM' });
    prisma.categories.findFirst.mockResolvedValue({
      id: 1,
      name: 'ăn uống',
      type: 'EXPENSE',
      is_system: true,
    });

    await expect(
      service.create(7, { name: ' Ăn uống ', type: 'EXPENSE' }),
    ).rejects.toThrow('Danh mục đã tồn tại');

    expect(prisma.categories.findFirst).toHaveBeenCalledWith({
      where: {
        name: 'ăn uống',
        type: 'EXPENSE',
        AND: [
          { OR: [{ is_active: true }, { is_active: null }] },
          { OR: [{ is_system: true }, { user_id: 7 }] },
        ],
      },
    });
    expect(prisma.categories.create).not.toHaveBeenCalled();
  });

  it('allows different premium users to use the same personal category name', async () => {
    prisma.users.findUnique.mockResolvedValue({ id: 8, role: 'PREMIUM' });
    prisma.categories.findFirst.mockResolvedValue(null);
    prisma.categories.create.mockResolvedValue({
      id: 10,
      name: 'gym',
      type: 'EXPENSE',
      is_system: false,
      user_id: 8,
    });

    await service.create(8, { name: 'Gym', type: 'EXPENSE' });

    expect(prisma.categories.findFirst).toHaveBeenCalledWith({
      where: {
        name: 'gym',
        type: 'EXPENSE',
        AND: [
          { OR: [{ is_active: true }, { is_active: null }] },
          { OR: [{ is_system: true }, { user_id: 8 }] },
        ],
      },
    });
    expect(prisma.categories.create).toHaveBeenCalledWith({
      data: {
        name: 'gym',
        type: 'EXPENSE',
        cash_flow_group: 'NORMAL',
        is_system: false,
        user_id: 8,
      },
    });
  });

  it('persists category cash flow group for loan and debt categories', async () => {
    prisma.users.findUnique.mockResolvedValue({ id: 8, role: 'PREMIUM' });
    prisma.categories.findFirst.mockResolvedValue(null);
    prisma.categories.create.mockResolvedValue({
      id: 11,
      name: 'tra no',
      type: 'EXPENSE',
      cash_flow_group: 'LOAN_DEBT',
      is_system: false,
      user_id: 8,
    });

    await service.create(8, {
      name: 'Tra no',
      type: 'EXPENSE',
      cash_flow_group: 'LOAN_DEBT',
    });

    expect(prisma.categories.create).toHaveBeenCalledWith({
      data: {
        name: 'tra no',
        type: 'EXPENSE',
        cash_flow_group: 'LOAN_DEBT',
        is_system: false,
        user_id: 8,
      },
    });
  });

  it('blocks updating a personal category to duplicate a visible system category', async () => {
    prisma.categories.findUnique.mockResolvedValue({
      id: 12,
      name: 'gym',
      type: 'EXPENSE',
      is_system: false,
      is_active: true,
      user_id: 7,
    });
    prisma.users.findUnique.mockResolvedValue({ id: 7, role: 'PREMIUM' });
    prisma.categories.findFirst.mockResolvedValue({
      id: 1,
      name: 'ăn uống',
      type: 'EXPENSE',
      is_system: true,
    });

    await expect(service.update(7, 12, { name: 'Ăn uống' })).rejects.toThrow(
      'Danh mục đã tồn tại',
    );

    expect(prisma.categories.findFirst).toHaveBeenCalledWith({
      where: {
        name: 'ăn uống',
        type: 'EXPENSE',
        AND: [
          { OR: [{ is_active: true }, { is_active: null }] },
          { OR: [{ is_system: true }, { user_id: 7 }] },
        ],
        NOT: { id: 12 },
      },
    });
    expect(prisma.categories.update).not.toHaveBeenCalled();
  });

  it('treats admin as a premium user on mobile category updates', async () => {
    prisma.categories.findUnique.mockResolvedValue({
      id: 22,
      name: 'gym',
      type: 'EXPENSE',
      is_system: false,
      is_active: true,
      user_id: 99,
    });
    prisma.users.findUnique.mockResolvedValue({ id: 7, role: 'ADMIN' });
    prisma.categories.findFirst.mockResolvedValue(null);

    await expect(service.update(7, 22, { name: 'gym pro' })).rejects.toThrow(
      'Không có quyền',
    );

    expect(prisma.categories.update).not.toHaveBeenCalled();
  });

  it('does not let admin create a system category through the mobile API', async () => {
    prisma.users.findUnique.mockResolvedValue({ id: 7, role: 'ADMIN' });
    prisma.categories.findFirst.mockResolvedValue(null);
    prisma.categories.create.mockResolvedValue({
      id: 23,
      name: 'gym',
      type: 'EXPENSE',
      is_system: false,
      user_id: 7,
    });

    await service.create(7, {
      name: 'Gym',
      type: 'EXPENSE',
      is_system: true,
    });

    expect(prisma.categories.create).toHaveBeenCalledWith({
      data: {
        name: 'gym',
        type: 'EXPENSE',
        cash_flow_group: 'NORMAL',
        is_system: false,
        user_id: 7,
      },
    });
  });
});
