import { Equals, IsString, MaxLength, MinLength } from 'class-validator';

export class ExtractBankNotificationDto {
  @IsString()
  @MinLength(5)
  @MaxLength(800)
  text!: string;

  @Equals(true, { message: 'Cần đồng ý gửi nội dung đã kiểm tra để AI đọc.' })
  consent!: boolean;
}
