import {
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
} from 'class-validator';
import { SUPPORTED_CURRENCIES } from '../../currency/currency.constants';

const POSITIVE_MONEY = /^(?!0+(?:\.0{1,2})?$)\d+(?:\.\d{1,2})?$/;

export class CreateSavingsGoalDto {
  @IsString({ message: 'Tên mục tiêu phải là chữ.' })
  @IsNotEmpty({ message: 'Vui lòng nhập tên mục tiêu.' })
  @MaxLength(100, { message: 'Tên mục tiêu không được vượt quá 100 ký tự.' })
  name!: string;

  @Matches(POSITIVE_MONEY, {
    message: 'Số tiền mục tiêu phải lớn hơn 0 và có tối đa 2 chữ số thập phân.',
  })
  target_amount!: string;

  @IsOptional()
  @IsInt({ message: 'Ví trích tiền không hợp lệ.' })
  source_wallet_id?: number;

  @IsOptional()
  @Matches(POSITIVE_MONEY, {
    message: 'Số tiền ban đầu phải lớn hơn 0 và có tối đa 2 chữ số thập phân.',
  })
  initial_amount?: string;

  @IsOptional()
  @IsDateString({ strict: true }, { message: 'Ngày hoàn thành chưa hợp lệ.' })
  target_date?: string | null;

  @IsOptional()
  @IsString({ message: 'Ghi chú phải là chữ.' })
  @MaxLength(1000, { message: 'Ghi chú không được vượt quá 1000 ký tự.' })
  note?: string;

  @IsOptional()
  @IsString({ message: 'Tiền tệ phải là chuỗi ký tự.' })
  @IsIn([...SUPPORTED_CURRENCIES], {
    message: `Tiền tệ chỉ hỗ trợ: ${SUPPORTED_CURRENCIES.join(', ')}`,
  })
  currency?: string;
}
