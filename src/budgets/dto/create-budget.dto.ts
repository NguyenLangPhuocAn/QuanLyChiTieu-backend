import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
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
}
