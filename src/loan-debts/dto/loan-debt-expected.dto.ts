import { loan_debt_type } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

/** The debt fields and paid amount shown before an offline metadata edit. */
export class LoanDebtExpectedDto {
  @IsString()
  person_name!: string;

  @Matches(/^(?!0+(?:\.0{1,2})?$)\d+(?:\.\d{1,2})?$/)
  principal_amount!: string;

  @IsInt()
  opening_wallet_id!: number;

  @IsEnum(loan_debt_type)
  type!: loan_debt_type;

  @IsOptional()
  @IsDateString({ strict: true })
  due_date!: string | null;

  @IsOptional()
  @IsString()
  note!: string | null;

  @Matches(/^\d+(?:\.\d{1,2})?$/)
  settled_amount!: string;
}
