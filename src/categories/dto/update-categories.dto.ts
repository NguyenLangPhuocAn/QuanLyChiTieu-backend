import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { CategoryType } from './create-categories.dto';

export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  name?: string;

  @IsOptional()
  @IsEnum(CategoryType)
  type?: CategoryType;
}