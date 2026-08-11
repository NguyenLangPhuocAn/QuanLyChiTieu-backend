import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { CategoryCashFlowGroup, CategoryType } from './create-categories.dto';

export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  name?: string;

  @IsOptional()
  @IsEnum(CategoryType)
  type?: CategoryType;

  @IsOptional()
  @IsEnum(CategoryCashFlowGroup)
  cash_flow_group?: CategoryCashFlowGroup;
}
