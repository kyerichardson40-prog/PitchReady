import type { Page } from 'playwright';

/**
 * Simulated demo sign-in: role picker on the start page → fictional account → Sign in.
 * `start` is the demo's start URL (the dev server's `/`, or the standalone file).
 */
export async function demoSignIn(page: Page, start: string, role: 'rep' | 'manager', name: string) {
  await page.goto(start);
  await signInFromPicker(page, role, name);
}

/** Signs out (back to the homepage) and signs in as someone else, without reloading. */
export async function demoSwitch(page: Page, role: 'rep' | 'manager', name: string) {
  await page.getByRole('button', { name: /^Sign out/ }).click();
  await signInFromPicker(page, role, name);
}

async function signInFromPicker(page: Page, role: 'rep' | 'manager', name: string) {
  await page.getByRole('link', { name: role === 'rep' ? 'Try it as a rep' : 'Try it as a manager' }).first().click();
  await page.getByRole('radio', { name: new RegExp(name) }).check();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: role === 'rep' ? 'Practise' : 'Team overview', exact: true }).waitFor();
}
