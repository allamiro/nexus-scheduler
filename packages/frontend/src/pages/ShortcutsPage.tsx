import { Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from "@mui/material";
import KeyboardOutlinedIcon from "@mui/icons-material/KeyboardOutlined";

// No custom app-wide keyboard shortcuts exist yet (§42) — this documents
// what's actually there today (standard form/browser behavior) rather
// than promising shortcuts that don't work. Add rows here as real ones
// are implemented.
const SHORTCUTS: { keys: string; description: string }[] = [
  { keys: "Enter", description: "Submit the login form from either the email or password field." },
];

export function ShortcutsPage() {
  return (
    <Stack spacing={2}>
      <Typography variant="h4" sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <KeyboardOutlinedIcon fontSize="large" /> Keyboard Shortcuts
      </Typography>
      <Typography color="text.secondary">
        Nexus Scheduler doesn't have a broad set of custom keyboard shortcuts yet — standard
        browser navigation (Tab, Enter, Esc to close a dialog) works throughout. This page will
        grow as shortcuts are added.
      </Typography>

      <TableContainer component={Paper} variant="outlined">
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Keys</TableCell>
              <TableCell>What it does</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {SHORTCUTS.map((shortcut) => (
              <TableRow key={shortcut.keys}>
                <TableCell>
                  <code>{shortcut.keys}</code>
                </TableCell>
                <TableCell>{shortcut.description}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Stack>
  );
}
