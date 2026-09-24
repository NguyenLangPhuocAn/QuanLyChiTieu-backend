import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class SendChatMessageDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Cuộc trò chuyện không hợp lệ.' })
  @Min(1, { message: 'Cuộc trò chuyện không hợp lệ.' })
  conversation_id?: number;

  @IsString({ message: 'Nội dung tin nhắn phải là chữ.' })
  @MinLength(1, { message: 'Tin nhắn không được để trống.' })
  @MaxLength(1500, { message: 'Tin nhắn không được vượt quá 1500 ký tự.' })
  message!: string;
}
