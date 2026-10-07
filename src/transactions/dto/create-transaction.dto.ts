import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsIn,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

export enum TransactionType {
  INCOME = 'INCOME',
  EXPENSE = 'EXPENSE',
}

export const transactionSources = ['BANK_NOTIFICATION'] as const;
export type TransactionSource = (typeof transactionSources)[number];

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

  @IsOptional()
  @IsIn(transactionSources)
  source?: TransactionSource;

  @IsOptional()
  @Matches(/^[a-f0-9]{64}$/i, {
    message: 'Mã nguồn giao dịch chưa hợp lệ',
  })
  source_ref?: string;
}
