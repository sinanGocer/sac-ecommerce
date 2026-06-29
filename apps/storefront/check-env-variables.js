const c = require("ansi-colors");

const requiredEnvs = [
  {
    key: "NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY",
    // TODO: we need a good doc to point this to
    description:
      "Learn how to create a publishable key: https://docs.medusajs.com/v2/resources/storefront-development/publishable-api-keys",
  },
  {
    key: "NEXT_PUBLIC_MEDUSA_BACKEND_URL",
    description:
      "URL of the Medusa backend API the storefront talks to (e.g. http://localhost:9000).",
  },
];

const isProduction = process.env.NODE_ENV === "production";

function checkEnvVariables() {
  const missingEnvs = requiredEnvs.filter(function (env) {
    c;
    return !process.env[env.key];
  });

  if (missingEnvs.length > 0) {
    console.error(
      c.red.bold("\n🚫 Error: Missing required environment variables\n")
    );

    missingEnvs.forEach(function (env) {
      console.error(c.yellow(`  ${c.bold(env.key)}`));
      if (env.description) {
        console.error(c.dim(`    ${env.description}\n`));
      }
    });

    console.error(
      c.yellow(
        "\nPlease set these variables in your .env file or environment before starting the application.\n"
      )
    );

    process.exit(1);
  }

  // Base URL: production'da zorunlu ve HTTPS olmalı (canonical/OG/sitemap için).
  const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL || "").trim();
  if (!baseUrl) {
    const msg =
      "NEXT_PUBLIC_BASE_URL is not set; canonical/OG/sitemap URLs fall back to http://localhost:8000.";
    if (isProduction) {
      console.error(c.red.bold(`\n🚫 Error: ${msg}\n`));
      process.exit(1);
    }
    console.warn(c.yellow(`\n⚠️  ${msg}\n`));
  } else if (isProduction) {
    let parsed;
    try {
      parsed = new URL(baseUrl);
    } catch {
      console.error(c.red.bold(`\n🚫 Error: NEXT_PUBLIC_BASE_URL is not a valid URL: ${baseUrl}\n`));
      process.exit(1);
    }
    if (parsed && parsed.protocol !== "https:") {
      console.error(
        c.red.bold("\n🚫 Error: NEXT_PUBLIC_BASE_URL must use HTTPS in production.\n")
      );
      process.exit(1);
    }
  }
}

module.exports = checkEnvVariables;
