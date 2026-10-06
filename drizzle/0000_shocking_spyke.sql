CREATE TABLE `releases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`artist` text NOT NULL,
	`title` text NOT NULL,
	`publish_date` text NOT NULL,
	`genre` text DEFAULT 'Άλλο' NOT NULL,
	`format` text DEFAULT 'MP3' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`cover_url` text DEFAULT '' NOT NULL,
	`cover_key` text DEFAULT '' NOT NULL,
	`download_url` text DEFAULT '' NOT NULL,
	`download_key` text DEFAULT '' NOT NULL,
	`download_name` text DEFAULT '' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`published` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `releases_slug_unique` ON `releases` (`slug`);--> statement-breakpoint
CREATE TABLE `site_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`owner_email` text,
	`blog_title` text DEFAULT 'NEEDLE / DROP' NOT NULL,
	`tagline` text DEFAULT 'μουσική για κατέβασμα · νέα releases & παλιά αγαπημένα' NOT NULL,
	`header_color` text DEFAULT '#4e5e4a' NOT NULL,
	`header_image_url` text DEFAULT '' NOT NULL,
	`about_title` text DEFAULT 'Σχετικά' NOT NULL,
	`about_text` text DEFAULT 'Μικρό ανεξάρτητο blog για μουσική, mixtapes και κυκλοφορίες που μοιράζονται ελεύθερα.' NOT NULL,
	`categories_title` text DEFAULT 'Κατηγορίες' NOT NULL,
	`archive_title` text DEFAULT 'Αρχείο' NOT NULL,
	`links_title` text DEFAULT 'Links' NOT NULL,
	`home_label` text DEFAULT 'Αρχική' NOT NULL,
	`releases_label` text DEFAULT 'Κυκλοφορίες' NOT NULL,
	`about_label` text DEFAULT 'Σχετικά' NOT NULL,
	`contact_label` text DEFAULT 'Επικοινωνία' NOT NULL,
	`contact_email` text DEFAULT 'hello@needledrop.gr' NOT NULL,
	`instagram_url` text DEFAULT '' NOT NULL,
	`soundcloud_url` text DEFAULT '' NOT NULL,
	`footer_text` text DEFAULT 'NEEDLE / DROP · 2026' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tracks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`release_id` integer NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`title` text NOT NULL,
	FOREIGN KEY (`release_id`) REFERENCES `releases`(`id`) ON UPDATE no action ON DELETE cascade
);
