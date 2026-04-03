import { createInterface } from "readline";

/** Prompt the user for a yes/no answer on stderr. Returns true if they answer yes (or press Enter). */
export async function promptConfirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      resolve(a === "y" || a === "yes" || a === "");
    });
  });
}
