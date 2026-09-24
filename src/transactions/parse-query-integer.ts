import { BadRequestException } from '@nestjs/common';

export function parseQueryInteger(value: string | undefined, label: string) {
  if (value === undefined) return undefined;
  if (
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < 1
  ) {
    throw new BadRequestException(`${label} phải là số nguyên dương.`);
  }
  return Number(value);
}
