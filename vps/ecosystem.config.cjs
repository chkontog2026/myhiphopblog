module.exports = {
  apps: [{
    name: "myhiphopblog",
    script: "server.mjs",
    cwd: "/opt/myhiphopblog",
    node_args: "--env-file=/opt/myhiphopblog/.env",
    autorestart: true,
    max_memory_restart: "500M",
  }],
};
