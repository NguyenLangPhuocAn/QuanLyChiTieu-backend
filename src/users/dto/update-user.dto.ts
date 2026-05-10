import {
  IsIn,
  IsString,
  IsOptional,
  Matches,
  IsDateString,
  IsUrl,
} from 'class-validator';
import { SUPPORTED_CURRENCIES } from '../../currency/currency.constants';

export class UpdateUserDto {
  // ================= FULL NAME =================
  @IsOptional()
  @IsString({ message: 'Tên phải là chuỗi' })
  @Matches(/^[a-zA-ZÀ-ỹ\s]+$/, {
    message: 'Tên không được chứa số',
  })
  full_name?: string;

  // ================= BIRTHDAY =================
  @IsOptional()
  @IsDateString({}, { message: 'Ngày sinh phải dạng YYYY-MM-DD' })
  birthday?: string;

  // ================= PHONE =================
  @IsOptional()
  @Matches(/^0\d{9}$/, {
    message: 'SĐT phải bắt đầu 0 và đủ 10 số',
  })
  phone?: string;

  // ================= ADDRESS =================
  @IsOptional()
  @IsString()
  address?: string;

  // ================= AVATAR =================
  @IsOptional()
  @IsUrl({}, { message: 'Avatar phải là URL' })
  @Matches(/\.(jpg|jpeg|png|webp)$/i, {
    message: 'Avatar phải là link ảnh',
  })
  avatar?: string;

  @IsOptional()
  @IsString()
  @IsIn([...SUPPORTED_CURRENCIES], {
    message: `Tiền tệ mặc định chỉ hỗ trợ: ${SUPPORTED_CURRENCIES.join(', ')}`,
  })
  currency_default?: string;
}
