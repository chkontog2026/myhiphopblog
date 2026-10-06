import { ensureCmsSchema, getD1 } from "../../../db/cms";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return Response.json({ error: "Μη έγκυρο αίτημα." }, { status: 415 });
    }

    const body = await request.json() as { email?: unknown; website?: unknown };
    if (typeof body.website === "string" && body.website.trim()) {
      return Response.json({ message: "Η εγγραφή ολοκληρώθηκε!" }, { status: 200 });
    }

    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!emailPattern.test(email) || email.length > 254) {
      return Response.json({ error: "Γράψε μια έγκυρη διεύθυνση email." }, { status: 400 });
    }

    await ensureCmsSchema();
    const result = await getD1()
      .prepare("INSERT OR IGNORE INTO newsletter_subscribers (email) VALUES (?)")
      .bind(email)
      .run();

    return Response.json(
      {
        message: result.meta.changes
          ? "Η εγγραφή ολοκληρώθηκε!"
          : "Είσαι ήδη στη λίστα μας.",
      },
      { status: result.meta.changes ? 201 : 200 },
    );
  } catch {
    return Response.json({ error: "Κάτι πήγε στραβά. Δοκίμασε ξανά." }, { status: 500 });
  }
}
