import { IsEmail, IsIn, IsOptional, IsString } from 'class-validator';
import { SUPPORTED_CURRENCIES } from '../../currency/currency.constants';

export class AdminCreateUserDto {
  @IsEmail({}, { message: 'Email không hợp lệ' })
  email!: string;

  @IsOptional()
  @IsString()
  full_name?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  birthday?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  @IsIn(['BASIC', 'PREMIUM', 'ADMIN'], {
    message: 'Vai trò không hợp lệ',
  })
  role?: string;

  @IsOptional()
  @IsString()
  @IsIn([...SUPPORTED_CURRENCIES], {
    message: `Tiền tệ mặc định chỉ hỗ trợ: ${SUPPORTED_CURRENCIES.join(', ')}`,
  })
  currency_default?: string;
}
