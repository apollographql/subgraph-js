import { GraphQLResolverMap } from '@apollo/subgraph';
import {
  DEFAULT_USER,
  User,
  deprecatedProductBySkuAndPackage,
  inventoryById,
  productById,
  productBySkuAndPackage,
  productBySkuAndVariation,
  productResearchByCaseNumber,
} from './data';

/** A `Product` key: `id`, `sku package`, or `sku variation { id }`. */
type ProductReference = {
  id?: string;
  sku?: string;
  package?: string;
  variation?: { id: string };
};

type UserReference = {
  email: string;
  totalProductsCreated?: number | null;
  yearsOfEmployment?: number | null;
};

export const resolvers: GraphQLResolverMap<unknown> = {
  Query: {
    product: (_source, { id }) => productById(id),
    deprecatedProduct: (_source, { sku, package: pkg }) =>
      deprecatedProductBySkuAndPackage(sku, pkg),
  },

  Product: {
    __resolveReference(reference: ProductReference) {
      if (reference.id !== undefined) {
        return productById(reference.id);
      }
      if (reference.sku !== undefined) {
        if (reference.package !== undefined) {
          return productBySkuAndPackage(reference.sku, reference.package);
        }
        if (reference.variation !== undefined) {
          return productBySkuAndVariation(
            reference.sku,
            reference.variation.id,
          );
        }
      }
      return null;
    },
  },

  DeprecatedProduct: {
    __resolveReference(reference: { sku: string; package: string }) {
      return deprecatedProductBySkuAndPackage(reference.sku, reference.package);
    },
  },

  ProductResearch: {
    __resolveReference(reference: { study: { caseNumber: string } }) {
      return productResearchByCaseNumber(reference.study.caseNumber);
    },
  },

  Inventory: {
    __resolveReference(reference: { id: string }) {
      return inventoryById(reference.id);
    },
  },

  User: {
    __resolveReference(reference: UserReference): User {
      return {
        email: reference.email,
        name: DEFAULT_USER.name,
        totalProductsCreated:
          reference.totalProductsCreated ?? DEFAULT_USER.totalProductsCreated,
        yearsOfEmployment:
          reference.yearsOfEmployment ?? DEFAULT_USER.yearsOfEmployment,
      };
    },
    // Computed from the fields `@requires` pulls in from the users subgraph.
    averageProductsCreatedPerYear(user: User) {
      if (user.totalProductsCreated == null || user.yearsOfEmployment <= 0) {
        return null;
      }
      return Math.round(user.totalProductsCreated / user.yearsOfEmployment);
    },
  },
};
