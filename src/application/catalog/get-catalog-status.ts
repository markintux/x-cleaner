import type { CatalogRepository, CatalogStatusSnapshot } from "../ports/catalog-repository.js";

/** Read-only catalog summary. It never selects interaction previews or sources. */
export class GetCatalogStatus {
  constructor(private readonly catalog: CatalogRepository) {}

  execute(): CatalogStatusSnapshot {
    return this.catalog.getCatalogStatus();
  }
}

export function getCatalogStatus(catalog: CatalogRepository): CatalogStatusSnapshot {
  return new GetCatalogStatus(catalog).execute();
}
