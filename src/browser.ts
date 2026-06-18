/**
 * Shared browser launcher — uses @sparticuz/chromium on Vercel/serverless,
 * falls back to the locally-installed Playwright Chromium in dev/CLI.
 */

export const IS_SERVERLESS =
  process.env.VERCEL === '1' ||
  process.env.AWS_LAMBDA_FUNCTION_NAME !== undefined ||
  process.env.FUNCTION_NAME !== undefined;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function launchBrowser(): Promise<any> {
  const { chromium } = await import('playwright-core');

  if (IS_SERVERLESS) {
    const sparticuz = await import('@sparticuz/chromium');
    return chromium.launch({
      args: sparticuz.default.args,
      executablePath: await sparticuz.default.executablePath(),
      headless: true,
    });
  }

  // Local dev / CLI — use Playwright's own bundled Chromium
  return chromium.launch({ headless: true });
}
