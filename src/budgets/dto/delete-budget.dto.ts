import { IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { BudgetExpectedDto } from './budget-expected.dto';

export class DeleteBudgetDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => BudgetExpectedDto)
  offline_expected?: BudgetExpectedDto;
}
