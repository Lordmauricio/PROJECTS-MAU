import { IsIn } from 'class-validator';
import { PLAN_KEYS } from '../plans.catalog';

export class ChangePlanDto {
  @IsIn(PLAN_KEYS)
  planKey!: (typeof PLAN_KEYS)[number];
}
