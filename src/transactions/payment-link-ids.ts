import { BadRequestException } from '@nestjs/common';

export function validatePaymentLinkIds(ids: number[]) {
  if (
    !Array.isArray(ids) ||
    ids.length < 1 ||
    ids.length > 100 ||
    ids.some((id) => !Number.isSafeInteger(id) || id < 1 || id > 2147483647) ||
    new Set(ids).size !== ids.length
  ) {
    throw new BadRequestException('Cần từ 1 đến 100 mã giao dịch khác nhau.');
  }
  return ids;
}

export function parsePaymentLinkIds(value: string | undefined) {
  if (typeof value !== 'string' || !/^\d+(,\d+)*$/.test(value)) {
    throw new BadRequestException('Danh sách mã giao dịch không hợp lệ.');
  }
  return validatePaymentLinkIds(value.split(',').map(Number));
}
