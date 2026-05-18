import { IsEmail, IsString, Matches, MinLength } from 'class-validator';

export class ForgotPasswordDto {
  @IsEmail({}, { message: 'Email không hợp lệ' })
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  token!: string;

  @IsString()
  @MinLength(6, { message: 'Mật khẩu phải có ít nhất 6 ký tự' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/, {
    message: 'Mật khẩu phải có chữ hoa, chữ thường, số và ký tự đặc biệt',
  })
  newPassword!: string;

  @IsString()
  confirmPassword!: string;
}

export class CompletePasswordSetupDto {
  @IsString()
  @MinLength(6, { message: 'Mật khẩu phải có ít nhất 6 ký tự' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/, {
    message: 'Mật khẩu phải có chữ hoa, chữ thường, số và ký tự đặc biệt',
  })
  newPassword!: string;

  @IsString()
  confirmPassword!: string;
}
