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

export enum CategoryCashFlowGroup {
  NORMAL = 'NORMAL',
  LOAN_DEBT = 'LOAN_DEBT',
  SAVING_TRANSFER = 'SAVING_TRANSFER',
}

export class CreateCategoryDto {
  // Tên danh mục hiển thị cho người dùng.
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name!: string;

  // Loại danh mục quyết định giao dịch là khoản thu hay khoản chi.
  @IsEnum(CategoryType)
  type!: CategoryType;

  // Chỉ admin dùng để tạo danh mục hệ thống.
  @IsOptional()
  @IsBoolean()
  is_system?: boolean;

  @IsOptional()
  @IsEnum(CategoryCashFlowGroup)
  cash_flow_group?: CategoryCashFlowGroup;
}
