const commitSha = process.env.STABLE_CORRIDOR_COMMIT_SHA;
const nodeInterpreter = process.env.STABLE_CORRIDOR_NODE;

if (!/^[0-9a-f]{7,64}$/iu.test(commitSha ?? "")) {
  throw new Error(
    "STABLE_CORRIDOR_COMMIT_SHA must contain the deployed Git commit"
  );
}
if (!nodeInterpreter?.startsWith("/")) {
  throw new Error(
    "STABLE_CORRIDOR_NODE must contain the absolute Node.js 24 path"
  );
}

module.exports = {
  apps: [
    {
      name: "stable-corridor-collector",
      cwd: "/opt/stable-corridor",
      script: "dist/collector/entrypoint.js",
      args: ["/opt/stable-corridor/config/collector.json"],
      interpreter: nodeInterpreter,
      node_args: ["--enable-source-maps"],
      instances: 1,
      exec_mode: "fork",
      autorestart: false,
      kill_timeout: 30000,
      time: true,
      out_file: "/var/log/stable-corridor/collector-out.log",
      error_file: "/var/log/stable-corridor/collector-error.log",
      env: {
        NODE_ENV: "production",
        STABLE_CORRIDOR_COMMIT_SHA: commitSha,
        STABLE_CORRIDOR_NODE: nodeInterpreter
      }
    }
  ]
};
