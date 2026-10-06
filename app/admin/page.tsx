import { chatGPTSignOutPath, requireChatGPTUser } from "../chatgpt-auth";
import { claimAdmin, getCmsContent } from "../../db/cms";
import AdminPanel from "./AdminPanel";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await requireChatGPTUser("/admin");
  const isAdmin = await claimAdmin(user.email);

  if (!isAdmin) {
    return (
      <main className="admin-denied">
        <h1>Δεν έχεις πρόσβαση</h1>
        <p>Το διαχειριστικό ανήκει σε διαφορετικό λογαριασμό.</p>
        <a href="/">Επιστροφή στο blog</a>
      </main>
    );
  }

  const content = await getCmsContent(true);
  return (
    <AdminPanel
      initialContent={content}
      userEmail={user.email}
      signOutUrl={chatGPTSignOutPath("/")}
    />
  );
}
