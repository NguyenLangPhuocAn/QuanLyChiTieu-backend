import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
} from 'class-validator';

export enum BudgetPeriod {
  DAY = 'DAY',
  WEEK = 'WEEK',
  MONTH = 'MONTH',
  QUARTER = 'QUARTER',
  YEAR = 'YEAR',
  CUSTOM = 'CUSTOM',
}

export enum BudgetScope {
  WALLET = 'WALLET',
  CATEGORY = 'CATEGORY',
}

export class CreateBudgetDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsEnum(BudgetScope)
  scope!: BudgetScope;

  @IsInt()
  wallet_id!: number;

  @IsOptional()
  @IsInt()
  category_id?: number | null;

  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'Ngân sách phải là số lớn hơn 0 và có tối đa 2 chữ số thập phân',
  })
  limit_amount!: string;

  @IsEnum(BudgetPeriod)
  period!: BudgetPeriod;

  @IsOptional()
  @IsDateString()
  start_date?: string;

  @IsOptional()
  @IsDateString()
  end_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(/^[a-zA-Z0-9_-]{8,80}$/)
  client_request_id?: string;
}
