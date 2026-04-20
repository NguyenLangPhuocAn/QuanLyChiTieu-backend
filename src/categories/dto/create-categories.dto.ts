import { IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export enum CategoryType {
  INCOME = 'INCOME',
  EXPENSE = 'EXPENSE',
}

export class CreateCategoryDto {
  // tên
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name: string;

  // loại
  @IsEnum(CategoryType)
  type: CategoryType;
}