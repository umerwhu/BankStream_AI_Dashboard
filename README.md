# BankStream AI Dashboard

**Real-time Banking Customer 360, Transaction Intelligence, and AI-Powered Insights — built with TapData.**

BankStream AI Dashboard is a reference banking application that turns information from separate banking systems into a unified, continuously updated customer experience. It demonstrates how **TapData's change data capture (CDC), data transformation, and published APIs** can support an operational dashboard and AI-assisted customer insights.

> **Who is this for?** Banking teams, solution architects, pre-sales engineers, partners, and developers who want to explore or demonstrate an end-to-end real-time data integration use case.
>
> **Project scope:** This is a demonstration/reference application only

## Why we built this demo

Banks often store customer profiles, accounts, transactions, and service interactions in different systems. Building a complete customer view can require manual exports, separate queries, and integration work that makes data stale or difficult to use.

This demo answers a practical question:

**How can a bank combine changes from its core banking and CRM systems into one current Customer 360 view, expose it through APIs, and use that data for dashboards and AI-assisted decisions?**

The demonstration highlights three capabilities:

1. **Real-time integration:** TapData captures inserts and updates from IBM i (DB2 for i / AS/400) and Oracle without relying on repeated manual exports.
2. **Unified customer data:** TapData transformations join and organize replicated records into a customer-oriented model, and build MDM models directly in MongoDB, including the unified Customer 360 model.
3. **Data-to-action:** TapData published APIs provide the dashboard with integrated data for customer exploration, transaction review, and AI-assisted analysis and recommendations.

### What value does it demonstrate?

| Challenge | Demonstrated approach | Business value |
| --- | --- | --- |
| Customer information is spread across systems | Use TapData to join core banking and CRM data and build MongoDB MDM models | A more complete customer view |
| Data changes frequently | Replicate source changes with CDC | More timely information for users |
| Each application needs custom database integration | Publish reusable TapData APIs | Simpler consumption of integrated data |
| Analysts must review many transactions | Show activity and deterministic review indicators | Easier prioritization of potential issues |
| Customer data is difficult to interpret quickly | Add AI-assisted analysis and recommendations | More actionable context for banking teams |

## Architecture: how the pieces connect

![BankStream AI Dashboard architecture](docs/images/BankStream_AI_System_Architecture.png)

**End-to-end flow:**

```text
IBM i / DB2 for i (AS/400)     Oracle CRM
            \                   /
             \                 /
                 TapData CDC
                      |
              FDM (Mongodb) replicated data
                      |
        TapData joins and transformations
                      |
       MongoDB MDM models (Customer 360)
                      |
             TapData published APIs
                      |
           BankStream backend (Node.js)
                      |
                Web dashboard
                      |
        AI Analysis / AI Chat / Insights
                 (DeepSeek / OpenAI)
```

**Important architecture details:**

- **TapData builds and maintains the MDM models in MongoDB** by joining, transforming, and aggregating replicated source data. MongoDB stores the resulting models, including Customer 360; the dashboard does not build these models.
- TapData performs replication, integration, transformation, and API publishing; the dashboard is a **consumer** of the resulting published APIs.
- The **backend** communicates with TapData APIs. The browser does **not** connect directly to TapData.
- AI provider credentials stay on the backend. AI features use the application's configured integration and accessible data.
- The dashboard's data-source modes are **alternatives**, not simultaneously combined sources.

## What you can explore

![BankStream AI Dashboard UI](docs/images/dashboard.jpg)

| Dashboard area | What it shows | What to look for |
| --- | --- | --- |
| **Overview** | Customer and transaction KPIs, customer segmentation, and top recommendations | A high-level picture of banking activity and priorities |
| **Customer 360** | Unified customer details and related banking information | How records from different systems appear together for one customer |
| **Transaction & Fraud Intelligence** | Transaction activity, filters, failed or flagged records, and investigation context | How potentially important transactions are surfaced for review |
| **AI Analysis** | AI-assisted customer insights | How integrated customer information can support interpretation |
| **AI Chat** | Conversational interaction through the configured AI provider | How users can explore information with natural-language questions |
| **Next Best Actions** | Suggested follow-up actions | How customer context can inform service or engagement priorities |

**Interpretation:** Fraud indicators are deterministic **review signals**, not confirmed fraud. AI suggestions require human review before any banking action.

## Deploy the full TapData banking demo

The **Full TapData Demo** is the recommended way to demonstrate the complete banking workflow:

