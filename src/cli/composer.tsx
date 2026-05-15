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

export interface EditableLineState {
  value: string;
  cursor: number;
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
    hint: disabled ? "waiting for current action" : "/exit /retry /debug /clip arrows edit history ctrl+a/e/u/k/w"
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

export function insertAtCursor(state: EditableLineState, input: string): EditableLineState {
  const cursor = clampCursor(state.value, state.cursor);
  const value = `${state.value.slice(0, cursor)}${input}${state.value.slice(cursor)}`;

  return {
    value,
    cursor: cursor + input.length
  };
}

export function removeBeforeCursor(state: EditableLineState): EditableLineState {
  const cursor = clampCursor(state.value, state.cursor);

  if (cursor === 0) {
    return { ...state, cursor };
  }

  return {
    value: `${state.value.slice(0, cursor - 1)}${state.value.slice(cursor)}`,
    cursor: cursor - 1
  };
}

export function removeAtCursor(state: EditableLineState): EditableLineState {
  const cursor = clampCursor(state.value, state.cursor);

  if (cursor >= state.value.length) {
    return { ...state, cursor };
  }

  return {
    value: `${state.value.slice(0, cursor)}${state.value.slice(cursor + 1)}`,
    cursor
  };
}

export function deleteWordBeforeCursor(state: EditableLineState): EditableLineState {
  const cursor = clampCursor(state.value, state.cursor);
  const before = state.value.slice(0, cursor);
  const match = /\s*\S+\s*$/.exec(before);

  if (!match) {
    return { ...state, cursor };
  }

  const start = cursor - match[0].length;

  return {
    value: `${state.value.slice(0, start)}${state.value.slice(cursor)}`,
    cursor: start
  };
}

export function moveCursor(state: EditableLineState, direction: "left" | "right" | "start" | "end"): EditableLineState {
  const cursor = clampCursor(state.value, state.cursor);

  if (direction === "left") {
    return { ...state, cursor: Math.max(0, cursor - 1) };
  }

  if (direction === "right") {
    return { ...state, cursor: Math.min(state.value.length, cursor + 1) };
  }

  if (direction === "start") {
    return { ...state, cursor: 0 };
  }

  return { ...state, cursor: state.value.length };
}

export function Composer({ disabled, onSubmit, theme = getTheme("dark") }: ComposerProps) {
  const [value, setValue] = useState("");
  const [cursor, setCursor] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>();
  const [historyDraft, setHistoryDraft] = useState("");

  function setLine(next: EditableLineState): void {
    setValue(next.value);
    setCursor(clampCursor(next.value, next.cursor));
  }

  function clearHistoryNavigation(): void {
    setHistoryIndex(undefined);
    setHistoryDraft("");
  }

  useInput((input, key) => {
    if (disabled) {
      return;
    }

    if (key.upArrow || key.downArrow) {
      const next = navigateHistory(history, { index: historyIndex, draft: historyDraft, value }, key.upArrow ? "up" : "down");
      setHistoryIndex(next.index);
      setHistoryDraft(next.draft);
      setLine({ value: next.value, cursor: next.value.length });
      return;
    }

    if (key.leftArrow) {
      setLine(moveCursor({ value, cursor }, "left"));
      return;
    }

    if (key.rightArrow) {
      setLine(moveCursor({ value, cursor }, "right"));
      return;
    }

    if (key.ctrl && isCtrlInput(input, "a")) {
      setLine(moveCursor({ value, cursor }, "start"));
      return;
    }

    if (key.ctrl && isCtrlInput(input, "e")) {
      setLine(moveCursor({ value, cursor }, "end"));
      return;
    }

    if (key.ctrl && isCtrlInput(input, "u")) {
      setLine({ value: value.slice(cursor), cursor: 0 });
      clearHistoryNavigation();
      return;
    }

    if (key.ctrl && isCtrlInput(input, "k")) {
      setLine({ value: value.slice(0, cursor), cursor });
      clearHistoryNavigation();
      return;
    }

    if (key.ctrl && isCtrlInput(input, "w")) {
      setLine(deleteWordBeforeCursor({ value, cursor }));
      clearHistoryNavigation();
      return;
    }

    if (key.return) {
      const nextValue = value.trim();

      if (nextValue.length > 0) {
        onSubmit(nextValue);
        setHistory((current) => [...current.filter((entry) => entry !== nextValue), nextValue].slice(-50));
        clearHistoryNavigation();
        setLine({ value: "", cursor: 0 });
      }

      return;
    }

    if (key.backspace) {
      setLine(removeBeforeCursor({ value, cursor }));
      clearHistoryNavigation();
      return;
    }

    if (key.delete) {
      setLine(removeAtCursor({ value, cursor }));
      clearHistoryNavigation();
      return;
    }

    if (key.escape) {
      setLine({ value: "", cursor: 0 });
      clearHistoryNavigation();
      return;
    }

    if (input.includes("\r") || input.includes("\n")) {
      const [beforeBreak, ...afterBreak] = input.split(/\r?\n|\r/);
      const inserted = insertAtCursor({ value, cursor }, beforeBreak ?? "");
      const nextValue = inserted.value.trim();

      if (nextValue.length > 0) {
        onSubmit(nextValue);
        setHistory((current) => [...current.filter((entry) => entry !== nextValue), nextValue].slice(-50));
        clearHistoryNavigation();
        const remainder = afterBreak.join("");
        setLine({ value: remainder, cursor: remainder.length });
      }

      return;
    }

    if (input && !key.ctrl && !key.meta) {
      setLine(insertAtCursor({ value, cursor }, input));
      clearHistoryNavigation();
    }
  });

  const state = composerState(disabled);
  const safeCursor = clampCursor(value, cursor);
  const beforeCursor = value.slice(0, safeCursor);
  const cursorCharacter = value[safeCursor] ?? " ";
  const afterCursor = value.slice(safeCursor + 1);

  return (
    <Box>
      <Text color={disabled ? theme.muted : theme.accent}>{state.prompt}</Text>
      <Text>{disabled ? value : beforeCursor}</Text>
      {!disabled && <Text inverse>{cursorCharacter}</Text>}
      {!disabled && <Text>{afterCursor}</Text>}
      <Text color={theme.muted}> {state.hint}</Text>
    </Box>
  );
}

function clampCursor(value: string, cursor: number): number {
  return Math.max(0, Math.min(value.length, cursor));
}

function isCtrlInput(input: string, key: string): boolean {
  const code = key.toLowerCase().charCodeAt(0) - 96;
  return input === key || input === key.toUpperCase() || input.charCodeAt(0) === code;
}
