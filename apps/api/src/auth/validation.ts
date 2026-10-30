import { ValidateBy, ValidationArguments, ValidationOptions } from 'class-validator';
import { BCRYPT_MAX_BYTES } from './password-policy';

export function MaxUtf8Bytes(maxBytes: number, validationOptions?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'maxUtf8Bytes',
      constraints: [maxBytes],
      validator: {
        validate(value: unknown, args?: ValidationArguments) {
          if (typeof value !== 'string') {
            return false;
          }
          const limit = Number(args?.constraints[0] ?? maxBytes);
          return Buffer.byteLength(value, 'utf8') <= limit;
        },
        defaultMessage(args?: ValidationArguments) {
          const limit = args?.constraints[0] ?? maxBytes;
          return `A senha pode ter no máximo ${limit} bytes.`;
        },
      },
    },
    validationOptions,
  );
}

export function PasswordWithinBcryptLimit(validationOptions?: ValidationOptions) {
  return MaxUtf8Bytes(BCRYPT_MAX_BYTES, {
    message: `A senha pode ter no máximo ${BCRYPT_MAX_BYTES} bytes.`,
    ...validationOptions,
  });
}

export function MinTrimmedLength(min: number, validationOptions?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'minTrimmedLength',
      constraints: [min],
      validator: {
        validate(value: unknown, args?: ValidationArguments) {
          if (typeof value !== 'string') {
            return false;
          }
          const limit = Number(args?.constraints[0] ?? min);
          return value.trim().length >= limit;
        },
        defaultMessage() {
          return 'O nome precisa ter pelo menos 2 caracteres.';
        },
      },
    },
    validationOptions,
  );
}
