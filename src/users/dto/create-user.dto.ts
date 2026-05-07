import { IsEmail, IsString, MinLength, Matches } from 'class-validator';

export class CreateUserDto {
  // ================= EMAIL =================
  @IsEmail({}, { message: 'Email không hợp lệ' })
  email!: string;

  // ================= PASSWORD =================
  @IsString()
  @MinLength(6, { message: 'Password phải >= 6 ký tự' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/, {
    message: 'Password phải có chữ hoa, chữ thường, số và ký tự đặc biệt',
  })
  password!: string;

  // ================= CONFIRM PASSWORD =================
  // chỉ dùng để check, KHÔNG lưu DB
  @IsString()
  confirmPassword!: string;
}
