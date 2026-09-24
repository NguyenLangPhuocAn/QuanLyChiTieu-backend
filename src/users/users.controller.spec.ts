import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { CurrencyService } from '../currency/currency.service';
import { PrismaService } from '../prisma/prisma.service';
import { Logger } from '@nestjs/common';

describe('UsersController', () => {
  let controller: UsersController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        UsersService,
        CurrencyService,
        {
          provide: PrismaService,
          useValue: {
            admin_logs: {
              create: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('returns the committed password-change result when the activity log fails', async () => {
    const result = { message: 'Đã đổi mật khẩu', forceLogout: true };
    const changePassword = jest.fn().mockResolvedValue(result);
    const createLog = jest
      .fn()
      .mockRejectedValue(new Error('database temporarily unavailable'));
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    try {
      const subject = new UsersController(
        { changePassword } as unknown as UsersService,
        { admin_logs: { create: createLog } } as unknown as PrismaService,
      );
      const request = { user: { userId: 7 } } as Parameters<
        UsersController['changePassword']
      >[0];
      const payload = {
        oldPassword: 'OldPassword1!',
        newPassword: 'NewPassword2!',
        confirmPassword: 'NewPassword2!',
      };
      await expect(subject.changePassword(request, payload)).resolves.toBe(
        result,
      );
      expect(changePassword).toHaveBeenCalledTimes(1);
      expect(createLog).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        'Account action succeeded, but its activity log could not be written.',
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('still reports the actual profile mutation failure and does not write a success log', async () => {
    const createLog = jest.fn();
    const subject = new UsersController(
      {
        updateProfile: jest
          .fn()
          .mockRejectedValue(new Error('Profile update failed')),
      } as unknown as UsersService,
      { admin_logs: { create: createLog } } as unknown as PrismaService,
    );
    const request = { user: { userId: 7 } } as Parameters<
      UsersController['updateProfile']
    >[0];
    await expect(
      subject.updateProfile(request, { full_name: 'Test' }),
    ).rejects.toThrow('Profile update failed');
    expect(createLog).not.toHaveBeenCalled();
  });
});
