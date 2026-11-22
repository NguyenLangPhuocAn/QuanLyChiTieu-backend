import { Type } from 'class-transformer';
import {
  IsDefined,
  IsIn,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { SUPPORTED_CURRENCIES } from '../../currency/currency.constants';
import { WALLET_TYPES, type WalletType } from './create-wallet.dto';

export class WalletSnapshotDto {
  @IsString()
  @MaxLength(50)
  name!: string;

  @IsIn([...WALLET_TYPES])
  wallet_type!: WalletType;

  @IsIn([...SUPPORTED_CURRENCIES])
  currency!: string;

  @Matches(/^\d+(\.\d{1,2})?$/)
  balance!: string;
}

export class DeleteWalletDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => WalletSnapshotDto)
  offline_expected!: WalletSnapshotDto;
}
