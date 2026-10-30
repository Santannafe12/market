import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsString, Matches, Max, Min } from 'class-validator';
import { MONEY_MAX_CENTS } from '../../common/money';

export class CreateAuctionDto {
  @IsString()
  @Matches(/^OL\d+M$/, { message: 'Informe uma edição válida da Open Library.' })
  editionId!: string;

  @Type(() => Number)
  @IsInt({ message: 'O lance inicial precisa ser um inteiro em centavos.' })
  @Min(1, { message: 'O lance inicial precisa ser de pelo menos 1 centavo.' })
  @Max(MONEY_MAX_CENTS, { message: 'O lance inicial passa do valor máximo.' })
  startingBidCents!: number;

  @Type(() => Number)
  @IsInt({ message: 'O incremento mínimo precisa ser um inteiro em centavos.' })
  @Min(1, { message: 'O incremento mínimo precisa ser de pelo menos 1 centavo.' })
  @Max(MONEY_MAX_CENTS, { message: 'O incremento mínimo passa do valor máximo.' })
  minIncrementCents!: number;

  @IsISO8601({}, { message: 'Informe um horário de início válido.' })
  startsAt!: string;

  @IsISO8601({}, { message: 'Informe um horário de fim válido.' })
  endsAt!: string;
}
