/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
import { Test, TestingModule } from '@nestjs/testing';
import { JwtGuard } from '../auth/jwt.guard';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

describe('NotificationsController', () => {
  let controller: NotificationsController;
  let service: { unreadCount: jest.Mock };

  beforeEach(async () => {
    service = {
      unreadCount: jest.fn().mockResolvedValue({ count: 3 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [
        {
          provide: NotificationsService,
          useValue: service,
        },
      ],
    })
      .overrideGuard(JwtGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    controller = module.get<NotificationsController>(NotificationsController);
  });

  it('passes authenticated user id to unreadCount', async () => {
    const req = { user: { userId: 42 } } as any;

    await expect(controller.unreadCount(req)).resolves.toEqual({ count: 3 });

    expect(service.unreadCount).toHaveBeenCalledWith(42);
  });
});
