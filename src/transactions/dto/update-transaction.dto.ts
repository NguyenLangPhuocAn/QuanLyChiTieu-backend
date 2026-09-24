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
import { TransactionType } from './create-transaction.dto';

export class UpdateTransactionDto {
  @IsOptional()
  @IsInt()
  wallet_id?: number;

  @IsOptional()
  @IsInt()
  category_id?: number;

  @IsOptional()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'Số tiền phải lớn hơn 0 và tối đa 2 chữ số thập phân',
  })
  amount?: string;

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
