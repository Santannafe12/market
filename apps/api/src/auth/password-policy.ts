export const BCRYPT_MAX_BYTES = 72;

export function passwordFitsBcrypt(password: string) {
  return Buffer.byteLength(password, 'utf8') <= BCRYPT_MAX_BYTES;
}
