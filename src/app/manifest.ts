import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PesaFlow Cash Flow Budget",
    short_name: "PesaFlow",
    start_url: "/app",
    display: "standalone",
    background_color: "#f6f7f5",
    theme_color: "#0f7b3f",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
