import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

interface TextInputProps {
  prompt: string;
  placeholder?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

export function TextInput({ prompt, placeholder, onSubmit, onCancel }: TextInputProps) {
  const [value, setValue] = useState("");

  useInput((input, key) => {
    if (key.return) {
      const trimmed = value.trim();
      if (trimmed) onSubmit(trimmed);
      // ignore empty submit
    } else if (key.escape) {
      onCancel();
    } else if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
    } else if (input && !key.ctrl && !key.meta) {
      setValue((v) => v + input);
    }
  });

  const display = value || "";
  const showPlaceholder = value.length === 0 && placeholder;

  return (
    <Box>
      <Text color="cyan" bold>
        {prompt}{" "}
      </Text>
      {showPlaceholder ? (
        <Text color="gray">{placeholder}</Text>
      ) : (
        <Text>{display}</Text>
      )}
      <Text color="cyan">█</Text>
    </Box>
  );
}
