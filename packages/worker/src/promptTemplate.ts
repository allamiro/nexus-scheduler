// Resolves {{variable}} placeholders in a saved prompt at execution time
// (REQUIREMENTS.md §2.3). Precedence, highest first: a per-schedule
// override value, then the variable's declared default, then built-ins
// (built-ins aren't overridable — a schedule can't redefine {{run_id}}).
export function renderPromptTemplate(
  content: string,
  context: {
    scheduleName?: string;
    runId: string;
    owner: { email: string; givenName?: string | null; familyName?: string | null; displayName?: string | null };
  },
  declaredVariables: Array<{ name: string; defaultValue?: string }>,
  variableValues: Record<string, string> = {},
): string {
  const now = new Date();
  const ownerFullName =
    context.owner.displayName ||
    [context.owner.givenName, context.owner.familyName].filter(Boolean).join(" ") ||
    context.owner.email;
  const builtins: Record<string, string> = {
    date: now.toISOString().slice(0, 10),
    datetime: now.toISOString(),
    schedule_name: context.scheduleName ?? "",
    run_id: context.runId,
    owner_full_name: ownerFullName,
    owner_given_name: context.owner.givenName ?? "",
    owner_last_name: context.owner.familyName ?? "",
    owner_email: context.owner.email,
  };

  const values: Record<string, string> = {};
  for (const variable of declaredVariables) {
    values[variable.name] = variable.defaultValue ?? "";
  }
  for (const [name, value] of Object.entries(variableValues)) {
    if (name in values) {
      values[name] = value;
    }
  }
  Object.assign(values, builtins); // built-ins always win, applied last

  return content.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (match, name: string) => {
    return name in values ? values[name]! : match;
  });
}
