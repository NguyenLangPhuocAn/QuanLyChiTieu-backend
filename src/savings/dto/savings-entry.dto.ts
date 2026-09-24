import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
} from 'class-validator';

const POSITIVE_MONEY = /^(?!0+(?:\.0{1,2})?$)\d+(?:\.\d{1,2})?$/;

export class AddSavingsContributionDto {
  @IsInt({ message: 'Vui lòng chọn ví nguồn.' })
  source_wallet_id!: number;

  @Matches(POSITIVE_MONEY, {
    message: 'Số tiền đóng góp phải lớn hơn 0 và có tối đa 2 chữ số thập phân.',
  })
  amount!: string;

  @IsOptional()
  @IsDateString({ strict: true }, { message: 'Ngày đóng góp chưa hợp lệ.' })
  entry_date?: string;

  @IsOptional()
  @IsString({ message: 'Ghi chú phải là chữ.' })
  @MaxLength(1000)
  note?: string;
}

export class WithdrawSavingsDto {
  @IsInt({ message: 'Vui lòng chọn ví nhận tiền.' })
  destination_wallet_id!: number;

  @Matches(POSITIVE_MONEY, {
    message: 'Số tiền rút phải lớn hơn 0 và có tối đa 2 chữ số thập phân.',
  })
  amount!: string;

  @IsOptional()
  @IsDateString({ strict: true }, { message: 'Ngày rút chưa hợp lệ.' })
  entry_date?: string;

  @IsOptional()
  @IsString({ message: 'Ghi chú phải là chữ.' })
  @MaxLength(1000)
  note?: string;
}
