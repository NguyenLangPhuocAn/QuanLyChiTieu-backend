import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

export class CreateLoanDebtPaymentDto {
  @IsInt({ message: 'Vui lòng chọn ví thanh toán.' })
  wallet_id!: number;

  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'Số tiền thanh toán phải lớn hơn 0',
  })
  amount!: string;

  @IsOptional()
  @IsDateString({}, { message: 'Ngày thanh toán chưa hợp lệ.' })
  payment_date?: string;

  @IsOptional()
  @IsString({ message: 'Ghi chú phải là chữ.' })
  note?: string;
}
