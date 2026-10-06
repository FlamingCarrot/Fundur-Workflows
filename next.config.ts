import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Notes readers for brief drafting load their own workers and data files at
  // run time, so they run from node_modules rather than being bundled.
  serverExternalPackages: ["unpdf", "mammoth"],
};

export default nextConfig;
