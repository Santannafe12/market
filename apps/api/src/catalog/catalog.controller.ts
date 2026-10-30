import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CatalogClient, CatalogRequestError, catalogHttpError } from './catalog.client';
import { SearchQueryDto } from './dto/search-query.dto';

@Controller('catalog')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SELLER)
export class CatalogController {
  constructor(private readonly catalog: CatalogClient) {}

  @Get('search')
  search(@Query() query: SearchQueryDto) {
    return this.wrap(this.catalog.search(query.q));
  }

  @Get('works/:workId/editions')
  editions(@Param('workId') workId: string) {
    return this.wrap(this.catalog.editions(workId));
  }

  @Get('editions/:editionId')
  async edition(@Param('editionId') editionId: string) {
    const detail = await this.wrap(this.catalog.edition(editionId));
    return {
      editionId: detail.editionId,
      workId: detail.workId,
      title: detail.title,
      authors: detail.authors,
      publisher: detail.publisher,
      publishedDate: detail.publishedDate,
      publishedYear: detail.publishedYear,
      isbn: detail.isbn,
      language: detail.language,
      description: detail.description,
    };
  }

  private async wrap<T>(work: Promise<T>) {
    try {
      return await work;
    } catch (error) {
      if (error instanceof CatalogRequestError) {
        throw catalogHttpError(error);
      }
      throw error;
    }
  }
}
