import React, { useState, useEffect, useRef } from "react";
import { Box, Text, useApp } from "ink";
import { Spinner } from "./components/Spinner.js";
import { ProjectList } from "./screens/ProjectList.js";
import { ProjectDetail } from "./screens/ProjectDetail.js";
import { Audit } from "./screens/Audit.js";
import { Diff } from "./screens/Diff.js";
import { scan } from "../core/discovery.js";
import type { ScanResult, ClaudeProject } from "../core/types.js";
import type { ScanOptions } from "../core/discovery.js";

type Screen =
  | { name: "loading" }
  | { name: "list" }
  | { name: "detail"; project: ClaudeProject; from?: "list" | "audit" }
  | { name: "audit" }
  | { name: "diff" };

interface AppProps {
  scanOptions?: ScanOptions;
}

export function App({ scanOptions }: AppProps) {
  const { exit } = useApp();
  const [screen, setScreen] = useState<Screen>({ name: "loading" });
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refreshCancelRef = useRef(0);

  useEffect(() => {
    scan(scanOptions)
      .then((result) => {
        setScanResult(result);
        setScreen({ name: "list" });
      })
      .catch((err: unknown) => {
        setError(String(err));
      });
  }, []);

  if (error) {
    return (
      <Box flexDirection="column">
        <Text color="red" bold>
          Error scanning filesystem:
        </Text>
        <Text color="red">{error}</Text>
      </Box>
    );
  }

  if (screen.name === "loading" || !scanResult) {
    return (
      <Box>
        <Spinner label="Scanning for Claude projects..." />
      </Box>
    );
  }

  if (screen.name === "list") {
    return (
      <ProjectList
        scanResult={scanResult}
        onSelectProject={(p) => setScreen({ name: "detail", project: p })}
        onAudit={() => setScreen({ name: "audit" })}
        onDiff={() => setScreen({ name: "diff" })}
        onQuit={() => exit()}
      />
    );
  }

  if (screen.name === "detail") {
    const refresh = async () => {
      const id = ++refreshCancelRef.current;
      const updated = await scan({ ...scanOptions, root: scanResult.scanRoot });
      if (id !== refreshCancelRef.current) return; // navigation happened while scanning
      const refreshed = updated.projects.find(
        (p) => p.rootPath === screen.project.rootPath
      );
      setScanResult(updated);
      if (refreshed) {
        setScreen({ name: "detail", project: refreshed, from: screen.from });
      } else {
        // Project was removed — fall back to list
        setScreen({ name: "list" });
      }
    };
    return (
      <ProjectDetail
        project={screen.project}
        onBack={() => {
          refreshCancelRef.current++;
          setScreen(screen.from === "audit" ? { name: "audit" } : { name: "list" });
        }}
        onRefresh={refresh}
      />
    );
  }

  if (screen.name === "audit") {
    return (
      <Audit
        scanResult={scanResult}
        onBack={() => setScreen({ name: "list" })}
        onSelectProject={(p) => setScreen({ name: "detail", project: p, from: "audit" })}
      />
    );
  }

  if (screen.name === "diff") {
    return (
      <Diff
        scanResult={scanResult}
        onBack={() => setScreen({ name: "list" })}
      />
    );
  }

  return null;
}
