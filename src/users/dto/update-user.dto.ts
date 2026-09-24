import {
  IsIn,
  IsString,
  IsOptional,
  Matches,
  IsDateString,
  IsUrl,
  IsBoolean,
} from 'class-validator';
import { SUPPORTED_CURRENCIES } from '../../currency/currency.constants';

export class UpdateUserDto {
  // ================= FULL NAME =================
  @IsOptional()
  @IsString({ message: 'Tên phải là chuỗi' })
  @Matches(/^[a-zA-ZÀ-ỹ\s]+$/, {
    message: 'Tên không được chứa số',
  })
  full_name?: string | null;

  // ================= BIRTHDAY =================
  @IsOptional()
  @IsDateString(
    { strict: true },
    { message: 'Ngày sinh phải là ngày hợp lệ dạng YYYY-MM-DD' },
  )
  birthday?: string | null;

  // ================= PHONE =================
  @IsOptional()
  @Matches(/^0\d{9}$/, {
    message: 'SĐT phải bắt đầu 0 và đủ 10 số',
  })
  phone?: string | null;

  // ================= ADDRESS =================
  @IsOptional()
  @IsString()
  address?: string | null;

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

  @IsOptional()
  @IsBoolean()
  profile_setup_completed?: boolean;
}
