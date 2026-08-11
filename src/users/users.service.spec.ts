/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UsersService } from './users.service';
import { CurrencyService } from '../currency/currency.service';
import { PrismaService } from '../prisma/prisma.service';

describe('UsersService', () => {
  let service: UsersService;
  const activeUser = {
    id: 7,
    email: 'user@gmail.com',
    password: '$2b$04$hash',
    role: 'BASIC',
    is_active: true,
    must_change_password: false,
  };
  const prisma = {
    users: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    password_resets: {
      create: jest.fn(),
      deleteMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    wallets: {
      count: jest.fn(),
    },
    admin_logs: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
    $executeRaw: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (callback: unknown) => {
      if (typeof callback === 'function') {
        return callback(prisma);
      }
      return callback;
    });
    prisma.wallets.count.mockResolvedValue(0);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        CurrencyService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    jest
      .spyOn(
        service as unknown as { sendMail: UsersService['sendMail'] },
        'sendMail',
      )
      .mockResolvedValue({
        delivered: true,
        devOnly: false,
      });
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('returns a generic message for unknown forgot-password email', async () => {
    prisma.users.findUnique.mockResolvedValueOnce(null);

    const result = await service.forgotPassword('missing@gmail.com');

    expect(result.message).toBe(
      'Nếu email tồn tại, hệ thống đã gửi mã xác nhận.',
    );
    expect(prisma.password_resets.create).not.toHaveBeenCalled();
    expect(service['sendMail']).not.toHaveBeenCalled();
  });

  it('stores a hashed OTP and sends an OTP email for an existing account', async () => {
    prisma.users.findUnique.mockResolvedValueOnce(activeUser);
    prisma.password_resets.create.mockResolvedValueOnce({ id: 12 });

    const result = await service.forgotPassword(' USER@gmail.com ');

    expect(result.message).toBe(
      'Nếu email tồn tại, hệ thống đã gửi mã xác nhận.',
    );
    expect(prisma.users.update).not.toHaveBeenCalled();
    expect(prisma.password_resets.deleteMany).toHaveBeenCalledWith({
      where: { email: activeUser.email },
    });
    expect(prisma.password_resets.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: activeUser.email,
        attempt_count: 0,
        used_at: null,
        reset_token_hash: null,
        reset_token_expired_at: null,
        reset_token_used_at: null,
      }),
    });
    const createArgs = prisma.password_resets.create.mock.calls[0][0];
    expect(createArgs.data.token).not.toMatch(/^\d{6}$/);
    expect(createArgs.data.expired_at.getTime()).toBeGreaterThan(Date.now());
    expect(service['sendMail']).toHaveBeenCalledWith(
      activeUser.email,
      expect.stringContaining('Mã xác nhận'),
      expect.stringMatching(/\d{6}/),
      expect.objectContaining({
        sensitive: true,
        html: expect.stringContaining('<html'),
      }),
    );
    const mailOptions = (service['sendMail'] as jest.Mock).mock.calls[0][3];
    expect(mailOptions.html).toContain('Quản tiền rõ ràng');
  });

  it('rejects an invalid OTP with the generic message and increments attempts', async () => {
    const hashedOtp = await bcrypt.hash('222222', 4);
    prisma.password_resets.findFirst.mockResolvedValueOnce({
      id: 20,
      email: activeUser.email,
      token: hashedOtp,
      expired_at: new Date(Date.now() + 60_000),
      used_at: null,
      attempt_count: 0,
    });

    await expect(
      service.verifyResetOtp(activeUser.email, '111111'),
    ).rejects.toThrow('Mã xác nhận không hợp lệ hoặc đã hết hạn.');

    expect(prisma.password_resets.update).toHaveBeenCalledWith({
      where: { id: 20 },
      data: { attempt_count: { increment: 1 } },
    });
  });

  it('returns a reset token for a valid OTP', async () => {
    const hashedOtp = await bcrypt.hash('123456', 4);
    prisma.password_resets.findFirst.mockResolvedValueOnce({
      id: 20,
      selector: 'selector',
      email: activeUser.email,
      token: hashedOtp,
      expired_at: new Date(Date.now() + 60_000),
      used_at: null,
      attempt_count: 1,
    });

    const result = await service.verifyResetOtp(activeUser.email, '123456');

    expect(result.reset_token).toEqual(expect.any(String));
    expect(result.reset_token).not.toBe('123456');
    expect(prisma.password_resets.update).toHaveBeenCalledWith({
      where: { id: 20 },
      data: expect.objectContaining({
        reset_token_hash: expect.any(String),
        reset_token_expired_at: expect.any(Date),
        reset_token_used_at: null,
      }),
    });
  });

  it('resets password with a one-time reset token and returns login tokens', async () => {
    const resetToken = 'selector.reset-secret';
    const hashedResetToken = await bcrypt.hash('reset-secret', 4);
    prisma.password_resets.findFirst.mockResolvedValueOnce({
      id: 20,
      email: activeUser.email,
      reset_token_hash: hashedResetToken,
      reset_token_expired_at: new Date(Date.now() + 60_000),
      reset_token_used_at: null,
      used_at: null,
    });
    prisma.users.findUnique.mockResolvedValueOnce(activeUser);
    prisma.password_resets.update.mockResolvedValueOnce({});
    prisma.users.update.mockResolvedValueOnce({});

    const result = await service.resetPassword({
      reset_token: resetToken,
      new_password: 'Password1!',
      confirm_password: 'Password1!',
    });

    expect(prisma.users.update).toHaveBeenCalledWith({
      where: { id: activeUser.id },
      data: {
        password: expect.stringMatching(/^\$2/),
        must_change_password: false,
      },
    });
    expect(prisma.password_resets.update).toHaveBeenCalledWith({
      where: { id: 20 },
      data: {
        used_at: expect.any(Date),
        reset_token_used_at: expect.any(Date),
      },
    });
    expect(result.accessToken).toEqual(expect.any(String));
    expect(result.refreshToken).toEqual(expect.any(String));
    expect(result.user).toEqual(
      expect.objectContaining({ email: activeUser.email }),
    );
  });

  it('does not allow a reset token to be reused', async () => {
    prisma.password_resets.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.resetPassword({
        reset_token: 'used-token',
        new_password: 'Password1!',
        confirm_password: 'Password1!',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('restores a deleted regular account on password login without deleting financial data', async () => {
    const password = 'Password1!';
    const deletedUser = {
      ...activeUser,
      password: await bcrypt.hash(password, 4),
      is_active: false,
      deleted_at: new Date('2026-05-01T00:00:00.000Z'),
    };
    prisma.users.findUnique.mockResolvedValueOnce(deletedUser);
    prisma.users.findUnique.mockResolvedValueOnce({
      ...deletedUser,
      is_active: true,
      deleted_at: null,
    });

    const result = await service.login(activeUser.email, password);

    expect(String(prisma.$executeRaw.mock.calls[0][0])).toContain(
      'SET is_active = 1',
    );
    expect(result.message).toBe('Khôi phục tài khoản thành công');
    expect(result.restored).toBe(true);
    expect(prisma.$executeRaw).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.stringContaining('INSERT INTO refresh_tokens'),
      ]),
      expect.any(Number),
      expect.any(String),
      expect.any(String),
      expect.any(Date),
    );
  });

  it('does not restore deleted admin accounts on password login', async () => {
    const password = 'Password1!';
    prisma.users.findUnique.mockResolvedValueOnce({
      ...activeUser,
      password: await bcrypt.hash(password, 4),
      role: 'ADMIN',
      is_active: false,
    });

    await expect(service.login(activeUser.email, password)).rejects.toThrow(
      'Tài khoản đã bị khóa',
    );

    expect(prisma.users.update).not.toHaveBeenCalled();
  });

  it('asks deleted regular accounts to restore by logging in when registering the same email', async () => {
    prisma.users.findUnique.mockResolvedValueOnce({
      ...activeUser,
      is_active: false,
    });

    await expect(
      service.create({
        email: activeUser.email,
        password: 'Password1!',
        confirmPassword: 'Password1!',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'ACCOUNT_RESTORE_REQUIRED',
      }),
    });

    expect(prisma.users.create).not.toHaveBeenCalled();
  });
});
