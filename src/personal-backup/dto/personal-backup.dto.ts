import { IsString, Length } from 'class-validator';

export class PersonalBackupPasswordDto {
  @IsString()
  @Length(8, 128, { message: 'Mật khẩu backup phải có từ 8 đến 128 ký tự.' })
  password!: string;
}
