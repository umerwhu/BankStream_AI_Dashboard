# BankStream AI Dashboard

## Introduction

The Customer 360 Banking Demo brings customer, account, transaction, and CRM data together from separate banking systems. **TapData CDC** captures changes, transformations build a unified **Customer 360** model in MongoDB, and **published APIs** supply the dashboard.

BankStream AI Dashboard displays this integrated data and provides **AI Analysis, AI Chat, and suggested next actions**. It is a reference application for internal training, partner demonstrations, and development.

## Architecture

![BankStream AI Dashboard architecture](docs/images/BankStream_AI_System_Architecture.png)

```text
AS400 + Oracle → TapData CDC → FDM (MongoDB)
    → MDM (MongoDB Customer 360) → TapData APIs → AI Dashboard
```

AS400 holds core banking records, and Oracle holds CRM data. TapData replicates source data into FDM, then joins and transforms it into MongoDB MDM models. The dashboard reads published APIs through its Node.js backend. TapData maintains the models; API and AI credentials stay on the backend.

## Dashboard Preview

![BankStream AI Dashboard UI](docs/images/dashboard.jpg)

## Prerequisites

- Git, npm, and Node.js 22.9+ or 20.18+ for the dashboard.
- IBM i / AS400 (DB2 for i) and Oracle with demo schemas and sample data.
- TapData and MongoDB, with network access and permissions for CDC, transformations, and API publishing.
- Published TapData API URLs and authentication credentials accessible from the dashboard host.
- A DeepSeek or OpenAI API key and provider connectivity for live AI features.

The complete demo uses three repositories: **BankStream Feeder** for source preparation and activity, **Tapdata_Tasks** for integration and APIs, and **BankStream_AI_Dashboard** for the user interface. Each repository documents its own setup requirements.

## Deployment Guide

Complete the following steps in order. Detailed source and pipeline setup belongs in the companion guides; dashboard installation is covered here.

### Step 1 — Prepare Source Databases (BankStream Feeder)

Prepare the AS400 and Oracle schemas, tables, and sample data before configuring the pipeline. Ensure the demo customer and linked account records are available.

