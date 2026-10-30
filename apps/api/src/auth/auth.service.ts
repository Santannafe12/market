import { randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, Role } from '@prisma/client';
import bcrypt from 'bcrypt';
import { DomainError } from '../common/domain-error';
import { PrismaService } from '../prisma/prisma.service';
import { passwordFitsBcrypt } from './password-policy';

const PUBLIC_ID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const BCRYPT_COST = 12;
const DUMMY_PASSWORD_HASH = '$2b$12$Nx2nSDTGXeELU0oTU7hQguvNQgibbTLa94e4mcwVrYKX9f/IhkchS';

const publicUserSelect = {
  id: true,
  publicId: true,
  name: true,
  email: true,
  role: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

export type PublicUser = Prisma.UserGetPayload<{ select: typeof publicUserSelect }>;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  /** `fixedPublicId` is only passed by the seed; the HTTP route always allocates a random one. */
  async register(
    input: { name: string; email: string; password: string; role: Role },
    fixedPublicId?: string,
  ) {
    const name = input.name.trim();
    if (name.length < 2) {
      throw new DomainError('VALIDATION_ERROR', 400, 'O nome precisa ter pelo menos 2 caracteres.');
    }
    this.assertPasswordBytes(input.password);

    const email = input.email.trim().toLowerCase();
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);

    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const publicId = fixedPublicId ?? (await this.allocatePublicId(tx));
        return tx.user.create({
          data: {
            publicId,
            name,
            email,
            passwordHash,
            role: input.role,
            wallet: { create: { balanceCents: 0 } },
          },
          select: publicUserSelect,
        });
      });

      return { accessToken: await this.sign(user), user };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = Array.isArray(error.meta?.target)
          ? error.meta.target.join(',')
          : String(error.meta?.target ?? '');
        if (target.includes('email')) {
          throw new DomainError('EMAIL_ALREADY_EXISTS', 409, 'Este e-mail já está cadastrado.');
        }
      }
      throw error;
    }
  }

  async login(input: { email: string; password: string }) {
    this.assertPasswordBytes(input.password);
    const email = input.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    const passwordMatches = await bcrypt.compare(
      input.password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );

    if (!user || !passwordMatches) {
      throw new DomainError('INVALID_CREDENTIALS', 401, 'E-mail ou senha inválidos.');
    }

    const publicUser = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: publicUserSelect,
    });

    return { accessToken: await this.sign(publicUser), user: publicUser };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: publicUserSelect,
    });

    if (!user) {
      throw new DomainError('UNAUTHORIZED', 401, 'Autenticação necessária.');
    }

    return user;
  }

  private assertPasswordBytes(password: string) {
    if (!passwordFitsBcrypt(password)) {
      throw new DomainError('VALIDATION_ERROR', 400, 'A senha pode ter no máximo 72 bytes.');
    }
  }

  private async sign(user: PublicUser) {
    return this.jwt.signAsync({
      sub: user.id,
      role: user.role,
      publicId: user.publicId,
    });
  }

  private async allocatePublicId(tx: Prisma.TransactionClient) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const publicId = randomPublicId();
      const existing = await tx.user.findUnique({
        where: { publicId },
        select: { id: true },
      });
      if (!existing) {
        return publicId;
      }
    }

    throw new DomainError(
      'PUBLIC_ID_EXHAUSTED',
      500,
      'Não foi possível criar o identificador público.',
    );
  }
}

function randomPublicId() {
  const bytes = randomBytes(10);
  return Array.from(bytes, (byte) => PUBLIC_ID_ALPHABET[byte % PUBLIC_ID_ALPHABET.length]).join('');
}
