import { savings_goal_status } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

/** The saved goal fields shown to the user before an offline edit. */
export class SavingsGoalExpectedDto {
  @IsString()
  name!: string;

  @Matches(/^(?!0+(?:\.0{1,2})?$)\d+(?:\.\d{1,2})?$/)
  target_amount!: string;

  @IsOptional()
  @IsDateString({ strict: true })
  target_date!: string | null;

  @IsOptional()
  @IsString()
  note!: string | null;

  @IsEnum(savings_goal_status)
  status!: savings_goal_status;
}
