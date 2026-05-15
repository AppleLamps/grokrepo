import { Text, useInput } from "ink";
import { useState } from "react";

interface ChatInputProps {
  disabled: boolean;
  onSubmit: (value: string) => void;
}

export function ChatInput({ disabled, onSubmit }: ChatInputProps) {
  const [value, setValue] = useState("");

  useInput((input, key) => {
    if (disabled) {
      return;
    }

    if (key.return) {
      const nextValue = value.trim();

      if (nextValue.length > 0) {
        onSubmit(nextValue);
        setValue("");
      }

      return;
    }

    if (key.backspace || key.delete) {
      setValue((current) => current.slice(0, -1));
      return;
    }

    if (key.escape) {
      setValue("");
      return;
    }

    if (input.includes("\r") || input.includes("\n")) {
      const [beforeBreak, ...afterBreak] = input.split(/\r?\n|\r/);
      const nextValue = `${value}${beforeBreak}`.trim();

      if (nextValue.length > 0) {
        onSubmit(nextValue);
        setValue(afterBreak.join(""));
      }

      return;
    }

    if (input && !key.ctrl && !key.meta) {
      setValue((current) => `${current}${input}`);
    }
  });

  return (
    <Text>
      <Text color="cyan">{disabled ? "..." : ">"}</Text> {value}
      {!disabled && <Text color="gray">_</Text>}
    </Text>
  );
}
