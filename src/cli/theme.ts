export type ThemeMode = "dark" | "light" | "compact";

export interface UiTheme {
  mode: ThemeMode;
  accent: "blue" | "cyan" | "magenta";
  assistant: "blue" | "cyan" | "magenta";
  user: "green" | "blue";
  muted: "gray" | "white";
  border: "gray" | "cyan";
  approval: "yellow" | "magenta";
  error: "red";
  dense: boolean;
}

export function parseThemeMode(value: string | undefined): ThemeMode {
  if (value === "light" || value === "compact") {
    return value;
  }

  return "dark";
}

export function getTheme(mode: ThemeMode): UiTheme {
  if (mode === "light") {
    return {
      mode,
      accent: "blue",
      assistant: "blue",
      user: "green",
      muted: "gray",
      border: "gray",
      approval: "magenta",
      error: "red",
      dense: false
    };
  }

  if (mode === "compact") {
    return {
      mode,
      accent: "cyan",
      assistant: "cyan",
      user: "green",
      muted: "gray",
      border: "gray",
      approval: "yellow",
      error: "red",
      dense: true
    };
  }

  return {
    mode,
    accent: "cyan",
    assistant: "cyan",
    user: "green",
    muted: "gray",
    border: "gray",
    approval: "yellow",
    error: "red",
    dense: false
  };
}
