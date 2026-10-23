# TapData API and MongoDB integration guide

## Integration evidence available

The repository includes the user-provided Db2 for i and Oracle DDL, summarized in [source-model.md](source-model.md). The configured TapData environment was checked against the published `MDM_CUSTOMER360` route. A bounded request returned HTTP 200 with a `data` array, `count`, and `api_monit_info`; only field names and response shape were inspected. This does not establish that every published table service is available or that MongoDB schemas have been verified.

The app offers two mutually exclusive live source adapters. Confirm the actual configured deployment before selecting either. It does not query both and auto-merge them.

## TapData published MDM API

The configured deployment publishes `MDM_CUSTOMER360` at `/api/v1/MDM_CUSTOMER360`. The screenshot lists original source-table services with paths such as `/v1/CUSTOMER_PROFILE`; the API base path adds `/api`, as verified against the Customer 360 service. The adapter in `src/integrations/tapdata/client.js` uses GET query mode with TapData's `filter` JSON query parameter and `limit`/`skip` pagination. A bounded, one-row check returned HTTP 200 for the listed loan, repayment, payment, deposit, KYC, interaction, case, offer, preference, consent, and campaign-response services.

The dashboard keeps the original table names for the 20 in-scope DDL tables as its internal bundle keys. `TAPDATA_COLLECTION_MAP` overrides only `CUSTOMER` to the confirmed `MDM_CUSTOMER360` service. Its nested records supply `BANK_BRANCH`, `BANK_ACCOUNT`, `ACCOUNT_CUSTOMER_RELATIONSHIP`, `ACCOUNT_TRANSACTION`, `CARD`, `CUSTOMER_PROFILE`, and `CUSTOMER_ADDRESS`. Other confirmed published services are queried under their original table names. The document table is outside the application scope and is not queried, stored, or displayed.

Configure server-side `.env` values:

```dotenv
DATA_SOURCE=tapdata
TAPDATA_API_BASE_URL=<configured-host>
TAPDATA_FIND_PATH_TEMPLATE=/api/v1/{collection}
TAPDATA_COLLECTION_MAP={"CUSTOMER":"MDM_CUSTOMER360"}
TAPDATA_TOKEN_URL=https://<configured-auth-host>/oauth/token
TAPDATA_CLIENT_ID=
TAPDATA_CLIENT_SECRET=
TAPDATA_TOKEN_AUTH_METHOD=client_secret_post
TAPDATA_PAGE_SIZE=200
TAPDATA_SCAN_LIMIT=1000
```

OAuth supports `client_secret_post` and `client_secret_basic`. A configured fixed bearer token is available for local debugging only. No credentials from the reference environment should be copied into this repository. `.env` is git-ignored.

