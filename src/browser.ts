export const IS_SERVERLESS =
  process.env.VERCEL === '1' ||
  process.env.AWS_LAMBDA_FUNCTION_NAME !== undefined ||
  process.env.FUNCTION_NAME !== undefined;

// Set BROWSER_WS_ENDPOINT to a managed browser service (Browserless.io, BrowserBase, etc.)
// to skip local Chromium entirely — no /tmp limit, no memory pressure, works on Vercel free.
export const MANAGED_BROWSER = !!process.env.BROWSER_WS_ENDPOINT;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function launchBrowser(): Promise<any> {
  const { chromium } = await import('playwright-core');

  if (process.env.BROWSER_WS_ENDPOINT) {
    return chromium.connectOverCDP(process.env.BROWSER_WS_ENDPOINT);
  }

  if (IS_SERVERLESS) {
    const sparticuz = await import('@sparticuz/chromium');
    return chromium.launch({
      args: sparticuz.default.args,
      executablePath: await sparticuz.default.executablePath(),
      headless: true,
    });
  }

  return chromium.launch({ headless: true });
}
