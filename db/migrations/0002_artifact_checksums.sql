ALTER TABLE artifacts RENAME COLUMN sha256 TO checksum;
ALTER TABLE artifacts ADD COLUMN checksum_algorithm text NOT NULL DEFAULT 'crc32c';
