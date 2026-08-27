import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: "https://exevra.github.io",
  base: "/exevra",
  integrations: [
    starlight({
      title: "Exevra",
      description: "Detect unexpected test-execution changes in CI.",
      logo: {
        light: "./src/assets/exevra-folded-trace.svg",
        dark: "./src/assets/exevra-folded-trace-dark.svg",
        alt: "",
      },
      customCss: ["./src/styles/exevra.css"],
      head: [
        {
          tag: "script",
          attrs: {
            "data-astro-rerun": true,
          },
          content: `
            (() => {
              const key = "__exevraContext7Load";
              const load = () => {
                if (!document.body || document.querySelector("#context7-widget")) return;
                const script = document.createElement("script");
                script.src = "https://context7.com/widget.js";
                script.dataset.library = "/exevra/exevra";
                document.body.appendChild(script);
              };

              if (!window[key]) {
                window[key] = load;
                document.addEventListener("astro:page-load", load);
              }

              if (document.readyState === "loading") {
                document.addEventListener("DOMContentLoaded", load, { once: true });
              } else {
                load();
              }
            })();
          `,
        },
      ],
      components: {
        Hero: "./src/components/ExevraHero.astro",
        SiteTitle: "./src/components/ExevraSiteTitle.astro",
      },
      sidebar: [
        { label: "Start here", items: ["getting-started"] },
        { label: "Guides", items: [{ autogenerate: { directory: "guides" } }] },
        { label: "Reference", items: [{ autogenerate: { directory: "reference" } }] },
      ],
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/Exevra/exevra",
        },
      ],
    }),
  ],
});
