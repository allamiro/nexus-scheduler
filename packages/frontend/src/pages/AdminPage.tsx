import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  List,
  ListItem,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useAuth } from "../context/AuthContext";
import { apiFetch } from "../api/client";

interface ClassificationLabel {
  id: string;
  text: string;
  abbreviation: string | null;
  badgeBgColor: string;
  badgeTextColor: string;
  sortOrder: number;
  isDefault: boolean;
}

export function AdminPage() {
  const { user } = useAuth();

  if (user?.role !== "ADMIN") {
    return <Typography color="error">Admin role required.</Typography>;
  }

  return (
    <Stack spacing={4}>
      <Typography variant="h4">Admin</Typography>
      <Typography color="text.secondary">
        User/role management, branding, SMTP, and cost rates (REQUIREMENTS §4-§8) still need to be
        built here. Classification taxonomy management (§6) is implemented below.
      </Typography>

      <ClassificationLabelsPanel />
    </Stack>
  );
}

// Object-level classification taxonomy (REQUIREMENTS §6) — deliberately
// separate from, and with no effect on, the system-wide classification
// banner, which isn't app-managed data at all (it's set once as part of
// deployment configuration, not edited here).
function ClassificationLabelsPanel() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [text, setText] = useState("");
  const [abbreviation, setAbbreviation] = useState("");
  const [badgeBgColor, setBadgeBgColor] = useState("#b71c1c");
  const [badgeTextColor, setBadgeTextColor] = useState("#ffffff");
  const [sortOrder, setSortOrder] = useState(0);
  const [isDefault, setIsDefault] = useState(false);

  const labelsQuery = useQuery({
    queryKey: ["classification-labels"],
    queryFn: () => apiFetch<ClassificationLabel[]>("/api/classification-labels"),
  });

  const createLabel = useMutation({
    mutationFn: () =>
      apiFetch("/api/classification-labels", {
        method: "POST",
        body: JSON.stringify({
          text,
          abbreviation: abbreviation || undefined,
          badgeBgColor,
          badgeTextColor,
          sortOrder,
          isDefault,
        }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["classification-labels"] });
      setCreateOpen(false);
      setText("");
      setAbbreviation("");
      setSortOrder(0);
      setIsDefault(false);
    },
  });

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="h6">Classification Taxonomy</Typography>
        <Button variant="contained" size="small" onClick={() => setCreateOpen(true)}>
          New Label
        </Button>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Applied per-Project/Prompt as a badge. Independent of the system-wide classification
        banner shown on every page.
      </Typography>

      <List dense>
        {labelsQuery.data?.map((label) => (
          <ListItem key={label.id} divider>
            <ListItemText
              primary={
                <Stack direction="row" spacing={1} alignItems="center">
                  <Chip
                    size="small"
                    label={label.abbreviation || label.text}
                    sx={{ backgroundColor: label.badgeBgColor, color: label.badgeTextColor, fontWeight: 700 }}
                  />
                  <span>{label.text}</span>
                  {label.isDefault && <Chip size="small" label="Default" variant="outlined" />}
                </Stack>
              }
              secondary={`Sort order: ${label.sortOrder}`}
            />
          </ListItem>
        ))}
        {labelsQuery.data?.length === 0 && (
          <Typography color="text.secondary">
            No classification labels defined yet — Projects will show no classification badge
            until at least one exists.
          </Typography>
        )}
      </List>

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>New Classification Label</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Text" value={text} onChange={(e) => setText(e.target.value)} autoFocus fullWidth />
            <TextField
              label="Abbreviation (optional, shown on badge)"
              value={abbreviation}
              onChange={(e) => setAbbreviation(e.target.value)}
              fullWidth
            />
            <Stack direction="row" spacing={2}>
              <TextField
                label="Badge background color"
                type="color"
                value={badgeBgColor}
                onChange={(e) => setBadgeBgColor(e.target.value)}
                fullWidth
              />
              <TextField
                label="Badge text color"
                type="color"
                value={badgeTextColor}
                onChange={(e) => setBadgeTextColor(e.target.value)}
                fullWidth
              />
            </Stack>
            <TextField
              label="Sort order"
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(Number(e.target.value))}
              fullWidth
            />
            <FormControlLabel
              control={<Checkbox checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />}
              label="Default for new Projects"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button variant="contained" disabled={!text || createLabel.isPending} onClick={() => createLabel.mutate()}>
            Create
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
