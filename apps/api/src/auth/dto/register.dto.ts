import { IsEmail, IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { Role } from '@prisma/client';
import { MinTrimmedLength, PasswordWithinBcryptLimit } from '../validation';

export class RegisterDto {
  @IsString({ message: 'Informe o nome.' })
  @MinTrimmedLength(2, { message: 'O nome precisa ter pelo menos 2 caracteres.' })
  @MaxLength(80, { message: 'O nome pode ter no máximo 80 caracteres.' })
  name!: string;

  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  @MaxLength(160)
  email!: string;

  @IsString()
  @MinLength(8, { message: 'A senha precisa ter pelo menos 8 caracteres.' })
  @PasswordWithinBcryptLimit()
  password!: string;

  @IsEnum(Role, { message: 'Escolha o papel SELLER ou BIDDER.' })
  role!: Role;
}
