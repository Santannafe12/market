import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class SearchQueryDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'Informe um termo de busca.' })
  @MinLength(2, { message: 'A busca precisa ter pelo menos 2 caracteres.' })
  @MaxLength(100, { message: 'A busca pode ter no máximo 100 caracteres.' })
  q!: string;
}
