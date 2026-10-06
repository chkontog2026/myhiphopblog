import { getCmsContent } from "../../../../db/cms";
import { errorResponse, requireAdminApi } from "../_auth";

export async function GET() {
  const denied = await requireAdminApi();
  if (denied) return denied;
  try {
    return Response.json({ content: await getCmsContent(true) });
  } catch (error) {
    return errorResponse(error);
  }
}
