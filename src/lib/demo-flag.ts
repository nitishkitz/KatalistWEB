export function demoModeFromEnv(value: string | undefined): boolean {
  return value === "true";
}

export function demoEnabled(): boolean {
  return demoModeFromEnv(import.meta.env.VITE_KATALIST_DEMO_MODE);
}
