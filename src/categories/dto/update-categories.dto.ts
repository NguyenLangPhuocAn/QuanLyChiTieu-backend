import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
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

  @IsOptional()
  @IsObject()
  offline_expected?: CategoryExpectedSnapshot;
}

export type CategoryExpectedSnapshot = {
  name: string;
  type: CategoryType;
  cash_flow_group: CategoryCashFlowGroup;
  icon: string | null;
};

export class DeleteCategoryDto {
  @IsOptional()
  @IsObject()
  offline_expected?: CategoryExpectedSnapshot;
}
