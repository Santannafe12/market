import { Type } from 'class-transformer';
import { IsInt } from 'class-validator';

export class PlaceBidDto {
  @Type(() => Number)
  @IsInt({ message: 'O lance precisa ser um inteiro em centavos.' })
  amountCents!: number;
}
