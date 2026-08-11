import { IsEmail, IsString, Matches, MinLength } from 'class-validator';

export class ForgotPasswordDto {
  @IsEmail({}, { message: 'Email không hợp lệ' })
  email!: string;
}

export class VerifyResetOtpDto {
  @IsEmail({}, { message: 'Email không hợp lệ' })
  email!: string;

  @IsString()
  @Matches(/^\d{6}$/, {
    message: 'Mã xác nhận không hợp lệ hoặc đã hết hạn.',
  })
  otp!: string;
}

export class ResetPasswordDto {
  @IsString()
  reset_token!: string;

  @IsString()
  @MinLength(6, { message: 'Mật khẩu phải có ít nhất 6 ký tự' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/, {
    message: 'Mật khẩu phải có chữ hoa, chữ thường, số và ký tự đặc biệt',
  })
  new_password!: string;

  @IsString()
  confirm_password!: string;
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
