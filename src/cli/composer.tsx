import { Box, Text, useInput } from "ink";
import { useState } from "react";

import { getTheme, type UiTheme } from "./theme.js";

interface ComposerProps {
  disabled: boolean;
  onSubmit: (value: string) => void;
  theme?: UiTheme;
}

export interface ComposerState {
  prompt: string;
  cursor: string;
  hint: string;
}

interface HistoryState {
  index?: number;
  draft: string;
  value: string;
}

export function composerState(disabled: boolean): ComposerState {
  return {
    prompt: disabled ? "..." : ">  ",
    cursor: disabled ? "" : "_",
    hint: disabled ? "waiting for current action" : "/exit /retry history: up/down"
  };
}

export function navigateHistory(history: readonly string[], state: HistoryState, direction: "up" | "down"): HistoryState {
  if (history.length === 0) {
    return state;
  }

  if (direction === "up") {
    const nextIndex = state.index === undefined ? history.length - 1 : Math.max(0, state.index - 1);
    return {
      index: nextIndex,
      draft: state.index === undefined ? state.value : state.draft,
      value: history[nextIndex] ?? state.value
    };
  }

  if (state.index === undefined) {
    return state;
  }

  const nextIndex = state.index + 1;

  if (nextIndex >= history.length) {
    return {
      index: undefined,
      draft: state.draft,
      value: state.draft
    };
  }

  return {
    ...state,
    index: nextIndex,
    value: history[nextIndex] ?? state.value
  };
}

export function Composer({ disabled, onSubmit, theme = getTheme("dark") }: ComposerProps) {
  const [value, setValue] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>();
  const [historyDraft, setHistoryDraft] = useState("");

  useInput((input, key) => {
    if (disabled) {
      return;
    }

    if (key.upArrow || key.downArrow) {
      const next = navigateHistory(history, { index: historyIndex, draft: historyDraft, value }, key.upArrow ? "up" : "down");
      setHistoryIndex(next.index);
      setHistoryDraft(next.draft);
      setValue(next.value);
      return;
    }

    if (key.return) {
      const nextValue = value.trim();

      if (nextValue.length > 0) {
        onSubmit(nextValue);
        setHistory((current) => [...current.filter((entry) => entry !== nextValue), nextValue].slice(-50));
        setHistoryIndex(undefined);
        setHistoryDraft("");
        setValue("");
      }

      return;
    }

    if (key.backspace || key.delete) {
      setValue((current) => current.slice(0, -1));
      setHistoryIndex(undefined);
      return;
    }

    if (key.escape) {
      setValue("");
      setHistoryIndex(undefined);
      setHistoryDraft("");
      return;
    }

    if (input.includes("\r") || input.includes("\n")) {
      const [beforeBreak, ...afterBreak] = input.split(/\r?\n|\r/);
      const nextValue = `${value}${beforeBreak}`.trim();

      if (nextValue.length > 0) {
        onSubmit(nextValue);
        setHistory((current) => [...current.filter((entry) => entry !== nextValue), nextValue].slice(-50));
        setHistoryIndex(undefined);
        setHistoryDraft("");
        setValue(afterBreak.join(""));
      }

      return;
    }

    if (input && !key.ctrl && !key.meta) {
      setValue((current) => `${current}${input}`);
      setHistoryIndex(undefined);
    }
  });

  const state = composerState(disabled);

  return (
    <Box>
      <Text color={disabled ? theme.muted : theme.accent}>{state.prompt}</Text>
      <Text>{value}</Text>
      {!disabled && <Text color={theme.muted}>{state.cursor}</Text>}
      <Text color={theme.muted}> {state.hint}</Text>
    </Box>
  );
}
