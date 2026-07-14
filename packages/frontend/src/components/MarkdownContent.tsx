import { Box } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

// Same typography styling as RunHistoryDialog.tsx's output rendering, minus
// the dialog-list-item height cap — this is used for full-page content
// (Knowledge Base articles) rather than an inline collapsed run output.
const markdownComponents: Components = {
  // A KB article's internal links (e.g. "/help/projects") should navigate
  // within the SPA instead of doing a full page reload; anything else
  // (there currently aren't any external links in KB content, but this is
  // defensive) opens normally.
  a: ({ href, children }) =>
    href?.startsWith("/") ? (
      <RouterLink to={href}>{children}</RouterLink>
    ) : (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    ),
};

export function MarkdownContent({ content }: { content: string }) {
  return (
    <Box
      sx={{
        "& > :first-of-type": { mt: 0 },
        "& > :last-child": { mb: 0 },
        "& p": { my: 1 },
        "& pre": {
          bgcolor: "action.hover",
          borderRadius: 1,
          p: 1,
          overflow: "auto",
        },
        "& code": {
          fontFamily: "monospace",
          bgcolor: "action.hover",
          borderRadius: 0.5,
          px: 0.5,
        },
        "& pre code": { bgcolor: "transparent", p: 0 },
        "& table": { borderCollapse: "collapse" },
        "& th, & td": {
          border: "1px solid",
          borderColor: "divider",
          px: 1,
          py: 0.5,
        },
        "& blockquote": {
          borderLeft: "3px solid",
          borderColor: "divider",
          m: 0,
          pl: 1.5,
          color: "text.secondary",
        },
      }}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </Box>
  );
}
