import { executeViaPiston, LanguageId } from "./piston.service";

export interface TestCase {
  input: Partial<Record<LanguageId, string>>; // bare call expression per language, e.g. "twoSum([2,7,11,15], 9)"
  expected: string;
}

export interface QuestionTestConfig {
  functionName: string;
  testCases: TestCase[];
}

export interface TestResult {
  passed: boolean;
  input: string;
  expected: string;
  actual: string;
  error?: string;
}

export interface RunTestsResult {
  success: boolean;
  results: TestResult[];
  passedCount: number;
  totalCount: number;
}

const MARKER = "===TEST_START===";

export async function runMultiLanguageTests(
  code: string,
  language: LanguageId,
  testConfig: QuestionTestConfig | null
): Promise<RunTestsResult> {
  if (!testConfig || testConfig.testCases.length === 0) {
    return { success: false, results: [], passedCount: 0, totalCount: 0 };
  }

  const missingLangCases = testConfig.testCases.filter((t) => !t.input[language]);
  if (missingLangCases.length > 0) {
    return {
      success: false,
      results: testConfig.testCases.map((t) => ({
        passed: false,
        input: t.input[language] ?? "(not configured for this language)",
        expected: t.expected,
        actual: "Not Configured",
        error: `No test expression defined for language "${language}"`,
      })),
      passedCount: 0,
      totalCount: testConfig.testCases.length,
    };
  }

  const { testCases } = testConfig;
  const wrappedCode = wrapCodeForTests(code, language, testCases);
  const res = await executeViaPiston(wrappedCode, language);

  if (!res.success && !res.stdout && res.stderr) {
    return {
      success: false,
      results: testCases.map((t) => ({
        passed: false,
        input: t.input[language]!,
        expected: t.expected,
        actual: "Compilation / Execution Error",
        error: res.stderr,
      })),
      passedCount: 0,
      totalCount: testCases.length,
    };
  }

  const markerIdx = res.stdout.indexOf(MARKER);
  if (markerIdx === -1) {
    return {
      success: false,
      results: testCases.map((t) => ({
        passed: false,
        input: t.input[language]!,
        expected: t.expected,
        actual: "Runtime Error",
        error: res.stderr || res.stdout || "Did not execute tests.",
      })),
      passedCount: 0,
      totalCount: testCases.length,
    };
  }

  const lines = res.stdout.substring(markerIdx + MARKER.length).trim().split(/\r?\n/);

  const results: TestResult[] = testCases.map((test, idx) => {
    const line = lines[idx] ? lines[idx].trim() : "";
    if (line.startsWith("ERROR:")) {
      return {
        passed: false,
        input: test.input[language]!,
        expected: test.expected,
        actual: "Exception",
        error: line.substring(6).trim(),
      };
    }
    const passed = normalize(line) === normalize(test.expected);
    return { passed, input: test.input[language]!, expected: test.expected, actual: line || "No Output" };
  });

  const passedCount = results.filter((r) => r.passed).length;
  return { success: passedCount === testCases.length, results, passedCount, totalCount: testCases.length };
}

function normalize(s: string): string {
  return s.replace(/\s/g, "").replace(/["']/g, "").toLowerCase();
}

function wrapCodeForTests(code: string, language: LanguageId, tests: TestCase[]): string {
  if (language === "javascript" || language === "typescript") {
    return `
${code}

console.log("${MARKER}");
${tests
  .map(
    (t) => `
try {
  console.log(JSON.stringify(${t.input[language]}));
} catch(e) {
  console.log("ERROR: " + e.message);
}
`
  )
  .join("\n")}
`;
  }

  if (language === "python") {
    return `
${code}

import json
print("${MARKER}")
${tests
  .map(
    (t) => `
try:
    __val = ${t.input[language]}
    print(json.dumps(__val))
except Exception as e:
    print("ERROR: " + str(e))
`
  )
  .join("\n")}
`;
  }

  if (language === "java") {
    const calls = tests
      .map(
        (t) => `
        try {
            printVal(solver.${t.input[language]});
        } catch (Exception e) {
            System.out.println("ERROR: " + e.getMessage());
        }`
      )
      .join("\n");

    return `
import java.util.*;
${code}

public class Main {
    static void printVal(int[] v) { System.out.println(Arrays.toString(v)); }
    static void printVal(long[] v) { System.out.println(Arrays.toString(v)); }
    static void printVal(double[] v) { System.out.println(Arrays.toString(v)); }
    static void printVal(String[] v) { System.out.println(Arrays.toString(v)); }
    static void printVal(boolean v) { System.out.println(v); }
    static void printVal(List<?> v) { System.out.println(v.toString().replace(" ", "")); }
    static void printVal(Object v) { System.out.println(String.valueOf(v)); }

    public static void main(String[] args) {
        System.out.println("${MARKER}");
        Solution solver = new Solution();
${calls}
    }
}
`;
  }

  if (language === "cpp") {
    const calls = tests
      .map(
        (t) => `
    try {
        printVal(solver.${t.input[language]});
    } catch (const exception& e) {
        cout << "ERROR: " << e.what() << endl;
    }`
      )
      .join("\n");

    return `
#include <iostream>
#include <vector>
#include <string>
using namespace std;

${code}

template<typename T>
void printVal(const vector<T>& v) {
    cout << "[";
    for (size_t i = 0; i < v.size(); i++) {
        cout << v[i];
        if (i + 1 < v.size()) cout << ",";
    }
    cout << "]" << endl;
}
void printVal(bool v) { cout << (v ? "true" : "false") << endl; }
template<typename T>
void printVal(const T& v) { cout << v << endl; }

int main() {
    cout << "${MARKER}" << endl;
    Solution solver;
${calls}
    return 0;
}
`;
  }

  return code;
}