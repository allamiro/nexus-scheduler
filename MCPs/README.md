# MCP examples

Worked examples of extending the LibreChat Agents that Nexus Scheduler
drives with [Model Context Protocol](https://modelcontextprotocol.io)
(MCP) tools, so scheduled jobs can pull live data from other systems and
turn it into recurring, audited reports.

Each example is self-contained: its own directory, its own lab
`docker-compose.yml`, and a README that walks from empty directory to a
scheduled report — written to be reproducible in air-gapped
environments (pinned images, no runtime downloads, `docker save`/`load`
transfer notes).

| Example | What it does |
|---|---|
| [stigman-mcp](./stigman-mcp/README.md) | STIG compliance reports and charts from [STIG Manager](https://github.com/NUWCDIVNPT/stig-manager), authenticated through a Keycloak service-account client |

The general recipe (server → LibreChat `mcpServers` → Agent → Nexus
Scheduler job) is documented in the in-app Knowledge Base under
**Building an MCP integration**.
