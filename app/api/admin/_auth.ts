import { getChatGPTUser } from "../../chatgpt-auth";
import { claimAdmin } from "../../../db/cms";

export async function requireAdminApi(): Promise<Response | null> {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Απαιτείται σύνδεση." }, { status: 401 });
  const allowed = await claimAdmin(user.email);
  if (!allowed) return Response.json({ error: "Δεν έχεις πρόσβαση στο διαχειριστικό." }, { status: 403 });
  return null;
}

export function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Παρουσιάστηκε άγνωστο σφάλμα.";
  return Response.json({ error: message }, { status: 500 });
}

export function formText(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export function formFile(form: FormData, key: string) {
  const value = form.get(key);
  return value instanceof File && value.size > 0 ? value : null;
}
