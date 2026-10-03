import type { Page } from "@playwright/test";

export function chooseSession(page: Page, instance: string): Promise<void>;
