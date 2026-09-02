import { config } from "../config/env";

export interface PistonResult {
  language: string;
  version: string;
  compile?: {
    stdout: string;
    stderr: string;
    code: number;
    signal: string | null;
    output: string;
  };
  run: {
    stdout: string;
    stderr: string;
    code: number;
    signal: string | null;
    output: string;
  };
}

export interface ExecuteResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  executionEngine: "piston";
  stage: "compile" | "run";
}

export const SUPPORTED_LANGUAGES = [
  { id: "javascript", label: "JavaScript", pistonLang: "javascript", version: "18.15.0" },
  { id: "typescript", label: "TypeScript", pistonLang: "typescript", version: "5.0.3" },
  { id: "python", label: "Python", pistonLang: "python", version: "3.10.0" },
  { id: "java", label: "Java", pistonLang: "java", version: "15.0.2" },
  { id: "cpp", label: "C++", pistonLang: "c++", version: "10.2.0" },
] as const;

export type LanguageId = (typeof SUPPORTED_LANGUAGES)[number]["id"];

const MAX_CODE_LENGTH = 50_000; // ~50KB, generous for interview code
const REQUEST_TIMEOUT_MS = 10_000;

export async function executeViaPiston(
  code: string,
  language: LanguageId,
  stdin?: string
): Promise<ExecuteResult> {
  const langConfig = SUPPORTED_LANGUAGES.find((l) => l.id === language);
  if (!langConfig) {
    return {
      success: false,
      stdout: "",
      stderr: "Unsupported language",
      exitCode: 1,
      executionEngine: "piston",
      stage: "run",
    };
  }

  if (code.length > MAX_CODE_LENGTH) {
    return {
      success: false,
      stdout: "",
      stderr: `Code exceeds maximum length of ${MAX_CODE_LENGTH} characters`,
      exitCode: 1,
      executionEngine: "piston",
      stage: "run",
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(config.pistonUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        language: langConfig.pistonLang,
        version: langConfig.version,
        files: [{ name: getFileName(language), content: code }],
        stdin: stdin ?? "",
        run_timeout: 5000,
        compile_timeout: 10000,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      return {
        success: false,
        stdout: "",
        stderr: `Execution sandbox error: ${res.status}`,
        exitCode: 1,
        executionEngine: "piston",
        stage: "run",
      };
    }

    const data = (await res.json()) as PistonResult;

    if (data.compile && data.compile.code !== 0) {
      return {
        success: false,
        stdout: data.compile.stdout,
        stderr: data.compile.stderr,
        exitCode: data.compile.code,
        executionEngine: "piston",
        stage: "compile",
      };
    }

    return {
      success: data.run.code === 0,
      stdout: data.run.stdout,
      stderr: data.run.stderr,
      exitCode: data.run.code,
      executionEngine: "piston",
      stage: "run",
    };
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === "AbortError";
    return {
      success: false,
      stdout: "",
      stderr: isTimeout
        ? "Execution request timed out"
        : err instanceof Error
        ? err.message
        : "Execution failed",
      exitCode: 1,
      executionEngine: "piston",
      stage: "run",
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function getFileName(language: LanguageId): string {
  const map: Record<LanguageId, string> = {
    javascript: "main.js",
    typescript: "main.ts",
    python: "main.py",
    java: "Main.java",
    cpp: "main.cpp",
  };
  return map[language];
}