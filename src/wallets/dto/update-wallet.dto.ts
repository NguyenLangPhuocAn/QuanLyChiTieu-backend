import { IsIn, IsOptional, IsString, MaxLength, Matches } from 'class-validator';
import { SUPPORTED_CURRENCIES } from '../../currency/currency.constants';
import { WALLET_TYPES, type WalletType } from './create-wallet.dto';

export class UpdateWalletDto {
  @IsOptional()
  @IsString({ message: 'Tên ví phải là chuỗi ký tự' })
  @MaxLength(50, { message: 'Tên ví không được vượt quá 50 ký tự' })
  name?: string;

  // Không cho sửa trực tiếp số dư ví vì số dư phải được tính từ các giao dịch thu/chi.
  @IsOptional()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'Số dư không được sửa trực tiếp sau khi ví đã tạo',
  })
  balance?: string;

  @IsOptional()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message:
      'Hạn mức chi tiêu phải là số không âm và có tối đa 2 chữ số thập phân',
  })
  budget_limit?: string;

  @IsOptional()
  @IsString({ message: 'Tiền tệ phải là chuỗi ký tự' })
  @IsIn([...SUPPORTED_CURRENCIES], {
    message: `Tiền tệ chỉ hỗ trợ: ${SUPPORTED_CURRENCIES.join(', ')}`,
  })
  currency?: string;

  @IsOptional()
  @IsString({ message: 'Loại ví phải là chuỗi ký tự' })
  @IsIn([...WALLET_TYPES], {
    message: `Loại ví chỉ hỗ trợ: ${WALLET_TYPES.join(', ')}`,
  })
  wallet_type?: WalletType;
}
