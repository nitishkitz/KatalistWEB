export default async function () {
  const baseUrl = process.env.URL;
  const secret = process.env.MAGIC_BOX_CLEANUP_SECRET;
  if (!baseUrl || !secret) return new Response("disabled", { status: 503 });
  return fetch(`${baseUrl}/api/cron/magic-box-attachment-cleanup`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
  });
}

export const config = { schedule: "0 * * * *" };
