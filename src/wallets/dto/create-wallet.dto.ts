import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
} from 'class-validator';
import { SUPPORTED_CURRENCIES } from '../../currency/currency.constants';

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
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message:
      'Hạn mức chi tiêu phải là số không âm và có tối đa 2 chữ số thập phân',
  })
  budget_limit?: string;

  @IsOptional()
  @IsString({ message: 'Tiền tệ phải là chuỗi ký tự' })
  @IsIn([...SUPPORTED_CURRENCIES], {
    message: `Tiền tệ chỉ hỗ trợ: ${SUPPORTED_CURRENCIES.join(', ')}`,
  })
  currency?: string;
}
