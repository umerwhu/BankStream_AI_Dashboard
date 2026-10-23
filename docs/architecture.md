# Architecture and business rules

## Data path

```text
IBM i Db2 for i ─┐
                 ├─ TapData CDC/integration ─ MongoDB and/or documented integrated APIs
Oracle CRM ──────┘                                  │
                                              Node.js backend
                                  ┌──────────────────┼───────────────────┐
                             Customer 360     rule-based NBA    DeepSeek/OpenAI
                                  │                  │                │
                                  └──── dashboard + audited workflows ┘
```

The browser only calls this backend. `DATA_SOURCE` chooses one data path; the app does not query both sources and silently merge conflicting records. TapData API mode uses the configurable published-find client; MongoDB mode reads only collections explicitly mapped by the operator. Both adapters expose arrays keyed by the exact original source table names from the DDL. The provided DDL is the field/relationship reference; actual TapData and Mongo deployments remain the source for endpoint envelopes, collection names, BSON types, indexes, freshness, and filtering.

## Modules

- `src/config` — environment configuration.
- `src/routes` — authenticated dashboard, customer, assistant, recommendation, and optional indicator APIs.
- `src/middleware` — authentication claims, role checks, request limits, security headers, and normalized errors.
- `src/services/customer-intelligence-service.js` — portfolio metrics, paged directory, Customer 360 aggregation, timeline, and minimized AI context.
- `src/services/recommendation-service.js` — deterministic evidence-based NBA generation and lifecycle validation.
- `src/services/fraud-intelligence-service.js` — source projection, customer scope, and optional transaction indicators.
- `src/integrations/mongodb` — configured MongoDB collections keyed by the original DDL table names and bounded repository.
- `src/integrations/tapdata/client.js` — published-find API client, OAuth2 client credentials, route mapping by original source table, and bounded pagination.
- `src/services/banking-api-client.js` — legacy configurable single-bundle API client.
- `src/services/ai-service.js` — server-side DeepSeek/OpenAI-compatible chat-completions provider client with grounded decision-support instructions.
- `src/repositories` — recommendation/investigation persistence (PostgreSQL or single-process JSON demo state).
- `public` — responsive dashboard UI.

## Customer 360 joins

Joins follow the supplied DDL:

- `CUSTOMER.CUSTOMER_ID = CUSTOMER_PROFILE.CUSTOMER_ID`.
- Accounts attach to a customer through effective-dated `ACCOUNT_CUSTOMER_RELATIONSHIP`.
- Transactions join to accounts by `ACCOUNT_ID`; cards by `CARD_ID` and `CUSTOMER_ID`.
- Loans, repayments, term deposits, cards, payments, and KYC join using their declared DDL keys.
- CRM cases, interactions, addresses, offers, preferences, consent, and campaign responses join through `CUSTOMER_PROFILE_ID`.

The profile response is field-whitelisted. Contact fields, complete address, and case subject are returned only when the authenticated scope carries the sensitive-field permission. Account numbers are masked. DeepSeek context excludes email, phone, street address, and case subject.

## Business definitions

- Active customers: `CUSTOMER_STATUS='ACTIVE'`.
- Active accounts: `ACCOUNT_STATUS='ACTIVE'`.
- Relationship account balances: sum `BALANCE` of active accounts, grouped by source `CURRENCY`. This is not term-deposit principal.
- Loan exposure: sum `OUTSTANDING_BALANCE` grouped by source currency.
- Posted activity: completed `POSTED` transactions, excluding reversal events and originals explicitly linked to a reversal. Values are summed as supplied and grouped by currency; no FX conversion occurs.
- Overdue installments: records with `REPAYMENT_STATUS='OVERDUE'`.
- Open service cases: `OPEN`, `IN_PROGRESS`, or `WAITING_CUSTOMER`.
- Pending KYC follow-up: `PENDING`, `REVIEW_REQUIRED`, or `EXPIRED`.
- Upcoming maturities: active term deposits with a source maturity date from today through 30 days ahead.
- Growth and activity charts group the returned source records by their recorded opening/timestamp fields. They do not imply a complete historical series if the API/Mongo view is bounded.
- Portfolio balance questions are calculated server-side across the full authorized customer set, not the paged 20-customer directory sample. The ranking sums active `BANK_ACCOUNT.BALANCE` values per customer and source currency using active `ACCOUNT_CUSTOMER_RELATIONSHIP` rows. Currencies are ranked separately because no FX basis is configured. Full balances are attributed to each linked customer; no ownership-share field is available to apportion joint accounts. The answer context carries the TapData retrieval timestamp and account record references.

Missing values remain missing. Decimal arithmetic uses four-place scaled integers for aggregation. Cross-currency totals are never combined.

## NBA rules and lifecycle

`nba-rules-v1` proposes actions from recorded open service cases, KYC follow-ups, overdue repayments, repeated rejected payment instructions, near-term active term deposits, and potential transaction indicators. Stable IDs hash customer, rule, and evidence-record ID, making generation idempotent. The engine does not infer churn, eligibility, or fraud confirmation. A DeepSeek answer is conversational advice; it is not persisted as a structured recommendation unless an authorized human uses the recommendation workflow.

Statuses: `PROPOSED → ACCEPTED → IN_PROGRESS → COMPLETED`, with `REJECTED` and `CANCELLED` from permitted states. Completion outcomes and rejection reasons are required. All updates include actor/time and are persisted to PostgreSQL when configured.

## Access and session controls

In production, `TRUST_IDENTITY_PROXY=true` is only valid behind a gateway that strips caller-provided identity headers and overwrites them from verified claims. Customer row scope comes from trusted `x-authorized-customer-ids` or portfolio access. Sensitive fields require the trusted `x-authorized-sensitive-fields=true` claim. The demo has broad demo roles; it is not a production identity implementation. Chat history is deliberately not accepted from the browser backend request, and the UI clears the conversation when switching customer context.
