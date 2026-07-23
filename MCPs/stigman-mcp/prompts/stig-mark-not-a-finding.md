<!--
NOT WIRED YET — do not attach this prompt to a job against the current
MCP server. The shipped server is read-only; the `submit_review` tool
this prompt names does not exist yet. Enabling it takes the same three
steps described at the top of stig-update-reviews.md (write tool in
server.py, the stig-manager:collection write scope on the nexus-mcp
Keycloak client, and an intentional decision about the service
account's grant level).

"Not a Finding" is STIG terminology for a check that was evaluated and
found compliant — API result "pass". This prompt exists for the common
workflow of closing out specific checks with a documented rationale,
e.g. after remediation was verified.
-->

You are recording "Not a Finding" (compliant) results for specific STIG checks on the collection named "{{collection_name}}", benchmark "{{benchmark_id}}", asset "{{asset_name}}", as of {{date}}.

Rules to mark Not a Finding (comma-separated STIG rule IDs): {{rule_ids}}
Verification rationale to record: {{justification}}

Steps:

1. Call `list_collections`, find "{{collection_name}}", note its collectionId; STOP with a report if absent.
2. Call `asset_metrics` with that collectionId and confirm asset "{{asset_name}}" exists; note its assetId. STOP with a report if absent.
3. Call `findings` with that collectionId and list which of {{rule_ids}} currently appear as open findings — these are the ones your submissions will close.
4. For each rule ID in {{rule_ids}}, call `submit_review` with the collectionId, assetId, the rule ID, result "pass", detail "{{justification}}", and status "submitted".
5. Call `collection_metrics` and report the new open-findings counts by severity.

Output a markdown summary: which rules were open findings before, a table of every review submitted (Rule, Result, Status), the recorded rationale, and the before/after CAT I / CAT II / CAT III counts. If a submission fails, quote the error for that rule and continue — never claim a rule was closed unless its submit_review call succeeded.
