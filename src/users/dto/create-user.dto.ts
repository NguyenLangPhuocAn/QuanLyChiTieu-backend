import { IsEmail, IsIn, IsOptional, IsString, MinLength, Matches } from 'class-validator';
import { SUPPORTED_CURRENCIES } from '../../currency/currency.constants';

export class CreateUserDto {
  // ================= EMAIL =================
  @IsEmail({}, { message: 'Email không hợp lệ' })
  email!: string;

  // ================= PASSWORD =================
  @IsString()
  @MinLength(6, { message: 'Mật khẩu phải có ít nhất 6 ký tự' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/, {
    message: 'Mật khẩu phải có chữ hoa, chữ thường, số và ký tự đặc biệt',
  })
  password!: string;

  // ================= CONFIRM PASSWORD =================
  // chỉ dùng để check, KHÔNG lưu DB
  @IsString()
  confirmPassword!: string;

  @IsOptional()
  @IsString()
  @IsIn([...SUPPORTED_CURRENCIES], {
    message: `Tiền tệ mặc định chỉ hỗ trợ: ${SUPPORTED_CURRENCIES.join(', ')}`,
  })
  currency_default?: string;
}
