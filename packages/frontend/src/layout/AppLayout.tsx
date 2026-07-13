import type { ReactNode } from "react";
import { AppBar, Avatar, Box, Button, IconButton, Toolbar, Tooltip, Typography } from "@mui/material";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import LightModeIcon from "@mui/icons-material/LightMode";
import { Link as RouterLink } from "react-router-dom";
import { ClassificationBanner } from "../components/ClassificationBanner";
import { useSettings } from "../context/SettingsContext";
import { useAuth } from "../context/AuthContext";
import { useColorMode } from "../context/ColorModeContext";

const NAV_LINKS = [
  { to: "/", label: "Dashboard" },
  { to: "/projects", label: "Projects" },
  { to: "/prompts", label: "Prompt Library" },
  { to: "/schedules", label: "Approvals" },
  { to: "/teams", label: "Teams" },
  { to: "/api-keys", label: "API Keys" },
  { to: "/admin", label: "Admin" },
];

// Top and bottom classification banner, always visible regardless of
// auth state — REQUIREMENTS §6, deliberately independent of login.
// Everything else — nav tabs, product branding bar — is gated on being
// logged in: an unauthenticated visitor should see nothing but the
// banner and the login screen (RequireAuth handles bouncing every
// other route to /login; this hides the chrome around it).
export function AppLayout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const { settings } = useSettings();
  const { mode, toggleMode } = useColorMode();
  const bannerConfig = {
    text: settings.classificationBannerText,
    backgroundColor: settings.classificationBannerBgColor,
    textColor: settings.classificationBannerTextColor,
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      <ClassificationBanner config={bannerConfig} />

      {user && (
        <AppBar position="static" color="default" elevation={1}>
          <Toolbar sx={{ gap: 2 }}>
            {settings.logoUrl && <Avatar src={settings.logoUrl} variant="square" sx={{ width: 32, height: 32 }} />}
            <Typography variant="h6" sx={{ flexGrow: 0 }}>
              {settings.productName}
            </Typography>
            <Box sx={{ flexGrow: 1, display: "flex", gap: 1 }}>
              {NAV_LINKS.map((link) => (
                <Button key={link.to} component={RouterLink} to={link.to} color="inherit">
                  {link.label}
                </Button>
              ))}
            </Box>
            <Typography variant="body2">
              {user.displayName ?? user.email} ({user.role})
            </Typography>
            <Tooltip title={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}>
              <IconButton color="inherit" onClick={toggleMode} aria-label="Toggle dark mode">
                {mode === "dark" ? <LightModeIcon /> : <DarkModeIcon />}
              </IconButton>
            </Tooltip>
            <Button color="inherit" onClick={() => void logout()}>
              Log out
            </Button>
          </Toolbar>
        </AppBar>
      )}

      <Box component="main" sx={{ flex: 1, p: 3 }}>
        {children}
      </Box>

      <ClassificationBanner config={bannerConfig} />
    </Box>
  );
}
