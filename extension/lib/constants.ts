/** Native messaging host name (see bridge/src/constants.ts). */
export const HOST_NAME = 'com.spoor.bridge';

/** Extension ID derived from the fixed manifest key in wxt.config.ts. */
export const EXTENSION_ID = 'nfdcncheigkogigcjnjpinbmfoibebme';

export const SCHEMA_VERSION = 1 as const;

/** A new session starts after this much idle time. */
export const SESSION_IDLE_MS = 5 * 60_000;

/** chrome.idle detection interval, in seconds. Same as the session rule. */
export const IDLE_DETECTION_SECONDS = 300;

/** Maximum events per bridge batch. */
export const BATCH_SIZE = 200;

export const VALUE_MAX_CHARS = 1000;
export const CLIPBOARD_MAX_CHARS = 200;
export const LABEL_MAX_CHARS = 60;
export const AI_TEXT_MAX_CHARS = 20_000;

/** Identical events within this window are dropped. */
export const THROTTLE_MS = 500;
