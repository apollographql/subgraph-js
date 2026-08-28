/**
 * Fixture data for the Apollo Federation subgraph compatibility suite.
 *
 * The values here are fixed by the suite — it asserts on them — so they mirror
 * the reference implementations exactly.
 */

export interface User {
  email: string;
  name: string;
  totalProductsCreated: number | null;
  yearsOfEmployment: number;
}

export interface CaseStudy {
  caseNumber: string;
  description: string;
}

export interface ProductResearch {
  study: CaseStudy;
  outcome: string | null;
}

export interface Product {
  id: string;
  sku: string;
  package: string;
  variation: { id: string };
  dimensions: { size: string; weight: number; unit: string };
  createdBy: User;
  research: ProductResearch[];
}

export interface DeprecatedProduct {
  sku: string;
  package: string;
  reason: string;
  createdBy: User;
}

export interface Inventory {
  id: string;
  deprecatedProducts: DeprecatedProduct[];
}

export const DEFAULT_USER: User = {
  email: 'support@apollographql.com',
  name: 'Jane Smith',
  totalProductsCreated: 1337,
  yearsOfEmployment: 0,
};

const DEFAULT_DIMENSIONS = { size: 'small', weight: 1, unit: 'kg' };

export const FEDERATION_STUDY: ProductResearch = {
  study: { caseNumber: '1234', description: 'Federation Study' },
  outcome: null,
};

export const STUDIO_STUDY: ProductResearch = {
  study: { caseNumber: '1235', description: 'Studio Study' },
  outcome: null,
};

const RESEARCH = [FEDERATION_STUDY, STUDIO_STUDY];

const PRODUCTS: Product[] = [
  {
    id: 'apollo-federation',
    sku: 'federation',
    package: '@apollo/federation',
    variation: { id: 'OSS' },
    dimensions: DEFAULT_DIMENSIONS,
    createdBy: DEFAULT_USER,
    research: [FEDERATION_STUDY],
  },
  {
    id: 'apollo-studio',
    sku: 'studio',
    package: '',
    variation: { id: 'platform' },
    dimensions: DEFAULT_DIMENSIONS,
    createdBy: DEFAULT_USER,
    research: [STUDIO_STUDY],
  },
];

export const DEPRECATED_PRODUCT: DeprecatedProduct = {
  sku: 'apollo-federation-v1',
  package: '@apollo/federation-v1',
  reason: 'Migrate to Federation V2',
  createdBy: DEFAULT_USER,
};

export function productById(id: string): Product | null {
  return PRODUCTS.find((product) => product.id === id) ?? null;
}

export function productBySkuAndPackage(
  sku: string,
  pkg: string,
): Product | null {
  return (
    PRODUCTS.find(
      (product) => product.sku === sku && product.package === pkg,
    ) ?? null
  );
}

export function productBySkuAndVariation(
  sku: string,
  variationId: string,
): Product | null {
  return (
    PRODUCTS.find(
      (product) => product.sku === sku && product.variation.id === variationId,
    ) ?? null
  );
}

export function deprecatedProductBySkuAndPackage(
  sku: string,
  pkg: string,
): DeprecatedProduct | null {
  return DEPRECATED_PRODUCT.sku === sku && DEPRECATED_PRODUCT.package === pkg
    ? DEPRECATED_PRODUCT
    : null;
}

export function productResearchByCaseNumber(
  caseNumber: string,
): ProductResearch | null {
  return (
    RESEARCH.find((research) => research.study.caseNumber === caseNumber) ??
    null
  );
}

export function inventoryById(id: string): Inventory | null {
  return id === 'apollo-oss'
    ? { id, deprecatedProducts: [DEPRECATED_PRODUCT] }
    : null;
}
