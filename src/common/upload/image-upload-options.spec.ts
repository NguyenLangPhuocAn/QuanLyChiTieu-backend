import { BadRequestException } from '@nestjs/common';
import { existsSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import {
  IMAGE_UPLOAD_LIMITS,
  createImageUploadOptions,
  deleteUploadedFile,
  generateSafeUploadFilename,
  imageFileFilter,
} from './image-upload-options';

describe('image upload options', () => {
  const imageFile = {
    originalname: 'receipt.JPG',
    mimetype: 'image/jpeg',
  } as Express.Multer.File;

  it('sets explicit file-size limits for every image upload flow', () => {
    expect(IMAGE_UPLOAD_LIMITS.avatar.fileSize).toBe(5 * 1024 * 1024);
    expect(IMAGE_UPLOAD_LIMITS.receipt.fileSize).toBe(10 * 1024 * 1024);
    expect(IMAGE_UPLOAD_LIMITS.categoryIcon.fileSize).toBe(2 * 1024 * 1024);
  });

  it('builds disk-backed multer options with a file-size limit', () => {
    const options = createImageUploadOptions({
      destination: 'uploads/tmp-test',
      fileSize: IMAGE_UPLOAD_LIMITS.categoryIcon.fileSize,
    });

    expect(options.storage).toBeDefined();
    expect(options.limits).toEqual({
      fileSize: IMAGE_UPLOAD_LIMITS.categoryIcon.fileSize,
      files: 1,
    });

    const cb = jest.fn();
    options.fileFilter?.({} as never, imageFile, cb);
    expect(cb).toHaveBeenCalledWith(null, true);
  });

  it('accepts supported image mime types and extensions', () => {
    const cb = jest.fn();

    imageFileFilter({} as never, imageFile, cb);

    expect(cb).toHaveBeenCalledWith(null, true);
  });

  it('rejects mismatched or unsupported upload files', () => {
    const cb = jest.fn();

    imageFileFilter(
      {} as never,
      {
        originalname: 'receipt.png',
        mimetype: 'application/pdf',
      } as Express.Multer.File,
      cb,
    );

    expect(cb).toHaveBeenCalledWith(expect.any(BadRequestException), false);
  });

  it('generates a normalized filename from the original extension only', () => {
    expect(generateSafeUploadFilename(imageFile)).toMatch(
      /^\d+-[0-9a-f-]+\.jpg$/,
    );
  });

  it('deletes disk-backed uploads when the request fails after multer writes', async () => {
    const tempDir = join(process.cwd(), 'uploads', 'tmp', 'upload-test');
    const tempPath = join(tempDir, 'orphan.png');
    await mkdir(tempDir, { recursive: true });
    await writeFile(tempPath, 'temporary image bytes');

    await deleteUploadedFile({ path: tempPath } as Express.Multer.File);

    expect(existsSync(tempPath)).toBe(false);
  });
});