The verified Customer 360 response uses `data` as its record array and `count` as its total. Query pagination follows the published API contract: `filter` contains `limit` and zero-based `skip`. The adapter also accepts common record-array wrappers and stops at a short page, reported total, or scan limit. See the [TapData API creation guide](https://docs.tapdata.io/publish-apis/create-api-service/) and [REST query guide](https://docs.tapdata.io/publish-apis/query/query-via-restful/). Stand-alone account/transaction/card/profile/address routes returned 404 during the check; the verified Customer 360 payload includes those entities nested under customer/account records.

The service returns arrays keyed by the original DDL source names and requires non-empty `CUSTOMER`, `BANK_ACCOUNT`, `ACCOUNT_CUSTOMER_RELATIONSHIP`, and `ACCOUNT_TRANSACTION` feeds. Other mapped source tables may be absent and render as unavailable/empty sections. The current portfolio call scans each mapped table sequentially up to its configured per-table limit; this is a bounded demo integration, not a production portfolio query strategy. For production, use approved server-side filtering/aggregation or a documented customer-scoped API to avoid incomplete metrics and excessive API calls.

TapData API monitoring status, freshness, and CDC lag are not inferred from successful `find` calls. Add the documented monitoring API separately when available.

## MongoDB CDC target

1. Inspect the TapData target configuration and MongoDB database; record collection names, sample documents, field BSON types, nested vs. flat layout, keys, update semantics, indexes, and CDC metadata.
2. Map the actual collections to the provided source tables. Configure `MONGODB_URI`, optional `MONGODB_DATABASE`, and JSON `MONGODB_COLLECTION_MAP` server-side. Example **shape only**—replace all values with inspected collection names:

```json
{"CUSTOMER":"verified_customer_collection","BANK_ACCOUNT":"verified_account_collection","ACCOUNT_CUSTOMER_RELATIONSHIP":"verified_relationship_collection","ACCOUNT_TRANSACTION":"verified_transaction_collection"}
```

3. Install the MongoDB driver when network/package installation is available: `npm install mongodb`.
4. Set `DATA_SOURCE=mongodb`. The repository applies bounded reads (`MONGODB_READ_LIMIT`) and uses DDL-key filters for a one-customer scope. It requires at minimum the three transaction-monitor arrays. For a complete Customer 360, map every collection that the deployment actually provides.
5. Verify identifier representation. Customer IDs originate as Db2 `BIGINT` and Oracle `NUMBER(19)`; a MongoDB connector may encode them as BSON Long, Decimal128, string, or another type. The adapter currently queries string and BSON Long for one-customer scope. If your TapData schema uses another representation or nested documents, update the adapter using inspected samples; do not coerce large IDs through unsafe JavaScript numbers.
6. Create or confirm indexes with the MongoDB owner. Candidate DDL-key patterns include customer ID, profile ID, account ID + transaction timestamp, and loan account ID + due date. This app does not create indexes automatically.
7. Add documented CDC freshness markers, idempotency keys, and source/target reconciliation only after their actual fields are known. Mongo retrieval time is not reported as source freshness.

The current generic portfolio read is bounded per mapped collection, not a substitute for production aggregation pipelines or a full tenant/row-level access design. For large collections, replace it with indexed, scoped query methods or integrated API aggregations before production.

## Source of truth and consistency

Choose one configured runtime source. Do not silently merge API/Mongo values or fall back to the other source on error. Confirm authoritative origin by table (core banking vs CRM), CDC lag semantics, duplicate delivery handling, update/delete behavior, and stale/conflicting record policy with the deployment owner. Record freshness only from a documented source field. If unavailable, UI says “not supplied by source.”

Demo mode is isolated and explicitly labeled. `DATA_SOURCE=demo` is the only mode that loads `src/data/demo-fraud-bundle.js`; upstream failures produce an error rather than demo fallback.

## AI and data minimization

Customer context is fetched server-side after row-scope authorization. A field whitelist removes contact and street address data from DeepSeek context; the UI's sensitive fields are controlled separately. The model receives at most one customer’s bounded products, 50 latest returned transactions, up to 10 recommendations/indicators, or a bounded portfolio summary/customer sample. It cannot issue SQL, MongoDB queries, or arbitrary API requests. Audit logs should record actor, request type, customer ID, source, model, and outcome metadata without storing prompts that contain personal data.

## Portfolio AI context and fraud review

Portfolio chat receives backend-computed portfolio metrics and balance leaders, a 20-customer directory sample (clearly counted against the authorized total), up to 20 potential fraud indicators, and bounded lists of KYC follow-ups, overdue repayments, rejected/failed payment instructions, and maturities. Per-list caps are returned as context metadata; DeepSeek is instructed to disclose those limits before claiming the portfolio search is exhaustive. Customer-specific chat continues to use the selected customer's authorized Customer 360 context.

The transaction page includes a rule-based alert queue with severity/pattern charts, search and filters, evidence inspection, customer/transaction drill-down, AI explanations, assignment, and investigator status updates. These operations use the existing fraud investigation API/repository and require the investigator or supervisor role. They do not block cards/accounts, reject payments, or alter core banking records.

## Monitoring APIs

The health page only reports whether a source/provider is configured. TapData pipeline state, CDC lag, sync timestamps, record counts, data-quality exceptions, AI request latency and failure rate require actual monitoring APIs or telemetry. Add their documented adapters before displaying such metrics; do not infer connectivity from a successful dashboard data request.
