import { IsIn, IsOptional, Matches } from 'class-validator';

export class CreateVnpayOrderDto {
  @IsOptional()
  @IsIn(['vn', 'en'], { message: 'Ngôn ngữ VNPay chỉ hỗ trợ vn hoặc en' })
  locale?: 'vn' | 'en';

  @IsOptional()
  @Matches(/^[A-Za-z0-9]{2,20}$/, { message: 'Mã ngân hàng chưa hợp lệ' })
  bank_code?: string;
}