Follow the [BankStream Feeder README](https://github.com/umerwhu/BankStream_Feeder#readme) and its linked database preparation documentation for setup instructions.

### Step 2 — Configure TapData (Tapdata_Tasks)

TapData handles CDC replication, transformations, MongoDB MDM models, and published APIs. Follow the [Tapdata_Tasks README](https://github.com/umerwhu/Tapdata_Tasks#readme) to configure and deploy the pipeline.

Start stages in this order: **Replication → Transformation → Published APIs**. Confirm the APIs return expected customer and banking records before starting the dashboard.

### Step 3 — Deploy BankStream AI Dashboard

1. **Clone the dashboard repository.**

   ```sh
   git clone https://github.com/umerwhu/BankStream_AI_Dashboard.git
   cd BankStream_AI_Dashboard
   ```

2. **Install dependencies.**

   ```sh
   npm ci
   ```

3. **Copy the example configuration.** Choose the command for your terminal.

   Windows PowerShell:

   ```powershell
   Copy-Item .env.example .env
   ```

   Linux/macOS:

   ```sh
   cp .env.example .env
   ```

4. **Select the TapData data source.** Edit `.env`:

   ```ini
   DATA_SOURCE=tapdata
   ```

5. **Configure TapData API access and AI credentials** in `.env`, using [.env.example](.env.example) as a reference. Assign real values to the following settings:

   | Settings | What to enter |
   | --- | --- |
   | `TAPDATA_API_BASE_URL` | Your published TapData API base URL. |
   | `TAPDATA_TOKEN_URL` | Your TapData OAuth token endpoint URL. |
   | `TAPDATA_CLIENT_ID` | Your TapData OAuth client ID. |
   | `TAPDATA_CLIENT_SECRET` | Your TapData OAuth client secret. |
   | `AI_PROVIDER`, `AI_MODEL`, `AI_BASE_URL` | Your provider (`deepseek` or `openai`), model, and matching API root. Keep the existing values if using the configured DeepSeek model and endpoint. |
   | `DEEPSEEK_API_KEY` or `OPENAI_API_KEY` | Your real API key for the selected provider. Only that provider's key is required. |

   Other settings can retain their existing values for the reference integration. Keep `.env` and real credentials out of Git.

   See [API integration documentation](docs/api-integration.md) for authentication, service mappings, pagination, and response requirements.

6. **Run tests, then start the dashboard.** Continue after the tests pass.

   ```sh
   npm test
   npm run service:start
   npm run service:status
   ```

7. **Open http://127.0.0.1:3001.** Confirm customer and transaction data appears, then try AI Analysis and AI Chat. Restart with `npm run service:restart` after changing `.env`.

   For foreground operation, use `npm start` and stop with **Ctrl+C**. Background mode does not automatically restart after a computer reboot.

For a UI preview without live integration, set `DATA_SOURCE=demo`. Sample data does not demonstrate CDC.

**Optional LAN access:** Set `HOST=0.0.0.0` and the desired `PORT` in `.env`, restart, and use the LAN URL shown by service status from another computer. The default `HOST=127.0.0.1` allows access only on the host. `0.0.0.0` is a listening address, not a browser URL. Your host firewall and network must permit the connection; the application does not configure them. Production requires the existing trusted identity proxy and network controls.

## Live CDC Demonstration

1. Open the dashboard, select a customer, and note a transaction, balance, or KYC value.
2. Use BankStream Feeder to generate a transaction or KYC update for that customer. Follow the [Feeder README](https://github.com/umerwhu/BankStream_Feeder#demo-commands) for all simulation and verification commands.
3. Allow TapData to capture the source change and process it through FDM, MDM, and the published APIs.
4. Refresh or reopen the dashboard view and confirm the same customer's updated information.

Allow for the backend cache (`TAPDATA_CACHE_TTL_MS`, 10 seconds in the example). API reads have configured scan limits, so choose a record included in the returned data. A successful API request or AI response alone does not confirm CDC health; use the companion guides to verify the pipeline.

## Dashboard Features

![BankStream AI Dashboard UI](docs/images/dashboard.jpg)

| Area | What it shows |
| --- | --- |
| Overview | Customer and transaction KPIs, segments, and top recommendations. |
| Customer 360 | Unified customer details and related banking information. |
| Transaction & Fraud Intelligence | Transaction activity, filters, review signals, and investigation context. |
| AI Analysis | AI-assisted insights from available customer data. |
| AI Chat | Natural-language questions through the configured AI provider. |
| Next Best Actions | Suggested service or engagement follow-ups. |

Fraud indicators are deterministic review signals, not confirmed fraud. AI suggestions require human review before any banking action.

## Essential Dashboard Commands

Run these from the dashboard repository:

| Action | Command |
| --- | --- |
| Start in the background | `npm run service:start` |
| Stop with confirmation | `npm stop` |
| Restart | `npm run service:restart` |
| Show status and addresses | `npm run service:status` |
| View recent logs | `npm run logs` |

At the stop prompt, enter `y` to stop; other answers cancel. For non-interactive shutdown, use `npm stop -- --yes`. Restart does not ask for shutdown confirmation.

## Troubleshooting

| Problem | What to do |
| --- | --- |
| Dashboard cannot start | Check Node.js version, run `npm ci`, confirm `.env` is in the project folder, and check that the configured port is free. View `npm run logs`. |
| TapData API connection fails | Check API URL/path, published service names, OAuth credentials, and network access. See [API integration details](docs/api-integration.md). |
| Customer or transaction data is missing | Confirm `DATA_SOURCE=tapdata` and restart. Check API results, service mappings, and scan limits in the [integration guide](docs/api-integration.md). |
| AI features do not work | Check provider, model, API root, key, and connectivity. Restart after configuration changes and inspect backend logs. |

For source database or simulation issues, use the [Feeder documentation](https://github.com/umerwhu/BankStream_Feeder#readme). For replication, transformation, or API publishing issues, use the [Tapdata_Tasks guide](https://github.com/umerwhu/Tapdata_Tasks#readme).

## Related Projects

| Repository | Purpose |
| --- | --- |
| [BankStream Feeder](https://github.com/umerwhu/BankStream_Feeder) | Source schema/sample-data scripts and commands to generate banking activity. |
| [Tapdata_Tasks](https://github.com/umerwhu/Tapdata_Tasks) | CDC replication, transformations, MongoDB MDM models, and published API packages. |
| [BankStream AI Dashboard](https://github.com/umerwhu/BankStream_AI_Dashboard) | Customer 360 dashboard, transaction intelligence, and AI-assisted insights. |