**Source Databases → TapData CDC → FDM → MDM → Published APIs → AI Dashboard**

For a quick UI preview without live banking connections, Demo Mode is also supported: set `DATA_SOURCE=demo` in `.env`, then use the same test and service commands below. Demo data does not demonstrate live CDC updates.

| Mode | Best for | What you need |
| --- | --- | --- |
| **Full TapData Demo (recommended)** | Demonstrating the complete real-time banking flow | Source databases, imported and running TapData tasks, published APIs, and dashboard configuration |

### Prerequisites and repository dependencies

For the Full TapData Demo, have these ready before starting:

- Access to IBM i / DB2 for i and Oracle, with permission to prepare the sample schemas/data and configure CDC as described in [BankStream Feeder](https://github.com/umerwhu/BankStream_Feeder).
- A TapData environment that can reach both source databases and the MongoDB target, with access to import/configure tasks and publish APIs. Follow [TapData Tasks](https://github.com/umerwhu/Tapdata_Tasks) for connection requirements and import instructions.
- A dashboard host that can reach the published TapData APIs and OAuth endpoint, with deployment-specific URLs and credentials. AI Analysis and AI Chat also require a supported provider, valid API key, and provider connectivity; see [AI Analysis and AI Chat](#ai-analysis-and-ai-chat).

The repositories depend on one another in this order: **BankStream Feeder** prepares source schemas/data → **TapData Tasks** replicates that data into FDM, transforms it into MongoDB MDM models, and publishes APIs → **BankStream AI Dashboard** consumes those APIs. The Feeder simulator generates subsequent source changes; it does not replace TapData replication or transformation tasks. Repository roles and links are also listed under [Related projects](#related-projects).

Prepare the dashboard repository first:

**Prerequisites:** Node.js **22.9+** (or **20.18+**) and npm.

1. Clone the dashboard repository:

   ```sh
   git clone https://github.com/umerwhu/BankStream_AI_Dashboard.git
   cd BankStream_AI_Dashboard
   ```

2. Install dependencies:

   ```sh
   npm ci
   ```

### Full TapData Demo setup

Complete these steps in order. Confirm each stage is working before starting the next:

1. **Prepare source databases and data.** Follow the [BankStream Feeder](https://github.com/umerwhu/BankStream_Feeder) repository for IBM i / DB2 for i and Oracle schemas, sample data, and the simulator that generates inserts and updates.
2. **Import TapData replication tasks.** Follow the [TapData Tasks](https://github.com/umerwhu/Tapdata_Tasks) guide, update source/target connection settings, test the connections, and **start replication tasks first**.
3. **Import and start transformation tasks.** Confirm that replicated FDM data is available, then start the TapData transformations that build and update the MDM models in MongoDB, including Customer 360.
4. **Import and publish the API services.** Check service names, target table/collection names, and paths against the imported API package. Verify the published APIs return expected data.
5. **Configure the dashboard.** Copy `.env.example` to `.env`, then set `DATA_SOURCE=tapdata` and fill in the actual TapData API URL and OAuth settings using `.env.example` and [API integration documentation](docs/api-integration.md).
6. **Configure AI features.** Follow [AI Analysis and AI Chat](#ai-analysis-and-ai-chat) using your provider settings and key; these are required to demonstrate live AI responses.
7. **Run the automated tests.** Confirm they pass before starting the service:

   ```sh
   npm test
   ```

8. **Start the dashboard service:**

   ```sh
   npm run service:start
   npm run service:status
   ```

   Open **http://127.0.0.1:3001**. If already running, use `npm run service:restart`. For foreground operation, use `npm start` and stop with **Ctrl+C**.
9. **Verify the complete demo.** Follow the checklist and real-time update steps below before presenting it.

**Startup order matters:** **Replication → Transformation → Publish APIs → Dashboard**. Start the Feeder when you are ready to demonstrate changing source data.

The full pipeline and task import instructions live in the companion repositories rather than being duplicated here.

### Deployment checklist

- [ ] Source schemas and sample data are prepared, and TapData source/target connections pass their checks.
- [ ] Replication tasks are running with FDM data available; transformation tasks have populated the MongoDB MDM models.
- [ ] Published APIs return expected customer, account, relationship, and transaction data using the configured OAuth settings and service mapping; see [API integration documentation](docs/api-integration.md).
- [ ] The dashboard runs with `DATA_SOURCE=tapdata`, displays the API-backed customer data, and live AI features respond with the configured provider.

### Verify end-to-end data and real-time updates

1. **Establish a baseline.** Open Customer 360 and Transaction & Fraud Intelligence, select a customer/account returned by the published APIs, and note its identifier and a visible field or transaction. Compare with the corresponding API response.
2. **Run the Feeder.** In the [BankStream Feeder](https://github.com/umerwhu/BankStream_Feeder) repository, follow its documented simulator setup and run instructions using your source database connections. Generate a supported insert/update and record the affected customer/account/transaction identifier and changed value. Use the Feeder's documented controls to stop the simulator when finished.
3. **Trace the change through TapData.** Confirm the source record changed, replication processed it into FDM, and transformation updated the corresponding MDM record. Inspect task progress/errors in TapData; a successful API request alone does not confirm CDC health.
4. **Check the published API.** Request the relevant record and confirm the new value or transaction appears. If it does not, check the replication, transformation, and API stages before investigating the dashboard.
5. **Check the dashboard.** Allow for the configured backend cache lifetime (`TAPDATA_CACHE_TTL_MS` in `.env.example`), then refresh/reopen the affected view and compare the same identifier/value. API reads are bounded by the configured pagination/scan limits, so choose a record included in the returned data; see [API integration documentation](docs/api-integration.md). Do not use portfolio totals alone as proof that a particular change arrived.
6. **Check AI features.** Run AI Analysis and ask AI Chat about the selected customer's available data. Confirm both return responses; review them against the displayed data. AI text is advisory and is not evidence of CDC health or measured replication latency.

## Configuration and AI integration

The `.env` file controls runtime settings. Copy it from `.env.example`, then set values appropriate to your environment. **Never commit `.env` or real credentials.**

### Data source selection

Set `DATA_SOURCE=tapdata` for this deployment:

| Setting | Meaning |
| --- | --- |
| `tapdata` | TapData published API integration — recommended for the full banking demo |


For live TapData use, check that the API base URL, OAuth credentials, published service names, and paths match your deployed environment. See [docs/api-integration.md](docs/api-integration.md) and [docs/architecture.md](docs/architecture.md).

### AI Analysis and AI Chat

Configure a supported **DeepSeek or OpenAI** provider and its API key using the settings already documented in `.env.example`. Restart the app after changing `.env`.

AI functionality depends on valid credentials, provider availability, and the customer/transaction data accessible to the application. Generated content is advisory, not an automated banking decision.

## Running in the background

After `npm test` passes, start the application without keeping the terminal open:

```sh
npm run service:start
```

| Command | Action |
| --- | --- |
| `npm run service:start` | Start the dashboard in the background |
| `npm run service:status` | Show process status, configuration, and network addresses |
| `npm run logs` | View recent logs |
| `npm run service:restart` | Restart after configuration changes without a confirmation prompt |
| `npm stop` | Ask for confirmation before stopping the background process |
| `npm stop -- --yes` | Stop without prompting, including in automation |

The shorter `npm run status` and `npm run restart` commands remain supported.
`npm run service:stop` uses the same confirmation flow as `npm stop`.

### Shutdown confirmation

In an interactive terminal on Windows PowerShell, Linux, or macOS, `npm stop` asks:

```text
⚠ Are you sure you want to stop the dashboard? (y/N):
```

Enter `y` or `Y` to run the existing shutdown logic and display the shutdown
banner. Enter `n`, `N`, or press Enter to cancel. The default is **No**; any
other answer also cancels. Cancellation leaves the service running and exits
successfully with:

```text
Shutdown cancelled — dashboard is still running.
```

Non-interactive commands cancel immediately without waiting for input. For scripts
or automated shutdown, explicitly pass `--yes`:

```sh
npm stop -- --yes
# Equivalent service alias:
npm run service:stop -- --yes
```

`npm run service:restart` (and `npm run restart`) still stops and starts the service
without asking for shutdown confirmation. Foreground `npm start` continues to use
Ctrl+C to stop.

Process information is saved under `STATE_DIR` (default `var/`), and logs under `LOG_DIR` (default `logs/`). Background mode does **not** automatically restart after a computer reboot; use a host service manager if required.

### LAN deployment on Windows or Linux

On the host machine, install the prerequisites above and set these values in `.env`:

```ini
HOST=0.0.0.0
PORT=3001
```

Run `npm run service:start`, or `npm run service:restart` if already running.
The same binding applies to foreground `npm start`. With no HOST setting, the
default remains `127.0.0.1`; set `HOST=127.0.0.1` and restart to restrict access
to the host again. Restart after changing HOST or PORT. Status and stop use the
running process's recorded binding, even if `.env` has since changed.

The existing terminal screen shows the configured Host, a Local URL, and a LAN URL
for each detected IPv4 interface, labeled with its interface name. On the host,
open `http://127.0.0.1:3001/`. From another computer on the same reachable LAN,
open the displayed LAN URL for the host's Ethernet or Wi-Fi connection. Choose
the interface on your shared network rather than a VPN or virtual adapter.
`0.0.0.0` is a listening address, not a browser URL. LAN URLs are omitted for
localhost-only binding. All browser API requests are relative to the dashboard's
origin; TapData and AI credentials remain on the backend. No CORS changes or
frontend configuration are needed.

The project does not change firewall rules. If remote connections fail, verify
that the host and client can reach each other, the service is running, the IP and
configured port match, and Wi-Fi client isolation or a VPN is not blocking access.
For Windows clients, test with `Test-NetConnection <host-LAN-IP> -Port 3001`.

If your firewall blocks inbound TCP, an administrator can allow the configured
port specifically for the LAN. Replace 3001 below if PORT is different.
In **Administrator PowerShell**, for a trusted Windows Private network:

```powershell
New-NetFirewallRule -DisplayName "BankStream LAN TCP 3001" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3001 -RemoteAddress LocalSubnet -Profile Private
```

For a managed Domain profile, ask the network administrator to apply the appropriate
rule. Do not disable Windows Firewall. See Microsoft's
[New-NetFirewallRule documentation](https://learn.microsoft.com/en-us/powershell/module/netsecurity/new-netfirewallrule).

On Linux with UFW, replace the example subnet with your actual LAN subnet:

```sh
sudo ufw allow proto tcp from 192.168.1.0/24 to any port 3001
```

For other Linux firewalls, ask the administrator for the equivalent LAN-scoped
inbound TCP rule. See the [Ubuntu firewall guide](https://ubuntu.com/server/docs/firewalls/).
These commands are instructions only; the application never executes them.

Binding to `0.0.0.0` listens on all IPv4 interfaces, so host firewall rules determine
who can connect. No router forwarding, public tunnel, or public internet exposure
is configured automatically. Development mode retains the existing demo roles;
production deployment still requires the existing trusted identity proxy and
network controls. No authentication behavior changes with HOST.

Verify the dashboard, API requests, auto-refresh, AI Chat and AI Analysis from a
second computer after setup. Host-side LAN-IP checks do not verify another device's
connectivity or its firewall path. Live TapData and AI functionality additionally
require the existing backend integration configuration and provider connectivity.

## Troubleshooting and verification

| Problem | What to check |
| --- | --- |
| Dashboard will not start | Supported Node.js version, `npm ci`, `.env` location, and whether port `3001` is free |
| Dashboard shows demo data | Confirm `DATA_SOURCE=tapdata` and restart the app |
| Customer or transaction data is missing | Replication and transformation tasks, MDM data, API publication, service routes, API URL, and OAuth credentials |
| Source updates are not visible | Confirm the Feeder generated changes; inspect TapData task progress and the API response before checking the UI |
| AI Analysis or Chat is unavailable | AI provider selection, API key, backend logs, and provider availability |

Run the project's automated tests when needed:

```sh
npm test
```

A successful API request **does not by itself confirm CDC pipeline health**; verify task execution in TapData.

## Related projects

These three repositories form the complete demonstration:

| Project | Purpose | Repository |
| --- | --- | --- |
| **BankStream AI Dashboard** | Customer 360 web UI, transaction intelligence, and AI-powered insights | [GitHub](https://github.com/umerwhu/BankStream_AI_Dashboard) |
| **BankStream Feeder** | IBM i / Oracle schemas, sample data, and real-time insert/update simulator | [GitHub](https://github.com/umerwhu/BankStream_Feeder) |
| **TapData Tasks** | Exported replication tasks, transformation tasks, published APIs (`.json.gz`), and import/setup guide | [GitHub](https://github.com/umerwhu/Tapdata_Tasks) |

**In short:** The **Feeder** creates source activity, **TapData Tasks** configure the data movement and APIs, and **BankStream AI Dashboard** shows how integrated banking data can be used for customer understanding and AI-assisted insights.
