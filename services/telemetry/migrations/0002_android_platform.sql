CREATE TABLE daily_startups_next (
    day TEXT NOT NULL,
    result TEXT NOT NULL CHECK (result IN ('ready', 'failed')),
    version TEXT NOT NULL,
    platform TEXT NOT NULL CHECK (platform IN ('win32', 'darwin', 'linux', 'android')),
    count INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (day, result, version, platform)
) WITHOUT ROWID;

INSERT INTO daily_startups_next (day, result, version, platform, count)
SELECT day, result, version, platform, count FROM daily_startups;

DROP TABLE daily_startups;
ALTER TABLE daily_startups_next RENAME TO daily_startups;
