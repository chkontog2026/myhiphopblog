import { ensureCmsSchema, getCmsContent, getD1 } from "../../../../db/cms";
import { storeMedia } from "../../../../db/media";
import { errorResponse, formFile, formText, requireAdminApi } from "../_auth";

const imageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export async function PUT(request: Request) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  try {
    await ensureCmsSchema();
    const form = await request.formData();
    const current = (await getCmsContent(true)).settings;
    const headerImage = formFile(form, "header_image");
    if (headerImage && (!imageTypes.has(headerImage.type) || headerImage.size > 12 * 1024 * 1024)) {
      return Response.json({ error: "Η φωτογραφία header πρέπει να είναι JPG, PNG, WEBP ή GIF έως 12 MB." }, { status: 400 });
    }

    let headerImageUrl = formText(form, "remove_header_image") === "1" ? "" : current.headerImageUrl;
    if (headerImage) headerImageUrl = (await storeMedia(headerImage, "headers")).url;

    const values = {
      blogTitle: formText(form, "blog_title"),
      tagline: formText(form, "tagline"),
      headerColor: formText(form, "header_color") || "#4e5e4a",
      aboutTitle: formText(form, "about_title"),
      aboutText: formText(form, "about_text"),
      categoriesTitle: formText(form, "categories_title"),
      archiveTitle: formText(form, "archive_title"),
      linksTitle: formText(form, "links_title"),
      homeLabel: formText(form, "home_label"),
      releasesLabel: formText(form, "releases_label"),
      aboutLabel: formText(form, "about_label"),
      contactLabel: formText(form, "contact_label"),
      contactEmail: formText(form, "contact_email"),
      instagramUrl: formText(form, "instagram_url"),
      soundcloudUrl: formText(form, "soundcloud_url"),
      footerText: formText(form, "footer_text"),
    };
    if (!values.blogTitle) return Response.json({ error: "Ο τίτλος του blog είναι υποχρεωτικός." }, { status: 400 });

    await getD1().prepare(`UPDATE site_settings SET
      blog_title = ?, tagline = ?, header_color = ?, header_image_url = ?,
      about_title = ?, about_text = ?, categories_title = ?, archive_title = ?, links_title = ?,
      home_label = ?, releases_label = ?, about_label = ?, contact_label = ?, contact_email = ?,
      instagram_url = ?, soundcloud_url = ?, footer_text = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = 1`)
      .bind(
        values.blogTitle, values.tagline, values.headerColor, headerImageUrl,
        values.aboutTitle, values.aboutText, values.categoriesTitle, values.archiveTitle, values.linksTitle,
        values.homeLabel, values.releasesLabel, values.aboutLabel, values.contactLabel, values.contactEmail,
        values.instagramUrl, values.soundcloudUrl, values.footerText,
      ).run();

    return Response.json({ settings: (await getCmsContent(true)).settings });
  } catch (error) {
    return errorResponse(error);
  }
}
