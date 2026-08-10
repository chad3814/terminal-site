/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@wterm/core", "@wterm/dom", "@wterm/react", "@wterm/ghostty"],
  serverExternalPackages: ["node-pty"],
};

export default nextConfig;
