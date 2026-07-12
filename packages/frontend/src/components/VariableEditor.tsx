import {
  Box,
  Button,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";

export interface PromptVariableDraft {
  name: string;
  type: "text" | "number" | "date";
  defaultValue: string;
}

// Declares the {{variable}} placeholders a prompt version accepts
// (REQUIREMENTS §2.3) — used when creating a Prompt and when saving a
// new PromptVersion. A schedule later fills in actual values for these
// (see VariableValueInputs), falling back to the default declared here.
export function VariableEditor({
  variables,
  onChange,
}: {
  variables: PromptVariableDraft[];
  onChange: (next: PromptVariableDraft[]) => void;
}) {
  const update = (index: number, patch: Partial<PromptVariableDraft>) => {
    onChange(variables.map((v, i) => (i === index ? { ...v, ...patch } : v)));
  };
  const remove = (index: number) => onChange(variables.filter((_, i) => i !== index));
  const add = () => onChange([...variables, { name: "", type: "text", defaultValue: "" }]);

  return (
    <Box>
      <Typography variant="subtitle2" gutterBottom>
        Variables
      </Typography>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
        Declares which <code>{"{{name}}"}</code> placeholders this prompt accepts, beyond the
        built-ins ({"{{date}}"}, {"{{datetime}}"}, {"{{schedule_name}}"}, {"{{run_id}}"}).
      </Typography>
      <Stack spacing={1}>
        {variables.map((variable, index) => (
          <Stack key={index} direction="row" spacing={1} alignItems="center">
            <TextField
              size="small"
              label="Name"
              value={variable.name}
              onChange={(e) => update(index, { name: e.target.value })}
              sx={{ flex: 1 }}
            />
            <FormControl size="small" sx={{ minWidth: 100 }}>
              <InputLabel id={`var-type-${index}`}>Type</InputLabel>
              <Select
                labelId={`var-type-${index}`}
                label="Type"
                value={variable.type}
                onChange={(e) => update(index, { type: e.target.value as PromptVariableDraft["type"] })}
              >
                <MenuItem value="text">Text</MenuItem>
                <MenuItem value="number">Number</MenuItem>
                <MenuItem value="date">Date</MenuItem>
              </Select>
            </FormControl>
            <TextField
              size="small"
              label="Default"
              value={variable.defaultValue}
              onChange={(e) => update(index, { defaultValue: e.target.value })}
              sx={{ flex: 1 }}
            />
            <IconButton size="small" onClick={() => remove(index)} aria-label="Remove variable">
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Stack>
        ))}
        <Button size="small" onClick={add} sx={{ alignSelf: "flex-start" }}>
          Add variable
        </Button>
      </Stack>
    </Box>
  );
}
