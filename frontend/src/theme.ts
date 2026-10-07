import { createTheme } from "@mui/material/styles";

export const theme = createTheme({
  palette: {
    primary: { main: "#176f63", light: "#e7f2ef", dark: "#105247" },
    secondary: { main: "#586ea2" },
    background: { default: "#f6f8fa", paper: "#ffffff" },
    text: { primary: "#24313b", secondary: "#6c7781" },
    divider: "#e6eaee",
    success: { main: "#267665" },
  },
  typography: {
    fontFamily: '"DM Sans Variable", sans-serif',
    fontSize: 13,
    h1: {
      fontSize: "1.9rem",
      fontWeight: 650,
      letterSpacing: "-0.055em",
      lineHeight: 1.2,
    },
    h2: { fontSize: "1.3rem", fontWeight: 650, letterSpacing: "-0.035em" },
    h3: { fontSize: "1rem", fontWeight: 650 },
    button: { textTransform: "none", fontWeight: 600, fontSize: 13 },
  },
  shape: { borderRadius: 9 },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { minHeight: 37, paddingInline: 15 },
        outlined: {
          borderColor: "#d9e0e5",
          color: "#394750",
          background: "white",
        },
      },
    },
    MuiIconButton: { styleOverrides: { root: { color: "#66737e" } } },
    MuiPaper: { defaultProps: { elevation: 0 } },
    MuiChip: {
      styleOverrides: {
        root: { fontSize: 11, height: 25, borderRadius: 5 },
        label: { paddingInline: 8 },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: "none",
          fontWeight: 600,
          minHeight: 52,
          minWidth: 90,
          padding: "12px 16px",
        },
      },
    },
    MuiTabs: {
      styleOverrides: {
        root: { minHeight: 52 },
        indicator: { height: 2, borderRadius: 2 },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: { fontSize: 13, background: "white" },
        notchedOutline: { borderColor: "#e0e5e9" },
      },
    },
    MuiDialog: { styleOverrides: { paper: { borderRadius: 16 } } },
    MuiTooltip: { defaultProps: { arrow: true } },
  },
});
