import {
  BadRequestException,
  Controller,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { memoryStorage } from 'multer';
import { JwtGuard } from '../auth/jwt.guard';
import { PersonalBackupService } from './personal-backup.service';

type AuthenticatedRequest = Request & { user: { userId: number } };

const backupUpload = FileInterceptor('file', {
  storage: memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => {
    const accepted = file.originalname.toLowerCase().endsWith('.stcn-backup');
    callback(
      accepted
        ? null
        : new BadRequestException('Chỉ hỗ trợ file .stcn-backup.'),
      accepted,
    );
  },
});

@Controller('personal-backup')
@UseGuards(JwtGuard)
export class PersonalBackupController {
  constructor(private readonly service: PersonalBackupService) {}

  @Post('export')
  export(@Req() req: AuthenticatedRequest) {
    return this.service.export(req.user.userId);
  }

  @Post('preview')
  @UseInterceptors(backupUpload)
  preview(
    @Req() req: AuthenticatedRequest,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Vui lòng chọn file backup.');
    return this.service.preview(req.user.userId, file.buffer);
  }

  @Post('restore')
  @UseInterceptors(backupUpload)
  restore(
    @Req() req: AuthenticatedRequest,
    @UploadedFile() file: Express.Multer.File,
    @Query('rows') rows?: string,
    @Query('fileHash') fileHash?: string,
  ) {
    if (!file) throw new BadRequestException('Vui lòng chọn file backup.');
    const selectedRows = new Set(
      (rows ?? '')
        .split(',')
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value >= 1),
    );
    if (selectedRows.size === 0) {
      throw new BadRequestException('Chưa chọn giao dịch nào để khôi phục.');
    }
    if (selectedRows.size > 1000) {
      throw new BadRequestException(
        'Mỗi lần chỉ khôi phục tối đa 1.000 giao dịch.',
      );
    }
    return this.service.restore(
      req.user.userId,
      file.buffer,
      selectedRows,
      fileHash ?? '',
    );
  }
}
