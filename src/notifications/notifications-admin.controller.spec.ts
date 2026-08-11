/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
import { Test, TestingModule } from '@nestjs/testing';
import { AdminGuard } from '../auth/admin.guard';
import { JwtGuard } from '../auth/jwt.guard';
import { NotificationsAdminController } from './notifications-admin.controller';
import { CreateBroadcastDto } from './dto/create-broadcast.dto';
import { NotificationsService } from './notifications.service';

describe('NotificationsAdminController', () => {
  let controller: NotificationsAdminController;
  let service: { createBroadcast: jest.Mock; recallBroadcast: jest.Mock };

  beforeEach(async () => {
    service = {
      createBroadcast: jest.fn().mockResolvedValue({ id: 7 }),
      recallBroadcast: jest.fn().mockResolvedValue({
        message: 'Đã thu hồi thông báo.',
        revokedCount: 4,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsAdminController],
      providers: [
        {
          provide: NotificationsService,
          useValue: service,
        },
      ],
    })
      .overrideGuard(JwtGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    controller = module.get<NotificationsAdminController>(
      NotificationsAdminController,
    );
  });

  it('passes authenticated admin id and dto to createBroadcast', async () => {
    const req = { user: { userId: 99 } } as any;
    const dto: CreateBroadcastDto = {
      title: 'Maintenance',
      message: 'Scheduled window tonight',
      severity: 'INFO',
    };

    await expect(controller.createBroadcast(req, dto)).resolves.toEqual({
      id: 7,
    });

    expect(service.createBroadcast).toHaveBeenCalledWith(99, dto);
  });

  it('passes authenticated admin id and broadcast id to recallBroadcast', async () => {
    const req = { user: { userId: 99 } } as any;

    await expect(controller.recallBroadcast(req, 7)).resolves.toEqual({
      message: 'Đã thu hồi thông báo.',
      revokedCount: 4,
    });

    expect(service.recallBroadcast).toHaveBeenCalledWith(99, 7);
  });
});
