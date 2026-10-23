# BankStream application API

All endpoints, including `/api/config`, require the configured identity middleware; dashboard data routes also enforce role access. The demo supplies demo roles. Production customer row and sensitive-field access must come from the trusted identity gateway described in [architecture.md](architecture.md). JSON request bodies are limited by Express and errors use `{ "error": { "code", "message" } }`.

| Method and path | Purpose |
|---|---|
| `GET /api/config` | Safe runtime mode, provider configured flag, and auth mode; never returns credentials. |
| `GET /api/dashboard` | Single-request snapshot for UI refresh: config permissions, overview, recommendations, products, operations, and fraud dashboard. |
| `GET /api/overview` | Business KPIs and source-derived chart series, including account, transaction, KYC, and payment status distributions. Currency values remain grouped. |
| `GET /api/customers?q=&segment=&page=&pageSize=` | Customer directory. Page size defaults to 5 and is capped at 100. |
| `GET /api/customers/:customerId/360` | Authorized customer relationship, source records, timeline, and recommendations. |
| `GET /api/transactions?q=&stage=&status=&currency=&from=&to=&minAmount=&maxAmount=&page=&pageSize=` | Filtered/paged transactions. Page size defaults to 5 and is capped at 100. Amounts accept up to four decimal places. |
| `GET /api/products` | Loans, repayments, cards, term deposits, and payments. |
| `GET /api/operations` | Cases, interactions, KYC, offers/campaigns, consent, and preferences. |
| `GET /api/recommendations` | Scoped proposed and in-flight actions, source evidence, and status history. |
| `PATCH /api/recommendations/:recommendationId` | Assign/update action status. Completing requires `outcome`; rejecting requires a reason in `outcome`. Investigator/supervisor only. |
| `POST /api/assistant/chat` | Body `{ "customerId"?: "...", "message": "..." }`; the backend retrieves authorized context and sends minimized records to DeepSeek. |
| `GET /api/fraud/dashboard` | Rule-based potential indicators with evidence, correlated product context, and investigation state. Indicators are not confirmed fraud. |
| `PATCH /api/fraud/investigations/:alertId` | Human review and audit trail for optional indicators. |

The assistant does not accept arbitrary database queries or trust browser-supplied conversation history. A missing DeepSeek key yields a clear provider-unavailable response; local rules and dashboard data still work.
