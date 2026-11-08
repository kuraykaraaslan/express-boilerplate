/** The observability OpenAPI 3.1 document, contributed to the API docs (`api_doc:openapi-source`, work order 2 item 10). The same document `GET /api/observability/openapi` serves. */
import { observabilityOpenApi } from './config/config.openapi'

const provider = {
  async listDocuments(_tenantId: string) {
    return [{ key: 'rest', document: observabilityOpenApi() }]
  },
}

export default provider
