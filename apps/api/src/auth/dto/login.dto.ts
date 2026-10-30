import { IsEmail, IsString, MinLength } from 'class-validator';
import { PasswordWithinBcryptLimit } from '../validation';

export class LoginDto {
  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  email!: string;

  @IsString()
  @MinLength(8, { message: 'A senha precisa ter pelo menos 8 caracteres.' })
  @PasswordWithinBcryptLimit()
  password!: string;
}
