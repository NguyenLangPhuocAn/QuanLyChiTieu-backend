import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';
import { BudgetPeriod, BudgetScope } from './create-budget.dto';

export class BudgetExpectedDto {
  @IsString()
  name!: string;

  @IsEnum(BudgetScope)
  scope!: BudgetScope;

  @IsInt()
  wallet_id!: number;

  @IsOptional()
  @IsInt()
  category_id!: number | null;

  @Matches(/^\d+(\.\d{1,2})?$/)
  limit_amount!: string;

  @IsEnum(BudgetPeriod)
  period!: BudgetPeriod;

  @IsDateString()
  start_date!: string;

  @IsDateString()
  end_date!: string;
}
