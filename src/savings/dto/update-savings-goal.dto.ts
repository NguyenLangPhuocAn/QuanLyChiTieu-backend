import {
  IsDateString,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
} from 'class-validator';

const POSITIVE_MONEY = /^(?!0+(?:\.0{1,2})?$)\d+(?:\.\d{1,2})?$/;

export class UpdateSavingsGoalDto {
  @IsOptional()
  @IsString({ message: 'Tên mục tiêu phải là chữ.' })
  @MaxLength(100, { message: 'Tên mục tiêu không được vượt quá 100 ký tự.' })
  name?: string;

  @IsOptional()
  @Matches(POSITIVE_MONEY, {
    message: 'Số tiền mục tiêu phải lớn hơn 0 và có tối đa 2 chữ số thập phân.',
  })
  target_amount?: string;

  @IsOptional()
  @IsDateString({ strict: true }, { message: 'Ngày hoàn thành chưa hợp lệ.' })
  target_date?: string | null;

  @IsOptional()
  @IsString({ message: 'Ghi chú phải là chữ.' })
  @MaxLength(1000, { message: 'Ghi chú không được vượt quá 1000 ký tự.' })
  note?: string | null;
}
