"use client";

import { FormEvent, useState } from "react";

type FormStatus = { kind: "idle" | "loading" | "success" | "error"; message: string };

export default function NewsletterForm() {
  const [status, setStatus] = useState<FormStatus>({ kind: "idle", message: "" });

  async function subscribe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setStatus({ kind: "loading", message: "Γίνεται η εγγραφή…" });

    try {
      const response = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: formData.get("email"),
          website: formData.get("website"),
        }),
      });
      const result = await response.json() as { message?: string; error?: string };
      if (!response.ok) throw new Error(result.error || "Η εγγραφή δεν ολοκληρώθηκε.");

      form.reset();
      setStatus({ kind: "success", message: result.message || "Η εγγραφή ολοκληρώθηκε!" });
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Κάτι πήγε στραβά. Δοκίμασε ξανά.",
      });
    }
  }

  return (
    <form className="newsletter-form" onSubmit={subscribe}>
      <div className="newsletter-honeypot" aria-hidden="true">
        <label htmlFor="newsletter-website">Website</label>
        <input id="newsletter-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>
      <label className="newsletter-honeypot" htmlFor="newsletter-email">Email</label>
      <div className="newsletter-fields">
        <input
          id="newsletter-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="e-mail"
          aria-describedby="newsletter-status"
          disabled={status.kind === "loading"}
          required
        />
        <button type="submit" disabled={status.kind === "loading"}>
          {status.kind === "loading" ? "…" : "Εγγραφή"}
        </button>
      </div>
      <p
        className={`newsletter-status${status.kind === "success" ? " success" : status.kind === "error" ? " error" : ""}`}
        id="newsletter-status"
        role="status"
        aria-live="polite"
      >{status.message}</p>
    </form>
  );
}
