import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
} from 'class-validator';

export class CreateWalletTransferDto {
  @IsInt({ message: 'Vui lòng chọn ví nguồn.' })
  source_wallet_id!: number;

  @IsInt({ message: 'Vui lòng chọn ví nhận.' })
  destination_wallet_id!: number;

  @Matches(/^(?!0+(?:\.0{1,2})?$)\d+(?:\.\d{1,2})?$/, {
    message: 'Số tiền chuyển phải lớn hơn 0 và có tối đa 2 chữ số thập phân.',
  })
  amount!: string;

  @IsOptional()
  @IsDateString({ strict: true }, { message: 'Ngày chuyển chưa hợp lệ.' })
  transfer_date?: string;

  @IsOptional()
  @IsString({ message: 'Ghi chú phải là chữ.' })
  @MaxLength(1000)
  note?: string;
}
