import { IsString, MinLength, Matches } from 'class-validator';

export class ChangePasswordDto {
  // ================= OLD PASSWORD =================
  // mật khẩu hiện tại
  @IsString()
  oldPassword!: string;

  // ================= NEW PASSWORD =================
  // password mới phải mạnh
  @IsString()
  @MinLength(6, { message: 'Mật khẩu phải có ít nhất 6 ký tự' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/, {
    message: 'Mật khẩu phải có chữ hoa, chữ thường, số và ký tự đặc biệt',
  })
  newPassword!: string;

  // ================= CONFIRM =================
  @IsString()
  confirmPassword!: string;
}
