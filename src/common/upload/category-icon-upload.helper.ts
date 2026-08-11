import { existsSync } from 'fs';
import { copyFile, mkdir, readdir, unlink, writeFile } from 'fs/promises';
import { extname, join, normalize } from 'path';
import {
  generateSafeUploadFilename,
  validateImageUploadFile,
} from './image-upload-options';

const allowedExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const categoryIconDir = join(process.cwd(), 'public', 'categories', 'icons');
const categoryIconPrefix = 'categories/icons/';

export function getCategoryIconDir() {
  return categoryIconDir;
}

export function getCategoryIconPublicPath(filename: string) {
  return `${categoryIconPrefix}${filename}`;
}

export function validateCategoryIcon(file?: Express.Multer.File) {
  validateImageUploadFile(file);
}

export function generateCategoryIconFilename(file: Express.Multer.File) {
  return generateSafeUploadFilename(file);
}

export async function saveCategoryIcon(file: Express.Multer.File) {
  validateCategoryIcon(file);
  await mkdir(categoryIconDir, { recursive: true });

  const filename = generateCategoryIconFilename(file);
  const targetPath = join(categoryIconDir, filename);

  if (file.buffer) {
    await writeFile(targetPath, file.buffer);
  } else if (file.path) {
    await copyFile(file.path, targetPath);
    await unlink(file.path).catch(() => undefined);
  } else {
    validateImageUploadFile(undefined);
  }

  return getCategoryIconPublicPath(filename);
}

export async function deleteCategoryIcon(icon?: string | null) {
  if (!icon) {
    return;
  }

  const filename = icon.startsWith(categoryIconPrefix)
    ? icon.slice(categoryIconPrefix.length)
    : icon;
  const targetPath = normalize(join(categoryIconDir, filename));

  if (
    !targetPath.startsWith(normalize(categoryIconDir)) ||
    !existsSync(targetPath)
  ) {
    return;
  }

  await unlink(targetPath).catch(() => undefined);
}

export async function copySeedCategoryIcons(sourceDir: string) {
  await mkdir(categoryIconDir, { recursive: true });

  if (!existsSync(sourceDir)) {
    return [];
  }

  const files = await readdir(sourceDir);
  const copied: string[] = [];

  for (const file of files) {
    const extension = extname(file).toLowerCase();

    if (!allowedExtensions.has(extension)) {
      continue;
    }

    const sourcePath = join(sourceDir, file);
    const targetPath = join(categoryIconDir, file);

    if (!existsSync(targetPath)) {
      await copyFile(sourcePath, targetPath);
    }

    copied.push(file);
  }

  return copied;
}

export function normalizeCategoryIconPath(icon?: string | null) {
  if (!icon) {
    return icon;
  }

  if (icon.startsWith('http://') || icon.startsWith('https://')) {
    return icon;
  }

  if (icon.startsWith(categoryIconPrefix)) {
    return icon;
  }

  return getCategoryIconPublicPath(icon);
}
