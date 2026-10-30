import { Type } from 'class-transformer';
import { IsInt } from 'class-validator';

export class DepositDto {
  @Type(() => Number)
  @IsInt({ message: 'O depósito precisa ser um inteiro em centavos.' })
  amountCents!: number;
}
