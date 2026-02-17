const config = {
  apps: [
    {
      name: "astrum",
      script: "dist/server.js",
      exec_mode: "cluster",
      instances: 4,
      // instances: "max",
      max_memory_restart: "1G",
      watch: false,
      merge_logs: true,
      instance_var: "INSTANCE_ID",
      out_file: "./logs/out-%i.log",
      error_file: "./logs/error-%i.log",
      env: {
        NODE_ENV: "production",
        HOST: "0.0.0.0",
        PORT: "3000",
        OUTPUT_DIR: process.env.OUTPUT_DIR || "./output",
      },
    },
  ],
};

export default config;

if (typeof module !== "undefined") {
  module.exports = config;
}
