Call the `collection_metrics` tool with collection_id "{{collection_id}}". Use only numbers from the tool result — never invent any.

Then output exactly this markdown structure:

# STIG Quick Check — {{collection_name}} — {{date}}

One sentence: how many of the total checks are assessed (assessed / assessments, assessedPct%).

## Open findings
A markdown table with two columns (Severity, Count) and three rows: CAT I = findings.high, CAT II = findings.medium, CAT III = findings.low.

## Results
A mermaid pie chart in a ```mermaid fence titled "Check results" with slices Pass, Fail, Not Applicable, and Unassessed (assessments minus assessed). Nothing but valid mermaid inside the fence.
