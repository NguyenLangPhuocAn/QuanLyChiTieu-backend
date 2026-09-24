import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
} from 'class-validator';
import { SUPPORTED_CURRENCIES } from '../../currency/currency.constants';

export const WALLET_TYPES = ['CASH', 'BANK', 'E_WALLET', 'SAVINGS'] as const;
export type WalletType = (typeof WALLET_TYPES)[number];

export class CreateWalletDto {
  @IsString({ message: 'Tên ví phải là chuỗi ký tự' })
  @IsNotEmpty({ message: 'Tên ví không được để trống' })
  @MaxLength(50, { message: 'Tên ví không được vượt quá 50 ký tự' })
  name!: string;

  @IsOptional()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message:
      'Số dư ban đầu phải là số không âm và có tối đa 2 chữ số thập phân',
  })
  balance?: string;

  @IsOptional()
  @IsString({ message: 'Tiền tệ phải là chuỗi ký tự' })
  @IsIn([...SUPPORTED_CURRENCIES], {
    message: `Tiền tệ chỉ hỗ trợ: ${SUPPORTED_CURRENCIES.join(', ')}`,
  })
  currency?: string;

  @IsOptional()
  @IsString({ message: 'Loại ví phải là chuỗi ký tự' })
  @IsIn([...WALLET_TYPES], {
    message: `Loại ví chỉ hỗ trợ: ${WALLET_TYPES.join(', ')}`,
  })
  wallet_type?: WalletType;
}
