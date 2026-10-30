import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ListAuctionsQueryDto {
  @IsIn(['live', 'scheduled', 'ended'], {
    message: 'O status precisa ser live, scheduled ou ended.',
  })
  status!: 'live' | 'scheduled' | 'ended';

  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'A busca pode ter no máximo 100 caracteres.' })
  q?: string;
}
