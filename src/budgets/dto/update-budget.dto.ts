import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { BudgetPeriod, BudgetScope } from './create-budget.dto';
import { BudgetExpectedDto } from './budget-expected.dto';

export class UpdateBudgetDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(BudgetScope)
  scope?: BudgetScope;

  @IsOptional()
  @IsInt()
  wallet_id?: number;

  @IsOptional()
  @IsInt()
  category_id?: number | null;

  @IsOptional()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'Ngân sách phải là số lớn hơn 0 và có tối đa 2 chữ số thập phân',
  })
  limit_amount?: string;

  @IsOptional()
  @IsEnum(BudgetPeriod)
  period?: BudgetPeriod;

  @IsOptional()
  @IsDateString()
  start_date?: string;

  @IsOptional()
  @IsDateString()
  end_date?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => BudgetExpectedDto)
  offline_expected?: BudgetExpectedDto;
}
