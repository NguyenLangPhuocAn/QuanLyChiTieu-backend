import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class UpdateLoanDebtDto {
  @IsOptional()
  @IsString({ message: 'Tên người phải là chữ.' })
  @IsNotEmpty({ message: 'Vui lòng nhập tên người.' })
  @MaxLength(100)
  person_name?: string;

  @IsOptional()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'Số tiền phải lớn hơn 0 và có tối đa 2 chữ số thập phân',
  })
  principal_amount?: string;

  @IsOptional()
  @IsInt({ message: 'Vui lòng chọn ví.' })
  wallet_id?: number;

  @IsOptional()
  @IsDateString({}, { message: 'Ngày hẹn trả chưa hợp lệ.' })
  due_date?: string | null;

  @IsOptional()
  @IsString({ message: 'Ghi chú phải là chữ.' })
  note?: string | null;
}
