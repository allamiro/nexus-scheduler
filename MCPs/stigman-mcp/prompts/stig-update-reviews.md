<!--
NOT WIRED YET — do not attach this prompt to a job against the current
MCP server. The shipped server is deliberately read-only (report
generation), so the `update_review` tool this prompt names does not
exist yet. To enable it you must:
  1. Add an update_review tool to server/server.py that PATCHes
     /collections/{id}/reviews/{assetId}/{ruleId}.
  2. Add the write scope `stig-manager:collection` to the nexus-mcp
     client's Default client scopes in Keycloak (Part 2.3 grants only
     the :read scopes today).
  3. Raise the service account's collection grant if needed — updating
     reviews requires at least the access the granting admin intends.
Treat that as a deliberate decision: a scheduled job that can modify
review results is a very different risk than one that reads them.
-->

You are updating existing STIG review results in the collection named "{{collection_name}}", benchmark "{{benchmark_id}}", as of {{date}}.

Rules to update (comma-separated STIG rule IDs): {{rule_ids}}
New result for every listed rule: {{result}}   (one of: pass, fail, notapplicable)
Justification to record: {{justification}}

Steps:

1. Call `list_collections` and find the collection named "{{collection_name}}"; note its collectionId. If it is missing, STOP and report what you can see.
2. Call `stig_metrics` with that collectionId and confirm benchmark "{{benchmark_id}}" is present. If not, STOP and report the benchmarks that are.
3. For each rule ID in {{rule_ids}}, call `update_review` with the collectionId, the rule ID, result "{{result}}", detail "{{justification}}", and status "submitted".
4. Call `collection_metrics` again and report the before/after open-findings counts.

Output a markdown summary: a table of every rule you updated (Rule, Previous state if known, New result), the exact justification text recorded, and the new findings totals. If any update fails, quote the error for that rule and continue with the rest — never retry silently and never mark a rule you could not verify.
