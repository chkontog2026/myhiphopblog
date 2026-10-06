CREATE INDEX `releases_date_idx` ON `releases` (`publish_date`,`position`);--> statement-breakpoint
CREATE INDEX `tracks_release_idx` ON `tracks` (`release_id`,`position`);