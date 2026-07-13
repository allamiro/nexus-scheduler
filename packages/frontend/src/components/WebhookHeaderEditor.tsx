import { Box, Button, IconButton, Stack, TextField, Typography } from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";

export interface WebhookHeaderDraft {
  key: string;
  value: string;
}

export function headersToRecord(drafts: WebhookHeaderDraft[]): Record<string, string> | undefined {
  const entries = drafts.filter((d) => d.key.trim().length > 0).map((d) => [d.key.trim(), d.value] as const);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function recordToHeaderDrafts(record: Record<string, string> | null | undefined): WebhookHeaderDraft[] {
  return record ? Object.entries(record).map(([key, value]) => ({ key, value })) : [];
}

// Custom headers merged into every delivery to a webhook destination
// (REQUIREMENTS §27) — e.g. a receiver-side auth token. Content-Type
// and X-Nexus-Signature are always set by the sender and can't be
// entered here (rejected server-side too, both at write time and again
// at delivery time).
export function WebhookHeaderEditor({
  headers,
  onChange,
}: {
  headers: WebhookHeaderDraft[];
  onChange: (next: WebhookHeaderDraft[]) => void;
}) {
  const update = (index: number, patch: Partial<WebhookHeaderDraft>) => {
    onChange(headers.map((h, i) => (i === index ? { ...h, ...patch } : h)));
  };
  const remove = (index: number) => onChange(headers.filter((_, i) => i !== index));
  const add = () => onChange([...headers, { key: "", value: "" }]);

  return (
    <Box>
      <Typography variant="subtitle2" gutterBottom>
        Custom headers
      </Typography>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
        Sent with every delivery to this destination. Content-Type and X-Nexus-Signature are
        always set automatically and can&apos;t be overridden.
      </Typography>
      <Stack spacing={1}>
        {headers.map((header, index) => (
          <Stack key={index} direction="row" spacing={1} alignItems="center">
            <TextField
              size="small"
              label="Header name"
              value={header.key}
              onChange={(e) => update(index, { key: e.target.value })}
              sx={{ flex: 1 }}
            />
            <TextField
              size="small"
              label="Value"
              value={header.value}
              onChange={(e) => update(index, { value: e.target.value })}
              sx={{ flex: 1 }}
            />
            <IconButton size="small" onClick={() => remove(index)} aria-label="Remove header">
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Stack>
        ))}
        <Button size="small" onClick={add} sx={{ alignSelf: "flex-start" }}>
          Add header
        </Button>
      </Stack>
    </Box>
  );
}
