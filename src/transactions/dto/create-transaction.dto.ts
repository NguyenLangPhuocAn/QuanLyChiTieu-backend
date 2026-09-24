import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

export enum TransactionType {
  INCOME = 'INCOME',
  EXPENSE = 'EXPENSE',
}

export class CreateTransactionDto {
  @IsInt()
  wallet_id!: number;

  @IsOptional()
  @IsInt()
  category_id?: number;

  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'Số tiền phải lớn hơn 0 và tối đa 2 chữ số thập phân',
  })
  amount!: string;

  // Dùng khi giao dịch chưa có danh mục; nếu có category_id thì loại danh mục là nguồn dữ liệu chính.
  @IsOptional()
  @IsEnum(TransactionType)
  type?: TransactionType;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  receipt_image?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  receipt_items?: unknown[] | null;

  @IsOptional()
  @IsDateString()
  transaction_date?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
