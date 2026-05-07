import { IsString, MinLength, Matches } from 'class-validator';

export class ChangePasswordDto {
  // ================= OLD PASSWORD =================
  // mật khẩu hiện tại
  @IsString()
  oldPassword!: string;

  // ================= NEW PASSWORD =================
  // password mới phải mạnh
  @IsString()
  @MinLength(6, { message: 'Password phải >= 6 ký tự' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/, {
    message: 'Password phải có chữ hoa, chữ thường, số và ký tự đặc biệt',
  })
  newPassword!: string;

  // ================= CONFIRM =================
  @IsString()
  confirmPassword!: string;
}
