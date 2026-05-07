import { spawn } from "child_process";

const child = spawn("opencode", ["--prompt", "Hello", "--model", "cursor/composer-2"], {
  env: { ...process.env, LOG_LEVEL: "trace", DEBUG: "*" },
  stdio: "pipe"
});

let output = "";

child.stdout.on("data", (data) => {
  output += data.toString();
});

child.stderr.on("data", (data) => {
  output += data.toString();
});

child.on("close", () => {
  // Extract error trace if any
  const errors = output.match(/Error:[\s\S]*?(?=\n\n|\Z)/g);
  console.log("=== ERRORS ===");
  if (errors) {
    errors.forEach(e => console.log(e));
  } else {
    console.log("No stack traces found. Full output:");
    // console.log(output.substring(output.length - 2000));
  }
});
