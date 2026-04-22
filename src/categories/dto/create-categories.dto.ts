import {
  IsEnum,
  IsNotEmpty,
  IsString,
  MaxLength,
  IsOptional,
  IsBoolean,
} from 'class-validator';

export enum CategoryType {
  INCOME = 'INCOME',
  EXPENSE = 'EXPENSE',
}

export class CreateCategoryDto {
  // tên
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name!: string;

  // loại
  @IsEnum(CategoryType)
  type!: CategoryType;

  // chỉ admin dùng
  @IsOptional()
  @IsBoolean()
  is_system?: boolean;
}