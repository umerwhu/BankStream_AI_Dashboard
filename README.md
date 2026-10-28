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

## Choose how to run the demo

There are two practical ways to use this project:

| Mode | Best for | What you need |
| --- | --- | --- |
| **Demo mode** | Exploring the UI quickly | Node.js and this repository; no live banking connection |
| **TapData mode** | Demonstrating the complete real-time banking flow | Source databases, imported and running TapData tasks, published APIs, and dashboard configuration |

### Option A — Quick start (demo mode)

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

3. Copy `.env.example` to `.env`. Leave `DATA_SOURCE=demo` selected and review the example configuration.

4. Start the dashboard:

   ```sh
   npm start
   ```

5. Open **http://127.0.0.1:3001**.

Use **Ctrl+C** to stop the foreground process. Demo mode lets you explore the interface without connecting to the banking systems. The displayed data in this mode is not evidence of live CDC activity.

### Option B — Run the full TapData banking demo

Use the three related repositories together:

1. **Prepare source databases and data.** Follow the [BankStream Feeder](https://github.com/umerwhu/BankStream_Feeder) repository for IBM i / DB2 for i and Oracle schemas, sample data, and the simulator that generates inserts and updates.
2. **Import TapData replication tasks.** Follow the [TapData Tasks](https://github.com/umerwhu/Tapdata_Tasks) guide, update source/target connection settings, test the connections, and **start replication tasks first**.
3. **Import and start transformation tasks.** Confirm that replicated FDM data is available, then start the TapData transformations that build and update the MDM models in MongoDB, including Customer 360.
4. **Import and publish the API services.** Check service names, target table/collection names, and paths against the imported API package. Verify the published APIs return expected data.
5. **Configure the dashboard.** In `.env`, set `DATA_SOURCE=tapdata` and fill in the actual TapData API URL and OAuth settings using `.env.example` and [API integration documentation](docs/api-integration.md).
6. **Start or restart the dashboard** using `npm start` (foreground) or the background commands below. Open **http://127.0.0.1:3001**.
7. **Observe changes.** Run the Feeder to generate new source inserts/updates, verify that TapData processes them, and check whether the corresponding API-backed dashboard views reflect the updated data.

**Startup order matters:** **Replication → Transformation → Publish APIs → Dashboard**. Start the Feeder when you are ready to demonstrate changing source data.

The full pipeline and task import instructions live in the companion repositories rather than being duplicated here.

## Configuration and AI integration

The `.env` file controls runtime settings. Copy it from `.env.example`, then set values appropriate to your environment. **Never commit `.env` or real credentials.**

### Data source selection

`DATA_SOURCE` selects one mode at a time:

| Setting | Meaning |
| --- | --- |
| `demo` | Local demonstration data |
| `tapdata` | TapData published API integration — recommended for the full banking demo |


For live TapData use, check that the API base URL, OAuth credentials, published service names, and paths match your deployed environment. See [docs/api-integration.md](docs/api-integration.md) and [docs/architecture.md](docs/architecture.md).

### AI Analysis and AI Chat

Configure a supported **DeepSeek or OpenAI** provider and its API key using the settings already documented in `.env.example`. Restart the app after changing `.env`.

AI functionality depends on valid credentials, provider availability, and the customer/transaction data accessible to the application. Generated content is advisory, not an automated banking decision.

## Running in the background

Start the application without keeping the terminal open:

```sh
npm run service:start
```

| Command | Action |
| --- | --- |
| `npm run service:start` | Start the dashboard in the background |
| `npm run status` | Check process status |
| `npm run logs` | View recent logs |
| `npm run restart` | Restart after configuration changes |
| `npm stop` | Stop the background process |

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

## Security and production considerations

- Store secrets in `.env` or a secret manager, not in source control or frontend files.
- Use TLS, authentication, authorization, and a trusted identity gateway before exposing the dashboard publicly.
- Validate data permissions, transformation rules, review indicators, and AI output before considering production use.
- Where supported by the application, workflow storage uses local JSON by default; PostgreSQL can be configured with `DATABASE_URL`.

## Related projects

These three repositories form the complete demonstration:

| Project | Purpose | Repository |
| --- | --- | --- |
| **BankStream AI Dashboard** | Customer 360 web UI, transaction intelligence, and AI-powered insights | [GitHub](https://github.com/umerwhu/BankStream_AI_Dashboard) |
| **BankStream Feeder** | IBM i / Oracle schemas, sample data, and real-time insert/update simulator | [GitHub](https://github.com/umerwhu/BankStream_Feeder) |
| **TapData Tasks** | Exported replication tasks, transformation tasks, published APIs (`.json.gz`), and import/setup guide | [GitHub](https://github.com/umerwhu/Tapdata_Tasks) |

**In short:** The **Feeder** creates source activity, **TapData Tasks** configure the data movement and APIs, and **BankStream AI Dashboard** shows how integrated banking data can be used for customer understanding and AI-assisted insights.
