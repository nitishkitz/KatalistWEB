export function demoEnabled(): boolean {
  return import.meta.env.DEV || import.meta.env.VITE_KATALIST_DEMO_MODE === "true";
}
