import { BadRequestException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { unlink } from 'fs/promises';
import { diskStorage } from 'multer';
import { extname, resolve } from 'path';

const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const allowedExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const uploadsRoot = resolve(process.cwd(), 'uploads');

export const IMAGE_UPLOAD_LIMITS = {
  avatar: { fileSize: 5 * 1024 * 1024 },
  receipt: { fileSize: 10 * 1024 * 1024 },
  categoryIcon: { fileSize: 2 * 1024 * 1024 },
} as const;

export function validateImageUploadFile(file?: Express.Multer.File) {
  if (!file) {
    throw new BadRequestException('Vui lòng chọn tệp');
  }

  const extension = extname(file.originalname).toLowerCase();

  if (
    !allowedMimeTypes.has(file.mimetype) ||
    !allowedExtensions.has(extension)
  ) {
    throw new BadRequestException('Chỉ cho phép tải lên tệp hình ảnh');
  }
}

export function imageFileFilter(
  _req: unknown,
  file: Express.Multer.File,
  cb: (error: Error | null, acceptFile: boolean) => void,
) {
  try {
    validateImageUploadFile(file);
    cb(null, true);
  } catch (error) {
    cb(error as Error, false);
  }
}

export function generateSafeUploadFilename(file: Express.Multer.File) {
  const extension = extname(file.originalname).toLowerCase();
  const normalizedExtension = extension === '.jpeg' ? '.jpg' : extension;

  return `${Date.now()}-${randomUUID()}${normalizedExtension}`;
}

export function createImageUploadOptions({
  destination,
  fileSize,
}: {
  destination: string;
  fileSize: number;
}): MulterOptions {
  return {
    storage: diskStorage({
      destination: (_req, _file, cb) => {
        mkdirSync(destination, { recursive: true });
        cb(null, destination);
      },
      filename: (_req, file, cb) => {
        cb(null, generateSafeUploadFilename(file));
      },
    }),
    fileFilter: imageFileFilter,
    limits: {
      fileSize,
      files: 1,
    },
  };
}

export async function deleteUploadedFile(file?: Express.Multer.File) {
  if (!file?.path) {
    return;
  }

  const targetPath = resolve(file.path);

  if (!targetPath.startsWith(uploadsRoot) || !existsSync(targetPath)) {
    return;
  }

  await unlink(targetPath).catch(() => undefined);
}
