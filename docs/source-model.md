# Source data model reference

Derived from the user-provided DDL attachment. BANKCORE is IBM i Db2 for i; C##BANKCRM is Oracle. The cross-system key is `BANKCORE.CUSTOMER.CUSTOMER_ID = C##BANKCRM.CUSTOMER_PROFILE.CUSTOMER_ID`. Source systems are not queried directly by the browser or this demo backend; configured integrated-data APIs remain the application boundary.

## BANKCORE (11 tables)

| Table | Key fields and joins | Dashboard use |
|---|---|---|
| `CUSTOMER` | `CUSTOMER_ID` PK; `CUSTOMER_NAME`, `CUSTOMER_TYPE`, `DATE_OF_BIRTH`, `BRANCH_CODE`, `CUSTOMER_STATUS`, `OPENING_DATE` | Customer identity and status |
| `BANK_BRANCH` | `BRANCH_CODE` PK; `BRANCH_NAME`, `CITY`, `COUNTRY`, `BRANCH_STATUS` | Branch labels |
| `BANK_ACCOUNT` | `ACCOUNT_ID` PK; `ACCOUNT_NUMBER`, `ACCOUNT_TYPE`, `CURRENCY`, `BALANCE`, `AVAILABLE_BALANCE`, `ACCOUNT_STATUS` | Accounts and balances |
| `ACCOUNT_CUSTOMER_RELATIONSHIP` | Composite PK `ACCOUNT_ID`,`CUSTOMER_ID`; `OWNERSHIP_ROLE`, effective dates | Account ownership and authorized access |
| `ACCOUNT_TRANSACTION` | `TRANSACTION_ID` PK; `ACCOUNT_ID`, optional `CARD_ID`, `TRANSACTION_TYPE`, `TRANSACTION_STAGE`, `TRANSACTION_STATUS`, `TRANSACTION_AMOUNT`, `CURRENCY`, timestamp, `RELATED_TRANSACTION_ID` | Activity; stage distinguishes authorization, posting, reversal |
| `CARD` | `CARD_ID` PK; `CUSTOMER_ID`, optional account, `CARD_TYPE`, masked number, `CARD_STATUS`, expiry, credit limit | Card holdings |
| `LOAN_ACCOUNT` | `LOAN_ACCOUNT_ID` PK; `CUSTOMER_ID`, `LOAN_TYPE`, amounts, rate, dates, `LOAN_STATUS` | Loan exposure and upcoming due dates |
| `LOAN_REPAYMENT` | `REPAYMENT_ID` PK; `LOAN_ACCOUNT_ID`, due/paid amounts, dates, `REPAYMENT_STATUS` | Repayment schedule and arrears |
| `PAYMENT_BENEFICIARY` | `BENEFICIARY_ID` PK; `CUSTOMER_ID`, beneficiary fields, status | Payment counterparties; mask sensitive fields |
| `PAYMENT_INSTRUCTION` | `PAYMENT_ID` PK; `CUSTOMER_ID`, source account, optional beneficiary, amount, currency, timestamp, status | Payment queue |
| `TERM_DEPOSIT` | `TERM_DEPOSIT_ID` PK; `CUSTOMER_ID`, funding account, principal, currency, rate, open/maturity dates, status | Deposit maturity view |

## C##BANKCRM (9 tables used by the dashboard)

| Table | Key fields and joins | Dashboard use |
|---|---|---|
| `CUSTOMER_PROFILE` | `CUSTOMER_PROFILE_ID` PK; unique `CUSTOMER_ID`; email, phone, country, segment, preferred channel | CRM profile linked to BANKCORE customer |
| `CUSTOMER_ADDRESS` | `ADDRESS_ID` PK; `CUSTOMER_PROFILE_ID`, address, primary flag, valid dates | Address, subject to field permissions |
| `CUSTOMER_KYC` | `KYC_RECORD_ID` PK; unique `CUSTOMER_ID`; status, risk rating, review dates | KYC follow-up |
| `CUSTOMER_SERVICE_CASE` | `SERVICE_CASE_ID` PK; `CUSTOMER_PROFILE_ID`, type, subject, priority, status, timestamps, assigned team | Service queue and SLA calculations (SLA target must be separately configured) |
| `CUSTOMER_INTERACTIONS` | `CUSTOMER_INTERACTION_ID` PK; profile, timestamp, type, channel, summary, optional case | Relationship timeline |
| `CUSTOMER_OFFERS` | `PRODUCT_OFFER_ID` PK; profile, product code, offer type/status, offer and expiry dates | Offer outcomes |
| `CUSTOMER_PREFERENCE` | `CUSTOMER_PREFERENCE_ID` PK; profile, language, delivery, channel, do-not-contact flag | Contact controls |
| `CUSTOMER_CONSENT` | `CONSENT_ID` PK; profile, consent type/status, captured timestamp/channel | Consent validation |
| `CUSTOMER_CAMPAIGN_RESPONSE` | `CAMPAIGN_RESPONSE_ID` PK; profile, campaign, response status, sent/responded timestamps, channel | Campaign reporting |

The DDL defines valid enum values and foreign keys. Monetary columns use `DECIMAL(19,4)`; preserve currency and decimal precision in API contracts. Transaction totals should count only appropriate posted/completed records and account for reversals using documented rules; authorizations must not be counted as posted activity. Never derive an absent field as zero.

## Fraud rule join and context

Rule-based potential indicators include rapid completed postings, same-account/same-type amount outliers, repeated rejected transaction records, repeated reversals, and repeated posted withdrawals. Rejected and reversal events are analyzed as event signals but are excluded from posted transaction totals. Repeated-event thresholds are configurable through `FRAUD_REPEATED_FAILURE_WINDOW_HOURS` and `FRAUD_REPEATED_FAILURE_COUNT`. These thresholds are operational heuristics, not validated fraud predictions. All alerts expose their rule code, evidence references, configured threshold, and supporting activity to investigators.

The rapid-activity, withdrawal, and amount-outlier rules screen `ACCOUNT_TRANSACTION` records only after joining valid `ACCOUNT_ID` values to `BANK_ACCOUNT`. Customer attribution uses active `ACCOUNT_CUSTOMER_RELATIONSHIP` rows. `CARD_ID` is contextual and joins to `CARD`; card ownership can also be checked through `CARD.CUSTOMER_ID`. Amount baselines group by account, currency, and the source `TRANSACTION_TYPE`. `TRANSACTION_STAGE`, `TRANSACTION_STATUS`, and `RELATED_TRANSACTION_ID` exclude authorizations, non-completed rows, reversals, and completed originals referenced by a reversal from posted activity totals.

CRM and product context is joined only through DDL keys: loans/cards/payments/KYC by `CUSTOMER_ID`; repayments by `LOAN_ACCOUNT_ID`; CRM cases/interactions/preferences/consent by `CUSTOMER_PROFILE_ID`. Sensitive columns such as national ID, email, phone, address, case description, and payment reference are not sent to the browser or DeepSeek in the current response projection. Account numbers are masked. This projection is not a replacement for a deployed bank field-level authorization policy.

Fraud alerts carry additional masked context when available: high KYC rating records, active account-customer relationships, payment instructions sourced from the same account, and linked beneficiary IDs/status. The UI and AI treat these as context only; they do not independently change severity or establish causation. Beneficiary names, bank names, and account references are not copied into this fraud context.
