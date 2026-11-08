import { listFilter, listQuerySchema } from '@kuraykaraaslan-labs/common/server/common.list-query';
import { z } from 'zod';

export const GRANT_SORTABLE = { createdAt: 'createdAt', lastUsedAt: 'lastUsedAt', clientName: 'clientName' } as const;
export const GRANT_STATUSES = ['active', 'suspended', 'revoked'] as const;

/** The Connected apps list (phase 43 list contract): page, pageSize, search (app name or host), sort, status. */
export const ListGrantsQuery = listQuerySchema({
  sortable: GRANT_SORTABLE,
  defaultSort: 'createdAt:desc',
  pageSize: { default: 20, max: 100 },
  filters: {
    status: listFilter.oneOf(GRANT_STATUSES),
  },
});
export type ListGrantsQuery = z.infer<typeof ListGrantsQuery>;
