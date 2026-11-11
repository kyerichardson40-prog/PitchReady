import type { Page } from 'playwright';

/**
 * Simulated demo sign-in: role picker on the start page → fictional account → Sign in.
 * `start` is the demo's start URL (the dev server's `/`, or the standalone file).
 */
export async function demoSignIn(page: Page, start: string, role: 'rep' | 'manager', name: string) {
  await page.goto(start);
  await signInFromPicker(page, role, name);
}

/** Opens the header Menu (if it isn't open) and chooses a page, or "Sign out". */
export async function menu(page: Page, item: string) {
  const btn = page.getByRole('button', { name: 'Menu', exact: true });
  if ((await btn.getAttribute('aria-expanded')) !== 'true') await btn.click();
  const panel = page.getByRole('navigation', { name: 'Menu' });
  if (item === 'Sign out') await panel.getByRole('button', { name: /^Sign out/ }).click();
  else await panel.getByRole('link', { name: item, exact: true }).click();
}

/** Signs out (back to the homepage) and signs in as someone else, without reloading. */
export async function demoSwitch(page: Page, role: 'rep' | 'manager', name: string) {
  await menu(page, 'Sign out');
  await signInFromPicker(page, role, name);
}

async function signInFromPicker(page: Page, role: 'rep' | 'manager', name: string) {
  await page.getByRole('link', { name: role === 'rep' ? 'Try it as a rep' : 'Try it as a manager' }).first().click();
  await page.getByRole('radio', { name: new RegExp(name) }).check();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: role === 'rep' ? 'Practise' : 'Team overview', exact: true }).waitFor();
}
