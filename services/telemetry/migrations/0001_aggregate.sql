CREATE TABLE daily_startups (
    day TEXT NOT NULL,
    result TEXT NOT NULL CHECK (result IN ('ready', 'failed')),
    version TEXT NOT NULL,
    platform TEXT NOT NULL CHECK (platform IN ('win32', 'darwin', 'linux')),
    count INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (day, result, version, platform)
) WITHOUT ROWID;
